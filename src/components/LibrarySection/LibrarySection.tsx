import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { SunoClip } from '../../types';
import {
  OfflineTrack,
  TrackStatusBuckets,
  archiveTrack,
  listTracksByStatus,
  restoreTrack,
} from '../../services/offlineDb';
import { collectTrackAssetUrls, requestEvictAssets } from '../../services/offlineSyncService';
import { StatusMessage } from '../ui/AppPrimitives';
import LibraryToolbar, { LibraryStatusCounts, LibraryStatusFilter } from './LibraryToolbar';
import LibraryCard from './LibraryCard';

/** Must match ASSET_CACHE in public/offline-sw.js. */
const ASSET_CACHE_NAME = 'suno-architect-assets-v1';

interface LibrarySectionProps {
  history: SunoClip[];
}

interface StorageInfo {
  usage: string;
  quota: string;
  cachedAssets: string;
}

const EMPTY_BUCKETS: TrackStatusBuckets = { active: [], archived: [], goneFromRemote: [], all: [] };

const formatBytes = (bytes: number): string => {
  if (!Number.isFinite(bytes) || bytes < 0) return 'unavailable';
  if (bytes < 1024) return `${bytes} B`;
  const units = ['KB', 'MB', 'GB', 'TB'];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) {
    value /= 1024;
    unit += 1;
  }
  return `${value.toFixed(value >= 100 ? 0 : 1)} ${units[unit]}`;
};

const readStorageInfo = async (): Promise<StorageInfo> => {
  let usage = 'unavailable';
  let quota = 'unavailable';
  let cachedAssets = 'unavailable';

  try {
    const estimate = await navigator.storage?.estimate?.();
    if (estimate) {
      if (typeof estimate.usage === 'number') usage = formatBytes(estimate.usage);
      if (typeof estimate.quota === 'number') quota = formatBytes(estimate.quota);
    }
  } catch {
    // leave 'unavailable'
  }

  try {
    if (typeof caches !== 'undefined') {
      const cache = await caches.open(ASSET_CACHE_NAME);
      const keys = await cache.keys();
      cachedAssets = String(keys.length);
    }
  } catch {
    // leave 'unavailable'
  }

  return { usage, quota, cachedAssets };
};

const EMPTY_STATE_COPY: Record<LibraryStatusFilter, { title: string; hint: string }> = {
  all: {
    title: 'No tracks in library yet.',
    hint: 'Open the Library tab and run "Sync Local Library Cache" to mirror your Suno tracks here.',
  },
  active: {
    title: 'No active tracks.',
    hint: 'Restore an archived track or sync from Suno to see tracks here.',
  },
  archived: {
    title: 'Nothing archived.',
    hint: 'Archive a track to free its cached audio and cover while keeping its metadata and lyrics.',
  },
  gone: {
    title: 'Every track is still on Suno.',
    hint: 'Tracks removed from your Suno account show up here after the next local library sync.',
  },
};

