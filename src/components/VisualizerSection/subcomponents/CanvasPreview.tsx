
import React from 'react';
import { ASPECT_RATIOS } from '../../../constants';

interface CanvasPreviewProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  aspectRatio: keyof typeof ASPECT_RATIOS;
  isPreparing: boolean;
}

const CanvasPreview: React.FC<CanvasPreviewProps> = ({ canvasRef, aspectRatio, isPreparing }) => {
  return (
    <div className="relative w-[min(72vw,960px)] rounded-xl overflow-hidden border border-[var(--app-panel-border)] shadow-2xl">
      <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/50 backdrop-blur-sm border border-emerald-500/20 text-[10px] text-emerald-400 font-mono z-10">
        <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
        LIVE
      </div>
      <div className="absolute top-3 left-3 text-[10px] font-mono text-white/25 tracking-wider z-10">
        {ASPECT_RATIOS[aspectRatio].label}
      </div>
      <div className="bg-black flex items-center justify-center bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgZmlsbD0iIzIyMiI+PHJlY3Qgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiB4PSIwIiB5PSIwIiBmaWxsPSIjMzMzIi8+PHJlY3Qgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiB4PSIxMCIgeT0iMTAiIGZpbGw9IiMzMzMiLz48L3N2Zz4=')]">
        <canvas
          ref={canvasRef}
          width={ASPECT_RATIOS[aspectRatio].width}
          height={ASPECT_RATIOS[aspectRatio].height}
          className="max-w-full max-h-[55vh] w-auto h-auto object-contain"
        />

        {isPreparing && (
          <div className="absolute inset-0 bg-black/80 flex items-center justify-center z-10 backdrop-blur-sm">
            <div className="flex flex-col items-center">
              <svg className="animate-spin h-8 w-8 text-[var(--app-accent)] mb-3" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
              </svg>
              <span className="text-white text-xs font-bold uppercase tracking-widest animate-pulse">Initializing Assets...</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default CanvasPreview;
