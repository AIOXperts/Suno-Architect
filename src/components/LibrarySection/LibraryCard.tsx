import React from 'react';
import { OfflineTrack, isTrackArchived } from '../../services/offlineDb';
import { AppButton, cx } from '../ui/AppPrimitives';

/** mm:ss formatting shared with LibraryPickerModal. Returns null when no duration is known. */
export const formatTrackDuration = (durationMs: number | undefined | null): string | null => {
  if (!durationMs || durationMs <= 0) return null;
  const minutes = Math.floor(durationMs / 60000);
  const seconds = String(Math.floor((durationMs % 60000) / 1000)).padStart(2, '0');
  return `${minutes}:${seconds}`;
};

export const ArchivedChip: React.FC<{ className?: string }> = ({ className }) => (
  <span
    data-track-chip="archived"
    className={cx('px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border border-amber-500/40 bg-amber-500/10 text-amber-300', className)}
  >
    Archived
  </span>
);

export const GoneChip: React.FC<{ className?: string }> = ({ className }) => (
  <span
    data-track-chip="gone"
    className={cx('px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wide border border-slate-500/50 bg-slate-600/30 text-slate-300', className)}
  >
    No longer on Suno
  </span>
);

interface LibraryCardProps {
  track: OfflineTrack;
  busy: boolean;
  onArchive: (track: OfflineTrack) => void;
  onRestore: (track: OfflineTrack) => void;
}

const LibraryCard: React.FC<LibraryCardProps> = ({ track, busy, onArchive, onRestore }) => {
  const archived = isTrackArchived(track);
  const duration = formatTrackDuration(track.metadata?.durationMs);
  const variantCount = track.variants?.length ?? 0;
  const tags = track.metadata?.tags ?? [];

  return (
    <div
      data-track-id={track.id}
      data-track-status={archived ? 'archived' : 'active'}
      className={cx(
        'bg-[var(--app-panel)] border border-[var(--app-panel-border)] rounded-xl overflow-hidden shadow-lg flex flex-row min-h-[100px] transition-all hover:border-slate-600',
        archived && 'opacity-60'
      )}
    >
      <div className="relative w-[100px] shrink-0 bg-slate-900">
        {track.imageUrl ? (
          <img
            src={track.imageUrl}
            alt=""
            className="w-full h-full object-cover"
            onError={(e) => {
              (e.target as HTMLImageElement).src = 'https://placehold.co/100x100/1e293b/475569?text=No+Image';
            }}
          />
        ) : (
          <div className="w-full h-full flex items-center justify-center text-slate-600">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-8 h-8 opacity-50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
        )}
      </div>

      <div className="p-3 flex-grow flex flex-col justify-between gap-2 overflow-hidden">
        <div>
          <div className="flex items-start gap-2">
            <h3 className="text-base font-bold text-white truncate leading-tight flex-grow" title={track.title}>
              {track.title || 'Untitled Track'}
            </h3>
            <div className="flex items-center gap-1 shrink-0">
              {archived && <ArchivedChip />}
              {track.goneFromRemote && <GoneChip />}
            </div>
          </div>
          <div className="flex items-center gap-2 text-xs text-slate-500 mt-1">
            {duration && <span className="font-mono">{duration}</span>}
            {duration && <span>•</span>}
            <span>{variantCount} {variantCount === 1 ? 'variant' : 'variants'}</span>
          </div>
          {tags.length > 0 ? (
            <div className="flex flex-wrap gap-1 mt-2">
              {tags.slice(0, 6).map((tag) => (
                <span key={tag} className="px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 text-[10px]">
                  {tag}
                </span>
              ))}
              {tags.length > 6 && (
                <span className="px-1.5 py-0.5 rounded text-slate-500 text-[10px]">+{tags.length - 6} more</span>
              )}
            </div>
          ) : (
            <p className="text-[10px] text-slate-600 mt-2">No tags</p>
          )}
        </div>

        <div className="flex items-center justify-end gap-2">
          {archived ? (
            <AppButton
              size="sm"
              variant="success"
              disabled={busy}
              onClick={() => onRestore(track)}
              data-track-action="restore"
            >
              {busy ? 'Restoring…' : 'Restore'}
            </AppButton>
          ) : (
            <AppButton
              size="sm"
              variant="warning"
              disabled={busy}
              onClick={() => onArchive(track)}
              data-track-action="archive"
              title="Archive this track and free its cached audio/cover. Metadata and lyrics are kept."
            >
              {busy ? 'Archiving…' : 'Archive'}
            </AppButton>
          )}
        </div>
      </div>
    </div>
  );
};

export default LibraryCard;
