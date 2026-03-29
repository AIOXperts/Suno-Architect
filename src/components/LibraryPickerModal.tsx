import React, { useState, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { OfflineTrack, TrackVariant } from '../services/offlineDb';

export interface LibrarySelection {
  track: OfflineTrack;
  variant?: TrackVariant;
}

interface LibraryPickerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectTrack: (selection: LibrarySelection) => void;
}

const LibraryPickerModal: React.FC<LibraryPickerModalProps> = ({ isOpen, onClose, onSelectTrack }) => {
  const [tracks, setTracks] = useState<OfflineTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (isOpen) {
      loadTracks();
    }
  }, [isOpen]);

  const loadTracks = async () => {
    setLoading(true);
    try {
      const { listAllTracks } = await import('../services/offlineDb');
      const allTracks = await listAllTracks();
      setTracks(allTracks);
    } catch (error) {
      console.error('Failed to load tracks:', error);
    } finally {
      setLoading(false);
    }
  };

  const filteredTracks = tracks.filter(track =>
    track.title.toLowerCase().includes(searchQuery.toLowerCase()) ||
    track.metadata.tags.some(tag => tag.toLowerCase().includes(searchQuery.toLowerCase()))
  );

  const handleSelect = (track: OfflineTrack, variant?: TrackVariant) => {
    onSelectTrack({ track, variant });
    onClose();
  };

  if (!isOpen) return null;

  const modalContent = (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-2 sm:p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200 overflow-y-auto">
      <div className="bg-slate-900 border border-[var(--app-panel-border)] rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col my-4 sm:my-8 max-h-[calc(100vh-2rem)] sm:max-h-[85vh] overflow-hidden">
        {/* Header */}
        <div className="flex-shrink-0 border-b border-[var(--app-panel-border)] bg-[var(--app-panel)] p-3 sm:p-4 rounded-t-2xl flex justify-between items-center gap-2">
          <h2 className="text-lg sm:text-xl font-bold text-white flex items-center gap-2">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <path d="M3 6a2 2 0 0 1 2-2h3v16H5a2 2 0 0 0-2 2z" />
              <path d="M21 6a2 2 0 0 0-2-2h-3v16h3a2 2 0 0 1 2 2z" />
              <path d="M8 4h8v16H8z" />
            </svg>
            <span className="hidden sm:inline">Select from Library</span>
            <span className="sm:hidden">Library</span>
          </h2>
          <button onClick={onClose} className="text-slate-400 hover:text-white p-1">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Search - sticky at top */}
        <div className="flex-shrink-0 p-3 sm:p-4 border-b border-[var(--app-panel-border)] bg-slate-900">
          <input
            type="text"
            placeholder="Search tracks..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            autoFocus
            className="w-full bg-slate-950 border border-[var(--app-panel-border)] rounded-lg px-4 py-2 text-white placeholder-slate-500 focus:ring-1 focus:ring-emerald-500 outline-none"
          />
        </div>

        {/* Track List */}
        <div className="flex-grow overflow-y-auto custom-scrollbar p-2 min-h-[200px]">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-emerald-400"></div>
            </div>
          ) : filteredTracks.length === 0 ? (
            <div className="text-center py-12 text-slate-400">
              {tracks.length === 0 ? (
                <>
                  <p className="text-lg mb-2">No tracks in library</p>
                  <p className="text-sm">Sync your library from Suno to see tracks here</p>
                </>
              ) : (
                <p>No tracks match your search</p>
              )}
            </div>
          ) : (
            <div className="space-y-1">
              {filteredTracks.map((track) => {
                const variants = [...(track.variants || [])].sort((a, b) => b.createdAt - a.createdAt);
                return (
                  <div
                    key={track.id}
                    className="rounded-lg border border-transparent hover:border-[var(--app-panel-border)] bg-transparent hover:bg-[var(--app-panel)]/40 transition-colors"
                  >
                    <button
                      onClick={() => handleSelect(track)}
                      className="w-full flex items-center gap-3 p-3 text-left group"
                    >
                      <div className="w-12 h-12 rounded-md bg-slate-800 flex-shrink-0 overflow-hidden">
                        {track.imageUrl ? (
                          <img src={track.imageUrl} alt="" className="w-full h-full object-cover" />
                        ) : (
                          <div className="w-full h-full flex items-center justify-center">
                            <svg xmlns="http://www.w3.org/2000/svg" className="w-6 h-6 text-slate-600" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                              <path d="M9 18V5l12-2v13" />
                              <circle cx="6" cy="18" r="3" />
                              <circle cx="18" cy="16" r="3" />
                            </svg>
                          </div>
                        )}
                      </div>
                      <div className="flex-grow min-w-0">
                        <p className="text-white font-medium truncate group-hover:text-emerald-400 transition-colors">
                          {track.title}
                        </p>
                        <p className="text-slate-500 text-sm truncate">
                          {track.metadata.tags.slice(0, 3).join(', ') || 'No tags'}
                        </p>
                      </div>
                      <div className="flex-shrink-0 text-right">
                        <div className="text-slate-500 text-xs">
                          {track.metadata.durationMs ? (
                            <span>{Math.floor(track.metadata.durationMs / 60000)}:{String(Math.floor((track.metadata.durationMs % 60000) / 1000)).padStart(2, '0')}</span>
                          ) : null}
                        </div>
                        <div className="mt-1 text-[10px] uppercase tracking-wide text-emerald-400/80">
                          Original
                        </div>
                      </div>
                    </button>

                    {variants.length > 0 && (
                      <div className="px-3 pb-3">
                        <div className="ml-[60px] flex flex-wrap gap-2">
                          {variants.slice(0, 4).map((variant) => (
                            <button
                              key={variant.id}
                              onClick={() => handleSelect(track, variant)}
                              className="px-2.5 py-1 text-xs rounded-full border border-slate-700 text-slate-200 hover:border-emerald-500/60 hover:text-emerald-300 transition-colors"
                              title={`Use ${variant.type} variant as reference`}
                            >
                              {variant.type}: {variant.title}
                            </button>
                          ))}
                          {variants.length > 4 && (
                            <span className="px-2.5 py-1 text-xs rounded-full border border-slate-800 text-slate-500">
                              +{variants.length - 4} more
                            </span>
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex-shrink-0 flex justify-end gap-3 p-3 sm:p-4 border-t border-[var(--app-panel-border)] bg-[var(--app-panel)] rounded-b-2xl">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium text-slate-300 hover:text-white hover:bg-[var(--app-panel)] rounded-lg transition-colors">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );

  return createPortal(modalContent, document.body);
};

export default LibraryPickerModal;