const LibrarySection: React.FC<LibrarySectionProps> = ({ history }) => {
  const [buckets, setBuckets] = useState<TrackStatusBuckets>(EMPTY_BUCKETS);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState('');
  const [storageInfo, setStorageInfo] = useState<StorageInfo | null>(null);
  const [statusFilter, setStatusFilter] = useState<LibraryStatusFilter>('all');
  const [searchQuery, setSearchQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [busyIds, setBusyIds] = useState<Set<string>>(() => new Set());
  const [actionMessage, setActionMessage] = useState<{ state: 'done' | 'error'; message: string } | null>(null);

  const reload = useCallback(async () => {
    setLoading(true);
    setLoadError('');
    try {
      const [next, storage] = await Promise.all([listTracksByStatus(), readStorageInfo()]);
      setBuckets(next);
      setStorageInfo(storage);
    } catch (error) {
      console.error('Failed to load library', error);
      setLoadError('Could not read the local library. Try refreshing.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    reload();
  }, [reload]);

  const counts: LibraryStatusCounts = useMemo(
    () => ({
      all: buckets.all.length,
      active: buckets.active.length,
      archived: buckets.archived.length,
      gone: buckets.goneFromRemote.length,
    }),
    [buckets]
  );

  const tagOptions = useMemo(() => {
    const union = new Set<string>();
    for (const track of buckets.all) {
      for (const tag of track.metadata?.tags ?? []) {
        if (tag) union.add(tag);
      }
    }
    return [...union].sort((a, b) => a.localeCompare(b));
  }, [buckets]);

  const visibleTracks = useMemo(() => {
    const base =
      statusFilter === 'active'
        ? buckets.active
        : statusFilter === 'archived'
          ? buckets.archived
          : statusFilter === 'gone'
            ? buckets.goneFromRemote
            : buckets.all;
    const query = searchQuery.trim().toLowerCase();
    return base.filter((track) => {
      const tags = track.metadata?.tags ?? [];
      if (tagFilter && !tags.includes(tagFilter)) return false;
      if (!query) return true;
      return (
        (track.title || '').toLowerCase().includes(query) ||
        tags.some((tag) => tag.toLowerCase().includes(query))
      );
    });
  }, [buckets, statusFilter, searchQuery, tagFilter]);

  const setBusy = (id: string, busy: boolean) => {
    setBusyIds((prev) => {
      const next = new Set(prev);
      if (busy) next.add(id);
      else next.delete(id);
      return next;
    });
  };

  const handleArchive = async (track: OfflineTrack) => {
    if (busyIds.has(track.id)) return;
    setBusy(track.id, true);
    setActionMessage(null);
    try {
      await archiveTrack(track.id);
      const evicted = await requestEvictAssets(collectTrackAssetUrls(track));
      setActionMessage({
        state: 'done',
        message: `Archived "${track.title}" and freed ${evicted} cached asset${evicted === 1 ? '' : 's'}.`,
      });
    } catch (error) {
      console.error('Archive failed', error);
      setActionMessage({ state: 'error', message: `Could not archive "${track.title}".` });
    } finally {
      setBusy(track.id, false);
      await reload();
    }
  };

  const handleRestore = async (track: OfflineTrack) => {
    if (busyIds.has(track.id)) return;
    setBusy(track.id, true);
    setActionMessage(null);
    try {
      await restoreTrack(track.id);
      setActionMessage({ state: 'done', message: `Restored "${track.title}". Audio re-caches on next sync or playback.` });
    } catch (error) {
      console.error('Restore failed', error);
      setActionMessage({ state: 'error', message: `Could not restore "${track.title}".` });
    } finally {
      setBusy(track.id, false);
      await reload();
    }
  };

  const hasAnyTracks = buckets.all.length > 0;
  const isFiltered = searchQuery.trim().length > 0 || tagFilter.length > 0;
  const emptyCopy = EMPTY_STATE_COPY[statusFilter];
  const historyClipCount = history.filter((clip) => !clip.id.startsWith('draft_')).length;

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div
        data-testid="library-storage-panel"
        className="border border-[var(--app-panel-border)] bg-black/40 px-3 py-3 rounded-md flex flex-wrap items-center gap-x-6 gap-y-2"
      >
        <p className="text-[11px] uppercase tracking-[0.16em] text-slate-300">Local Storage</p>
        <p className="text-xs text-slate-300">
          Usage: <span data-testid="library-storage-usage" className="font-mono text-white">{storageInfo?.usage ?? '…'}</span>
          <span className="text-slate-500"> of </span>
          <span className="font-mono text-white">{storageInfo?.quota ?? '…'}</span>
        </p>
        <p className="text-xs text-slate-300">
          Cached assets: <span data-testid="library-cached-assets" className="font-mono text-white">{storageInfo?.cachedAssets ?? '…'}</span>
        </p>
        <p className="text-xs text-slate-500">
          {historyClipCount} history clip{historyClipCount === 1 ? '' : 's'} mirrored on sync
        </p>
      </div>

      <LibraryToolbar
        counts={counts}
        statusFilter={statusFilter}
        onStatusFilterChange={setStatusFilter}
        searchQuery={searchQuery}
        onSearchChange={setSearchQuery}
        tagOptions={tagOptions}
        tagFilter={tagFilter}
        onTagFilterChange={setTagFilter}
        onRefresh={reload}
        loading={loading}
      />

      {loadError && <StatusMessage state="error" message={loadError} />}
      {actionMessage && (
        <StatusMessage state={actionMessage.state} message={actionMessage.message} className="px-1" />
      )}

      {loading && !hasAnyTracks ? (
        <div className="flex items-center justify-center py-16">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400" />
        </div>
      ) : visibleTracks.length === 0 ? (
        <div
          data-testid="library-empty-state"
          className="text-center py-20 bg-[var(--app-panel)] rounded-xl border-2 border-dashed border-[var(--app-panel-border)]"
        >
          <p className="text-slate-500 mb-2">{isFiltered ? 'No tracks match your filters.' : emptyCopy.title}</p>
          <p className="text-xs text-slate-600">
            {isFiltered ? 'Try a different search term or clear the tag filter.' : emptyCopy.hint}
          </p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          {visibleTracks.map((track) => (
            <LibraryCard
              key={track.id}
              track={track}
              busy={busyIds.has(track.id)}
              onArchive={handleArchive}
              onRestore={handleRestore}
            />
          ))}
        </div>
      )}
    </div>
  );
};

export default LibrarySection;
