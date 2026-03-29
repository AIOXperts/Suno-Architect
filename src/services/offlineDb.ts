import { DBSchema, openDB } from 'idb';

export interface MasteringSettings {
  inputGain: number;
  glueCompression: boolean;
  deharsh: boolean;
  cleanLowEnd: boolean;
  autoLevel: boolean;
  addPunch: boolean;
  stereoWidth: number;
  centerBass: boolean;
  cutMud: boolean;
  addAir: boolean;
  tapeWarmth: boolean;
  normalizeLoudness: boolean;
  targetLufs: number;
  truePeakLimit: boolean;
  ceiling: number;
  sampleRate: number;
  bitDepth: number;
  eq: {
    low: number;
    lowMid: number;
    mid: number;
    highMid: number;
    high: number;
  };
}

export interface TrackVariant {
  id: string;
  type: 'mastered' | 'remastered' | 'custom';
  title: string;
  audioUrl: string;
  audioBlob?: Blob;
  imageUrl?: string;
  createdAt: number;
  settings?: MasteringSettings;
  parentVariantId?: string;
}

export interface OfflineTrack {
  id: string;
  sunoId: string;
  title: string;
  audioUrl: string;
  imageUrl: string;
  lyricsText: string;
  lrcContent: string;
  srtContent: string;
  metadata: {
    tags: string[];
    prompt: string;
    durationMs: number;
  };
  cachedLocally: boolean;
  raw: any;
  updatedAt: number;
  createdAt: number;
  variants?: TrackVariant[];
}

export interface OfflineAlbum {
  id: string;
  title: string;
  description: string;
  coverArtUrl: string;
  type: 'EP' | 'LP' | 'Single' | 'GreatestHits';
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
  raw: any;
}

export interface OfflinePlaylist {
  id: string;
  title: string;
  description?: string;
  coverArtUrl?: string;
  trackIds: string[];
  createdAt: number;
  updatedAt: number;
  raw: any;
}

export interface OfflineRenderHistory {
  id: string; // UUID
  clipId: string;
  clipTitle: string;
  createdAt: number; // timestamp
  settings: any; // The visualizer config snapshot used
  mediaBlob?: Blob; // Legacy: older entries may contain the rendered video file
  mimeType?: string;
  fileSize?: number;
}

interface SunoOfflineDB extends DBSchema {
  tracks: {
    key: string;
    value: OfflineTrack;
    indexes: {
      byUpdatedAt: number;
      byCreatedAt: number;
    };
  };
  albums: {
    key: string;
    value: OfflineAlbum;
    indexes: {
      byUpdatedAt: number;
    };
  };
  playlists: {
    key: string;
    value: OfflinePlaylist;
    indexes: {
      byUpdatedAt: number;
    };
  };
  visualizer_renders: {
    key: string;
    value: OfflineRenderHistory;
    indexes: {
      byCreatedAt: number;
    };
  };
  syncMeta: {
    key: string;
    value: {
      key: string;
      value: any;
      updatedAt: number;
    };
  };
}

const DB_NAME = 'suno-architect-offline';
const DB_VERSION = 3;

let dbPromise: ReturnType<typeof openDB<SunoOfflineDB>> | null = null;

export const getOfflineDb = () => {
  if (!dbPromise) {
    dbPromise = openDB<SunoOfflineDB>(DB_NAME, DB_VERSION, {
      upgrade(db, oldVersion) {
        if (!db.objectStoreNames.contains('tracks')) {
          const trackStore = db.createObjectStore('tracks', { keyPath: 'id' });
          trackStore.createIndex('byUpdatedAt', 'updatedAt');
          trackStore.createIndex('byCreatedAt', 'createdAt');
        }

        if (!db.objectStoreNames.contains('albums')) {
          const albumStore = db.createObjectStore('albums', { keyPath: 'id' });
          albumStore.createIndex('byUpdatedAt', 'updatedAt');
        }

        if (!db.objectStoreNames.contains('playlists')) {
          const playlistStore = db.createObjectStore('playlists', { keyPath: 'id' });
          playlistStore.createIndex('byUpdatedAt', 'updatedAt');
        }

        if (oldVersion < 3 && !db.objectStoreNames.contains('visualizer_renders')) {
          const renderStore = db.createObjectStore('visualizer_renders', { keyPath: 'id' });
          renderStore.createIndex('byCreatedAt', 'createdAt');
        }

        if (!db.objectStoreNames.contains('syncMeta')) {
          db.createObjectStore('syncMeta', { keyPath: 'key' });
        }
      },
    });
  }
  return dbPromise;
};

