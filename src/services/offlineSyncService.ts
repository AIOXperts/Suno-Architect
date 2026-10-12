import { getLyricAlignment, getSunoClip, getSunoFeedAll, getSunoPlaylist, legacySunoAudioUrl, pickSunoAudioUrl } from './sunoApi';
import { generateLrc, generateSrt, groupWordsByTiming, stripMetaTags } from '../utils/lyrics';
import type { SunoClip } from '../types';
import {
  OfflinePlaylist,
  OfflineTrack,
  getSyncMeta,
  getTrackById,
  listAllTracks,
  setSyncMeta,
  upsertPlaylists,
  upsertTracks,
} from './offlineDb';

const ASSET_CACHE_NAME = 'suno-architect-assets-v1';

export interface SyncProgress {
  phase: 'fetching' | 'diffing' | 'upserting' | 'caching-assets' | 'done';
  completed: number;
  total: number;
  message: string;
}

export interface SyncResult {
  added: number;
  updated: number;
  unchanged: number;
  failedAssets: number;
  /** Local active tracks that were not present in the remote feed and got flagged goneFromRemote. */
  markedGone: number;
}

export interface SyncDiff {
  toWrite: OfflineTrack[];
  markedGone: OfflineTrack[];
  added: number;
  updated: number;
  unchanged: number;
}

const LAST_SYNC_META_KEY = 'lastSyncAt';

const toTags = (raw: string | undefined): string[] => {
  if (!raw) return [];
  return raw
    .split(',')
    .map((x) => x.trim())
    .filter(Boolean);
};

const buildTrack = (clip: any, now: number, prev?: OfflineTrack): OfflineTrack => {
  const metadata = clip?.metadata || {};
  const audioUrl = pickSunoAudioUrl(clip)?.url || prev?.audioUrl || '';
  const imageUrl = clip?.image_large_url || clip?.image_url || '';
  const promptLyrics = metadata.prompt || prev?.lyricsText || '';
  return {
    id: clip.id,
    sunoId: clip.id,
    title: clip.title || 'Untitled',
    audioUrl,
    imageUrl,
    lyricsText: promptLyrics,
    lrcContent: prev?.lrcContent || '',
    srtContent: prev?.srtContent || '',
    metadata: {
      tags: toTags(metadata.tags),
      prompt: metadata.prompt || '',
      durationMs: Math.round((metadata.duration || 0) * 1000),
    },
    cachedLocally: prev?.cachedLocally || false,
    raw: clip,
    createdAt: prev?.createdAt || now,
    updatedAt: now,
    variants: prev?.variants,
    // Preserve local archive state; a remote sighting always clears the "gone" flag.
    archivedAt: prev?.archivedAt,
    goneFromRemote: false,
  };
};

const isArchived = (track: OfflineTrack | undefined): boolean => typeof track?.archivedAt === 'number';

/**
 * Pure diff of local library vs remote feed.
 * - remote clips without an `id` are skipped
 * - archived local tracks are never written/resurrected
 * - active local tracks absent from remote get goneFromRemote=true (updatedAt unchanged)
 * - tracks present in remote get goneFromRemote cleared via buildTrack
 */
export function computeSyncDiff(local: OfflineTrack[], remote: any[], now: number): SyncDiff {
  const localMap = new Map(local.map((t) => [t.id, t]));
  const seenRemote = new Set<string>();
  const toWrite: OfflineTrack[] = [];
  let added = 0;
  let updated = 0;
  let unchanged = 0;

  for (const clip of Array.isArray(remote) ? remote : []) {
    const id = clip?.id;
    if (typeof id !== 'string' || !id) continue;
    seenRemote.add(id);
    const prev = localMap.get(id);
    if (isArchived(prev)) continue;
    const next = buildTrack(clip, now, prev);
    if (!prev) {
      added += 1;
      toWrite.push(next);
    } else if (!isTrackEqual(prev, next) || prev.goneFromRemote === true) {
      updated += 1;
      toWrite.push(next);
    } else {
      unchanged += 1;
    }
  }

  const markedGone: OfflineTrack[] = [];
  for (const track of local) {
    if (seenRemote.has(track.id)) continue;
    if (isArchived(track)) continue;
    if (track.goneFromRemote === true) continue;
    markedGone.push({ ...track, goneFromRemote: true });
  }

  return { toWrite, markedGone, added, updated, unchanged };
}

