import React, { useEffect, useMemo, useState } from 'react';
import { SunoClip, ViewMode } from '../../types';
import { listVisualizerRenders, deleteVisualizerRender, OfflineRenderHistory } from '../../services/offlineDb';

interface ActivityHistorySectionProps {
  history: SunoClip[];
  setView: (view: ViewMode) => void;
}

const ActivityHistorySection: React.FC<ActivityHistorySectionProps> = ({ history, setView }) => {
  const EXPANDED_STORAGE_KEY = 'activity_history_generation_expanded';
  const [activeTab, setActiveTab] = useState<'generations' | 'visualizers'>('generations');
  const [renders, setRenders] = useState<OfflineRenderHistory[]>([]);
  const [isLoadingRenders, setIsLoadingRenders] = useState(false);
  const [generationSort, setGenerationSort] = useState<'newest' | 'oldest' | 'title'>('newest');
  const [showOnlyExpanded, setShowOnlyExpanded] = useState(false);
  const [expandedGenerationIds, setExpandedGenerationIds] = useState<Record<string, boolean>>(() => {
    try {
      const raw = localStorage.getItem('activity_history_generation_expanded');
      if (!raw) return {};
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : {};
    } catch {
      return {};
    }
  });

  // Generations are drafts or specifically tagged models. For simplicity, any 'draft_' clip.
  const generations = useMemo(
    () => history.filter(c => c.id.startsWith('draft_') || c.model_name === 'Gemini Draft'),
    [history]
  );

  useEffect(() => {
    if (activeTab === 'visualizers') {
      loadRenders();
    }
  }, [activeTab]);

  useEffect(() => {
    try {
      localStorage.setItem(EXPANDED_STORAGE_KEY, JSON.stringify(expandedGenerationIds));
    } catch {
      // no-op
    }
  }, [EXPANDED_STORAGE_KEY, expandedGenerationIds]);

  useEffect(() => {
    if (generations.length === 0) return;
    const validIds = new Set(generations.map((g) => g.id));
    setExpandedGenerationIds((prev) => {
      const next = Object.fromEntries(
        Object.entries(prev).filter(([id, value]) => validIds.has(id) && !!value)
      );
      const sameKeys = Object.keys(next).length === Object.keys(prev).length;
      return sameKeys ? prev : next;
    });
  }, [generations]);

  const loadRenders = async () => {
    setIsLoadingRenders(true);
    try {
      const data = await listVisualizerRenders();
      setRenders(data);
    } catch (e) {
      console.error('Failed to load renders', e);
    } finally {
      setIsLoadingRenders(false);
    }
  };

  const handleDeleteRender = async (id: string) => {
    if (!window.confirm("Delete this rendered video?")) return;
    try {
      await deleteVisualizerRender(id);
      setRenders(prev => prev.filter(r => r.id !== id));
    } catch (e) {
      console.error("Failed to delete render", e);
    }
  };

  const handleDownloadRender = (render: OfflineRenderHistory) => {
    if (!render.mediaBlob) {
      alert('This render history entry stores settings only (no video file). Reopen in Visualizer and render again to download.');
      return;
    }
    const url = URL.createObjectURL(render.mediaBlob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${render.clipTitle || 'visualizer'}.webm`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const handleReapplySettings = (render: OfflineRenderHistory) => {
    // We would need a way to restore settings. 
    // For now, we just route to visualizer. A full implementation would dispatch an event or use context.
    setView('visualizer');
    alert("In a full implementation, this would restore exact settings. Navigated to Visualizer.");
  };

  const formatPercent = (value?: number) => (
    typeof value === 'number' && Number.isFinite(value) ? `${value}%` : 'N/A'
  );

  const toggleGenerationExpanded = (clipId: string) => {
    setExpandedGenerationIds((prev) => ({
      ...prev,
      [clipId]: !prev[clipId],
    }));
  };

  const expandedGenerationCount = generations.filter((g) => !!expandedGenerationIds[g.id]).length;
  const allGenerationsExpanded = generations.length > 0 && expandedGenerationCount === generations.length;

  const handleToggleAllGenerations = () => {
    if (generations.length === 0) return;
    setExpandedGenerationIds((prev) => {
      if (!allGenerationsExpanded) {
        const next = { ...prev };
        generations.forEach((g) => {
          next[g.id] = true;
        });
        return next;
      }

      const next = { ...prev };
      generations.forEach((g) => {
        delete next[g.id];
      });
      return next;
    });
  };

  const visibleGenerations = useMemo(() => {
    const base = showOnlyExpanded
      ? generations.filter((g) => !!expandedGenerationIds[g.id])
      : generations;

    const sorted = [...base];
    sorted.sort((a, b) => {
      if (generationSort === 'title') {
        return (a.title || '').localeCompare(b.title || '');
      }

      const aTime = new Date(a.created_at).getTime();
      const bTime = new Date(b.created_at).getTime();
      return generationSort === 'oldest' ? aTime - bTime : bTime - aTime;
    });

    return sorted;
  }, [expandedGenerationIds, generationSort, generations, showOnlyExpanded]);

  useEffect(() => {
    if (showOnlyExpanded && expandedGenerationCount === 0) {
      setShowOnlyExpanded(false);
    }
  }, [expandedGenerationCount, showOnlyExpanded]);

  return (
    <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-500">
      <div className="flex gap-2 border-b border-[var(--app-panel-border)] pb-4">
        <button
          onClick={() => setActiveTab('generations')}
          className={`px-4 py-2 text-sm font-bold uppercase tracking-wider rounded-t border-b-2 transition-colors ${
            activeTab === 'generations'
              ? 'border-[var(--brand-accent)] text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Song Generations
        </button>
        <button
          onClick={() => setActiveTab('visualizers')}
          className={`px-4 py-2 text-sm font-bold uppercase tracking-wider rounded-t border-b-2 transition-colors ${
            activeTab === 'visualizers'
              ? 'border-[var(--brand-accent)] text-white'
              : 'border-transparent text-slate-400 hover:text-slate-200'
          }`}
        >
          Visualizer Renders
        </button>
      </div>

      {activeTab === 'generations' && (
        <div className="space-y-4">
          {generations.length > 0 && (
            <div className="flex flex-col gap-3 border border-[var(--app-panel-border)] bg-[var(--app-panel)] rounded-lg px-3 py-3">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <p className="text-xs text-slate-400">
                  {expandedGenerationCount} of {generations.length} expanded
                  <span className="ml-2">
                    ({visibleGenerations.length} visible)
                  </span>
                </p>
                <button
                  type="button"
                  onClick={handleToggleAllGenerations}
                  className="h-9 px-3 rounded-md border border-[var(--app-panel-border)] bg-black/20 hover:bg-[var(--app-tab-hover)] text-slate-200 text-[11px] font-bold uppercase tracking-widest transition-colors"
                  aria-pressed={allGenerationsExpanded}
                >
                  {allGenerationsExpanded ? 'Collapse All' : 'Expand All'}
                </button>
              </div>

              <div className="flex flex-col sm:flex-row gap-2 sm:items-center">
                <label className="flex items-center gap-2 text-xs text-slate-300">
                  <input
                    type="checkbox"
                    checked={showOnlyExpanded}
                    onChange={(e) => setShowOnlyExpanded(e.target.checked)}
                    className="h-4 w-4 rounded border-[var(--app-panel-border)] bg-black/20"
                  />
                  Show only expanded
                </label>

                <div className="sm:ml-auto flex items-center gap-2">
                  <label htmlFor="generation-sort" className="text-xs text-slate-400">Sort</label>
                  <select
                    id="generation-sort"
                    value={generationSort}
                    onChange={(e) => setGenerationSort(e.target.value as 'newest' | 'oldest' | 'title')}
                    className="h-9 rounded-md border border-[var(--app-panel-border)] bg-black/20 px-2 text-xs text-slate-200 focus:outline-none focus:ring-1 focus:ring-[var(--app-accent)]/50"
                  >
                    <option value="newest">Newest first</option>
                    <option value="oldest">Oldest first</option>
                    <option value="title">Title (A-Z)</option>
                  </select>
                </div>
              </div>
            </div>
          )}

          {generations.length === 0 ? (
            <div className="text-center py-20 bg-[var(--app-panel)] rounded-xl border-2 border-dashed border-[var(--app-panel-border)]">
              <p className="text-slate-500 mb-2">No song generations found.</p>
              <p className="text-xs text-slate-600">Generated drafts will appear here.</p>
            </div>
          ) : visibleGenerations.length === 0 ? (
            <div className="text-center py-14 bg-[var(--app-panel)] rounded-xl border border-[var(--app-panel-border)]">
              <p className="text-slate-400 mb-1">No expanded generations are currently visible.</p>
              <p className="text-xs text-slate-500">Disable "Show only expanded" or expand some generation cards.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 gap-4">
              {visibleGenerations.map((clip) => {
                const isExpanded = !!expandedGenerationIds[clip.id];
                return (
                <div key={clip.id} className="bg-[var(--app-panel)] border border-[var(--app-panel-border)] p-4 rounded-xl flex flex-col md:flex-row gap-4">
                  <div className="flex-1">
                    <h3 className="text-lg font-bold mb-1">{clip.title || 'Untitled Draft'}</h3>
                    <p className="text-xs text-slate-400 mb-3 font-mono">{new Date(clip.created_at).toLocaleString()}</p>

                    <div className="grid grid-cols-2 md:grid-cols-3 gap-2 mb-3">
                      <div className="rounded border border-[var(--app-panel-border)] bg-black/20 px-2 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">Model</p>
                        <p className="text-xs text-slate-200 truncate" title={clip.model_name}>{clip.model_name || 'N/A'}</p>
                      </div>
                      <div className="rounded border border-[var(--app-panel-border)] bg-black/20 px-2 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">Weirdness</p>
                        <p className="text-xs text-slate-200">{formatPercent(clip.originalData?.weirdness)}</p>
                      </div>
                      <div className="rounded border border-[var(--app-panel-border)] bg-black/20 px-2 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">Style Influence</p>
                        <p className="text-xs text-slate-200">{formatPercent(clip.originalData?.styleInfluence)}</p>
                      </div>
                      <div className="rounded border border-[var(--app-panel-border)] bg-black/20 px-2 py-2">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">Vocal</p>
                        <p className="text-xs text-slate-200">{clip.originalData?.vocalGender || 'N/A'}</p>
                      </div>
                      <div className="rounded border border-[var(--app-panel-border)] bg-black/20 px-2 py-2 col-span-2 md:col-span-2">
                        <p className="text-[10px] uppercase tracking-wider text-slate-500">Style Prompt</p>
                        <p className="text-xs text-slate-200 break-words">
                          {clip.originalData?.style || clip.metadata?.tags || 'N/A'}
                        </p>
                      </div>
                      {(clip.originalData?.excludeStyles || clip.metadata?.negative_tags) && (
                        <div className="rounded border border-[var(--app-panel-border)] bg-black/20 px-2 py-2 col-span-2 md:col-span-3">
                          <p className="text-[10px] uppercase tracking-wider text-slate-500">Excluded Styles</p>
                          <p className="text-xs text-slate-200 break-words">
                            {clip.originalData?.excludeStyles || clip.metadata?.negative_tags}
                          </p>
                        </div>
                      )}
                    </div>

                    <div className="space-y-2">
                      <div>
                        <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Lyrics Prompt</p>
                        <div className={`bg-black/30 p-3 rounded border border-slate-800 font-mono text-sm text-slate-300 whitespace-pre-wrap overflow-y-auto ${isExpanded ? 'max-h-[28rem]' : 'max-h-32'}`}>
                          {clip.metadata?.prompt || clip.originalData?.lyricsWithTags || clip.originalData?.lyricsAlone || 'No prompt data.'}
                        </div>
                      </div>
                      {(isExpanded && clip.originalData?.advancedParams) && (
                        <div>
                          <p className="text-[10px] uppercase tracking-wider text-slate-500 mb-1">Advanced Params</p>
                          <div className="bg-black/20 p-2 rounded border border-[var(--app-panel-border)] text-xs text-slate-300 whitespace-pre-wrap break-words">
                            {clip.originalData.advancedParams}
                          </div>
                        </div>
                      )}
                    </div>
                  </div>
                  <div className="md:w-48 flex flex-col justify-end">
                    <button
                      onClick={() => toggleGenerationExpanded(clip.id)}
                      className="w-full mb-2 py-2 border border-[var(--app-panel-border)] bg-[var(--app-panel)] hover:bg-[var(--app-tab-hover)] text-slate-200 text-[11px] font-bold uppercase tracking-widest transition-colors rounded"
                      aria-expanded={isExpanded}
                    >
                      {isExpanded ? 'Collapse Details' : 'Expand Details'}
                    </button>
                    <button
                      onClick={() => setView('generator')}
                      className="w-full py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-bold uppercase tracking-widest transition-colors rounded"
                    >
                      Open Generator
                    </button>
                  </div>
                </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {activeTab === 'visualizers' && (
        <div className="space-y-4">
          {isLoadingRenders ? (
            <div className="text-center py-20 text-slate-500">Loading renders...</div>
          ) : renders.length === 0 ? (
            <div className="text-center py-20 bg-[var(--app-panel)] rounded-xl border-2 border-dashed border-[var(--app-panel-border)]">
              <p className="text-slate-500 mb-2">No offline renders found.</p>
              <p className="text-xs text-slate-600">Videos rendered from the Visualizer will appear here.</p>
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
              {renders.map(render => (
                <div key={render.id} className="bg-[var(--app-panel)] border border-[var(--app-panel-border)] rounded-xl overflow-hidden flex flex-col">
                  <div className="p-4 bg-black/40 border-b border-[var(--app-panel-border)]">
                    <h3 className="font-bold truncate" title={render.clipTitle}>{render.clipTitle}</h3>
                    <p className="text-[10px] text-slate-400 font-mono mt-1">
                      {new Date(render.createdAt).toLocaleString()}
                      {typeof render.fileSize === 'number' ? ` • ${(render.fileSize / 1024 / 1024).toFixed(2)} MB` : ' • settings only'}
                    </p>
                  </div>
                  
                  {/* Basic Preview */}
                  <div className="aspect-video bg-black flex items-center justify-center border-b border-[var(--app-panel-border)] relative group">
                     {render.mediaBlob ? (
                       <video src={URL.createObjectURL(render.mediaBlob)} controls className="w-full h-full object-contain" />
                     ) : (
                       <div className="px-4 text-center">
                         <p className="text-sm text-slate-300">No video file stored</p>
                         <p className="text-xs text-slate-500 mt-1">This entry keeps render settings only for replay/re-render.</p>
                       </div>
                     )}
                  </div>

                  <div className="p-3 grid grid-cols-2 gap-2 mt-auto">
                    <button
                      onClick={() => handleDownloadRender(render)}
                      disabled={!render.mediaBlob}
                      className="py-1.5 px-2 bg-emerald-900/30 hover:bg-emerald-800/50 text-emerald-400 border border-emerald-800/50 rounded text-xs font-bold uppercase tracking-wider transition-colors"
                    >
                      Download
                    </button>
                    <button
                      onClick={() => handleReapplySettings(render)}
                      className="py-1.5 px-2 bg-slate-800 hover:bg-slate-700 text-slate-300 border border-slate-700 rounded text-[10px] font-bold uppercase tracking-wider transition-colors"
                    >
                      Use Settings
                    </button>
                    <button
                      onClick={() => handleDeleteRender(render.id)}
                      className="py-1.5 px-2 col-span-2 bg-red-900/20 hover:bg-red-900/40 text-red-400 border border-red-900/30 rounded text-xs font-bold uppercase tracking-wider transition-colors"
                    >
                      Delete
                    </button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default ActivityHistorySection;