export const upsertTracks = async (tracks: OfflineTrack[]) => {
  if (!tracks.length) return;
  const db = await getOfflineDb();
  const tx = db.transaction('tracks', 'readwrite');
  for (const track of tracks) {
    await tx.store.put(track);
  }
  await tx.done;
};

export const updateTrack = async (track: OfflineTrack): Promise<void> => {
  await upsertTracks([track]);
};

export const upsertPlaylists = async (playlists: OfflinePlaylist[]) => {
  if (!playlists.length) return;
  const db = await getOfflineDb();
  const tx = db.transaction('playlists', 'readwrite');
  for (const playlist of playlists) {
    await tx.store.put(playlist);
  }
  await tx.done;
};

export const upsertAlbums = async (albums: OfflineAlbum[]) => {
  if (!albums.length) return;
  const db = await getOfflineDb();
  const tx = db.transaction('albums', 'readwrite');
  for (const album of albums) {
    await tx.store.put(album);
  }
  await tx.done;
};

export const listAlbumsByUpdatedAtDesc = async (): Promise<OfflineAlbum[]> => {
  const db = await getOfflineDb();
  const tx = db.transaction('albums', 'readonly');
  const index = tx.store.index('byUpdatedAt');
  const results: OfflineAlbum[] = [];
  let cursor = await index.openCursor(null, 'prev');
  while (cursor) {
    results.push(cursor.value);
    cursor = await cursor.continue();
  }
  await tx.done;
  return results;
};

export const deleteAlbumById = async (id: string) => {
  const db = await getOfflineDb();
  await db.delete('albums', id);
};

export const listTracksByUpdatedAtDesc = async (limit = 50): Promise<OfflineTrack[]> => {
  const db = await getOfflineDb();
  const tx = db.transaction('tracks', 'readonly');
  const index = tx.store.index('byUpdatedAt');
  const results: OfflineTrack[] = [];
  let cursor = await index.openCursor(null, 'prev');
  while (cursor && results.length < limit) {
    results.push(cursor.value);
    cursor = await cursor.continue();
  }
  await tx.done;
  return results;
};

export const listAllTracks = async (): Promise<OfflineTrack[]> => {
  const db = await getOfflineDb();
  return db.getAll('tracks');
};

export const getTrackById = async (id: string): Promise<OfflineTrack | undefined> => {
  const db = await getOfflineDb();
  return db.get('tracks', id);
};

export const getPlaylistById = async (id: string): Promise<OfflinePlaylist | undefined> => {
  const db = await getOfflineDb();
  return db.get('playlists', id);
};

export const setSyncMeta = async (key: string, value: any) => {
  const db = await getOfflineDb();
  await db.put('syncMeta', { key, value, updatedAt: Date.now() });
};

export const getSyncMeta = async <T = any>(key: string): Promise<T | undefined> => {
  const db = await getOfflineDb();
  const record = await db.get('syncMeta', key);
  return record?.value as T | undefined;
};

export const saveVisualizerRender = async (renderInfo: OfflineRenderHistory) => {
  const db = await getOfflineDb();
  await db.put('visualizer_renders', renderInfo);
};

export const listVisualizerRenders = async (): Promise<OfflineRenderHistory[]> => {
  const db = await getOfflineDb();
  const tx = db.transaction('visualizer_renders', 'readonly');
  const index = tx.store.index('byCreatedAt');
  const results: OfflineRenderHistory[] = [];
  let cursor = await index.openCursor(null, 'prev'); // Most recent first
  while (cursor) {
    results.push(cursor.value);
    cursor = await cursor.continue();
  }
  await tx.done;
  return results;
};

export const deleteVisualizerRender = async (id: string) => {
  const db = await getOfflineDb();
  await db.delete('visualizer_renders', id);
};
