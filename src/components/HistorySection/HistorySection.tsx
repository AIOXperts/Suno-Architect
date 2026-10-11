import React, { useEffect, useMemo, useState } from 'react';
import { SunoClip, ParsedSunoOutput } from '../../types';
import { extractSunoPlaylistId, getSunoClip, getSunoFeedOfflineAware, getSunoPlaylist } from '../../services/sunoApi';
import HistoryToolbar from './HistoryToolbar';
import HistoryCard from './HistoryCard';
import DetailsModal from './DetailsModal';
import { stripMetaTags } from '../../utils/lyrics';
import { downloadPlaylistZipFromCache } from '../../services/playlistDownloadService';

interface HistorySectionProps {
  history: SunoClip[];
  onUpdateClip: (id: string, updates: Partial<SunoClip>) => void;
  onAddClip: (clip: SunoClip | SunoClip[]) => void;
  sunoCookie?: string;
  onFetchHistory: (limit: number | 'all') => void;
  isSyncing: boolean;
  syncProgress?: string;
  onDownloadOfflineCache: () => void;
  isDownloadingOfflineCache: boolean;
  offlineProgress?: string;
  useCachedData: boolean;
  onToggleUseCachedData: (value: boolean) => void;
  /** One-line note shown under the header when history persistence had to trim or failed. */
  storageWarning?: string;
}

// Helper to map API response to SunoClip (reused logic)
const mapSunoClip = (clip: any): SunoClip => {
    const metadata = clip.metadata || {};
    const tags = metadata.tags || '';
    const prompt = metadata.prompt || '';
    const title = clip.title || 'Untitled';

    const originalData: ParsedSunoOutput = {
        style: tags,
        title: title,
        excludeStyles: metadata.negative_tags || '',
        advancedParams: '',
        vocalGender: '',
        weirdness: metadata.control_sliders?.weirdness_constraint ? Math.round(metadata.control_sliders.weirdness_constraint * 100) : 50,
        styleInfluence: metadata.control_sliders?.style_weight ? Math.round(metadata.control_sliders.style_weight * 100) : 50,
        lyricsWithTags: prompt,
        lyricsAlone: stripMetaTags(prompt),
        fullResponse: ''
    };

    return {
        id: clip.id,
        title: title,
        created_at: clip.created_at,
        model_name: clip.model_name || 'unknown',
        imageUrl: clip.image_url,
        imageLargeUrl: clip.image_large_url,
        explicit: clip.explicit,
        metadata: {
            tags: tags,
            prompt: prompt,
            negative_tags: metadata.negative_tags,
            duration: metadata.duration,
            max_bpm: metadata.max_bpm,
            min_bpm: metadata.min_bpm,
            avg_bpm: metadata.avg_bpm,
            key: metadata.key,
        },
        originalData: originalData
    };
};

