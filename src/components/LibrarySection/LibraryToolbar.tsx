import React from 'react';
import { AppInput, AppSelect, cx } from '../ui/AppPrimitives';

export type LibraryStatusFilter = 'all' | 'active' | 'archived' | 'gone';

export interface LibraryStatusCounts {
  all: number;
  active: number;
  archived: number;
  gone: number;
}

const STATUS_TABS: { key: LibraryStatusFilter; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'active', label: 'Active' },
  { key: 'archived', label: 'Archived' },
  { key: 'gone', label: 'No longer on Suno' },
];

interface LibraryToolbarProps {
  counts: LibraryStatusCounts;
  statusFilter: LibraryStatusFilter;
  onStatusFilterChange: (next: LibraryStatusFilter) => void;
  searchQuery: string;
  onSearchChange: (next: string) => void;
  tagOptions: string[];
  tagFilter: string;
  onTagFilterChange: (next: string) => void;
  onRefresh: () => void;
  loading: boolean;
}

const LibraryToolbar: React.FC<LibraryToolbarProps> = ({
  counts,
  statusFilter,
  onStatusFilterChange,
  searchQuery,
  onSearchChange,
  tagOptions,
  tagFilter,
  onTagFilterChange,
  onRefresh,
  loading,
}) => (
  <div className="bg-[var(--app-panel)] border border-[var(--app-panel-border)] rounded-xl p-4 space-y-4">
    <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
      <div>
        <h2 className="text-lg font-bold text-white flex items-center gap-2">
          <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5 text-emerald-400" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 6a2 2 0 0 1 2-2h3v16H5a2 2 0 0 0-2 2z" />
            <path d="M21 6a2 2 0 0 0-2-2h-3v16h3a2 2 0 0 1 2 2z" />
            <path d="M8 4h8v16H8z" />
          </svg>
          Track Library
        </h2>
        <p data-testid="library-counts" className="text-xs text-slate-400 mt-1">
          {counts.active} active · {counts.archived} archived · {counts.gone} no longer on Suno
        </p>
      </div>
      <button
        type="button"
        onClick={onRefresh}
        disabled={loading}
        className="h-9 px-3 rounded-md border border-[var(--app-panel-border)] text-xs font-bold text-slate-200 disabled:opacity-40 disabled:cursor-not-allowed hover:bg-[var(--app-tab-hover)]"
      >
        {loading ? 'Loading…' : 'Refresh'}
      </button>
    </div>

    <div className="flex flex-col md:flex-row gap-3">
      <AppInput
        type="search"
        placeholder="Search by title or tag…"
        value={searchQuery}
        onChange={(e) => onSearchChange(e.target.value)}
        aria-label="Search library"
        className="md:flex-grow"
      />
      <AppSelect
        value={tagFilter}
        onChange={(e) => onTagFilterChange(e.target.value)}
        aria-label="Filter by tag"
        className="md:w-56"
      >
        <option value="">All tags</option>
        {tagOptions.map((tag) => (
          <option key={tag} value={tag}>
            {tag}
          </option>
        ))}
      </AppSelect>
    </div>

    <div className="flex flex-wrap gap-2" role="tablist" aria-label="Track status">
      {STATUS_TABS.map((tab) => {
        const isActive = statusFilter === tab.key;
        return (
          <button
            key={tab.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-library-filter={tab.key}
            onClick={() => onStatusFilterChange(tab.key)}
            className={cx(
              'px-3 py-1.5 rounded-lg text-xs font-bold border transition-colors flex items-center gap-2',
              isActive
                ? 'border-[var(--app-accent)]/70 bg-[var(--app-accent)]/15 text-white'
                : 'border-[var(--app-panel-border)] text-slate-300 hover:text-white hover:bg-[var(--app-tab-hover)]'
            )}
          >
            {tab.label}
            <span className={cx('px-1.5 rounded-full text-[10px] font-mono', isActive ? 'bg-black/30 text-white' : 'bg-slate-900 text-slate-400')}>
              {counts[tab.key]}
            </span>
          </button>
        );
      })}
    </div>
  </div>
);

export default LibraryToolbar;
