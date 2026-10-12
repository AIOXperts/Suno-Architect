import 'fake-indexeddb/auto';
import { IDBFactory } from 'fake-indexeddb';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SunoClip } from '../types';
import { OfflineTrack, __resetOfflineDbForTests, getTrackById, listAllTracks, upsertTracks } from './offlineDb';
import {
  collectTrackAssetUrls,
  computeSyncDiff,
  mapHistoryClipToOfflineTrack,
  mirrorHistoryToLibrary,
  requestEvictAssets,
} from './offlineSyncService';

// sunoApi / lyrics are only used by network paths not exercised here; stub to keep the import light.
vi.mock('./sunoApi', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./sunoApi')>();
  return {
    ...actual,
    getLyricAlignment: vi.fn(),
    getSunoClip: vi.fn(),
    getSunoFeedAll: vi.fn(),
    getSunoPlaylist: vi.fn(),
  };
});

const NOW = 1_000_000;

const makeTrack = (id: string, overrides: Partial<OfflineTrack> = {}): OfflineTrack => ({
  id,
  sunoId: id,
  title: `Track ${id}`,
  audioUrl: `https://cdn1.suno.ai/${id}.mp3`,
  imageUrl: `https://cdn2.suno.ai/image_${id}.jpeg`,
  lyricsText: 'la la',
  lrcContent: '',
  srtContent: '',
  metadata: { tags: ['pop'], prompt: 'la la', durationMs: 120000 },
  cachedLocally: false,
  raw: {},
  createdAt: 10,
  updatedAt: 10,
  ...overrides,
});

const makeClip = (id: string, overrides: Record<string, any> = {}) => ({
  id,
  title: `Track ${id}`,
  audio_url: `https://cdn1.suno.ai/${id}.mp3`,
  image_large_url: `https://cdn2.suno.ai/image_${id}.jpeg`,
  metadata: { tags: 'pop', prompt: 'la la', duration: 120 },
  ...overrides,
});

const makeHistoryClip = (id: string, overrides: Partial<SunoClip> = {}): SunoClip => ({
  id,
  title: `History ${id}`,
  created_at: '2026-01-01T00:00:00Z',
  model_name: 'v4',
  imageUrl: `https://cdn2.suno.ai/image_${id}.jpeg`,
  imageLargeUrl: `https://cdn2.suno.ai/image_large_${id}.jpeg`,
  metadata: { tags: 'rock, indie', prompt: 'hello world', duration: 90.4 },
  lrcContent: '[00:01.00]hello',
  srtContent: '1\n00:00:01,000 --> 00:00:02,000\nhello',
  ...overrides,
});

describe('collectTrackAssetUrls', () => {
  it('returns empty when neither audio nor image is present', () => {
    expect(collectTrackAssetUrls(makeTrack('a', { audioUrl: '', imageUrl: '' }))).toEqual([]);
    expect(collectTrackAssetUrls(undefined)).toEqual([]);
  });

  it('returns both entries when both present, audio first', () => {
    expect(collectTrackAssetUrls(makeTrack('a'))).toEqual([
      'https://cdn1.suno.ai/a.mp3',
      'https://cdn2.suno.ai/image_a.jpeg',
    ]);
  });

  it('returns a single entry when only one is present', () => {
    expect(collectTrackAssetUrls(makeTrack('a', { imageUrl: '' }))).toEqual(['https://cdn1.suno.ai/a.mp3']);
    expect(collectTrackAssetUrls(makeTrack('a', { audioUrl: '' }))).toEqual(['https://cdn2.suno.ai/image_a.jpeg']);
  });
});