const HistorySection: React.FC<HistorySectionProps> = ({
  history,
  onUpdateClip,
  onAddClip,
  sunoCookie,
  onFetchHistory,
  isSyncing,
  syncProgress,
  onDownloadOfflineCache,
  isDownloadingOfflineCache,
  offlineProgress,
  useCachedData,
  onToggleUseCachedData,
  storageWarning,
}) => {
  const [selectedClipId, setSelectedClipId] = useState<string | null>(null);
  
  // Search & Filter State
  const [searchText, setSearchText] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [searchResults, setSearchResults] = useState<SunoClip[] | null>(null);
  const [limit, setLimit] = useState<number>(50);
  const [currentPage, setCurrentPage] = useState(1);
  const [playlistZipState, setPlaylistZipState] = useState<'idle' | 'packing' | 'done' | 'error'>('idle');
  const [playlistZipMessage, setPlaylistZipMessage] = useState('');

  // Derive the active clip from history to ensure we always have the latest data
  const selectedClip = useMemo(() => {
    // Check history first, then search results
    let clip = history.find(c => c.id === selectedClipId);
    if (!clip && searchResults) {
        clip = searchResults.find(c => c.id === selectedClipId);
    }
    return clip || null;
  }, [history, searchResults, selectedClipId]);

  const isDraft = (clip: SunoClip) => clip.id.startsWith('draft_');

  const handleSearchOrImport = async () => {
      if (!searchText.trim()) return;
      if (!sunoCookie) {
          alert("Please connect Suno API in settings to search or import.");
          return;
      }
      
      setIsSearching(true);
      const input = searchText.trim();
      
      // UUID Check for Direct Import
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(input);
      const playlistId = extractSunoPlaylistId(input);

      try {
          if (playlistId && !isUUID) {
              const data = await getSunoPlaylist(playlistId, sunoCookie);
              const playlistClips = Array.isArray(data?.playlist_clips)
                ? data.playlist_clips
                    .map((entry: any) => entry?.clip)
                    .filter(Boolean)
                : [];

              const clips = playlistClips.map(mapSunoClip);
              setSearchResults(clips);
              onAddClip(clips);
          } else if (isUUID) {
              // Direct Import
              const data = await getSunoClip(input, sunoCookie);
              if (data) {
                  const clip = mapSunoClip(data);
                  onAddClip(clip);
                  // Display the imported clip as a search result
                  setSearchResults([clip]);
              }
          } else {
              // Feed Search
              const data = await getSunoFeedOfflineAware(sunoCookie, limit, null, input, { useCachedData });
              if (data && Array.isArray(data.clips)) {
                  const results = data.clips.map(mapSunoClip);
                  setSearchResults(results);
                  // Automatically merge search results into history persistence
                  onAddClip(results); 
              } else {
                  setSearchResults([]);
              }
          }
      } catch (e: any) {
          console.error("Search/Import failed", e);
          alert("Failed to process request. Check ID/Connection.");
      } finally {
          setIsSearching(false);
      }
  };

  const handleClearSearch = () => {
      setSearchText('');
      setSearchResults(null);
      setCurrentPage(1);
  };

  const handleDownloadPlaylistZip = async () => {
    const input = searchText.trim();
    const playlistId = extractSunoPlaylistId(input);
    if (!playlistId) {
      setPlaylistZipState('error');
      setPlaylistZipMessage('Enter a valid Suno playlist URL/ID first.');
      return;
    }

    setPlaylistZipState('packing');
    setPlaylistZipMessage('Building playlist ZIP from local cache...');
    try {
      const result = await downloadPlaylistZipFromCache(playlistId);
      setPlaylistZipState('done');
      setPlaylistZipMessage(`ZIP created. Added ${result.added} tracks, skipped ${result.skipped} uncached tracks.`);
    } catch (error) {
      console.error('Playlist ZIP export failed', error);
      setPlaylistZipState('error');
      setPlaylistZipMessage('Playlist not available offline yet. Sync/download cache first.');
    }
  };

  const libraryBaseList = useMemo(() => {
    const drafts = history.filter(c => c.id.startsWith('draft_'));
    const nonDrafts = history.filter(c => !c.id.startsWith('draft_'));
    return [...drafts, ...nonDrafts];
  }, [history]);

  const activeList = useMemo(() => {
    if (searchText && searchResults) return searchResults;
    return libraryBaseList;
  }, [searchText, searchResults, libraryBaseList]);

  const totalPages = Math.max(1, Math.ceil(activeList.length / limit));
  const safeCurrentPage = Math.min(currentPage, totalPages);

  const displayList = useMemo(() => {
    const start = (safeCurrentPage - 1) * limit;
    return activeList.slice(start, start + limit);
  }, [activeList, limit, safeCurrentPage]);

  const libraryTotalCount = libraryBaseList.length;

  useEffect(() => {
    setCurrentPage(1);
  }, [limit, searchText]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
    }
  }, [currentPage, totalPages]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
        <HistoryToolbar 
            totalCount={libraryTotalCount}
            visibleCount={displayList.length}
            searchText={searchText}
            setSearchText={setSearchText}
            onAction={handleSearchOrImport}
            isActionLoading={isSearching}
            onFetchHistory={onFetchHistory}
            isSyncing={isSyncing}
            syncProgress={syncProgress}
            limit={limit}
            setLimit={setLimit}
            onClearSearch={handleClearSearch}
            isShowingSearchResults={!!(searchText && searchResults)}
            onDownloadOfflineCache={onDownloadOfflineCache}
            isDownloadingOfflineCache={isDownloadingOfflineCache}
            offlineProgress={offlineProgress}
        />
        {storageWarning && (
          <p
            data-testid="history-storage-warning"
            role="status"
            className="text-xs text-amber-300 border border-amber-500/30 bg-amber-500/10 rounded-md px-3 py-2"
          >
            {storageWarning}
          </p>
        )}
        <div className="flex items-center gap-3 border border-[var(--app-panel-border)] bg-black/40 px-3 py-2 rounded-md w-fit">
          <span className="text-[11px] uppercase tracking-wider text-slate-300">Library Source</span>
          <button
            onClick={() => onToggleUseCachedData(!useCachedData)}
            className={`text-xs font-bold px-2.5 py-1 rounded border ${useCachedData ? 'bg-green-400/10 text-green-300 border-green-500' : 'bg-[var(--app-panel)] text-slate-200 border-slate-600'}`}
          >
            {useCachedData ? 'Local Library Mode' : 'Live Suno API'}
          </button>
        </div>

        <div className="border border-[var(--app-panel-border)] bg-black/40 px-3 py-3 rounded-md">
          <div className="flex flex-wrap items-center gap-3">
            <p className="text-[11px] uppercase tracking-[0.16em] text-slate-300">Playlist ZIP (Cached Library)</p>
            <button
              type="button"
              onClick={handleDownloadPlaylistZip}
              disabled={playlistZipState === 'packing'}
              className="h-9 px-3 border border-amber-300 text-amber-200 text-[11px] font-bold uppercase tracking-[0.14em] disabled:opacity-40 disabled:cursor-not-allowed hover:bg-amber-300/10"
            >
              {playlistZipState === 'packing' ? 'Packing ZIP...' : 'Download Playlist ZIP'}
            </button>
          </div>
          {playlistZipMessage && (
            <p
              className={`mt-2 text-xs ${
                playlistZipState === 'done'
                  ? 'text-emerald-300'
                  : playlistZipState === 'error'
                    ? 'text-red-300'
                    : 'text-slate-300'
              }`}
            >
              {playlistZipMessage}
            </p>
          )}
        </div>
        
        {displayList.length === 0 ? (
             <div className="text-center py-20 bg-[var(--app-panel)] rounded-xl border-2 border-dashed border-[var(--app-panel-border)]">
                <p className="text-slate-500 mb-2">
                    {searchText && searchResults ? "No results found for search." : "Your library is empty."}
                </p>
                <p className="text-xs text-slate-600">
                    {searchText && searchResults ? "Try a different keyword." : "Generated songs and drafts will appear here."}
                </p>
             </div>
        ) : (
            <>
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                  {displayList.map((clip) => (
                      <HistoryCard 
                          key={clip.id} 
                          clip={clip} 
                          onClick={() => setSelectedClipId(clip.id)}
                          isDraft={isDraft(clip)}
                      />
                  ))}
              </div>

              {activeList.length > limit && (
                <div className="flex flex-col sm:flex-row items-center justify-between gap-3 border border-[var(--app-panel-border)] bg-[var(--app-panel)] px-3 py-2 rounded-lg">
                  <p className="text-xs text-slate-400">
                    Page {safeCurrentPage} of {totalPages}
                    <span className="ml-2">
                      ({(safeCurrentPage - 1) * limit + 1}-{Math.min(safeCurrentPage * limit, activeList.length)} of {activeList.length})
                    </span>
                  </p>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => setCurrentPage((p) => Math.max(1, p - 1))}
                      disabled={safeCurrentPage <= 1}
                      className="px-3 h-9 rounded-md border border-[var(--app-panel-border)] text-xs font-bold text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--app-tab-hover)]"
                      aria-label="Previous page"
                    >
                      Prev
                    </button>
                    <button
                      type="button"
                      onClick={() => setCurrentPage((p) => Math.min(totalPages, p + 1))}
                      disabled={safeCurrentPage >= totalPages}
                      className="px-3 h-9 rounded-md border border-[var(--app-panel-border)] text-xs font-bold text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--app-tab-hover)]"
                      aria-label="Next page"
                    >
                      Next
                    </button>
                  </div>
                </div>
              )}
            </>
        )}

        {selectedClip && (
            <DetailsModal 
                clip={selectedClip} 
                onClose={() => setSelectedClipId(null)} 
                onUpdateClip={onUpdateClip}
                sunoCookie={sunoCookie}
                isDraft={isDraft(selectedClip)}
            />
        )}
    </div>
  );
};

export default HistorySection;