const isTrackEqual = (a: OfflineTrack, b: OfflineTrack) => {
  return (
    a.title === b.title &&
    a.audioUrl === b.audioUrl &&
    a.imageUrl === b.imageUrl &&
    a.metadata.prompt === b.metadata.prompt &&
    a.metadata.durationMs === b.metadata.durationMs &&
    a.metadata.tags.join('|') === b.metadata.tags.join('|') &&
    a.lyricsText === b.lyricsText &&
    a.lrcContent === b.lrcContent &&
    a.srtContent === b.srtContent
  );
};

const enrichTrackLyricsAndCaptions = async (track: OfflineTrack, cookie: string): Promise<OfflineTrack> => {
  if (!cookie || !track.id) return track;
  try {
    const clip = await getSunoClip(track.id, cookie);
    const prompt = clip?.metadata?.prompt || track.metadata.prompt || track.lyricsText || '';
    const cleanLyrics = stripMetaTags(prompt);

    let lrcContent = track.lrcContent || '';
    let srtContent = track.srtContent || '';

    try {
      const alignment = await getLyricAlignment(track.id, cookie);
      const alignedWords = Array.isArray(alignment?.aligned_words) ? alignment.aligned_words : [];
      if (alignedWords.length > 0) {
        const lines = groupWordsByTiming(alignedWords);
        lrcContent = generateLrc(lines);
        srtContent = generateSrt(lines);
      }
    } catch {
      // Alignment can fail for some tracks; still keep lyrics cached.
    }

    return {
      ...track,
      lyricsText: cleanLyrics || prompt,
      lrcContent,
      srtContent,
      raw: clip || track.raw,
    };
  } catch {
    return track;
  }
};

/** Pure: the cacheable asset URLs belonging to a single track (audio + image when present). */
export const collectTrackAssetUrls = (track: Pick<OfflineTrack, 'audioUrl' | 'imageUrl'> | null | undefined): string[] => {
  const urls: string[] = [];
  if (track?.audioUrl) urls.push(track.audioUrl);
  if (track?.imageUrl && !urls.includes(track.imageUrl)) urls.push(track.imageUrl);
  return urls;
};

const collectAssetUrls = (tracks: OfflineTrack[]): string[] => {
  const urls = new Set<string>();
  for (const track of tracks) {
    for (const url of collectTrackAssetUrls(track)) urls.add(url);
  }
  return [...urls];
};

const evictAssetsDirect = async (urls: string[]): Promise<number> => {
  if (typeof caches === 'undefined') return 0;
  try {
    const cache = await caches.open(ASSET_CACHE_NAME);
    let evicted = 0;
    for (const url of urls) {
      try {
        if (await cache.delete(url, { ignoreVary: true })) evicted += 1;
      } catch {
        // ignore individual failures
      }
    }
    return evicted;
  } catch {
    return 0;
  }
};

/**
 * Ask the service worker to drop the given URLs from the asset cache.
 * Resolves with the number of cache entries actually deleted. Falls back to
 * direct Cache API deletion when no SW controller is available; resolves 0
 * when there is nothing to do or no caches API.
 */
