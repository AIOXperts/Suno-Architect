import React from 'react';
import type { AlignedWord } from '../../../types';
import { AppButton, AppCard, AppInput } from '../../ui/AppPrimitives';

interface WordAlignmentEditorCardProps {
  alignment: AlignedWord[] | null;
  currentTime: number;
  onApplyAlignment: (next: AlignedWord[]) => void;
}

const PAGE_SIZE = 80;

const fmt = (n: number) => (Number.isFinite(n) ? n.toFixed(2) : '0.00');

const WordAlignmentEditorCard: React.FC<WordAlignmentEditorCardProps> = ({
  alignment,
  currentTime,
  onApplyAlignment,
}) => {
  const [page, setPage] = React.useState(0);
  const [draft, setDraft] = React.useState<AlignedWord[]>([]);
  const [dirty, setDirty] = React.useState(false);

  React.useEffect(() => {
    setDraft(alignment ? alignment.map((w) => ({ ...w })) : []);
    setDirty(false);
    setPage(0);
  }, [alignment]);

  const totalPages = Math.max(1, Math.ceil(draft.length / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const pageStart = safePage * PAGE_SIZE;
  const pageRows = draft.slice(pageStart, pageStart + PAGE_SIZE);

  const activeIndex = React.useMemo(() => {
    if (!draft.length) return -1;
    return draft.findIndex((w) => currentTime >= w.start_s && currentTime <= w.end_s);
  }, [draft, currentTime]);

  React.useEffect(() => {
    if (activeIndex < 0) return;
    const nextPage = Math.floor(activeIndex / PAGE_SIZE);
    if (!dirty) setPage(nextPage);
  }, [activeIndex, dirty]);

  const updateWord = (index: number, patch: Partial<AlignedWord>) => {
    setDraft((prev) => {
      const next = [...prev];
      next[index] = { ...next[index], ...patch };
      return next;
    });
    setDirty(true);
  };

  const handleApply = () => {
    if (!draft.length) return;
    onApplyAlignment(draft);
    setDirty(false);
  };

  const handleResetPage = () => {
    if (!alignment) return;
    setDraft((prev) => {
      const next = [...prev];
      for (let i = pageStart; i < Math.min(pageStart + PAGE_SIZE, alignment.length); i++) {
        next[i] = { ...alignment[i] };
      }
      return next;
    });
    setDirty(true);
  };

  return (
    <AppCard className="rounded-xl p-4 space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div>
          <p className="text-xs font-bold text-slate-300 uppercase tracking-wider">Word Alignment Editor</p>
          <p className="text-[10px] text-slate-500">
            Edit Suno synced words directly. Applying updates canvas timing/grouping using the current LRC.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <AppButton size="xs" variant="secondary" onClick={handleResetPage} disabled={!alignment || !draft.length}>
            Reset Page
          </AppButton>
          <AppButton size="xs" variant="primary" onClick={handleApply} disabled={!dirty || !draft.length}>
            Apply Word Edits
          </AppButton>
        </div>
      </div>

      {!alignment || alignment.length === 0 ? (
        <p className="text-xs text-slate-500">No alignment data loaded for this clip.</p>
      ) : (
        <>
          <div className="flex items-center justify-between gap-2 text-[10px] text-slate-400">
            <span>{draft.length} words • playback {fmt(currentTime)}s</span>
            <div className="flex items-center gap-2">
              <AppButton size="xs" variant="secondary" onClick={() => setPage((p) => Math.max(0, p - 1))} disabled={safePage <= 0}>
                Prev
              </AppButton>
              <span>Page {safePage + 1}/{totalPages}</span>
              <AppButton size="xs" variant="secondary" onClick={() => setPage((p) => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1}>
                Next
              </AppButton>
            </div>
          </div>

          <div className="max-h-[24rem] overflow-auto rounded border border-[var(--app-panel-border)]">
            <table className="w-full text-xs">
              <thead className="sticky top-0 bg-slate-900 z-10">
                <tr className="text-slate-400">
                  <th className="text-left px-2 py-2 w-14">#</th>
                  <th className="text-left px-2 py-2">Word</th>
                  <th className="text-left px-2 py-2 w-28">Start</th>
                  <th className="text-left px-2 py-2 w-28">End</th>
                  <th className="text-left px-2 py-2 w-20">Dur</th>
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, i) => {
                  const globalIndex = pageStart + i;
                  const isActive = globalIndex === activeIndex;
                  const duration = Math.max(0, row.end_s - row.start_s);
                  return (
                    <tr key={`${globalIndex}-${row.word}`} className={isActive ? 'bg-cyan-500/10' : 'bg-transparent'}>
                      <td className="px-2 py-1.5 font-mono text-slate-400">{globalIndex + 1}</td>
                      <td className="px-2 py-1.5">
                        <AppInput
                          value={row.word}
                          onChange={(e) => updateWord(globalIndex, { word: e.target.value })}
                          className="h-8 text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <AppInput
                          type="number"
                          step="0.01"
                          value={Number.isFinite(row.start_s) ? row.start_s : 0}
                          onChange={(e) => updateWord(globalIndex, { start_s: Number(e.target.value) })}
                          className="h-8 text-xs"
                        />
                      </td>
                      <td className="px-2 py-1.5">
                        <AppInput
                          type="number"
                          step="0.01"
                          value={Number.isFinite(row.end_s) ? row.end_s : 0}
                          onChange={(e) => updateWord(globalIndex, { end_s: Number(e.target.value) })}
                          className="h-8 text-xs"
                        />
                      </td>
                      <td className={`px-2 py-1.5 font-mono ${duration <= 0 ? 'text-red-300' : 'text-slate-400'}`}>
                        {fmt(duration)}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </>
      )}
    </AppCard>
  );
};

export default WordAlignmentEditorCard;
