import React from 'react';
import { AppButton, AppCard, AppTextarea } from '../../ui/AppPrimitives';

interface MetadataCardProps {
  lyricSource: string;
  setLyricSource: (val: string) => void;
  lrcDraft: string;
  setLrcDraft: (val: string) => void;
  onApplyLyrics: () => void;
  onApplyLrc: () => void;
  onGenerateLrcFromCurrentLines: () => void;
  applyStatus: 'idle' | 'applied';
  lrcApplyStatus: 'idle' | 'applied' | 'error';
  hasAlignment: boolean;
  longLineIssues: Array<{
    lineIndex: number;
    duration_s: number;
    severity: 'warning' | 'critical';
    text: string;
  }>;
  longLrcGapIssues: Array<{
    fromLineNumber: number;
    toLineNumber: number;
    gap_s: number;
    severity: 'warning' | 'critical';
  }>;
  lrcInvalidLineNumbers: number[];
  lrcParsedLineCount: number;
}

const MetadataCard: React.FC<MetadataCardProps> = ({ 
  lyricSource, 
  setLyricSource, 
  lrcDraft,
  setLrcDraft,
  onApplyLyrics, 
  onApplyLrc,
  onGenerateLrcFromCurrentLines,
  applyStatus, 
  lrcApplyStatus,
  hasAlignment,
  longLineIssues,
  longLrcGapIssues,
  lrcInvalidLineNumbers,
  lrcParsedLineCount
}) => {
  const topLongLineIssues = longLineIssues.slice(0, 3);
  const topLrcGapIssues = longLrcGapIssues.slice(0, 3);

  return (
    <AppCard className="rounded-xl overflow-hidden shadow-lg p-0">
      <div className="bg-[var(--app-panel)] px-4 py-3 border-b border-[var(--app-panel-border)] flex justify-between items-center">
          <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Timed Lyrics Editor (LRC)</h3>
          <div className="flex items-center gap-2">
            <span className="text-[10px] text-slate-500">{lrcParsedLineCount} timestamps</span>
            <AppButton
              size="xs"
              variant="secondary"
              onClick={onGenerateLrcFromCurrentLines}
              disabled={!hasAlignment}
              title="Generate LRC from current visualizer line timings"
            >
              Rebuild LRC
            </AppButton>
            <AppButton
              size="xs"
              variant={lrcApplyStatus === 'error' ? 'danger' : 'primary'}
              onClick={onApplyLrc}
              disabled={!hasAlignment}
              title="Apply LRC timestamps + text to visualizer lines"
            >
              {lrcApplyStatus === 'applied' ? 'Applied!' : lrcApplyStatus === 'error' ? 'LRC Error' : 'Apply LRC'}
            </AppButton>
          </div>
      </div>
      <div className="p-2">
            <AppTextarea
              value={lrcDraft}
              onChange={(e) => setLrcDraft(e.target.value)}
              className="w-full h-44 bg-slate-950 text-xs font-mono text-slate-300 placeholder-slate-600 custom-scrollbar resize-y leading-relaxed"
              placeholder="[00:12.34] First lyric line"
            />
            <p className="text-[10px] text-slate-500 mt-2 px-1">
              Single editor flow: edit timestamp + lyric text here, then click <strong>Apply LRC</strong>. Suno alignment is still used underneath for timing windows.
            </p>

            {(topLongLineIssues.length > 0 || topLrcGapIssues.length > 0 || lrcInvalidLineNumbers.length > 0) && (
              <div className="mt-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-2 space-y-1">
                <p className="text-[11px] font-semibold text-amber-200">Timing Warnings</p>
                {topLongLineIssues.map((issue) => (
                  <p key={`line-${issue.lineIndex}`} className={`text-[10px] ${issue.severity === 'critical' ? 'text-red-300' : 'text-amber-200'}`}>
                    Visual line {issue.lineIndex + 1}: {issue.duration_s.toFixed(1)}s {issue.text ? `• ${issue.text.slice(0, 70)}` : ''}
                  </p>
                ))}
                {topLrcGapIssues.map((issue, idx) => (
                  <p key={`lrc-gap-${idx}`} className={`text-[10px] ${issue.severity === 'critical' ? 'text-red-300' : 'text-amber-200'}`}>
                    LRC gap lines {issue.fromLineNumber}→{issue.toLineNumber}: {issue.gap_s.toFixed(1)}s
                  </p>
                ))}
                {lrcInvalidLineNumbers.length > 0 && (
                  <p className="text-[10px] text-amber-100">
                    LRC lines without valid timestamps: {lrcInvalidLineNumbers.slice(0, 8).join(', ')}
                    {lrcInvalidLineNumbers.length > 8 ? '…' : ''}
                  </p>
                )}
              </div>
            )}

            <details className="mt-4 pt-3 border-t border-[var(--app-panel-border)]">
              <summary className="cursor-pointer text-[11px] font-semibold uppercase tracking-wider text-slate-400">
                Advanced: Structure Text (Legacy)
              </summary>
              <div className="mt-2">
                <div className="flex justify-end mb-2">
                  <AppButton
                    variant="primary"
                    size="xs"
                    onClick={onApplyLyrics}
                    disabled={!hasAlignment}
                    className={`disabled:opacity-50 ${applyStatus === 'applied' ? 'bg-green-600 border-green-500 text-white' : 'bg-[var(--app-accent)] border-purple-500 text-white'}`}
                    title="Legacy prompt-text grouping"
                  >
                    {applyStatus === 'applied' ? 'Applied!' : 'Apply Structure'}
                  </AppButton>
                </div>
                <AppTextarea
                  value={lyricSource}
                  onChange={(e) => setLyricSource(e.target.value)}
                  className="w-full h-32 bg-slate-950 text-xs font-mono text-slate-300 placeholder-slate-600 custom-scrollbar resize-y leading-relaxed"
                  placeholder="Legacy plain-text grouping editor"
                />
                <p className="text-[10px] text-slate-500 mt-2 px-1">
                  This is kept for fallback grouping. Primary flow is the timed LRC editor above.
                </p>
              </div>
            </details>
      </div>
    </AppCard>
  );
};

export default MetadataCard;