export async function requestEvictAssets(urls: string[]): Promise<number> {
  const unique = [...new Set((urls || []).filter(Boolean))];
  if (!unique.length) return 0;

  const hasSw = typeof navigator !== 'undefined' && 'serviceWorker' in navigator && !!navigator.serviceWorker;
  if (!hasSw) return evictAssetsDirect(unique);

  let registration: ServiceWorkerRegistration | undefined;
  try {
    registration = await navigator.serviceWorker.ready;
  } catch {
    registration = undefined;
  }
  const active = registration?.active;
  if (!active) return evictAssetsDirect(unique);

  const requestId = `evict-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return new Promise<number>((resolve) => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== 'CACHE_PROGRESS' || data.requestId !== requestId || !data.done) return;
      navigator.serviceWorker.removeEventListener('message', onMessage);
      resolve(typeof data.evicted === 'number' ? data.evicted : 0);
    };
    navigator.serviceWorker.addEventListener('message', onMessage);
    active.postMessage({ type: 'EVICT_ASSETS', urls: unique, requestId });
  });
}

async function requestCacheAssets(urls: string[], onProgress?: (p: SyncProgress) => void): Promise<number> {
  if (!urls.length || !('serviceWorker' in navigator)) return 0;

  const registration = await navigator.serviceWorker.ready;
  if (!registration.active) return urls.length;

  const requestId = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  let failedAssets = 0;

  await new Promise<void>((resolve) => {
    const onMessage = (event: MessageEvent) => {
      const data = event.data;
      if (!data || data.type !== 'CACHE_PROGRESS' || data.requestId !== requestId) return;

      onProgress?.({
        phase: data.done ? 'done' : 'caching-assets',
        completed: data.completed,
        total: data.total,
        message: `Caching assets ${data.completed}/${data.total}`,
      });

      if (data.done) {
        navigator.serviceWorker.removeEventListener('message', onMessage);
        resolve();
      }
    };

    navigator.serviceWorker.addEventListener('message', onMessage);
    registration.active?.postMessage({ type: 'CACHE_ASSETS', urls, requestId });
  });

  // Conservative fallback estimation for cross-origin failures, if any URLs still uncached.
  if ('caches' in window) {
    caches.open('suno-architect-assets-v1').then(async (cache) => {
      const checks = await Promise.all(
        urls.map(async (url) => {
          try {
            const hit = await cache.match(url, { ignoreVary: true });
            return !!hit;
          } catch {
            return false;
          }
        })
      );
      failedAssets = checks.filter((x) => !x).length;
    });
  }

  return failedAssets;
}

export async function downloadAccountCache(
  cookie: string,
  playlistIds: string[] = [],
  onProgress?: (p: SyncProgress) => void
): Promise<SyncResult> {
  onProgress?.({ phase: 'fetching', completed: 0, total: 1, message: 'Fetching remote account metadata…' });
  const feed = await getSunoFeedAll(cookie, 100);
  const remoteClips = Array.isArray(feed?.clips) ? feed.clips : [];

  const remotePlaylists: OfflinePlaylist[] = [];
  if (playlistIds.length) {
    for (let i = 0; i < playlistIds.length; i += 1) {
      const id = playlistIds[i];
      try {
        const pl = await getSunoPlaylist(id, cookie);
        const playlistClips = Array.isArray(pl?.playlist_clips) ? pl.playlist_clips : [];
        remotePlaylists.push({
          id,
          title: pl?.name || `Playlist ${id}`,
          description: pl?.description || '',
          coverArtUrl: pl?.image_url,
          trackIds: playlistClips.map((entry: any) => entry?.clip?.id).filter(Boolean),
          createdAt: Date.now(),
          updatedAt: Date.now(),
          raw: pl,
        });
      } catch {
        // Partial failure allowed.
      }
      onProgress?.({ phase: 'fetching', completed: i + 1, total: playlistIds.length, message: `Fetched playlists ${i + 1}/${playlistIds.length}` });
    }
  }

  onProgress?.({ phase: 'diffing', completed: 0, total: remoteClips.length, message: 'Diffing remote vs local state…' });
  const localTracks = await listAllTracks();

  const now = Date.now();
  const diff = computeSyncDiff(localTracks, remoteClips, now);
  const { toWrite, added, updated, unchanged } = diff;
  // SAFETY GATE: an empty remote feed with existing local rows is treated as a partial
  // fetch failure — never flag everything as gone in that case.
  const markedGoneRows = remoteClips.length === 0 && localTracks.length > 0 ? [] : diff.markedGone;
  const markedGone = markedGoneRows.length;
  onProgress?.({ phase: 'diffing', completed: remoteClips.length, total: remoteClips.length, message: `Compared ${remoteClips.length}/${remoteClips.length} tracks` });

  const enrichedTracks: OfflineTrack[] = [];
  for (let i = 0; i < toWrite.length; i += 1) {
    const track = toWrite[i];
    const enriched = await enrichTrackLyricsAndCaptions(track, cookie);
    enrichedTracks.push(enriched);
    onProgress?.({
      phase: 'upserting',
      completed: i + 1,
      total: toWrite.length,
      message: `Caching lyrics/LRC ${i + 1}/${toWrite.length}`,
    });
  }

  onProgress?.({ phase: 'upserting', completed: 0, total: enrichedTracks.length, message: 'Persisting metadata to IndexedDB…' });
  await upsertTracks(enrichedTracks);
  await upsertTracks(markedGoneRows);
  await upsertPlaylists(remotePlaylists);
  await setSyncMeta(LAST_SYNC_META_KEY, now);

  const refreshedLocal = await listAllTracks();
  const assetUrls = collectAssetUrls(refreshedLocal);
  const failedAssets = await requestCacheAssets(assetUrls, onProgress);

  onProgress?.({ phase: 'done', completed: 1, total: 1, message: 'Account cache is up to date.' });
  return { added, updated, unchanged, failedAssets, markedGone };
}

const isEmptyValue = (v: unknown): boolean =>
  v === undefined || v === null || v === '' || (Array.isArray(v) && v.length === 0);

/** Pure: map a history (localStorage) clip onto the OfflineTrack shape. Tolerates missing metadata. */
export function mapHistoryClipToOfflineTrack(clip: SunoClip, now: number = Date.now()): OfflineTrack {
  const metadata: Partial<SunoClip['metadata']> = (clip as any)?.metadata || {};
  const prompt = metadata.prompt || '';
  return {
    id: clip.id,
    sunoId: clip.id,
    title: clip.title || 'Untitled',
    audioUrl: clip.audioUrl || legacySunoAudioUrl(clip.id),
    imageUrl: clip.imageLargeUrl || clip.imageUrl || '',
    lyricsText: prompt,
    lrcContent: clip.lrcContent || '',
    srtContent: clip.srtContent || '',
    metadata: {
      tags: toTags(metadata.tags),
      prompt,
      durationMs: Math.round((metadata.duration || 0) * 1000),
    },
    cachedLocally: false,
    raw: clip,
    createdAt: now,
    updatedAt: now,
  };
}

export interface MirrorHistoryResult {
  created: number;
  merged: number;
  skipped: number;
}

/**
 * Mirror history clips into the IndexedDB library.
 * - `draft_` ids are skipped
 * - missing rows are created
 * - existing rows only get EMPTY fields filled; non-empty values (lrc/srt/variants/archivedAt/
 *   goneFromRemote/title/...) are never overwritten. Untouched rows are not rewritten.
 */
export async function mirrorHistoryToLibrary(clips: SunoClip[]): Promise<MirrorHistoryResult> {
  const result: MirrorHistoryResult = { created: 0, merged: 0, skipped: 0 };
  const now = Date.now();
  const toUpsert: OfflineTrack[] = [];

  for (const clip of Array.isArray(clips) ? clips : []) {
    const id = clip?.id;
    if (typeof id !== 'string' || !id || id.startsWith('draft_')) {
      result.skipped += 1;
      continue;
    }
    const mapped = mapHistoryClipToOfflineTrack(clip, now);
    const existing = await getTrackById(id);
    if (!existing) {
      toUpsert.push(mapped);
      result.created += 1;
      continue;
    }

    let changed = false;
    const merged: OfflineTrack = { ...existing, metadata: { ...existing.metadata } };
    const fillable: Array<keyof Pick<OfflineTrack, 'title' | 'audioUrl' | 'imageUrl' | 'lyricsText' | 'lrcContent' | 'srtContent' | 'raw'>> = [
      'title',
      'audioUrl',
      'imageUrl',
      'lyricsText',
      'lrcContent',
      'srtContent',
      'raw',
    ];
    for (const key of fillable) {
      if (isEmptyValue(existing[key]) && !isEmptyValue(mapped[key])) {
        (merged as any)[key] = mapped[key];
        changed = true;
      }
    }
    const existingMeta = existing.metadata || ({} as OfflineTrack['metadata']);
    if (isEmptyValue(existingMeta.tags) && mapped.metadata.tags.length) {
      merged.metadata.tags = mapped.metadata.tags;
      changed = true;
    }
    if (isEmptyValue(existingMeta.prompt) && mapped.metadata.prompt) {
      merged.metadata.prompt = mapped.metadata.prompt;
      changed = true;
    }
    if (!existingMeta.durationMs && mapped.metadata.durationMs) {
      merged.metadata.durationMs = mapped.metadata.durationMs;
      changed = true;
    }
    if (!merged.metadata.tags) merged.metadata.tags = [];
    if (merged.metadata.prompt === undefined) merged.metadata.prompt = '';
    if (merged.metadata.durationMs === undefined) merged.metadata.durationMs = 0;

    if (changed) {
      merged.updatedAt = now;
      toUpsert.push(merged);
      result.merged += 1;
    } else {
      result.skipped += 1;
    }
  }

  await upsertTracks(toUpsert);
  return result;
}

export const getLastAccountSync = async (): Promise<number | undefined> => {
  return getSyncMeta<number>(LAST_SYNC_META_KEY);
};
