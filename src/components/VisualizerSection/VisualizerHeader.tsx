import React from 'react';
import { SunoClip } from '../../types';
import { AppButton, AppCard, AppInput, AppSelect } from '../ui/AppPrimitives';
import LibraryPickerModal, { LibrarySelection } from '../LibraryPickerModal';

interface VisualizerHeaderProps {
  history: SunoClip[];
  selectedClipId: string;
  setSelectedClipId: (id: string) => void;
  manualId: string;
  setManualId: (id: string) => void;
  onManualLoad: () => void;
  onSelectFromLibrary?: (selection: LibrarySelection) => void;
}

const VisualizerHeader: React.FC<VisualizerHeaderProps> = ({ 
    history, selectedClipId, setSelectedClipId, manualId, setManualId, onManualLoad, onSelectFromLibrary 
}) => {
  const [showLibraryPicker, setShowLibraryPicker] = React.useState(false);

  const handleLibrarySelect = (selection: LibrarySelection) => {
    if (onSelectFromLibrary) {
      onSelectFromLibrary(selection);
    }
    setShowLibraryPicker(false);
  };

  return (
    <AppCard className="p-6 backdrop-blur-sm border-[var(--app-panel-border)]/50">
        <div className="flex flex-col md:flex-row justify-between items-start md:items-center gap-4 mb-6">
            <div>
            <h2 className="text-2xl font-bold text-white mb-1">Lyric Video Visualizer</h2>
            <p className="text-sm text-slate-400">Build lyric visuals live and publish through the connected workflow (Suno sync can be used offline).</p>
            </div>
            
            <div className="flex gap-2 w-full md:w-auto">
                <button
                    onClick={() => setShowLibraryPicker(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors text-sm"
                >
                    <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                        <path d="M3 6a2 2 0 0 1 2-2h3v16H5a2 2 0 0 0-2 2z" />
                        <path d="M21 6a2 2 0 0 0-2-2h-3v16h3a2 2 0 0 1 2 2z" />
                        <path d="M8 4h8v16H8z" />
                    </svg>
                    Select from Library
                </button>
                <AppSelect
                value={selectedClipId}
                onChange={(e) => setSelectedClipId(e.target.value)}
                className="block w-full md:w-64 text-slate-300"
                >
                    <option value="">Or from History...</option>
                    {history.filter(c => !c.id.startsWith('draft_')).map(c => (
                        <option key={c.id} value={c.id}>{c.title || c.id}</option>
                    ))}
                </AppSelect>
            </div>
        </div>
        
        <div className="flex gap-2 items-center pt-4 border-t border-[var(--app-panel-border)]/50">
        <AppInput
            type="text" 
            placeholder="Or paste Suno ID / UUID manually..." 
            value={manualId}
            onChange={(e) => setManualId(e.target.value)}
            className="flex-1"
        />
        <AppButton
            variant="secondary"
            onClick={onManualLoad}
            className="text-sm px-4 py-2"
        >
            Load ID
        </AppButton>
        </div>

        <LibraryPickerModal
            isOpen={showLibraryPicker}
            onClose={() => setShowLibraryPicker(false)}
            onSelectTrack={handleLibrarySelect}
        />
    </AppCard>
  );
};

export default VisualizerHeader;
