import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  OfflineTrack,
  TrackNotFoundError,
  __resetOfflineDbForTests,
  archiveTrack,
  deleteVisualizerRender,
  getOfflineDb,
  getSyncMeta,
  getTrackById,
  listAllTracks,
  listTracksByStatus,
  listVisualizerRenders,
  restoreTrack,
  saveVisualizerRender,
  setGoneFromRemote,
  setSyncMeta,
  updateTrack,
  upsertTracks,
} from './offlineDb';

const DB_NAME = 'suno-architect-offline';

const makeTrack = (id: string, overrides: Partial<OfflineTrack> = {}): OfflineTrack => ({
  id,
  sunoId: id,
  title: `Track ${id}`,
  audioUrl: `https://cdn1.suno.ai/${id}.mp3`,
  imageUrl: `https://cdn2.suno.ai/image_${id}.jpeg`,
  lyricsText: '',
  lrcContent: '',
  srtContent: '',
  metadata: { tags: ['pop'], prompt: '', durationMs: 1000 },
  cachedLocally: false,
  raw: {},
  createdAt: 1,
  updatedAt: 1,
  ...overrides,
});

beforeEach(async () => {
  await __resetOfflineDbForTests();
  // Fresh IndexedDB per test.
  (globalThis as any).indexedDB = new IDBFactory();
});

describe('offlineDb schema', () => {
  it('creates all 5 stores with indexes at v3', async () => {
    const db = await getOfflineDb();
    const names = Array.from(db.objectStoreNames).sort();
    expect(names).toEqual(['albums', 'playlists', 'syncMeta', 'tracks', 'visualizer_renders']);
    expect(db.version).toBe(3);
    const tx = db.transaction('tracks', 'readonly');
    expect(Array.from(tx.store.indexNames).sort()).toEqual(['byCreatedAt', 'byUpdatedAt']);
    const rtx = db.transaction('visualizer_renders', 'readonly');
    expect(Array.from(rtx.store.indexNames)).toEqual(['byCreatedAt']);
  });

  it('upgrades a legacy v2-shaped DB to v3 and keeps track rows readable', async () => {
    // Build a v2 DB by hand: tracks/albums/playlists/syncMeta only (no visualizer_renders).
    const legacyRow = makeTrack('legacy-1', { updatedAt: 5 });
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 2);
      req.onupgradeneeded = () => {
        const db = req.result;
        const tracks = db.createObjectStore('tracks', { keyPath: 'id' });
        tracks.createIndex('byUpdatedAt', 'updatedAt');
        tracks.createIndex('byCreatedAt', 'createdAt');
        db.createObjectStore('albums', { keyPath: 'id' }).createIndex('byUpdatedAt', 'updatedAt');
        db.createObjectStore('playlists', { keyPath: 'id' }).createIndex('byUpdatedAt', 'updatedAt');
        db.createObjectStore('syncMeta', { keyPath: 'key' });
      };
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('tracks', 'readwrite');
        tx.objectStore('tracks').put(legacyRow);
        tx.oncomplete = () => {
          db.close();
          resolve();
        };
        tx.onerror = () => reject(tx.error);
      };
      req.onerror = () => reject(req.error);
    });

    const db = await getOfflineDb();
    expect(db.version).toBe(3);
    expect(db.objectStoreNames.contains('visualizer_renders')).toBe(true);
    const row = await getTrackById('legacy-1');
    expect(row).toBeDefined();
    expect(row?.title).toBe('Track legacy-1');
    // Legacy rows have no archive fields and are therefore active.
    const buckets = await listTracksByStatus();
    expect(buckets.active.map((t) => t.id)).toEqual(['legacy-1']);
  });
});

describe('track CRUD', () => {
  it('upsertTracks / updateTrack round-trip', async () => {
    await upsertTracks([makeTrack('a'), makeTrack('b')]);
    expect((await listAllTracks()).map((t) => t.id).sort()).toEqual(['a', 'b']);
    await updateTrack(makeTrack('a', { title: 'Renamed' }));
    expect((await getTrackById('a'))?.title).toBe('Renamed');
    expect((await listAllTracks()).length).toBe(2);
  });

  it('getTrackById miss returns undefined', async () => {
    expect(await getTrackById('nope')).toBeUndefined();
  });

  it('upsertTracks with empty array is a no-op', async () => {
    await upsertTracks([]);
    expect(await listAllTracks()).toEqual([]);
  });
});

