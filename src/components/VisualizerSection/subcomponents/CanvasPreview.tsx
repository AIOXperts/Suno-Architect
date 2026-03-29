
import React from 'react';
import { ASPECT_RATIOS } from '../../../constants';
import { AppCard } from '../../ui/AppPrimitives';

interface CanvasPreviewProps {
  canvasRef: React.RefObject<HTMLCanvasElement | null>;
  aspectRatio: keyof typeof ASPECT_RATIOS;
  isPreparing: boolean;
}

const CanvasPreview: React.FC<CanvasPreviewProps> = ({ canvasRef, aspectRatio, isPreparing }) => {
  return (
    <AppCard className="overflow-hidden p-0 flex flex-col">
        <div className="bg-slate-900 px-4 py-2 border-b border-[var(--app-panel-border)] flex justify-between items-center">
            <h3 className="text-xs font-bold text-slate-400 uppercase tracking-wider">Canvas Live Preview</h3>
            <div className="flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                <span className="text-[10px] font-mono text-emerald-500/80 uppercase">Live_Output</span>
            </div>
        </div>
        <div className="bg-black relative flex items-center justify-center bg-[url('data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyMCIgaGVpZ2h0PSIyMCIgZmlsbD0iIzIyMiI+PHJlY3Qgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiB4PSIwIiB5PSIwIiBmaWxsPSIjMzMzIi8+PHJlY3Qgd2lkdGg9IjEwIiBoZWlnaHQ9IjEwIiB4PSIxMCIgeT0iMTAiIGZpbGw9IiMzMzMiLz48L3N2Zz4=')] min-h-[300px]">
            <canvas 
              ref={canvasRef}
              width={ASPECT_RATIOS[aspectRatio].width}
              height={ASPECT_RATIOS[aspectRatio].height}
              className="max-w-full max-h-[70vh] w-auto h-auto object-contain shadow-2xl transition-opacity duration-300"
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
    </AppCard>
  );
};

export default CanvasPreview;