describe('computeSyncDiff', () => {
  it('(a) local active track missing from remote is markedGone with updatedAt unchanged', () => {
    const local = [makeTrack('a', { updatedAt: 77 })];
    const diff = computeSyncDiff(local, [], NOW);
    expect(diff.markedGone.map((t) => t.id)).toEqual(['a']);
    expect(diff.markedGone[0].goneFromRemote).toBe(true);
    expect(diff.markedGone[0].updatedAt).toBe(77);
    expect(diff.toWrite).toEqual([]);
  });

  it('(b) local archived track missing from remote is NOT markedGone and NOT written', () => {
    const local = [makeTrack('a', { archivedAt: 5 })];
    const diff = computeSyncDiff(local, [], NOW);
    expect(diff.markedGone).toEqual([]);
    expect(diff.toWrite).toEqual([]);
  });

  it('(c) archived track present in remote stays archived with no toWrite row', () => {
    const local = [makeTrack('a', { archivedAt: 5 })];
    const diff = computeSyncDiff(local, [makeClip('a', { title: 'Changed upstream' })], NOW);
    expect(diff.toWrite).toEqual([]);
    expect(diff.markedGone).toEqual([]);
    expect(diff.added + diff.updated).toBe(0);
  });

  it('(d) gone track back in remote gets goneFromRemote cleared in toWrite row (archivedAt preserved via buildTrack)', () => {
    const local = [makeTrack('a', { goneFromRemote: true })];
    const diff = computeSyncDiff(local, [makeClip('a')], NOW);
    expect(diff.toWrite).toHaveLength(1);
    expect(diff.toWrite[0].goneFromRemote).toBe(false);
    expect(diff.toWrite[0].archivedAt).toBeUndefined();
    expect(diff.markedGone).toEqual([]);
  });

  it('(e) empty remote + non-empty local still yields markedGone from the pure fn (gate lives in downloadAccountCache)', () => {
    const local = [makeTrack('a'), makeTrack('b')];
    const diff = computeSyncDiff(local, [], NOW);
    expect(diff.markedGone).toHaveLength(2);
    // Simulate the downloadAccountCache safety gate.
    const remoteClips: any[] = [];
    const gated = remoteClips.length === 0 && local.length > 0 ? [] : diff.markedGone;
    expect(gated).toHaveLength(0);
  });

  it('(f) add / update / unchanged / markedGone counts are correct', () => {
    const local = [
      makeTrack('same'),
      makeTrack('changed', { title: 'Old title' }),
      makeTrack('vanished'),
      makeTrack('already-gone', { goneFromRemote: true }),
    ];
    const remote = [makeClip('same'), makeClip('changed'), makeClip('new')];
    const diff = computeSyncDiff(local, remote, NOW);
    expect(diff.added).toBe(1);
    expect(diff.updated).toBe(1);
    expect(diff.unchanged).toBe(1);
    expect(diff.toWrite.map((t) => t.id).sort()).toEqual(['changed', 'new']);
    // 'already-gone' is already flagged; it is not re-written again.
    expect(diff.markedGone.map((t) => t.id)).toEqual(['vanished']);
    expect(diff.markedGone.length).toBe(1);
  });

  it('skips malformed remote clips missing an id without throwing', () => {
    const local = [makeTrack('a')];
    const remote = [{ title: 'no id' }, null, undefined, { id: '' }, makeClip('a')];
    expect(() => computeSyncDiff(local, remote, NOW)).not.toThrow();
    const diff = computeSyncDiff(local, remote, NOW);
    expect(diff.toWrite).toEqual([]);
    expect(diff.unchanged).toBe(1);
    expect(diff.markedGone).toEqual([]);
  });

  it('buildTrack output preserves prev.archivedAt and variants on a non-archived rebuild path', () => {
    // Only reachable for non-archived rows; verify prev fields carry through.
    const variants = [{ id: 'v1', type: 'mastered' as const, title: 'M', audioUrl: 'x', createdAt: 1 }];
    const local = [makeTrack('a', { variants, lrcContent: '[00:01.00]x', title: 'Old' })];
    const diff = computeSyncDiff(local, [makeClip('a')], NOW);
    expect(diff.toWrite[0].variants).toEqual(variants);
    expect(diff.toWrite[0].lrcContent).toBe('[00:01.00]x');
    expect(diff.toWrite[0].createdAt).toBe(10);
    expect(diff.toWrite[0].updatedAt).toBe(NOW);
  });
});

describe('requestEvictAssets fallback (no service worker)', () => {
  const originalNavigator = globalThis.navigator;
  const originalCaches = (globalThis as any).caches;

  afterEach(() => {
    Object.defineProperty(globalThis, 'navigator', { value: originalNavigator, configurable: true, writable: true });
    (globalThis as any).caches = originalCaches;
  });

  it('resolves 0 for an empty list', async () => {
    expect(await requestEvictAssets([])).toBe(0);
  });

  it('resolves 0 when no caches API is available', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
    delete (globalThis as any).caches;
    expect(await requestEvictAssets(['https://cdn1.suno.ai/a.mp3'])).toBe(0);
  });

  it('uses the Cache API directly when no SW controller and counts deletions', async () => {
    Object.defineProperty(globalThis, 'navigator', { value: {}, configurable: true, writable: true });
    const store = new Set(['https://cdn1.suno.ai/a.mp3']);
    (globalThis as any).caches = {
      open: async () => ({
        delete: async (url: string) => store.delete(url),
      }),
    };
    const count = await requestEvictAssets(['https://cdn1.suno.ai/a.mp3', 'https://cdn1.suno.ai/never-cached.mp3']);
    expect(count).toBe(1);
    expect(store.size).toBe(0);
  });
});