describe('archive / restore / gone helpers', () => {
  it('archiveTrack sets archivedAt and round-trips', async () => {
    await upsertTracks([makeTrack('a')]);
    const archived = await archiveTrack('a');
    expect(typeof archived.archivedAt).toBe('number');
    const stored = await getTrackById('a');
    expect(stored?.archivedAt).toBe(archived.archivedAt);
  });

  it('archiveTrack twice is idempotent (keeps first timestamp)', async () => {
    await upsertTracks([makeTrack('a')]);
    const first = await archiveTrack('a', 100);
    const second = await archiveTrack('a', 200);
    expect(second.archivedAt).toBe(100);
    expect(first.archivedAt).toBe(100);
    expect((await getTrackById('a'))?.archivedAt).toBe(100);
  });

  it('restoreTrack clears archivedAt only, never goneFromRemote', async () => {
    await upsertTracks([makeTrack('a', { archivedAt: 50, goneFromRemote: true })]);
    const restored = await restoreTrack('a');
    expect(restored.archivedAt).toBeUndefined();
    expect(restored.goneFromRemote).toBe(true);
    const stored = await getTrackById('a');
    expect('archivedAt' in (stored as object)).toBe(false);
    expect(stored?.goneFromRemote).toBe(true);
  });

  it('setGoneFromRemote toggles the flag', async () => {
    await upsertTracks([makeTrack('a')]);
    await setGoneFromRemote('a', true);
    expect((await getTrackById('a'))?.goneFromRemote).toBe(true);
    await setGoneFromRemote('a', false);
    expect((await getTrackById('a'))?.goneFromRemote).toBe(false);
  });

  it('rejects with TrackNotFoundError for a missing record (no silent no-op)', async () => {
    await expect(archiveTrack('missing')).rejects.toBeInstanceOf(TrackNotFoundError);
    await expect(restoreTrack('missing')).rejects.toBeInstanceOf(TrackNotFoundError);
    await expect(setGoneFromRemote('missing', true)).rejects.toBeInstanceOf(TrackNotFoundError);
    await expect(archiveTrack('missing')).rejects.toMatchObject({ name: 'TrackNotFoundError', trackId: 'missing' });
    expect(await listAllTracks()).toEqual([]);
  });

  it('rejects when the record was deleted mid-flight (absent record path)', async () => {
    await upsertTracks([makeTrack('a')]);
    const db = await getOfflineDb();
    await db.delete('tracks', 'a');
    await expect(archiveTrack('a')).rejects.toBeInstanceOf(TrackNotFoundError);
  });
});

describe('listTracksByStatus', () => {
  it('returns empty buckets on an empty DB', async () => {
    const buckets = await listTracksByStatus();
    expect(buckets).toEqual({ active: [], archived: [], goneFromRemote: [], all: [] });
  });

  it('buckets a seeded mix correctly and sorts by updatedAt desc', async () => {
    await upsertTracks([
      makeTrack('active-old', { updatedAt: 1 }),
      makeTrack('active-new', { updatedAt: 9 }),
      makeTrack('archived', { updatedAt: 5, archivedAt: 123 }),
      makeTrack('gone', { updatedAt: 7, goneFromRemote: true }),
      makeTrack('both', { updatedAt: 3, archivedAt: 5, goneFromRemote: true }),
    ]);
    const b = await listTracksByStatus();
    expect(b.active.map((t) => t.id)).toEqual(['active-new', 'gone', 'active-old']);
    expect(b.archived.map((t) => t.id)).toEqual(['archived', 'both']);
    expect(b.goneFromRemote.map((t) => t.id)).toEqual(['gone', 'both']);
    expect(b.all.map((t) => t.id)).toEqual(['active-new', 'gone', 'archived', 'both', 'active-old']);
    // A track with both flags appears in archived AND goneFromRemote.
    expect(b.archived.some((t) => t.id === 'both') && b.goneFromRemote.some((t) => t.id === 'both')).toBe(true);
    expect(b.active.some((t) => t.id === 'both')).toBe(false);
  });

  it('tolerates a malformed row missing metadata/optional fields (still lands in all)', async () => {
    const db = await getOfflineDb();
    // idb is schema-less on fields: only the keyPath is required.
    await db.put('tracks', { id: 'raw', title: 'raw row' } as unknown as OfflineTrack);
    const b = await listTracksByStatus();
    expect(b.all.map((t) => t.id)).toEqual(['raw']);
    expect(b.active.map((t) => t.id)).toEqual(['raw']);
    expect(b.archived).toEqual([]);
    expect(b.goneFromRemote).toEqual([]);
  });
});

describe('visualizer renders + sync meta', () => {
  it('saveVisualizerRender / listVisualizerRenders / deleteVisualizerRender round-trip', async () => {
    await saveVisualizerRender({ id: 'r1', clipId: 'c', clipTitle: 'C', createdAt: 1, settings: {} });
    await saveVisualizerRender({ id: 'r2', clipId: 'c', clipTitle: 'C', createdAt: 2, settings: {} });
    const list = await listVisualizerRenders();
    expect(list.map((r) => r.id)).toEqual(['r2', 'r1']);
    await deleteVisualizerRender('r2');
    expect((await listVisualizerRenders()).map((r) => r.id)).toEqual(['r1']);
  });

  it('setSyncMeta / getSyncMeta round-trip and miss', async () => {
    expect(await getSyncMeta('lastSyncAt')).toBeUndefined();
    await setSyncMeta('lastSyncAt', 42);
    expect(await getSyncMeta<number>('lastSyncAt')).toBe(42);
    await setSyncMeta('lastSyncAt', 43);
    expect(await getSyncMeta<number>('lastSyncAt')).toBe(43);
  });
});