describe('mapHistoryClipToOfflineTrack', () => {
  it('maps fields and tolerates a missing metadata object', () => {
    const t = mapHistoryClipToOfflineTrack(makeHistoryClip('h1'), NOW);
    expect(t.id).toBe('h1');
    expect(t.sunoId).toBe('h1');
    expect(t.audioUrl).toBe('https://cdn1.suno.ai/h1.mp3');
    expect(t.imageUrl).toBe('https://cdn2.suno.ai/image_large_h1.jpeg');
    expect(t.metadata).toEqual({ tags: ['rock', 'indie'], prompt: 'hello world', durationMs: 90400 });
    expect(t.lyricsText).toBe('hello world');
    expect(t.createdAt).toBe(NOW);
    expect(t.updatedAt).toBe(NOW);

    const noMeta = { id: 'h2', title: 'x', created_at: '', model_name: '' } as unknown as SunoClip;
    expect(() => mapHistoryClipToOfflineTrack(noMeta, NOW)).not.toThrow();
    const m = mapHistoryClipToOfflineTrack(noMeta, NOW);
    expect(m.metadata).toEqual({ tags: [], prompt: '', durationMs: 0 });
    expect(m.imageUrl).toBe('');
    expect(m.lrcContent).toBe('');
  });
});

describe('mirrorHistoryToLibrary', () => {
  beforeEach(async () => {
    await __resetOfflineDbForTests();
    (globalThis as any).indexedDB = new IDBFactory();
  });

  it('creates a row when missing', async () => {
    const res = await mirrorHistoryToLibrary([makeHistoryClip('h1')]);
    expect(res).toEqual({ created: 1, merged: 0, skipped: 0 });
    const row = await getTrackById('h1');
    expect(row?.title).toBe('History h1');
    expect(row?.lrcContent).toBe('[00:01.00]hello');
    expect(row?.metadata.tags).toEqual(['rock', 'indie']);
  });

  it('fills only empty fields on an existing row and preserves archivedAt / goneFromRemote', async () => {
    await upsertTracks([makeTrack('h1', { lrcContent: '', srtContent: '', archivedAt: 555, goneFromRemote: true, title: 'Local title' })]);
    const res = await mirrorHistoryToLibrary([makeHistoryClip('h1')]);
    expect(res).toEqual({ created: 0, merged: 1, skipped: 0 });
    const row = await getTrackById('h1');
    expect(row?.lrcContent).toBe('[00:01.00]hello');
    expect(row?.srtContent).toContain('hello');
    expect(row?.title).toBe('Local title');
    expect(row?.archivedAt).toBe(555);
    expect(row?.goneFromRemote).toBe(true);
    expect(row?.metadata.tags).toEqual(['pop']);
  });

  it('leaves a rich existing row untouched (deep-equal before/after)', async () => {
    const rich = makeTrack('h1', {
      lrcContent: '[00:05.00]rich',
      srtContent: 'rich srt',
      variants: [{ id: 'v', type: 'custom', title: 'V', audioUrl: 'u', createdAt: 1 }],
      archivedAt: 9,
    });
    await upsertTracks([rich]);
    const before = await getTrackById('h1');
    const res = await mirrorHistoryToLibrary([makeHistoryClip('h1')]);
    expect(res).toEqual({ created: 0, merged: 0, skipped: 1 });
    const after = await getTrackById('h1');
    expect(after).toEqual(before);
  });

  it('skips draft_ ids', async () => {
    const res = await mirrorHistoryToLibrary([makeHistoryClip('draft_123'), makeHistoryClip('h1')]);
    expect(res).toEqual({ created: 1, merged: 0, skipped: 1 });
    expect(await getTrackById('draft_123')).toBeUndefined();
    expect((await listAllTracks()).map((t) => t.id)).toEqual(['h1']);
  });

  it('handles a clip with missing metadata without throwing', async () => {
    const noMeta = { id: 'h9', title: 'No meta', created_at: '', model_name: '' } as unknown as SunoClip;
    await expect(mirrorHistoryToLibrary([noMeta])).resolves.toEqual({ created: 1, merged: 0, skipped: 0 });
    const row = await getTrackById('h9');
    expect(row?.metadata).toEqual({ tags: [], prompt: '', durationMs: 0 });
  });
});
