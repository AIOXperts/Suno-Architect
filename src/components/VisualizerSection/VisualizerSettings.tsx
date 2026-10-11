import React, { useMemo, useState } from 'react';
import { VISUALIZER_FONTS } from '../../constants';
import { ColorEvent, Qt6Style } from '../../types';
import { AppButton, AppInput, AppSelect, AppTextarea, AppFieldLabel } from '../ui/AppPrimitives';
import { formatTime } from '../../utils/visualizer';

const SliderRow: React.FC<{ label: string; value: number; display?: string; children: React.ReactNode }> = ({ label, value, display, children }) => (
  <div>
    <div className="flex items-center justify-between mb-1">
      <AppFieldLabel className="!mb-0">{label}</AppFieldLabel>
      <span className="text-[10px] font-mono text-slate-400">{display ?? value}</span>
    </div>
    {children}
  </div>
);

interface VisualizerSettingsProps {
    activeTab: 'style' | 'timeline' | 'dsp';
    savedPresets: Array<{ id: string; name: string; createdAt: string }>;
    onSavePreset: (name: string) => void;
    onApplySavedPreset: (id: string) => void;
    onDeleteSavedPreset: (id: string) => void;
    templatePreset: 'classic' | 'clean-lyrics' | 'corner-pulse' | 'cinematic-bars';
    onTemplateChange: (val: 'classic' | 'clean-lyrics' | 'corner-pulse' | 'cinematic-bars') => void;
    fontFamily: string;
    setFontFamily: (val: string) => void;
    activeColor: string;
    setActiveColor: (val: string) => void;
    inactiveColor: string;
    setInactiveColor: (val: string) => void;
    smoothingFactor: number;
    setSmoothingFactor: (val: number) => void;
    verticalOffset: number;
    setVerticalOffset: (val: number) => void;
    inactiveOpacity: number;
    setInactiveOpacity: (val: number) => void;
    mainVisualizerEnabled: boolean;
    showTitle: boolean;
    setShowTitle: (val: boolean) => void;
    logoPosition: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
    setLogoPosition: (val: 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left') => void;
    logoScale: number;
    setLogoScale: (val: number) => void;
    logoOpacity: number;
    setLogoOpacity: (val: number) => void;
    logoPulseEnabled: boolean;
    setLogoPulseEnabled: (val: boolean) => void;
    logoPulseStyle: 'expanding-circle' | 'radial-bars' | 'circular-wave';
    setLogoPulseStyle: (val: 'expanding-circle' | 'radial-bars' | 'circular-wave') => void;
    logoPulseGap: number;
    setLogoPulseGap: (val: number) => void;
    logoPulseScale: number;
    setLogoPulseScale: (val: number) => void;
    logoPulseSensitivity: number;
    setLogoPulseSensitivity: (val: number) => void;
    qt6Style: Qt6Style;
    setQt6Style: (val: Qt6Style) => void;
    qt6BarCount: number;
    setQt6BarCount: (val: number) => void;
    qt6Sensitivity: number;
    setQt6Sensitivity: (val: number) => void;
    qt6SpectrogramSpeed: number;
    setQt6SpectrogramSpeed: (val: number) => void;
    qt6ParticleDensity: number;
    setQt6ParticleDensity: (val: number) => void;
    qt6RingCount: number;
    setQt6RingCount: (val: number) => void;
    qt6LedSegments: number;
    setQt6LedSegments: (val: number) => void;
    qt6SpectrogramPalette: 'neon' | 'fire' | 'ice' | 'mono';
    setQt6SpectrogramPalette: (val: 'neon' | 'fire' | 'ice' | 'mono') => void;
    onApplyQt6LookPreset: (preset: 'retro-led' | 'broadcast-vu' | 'neon-spectrogram' | 'club-radial' | 'organic-ambient' | 'social-hybrid') => void;
    onRandomizeQt6Look: () => void;
    videoBitrate: number;
    setVideoBitrate: (val: number) => void;
    videoBitrateMode: 'constant' | 'variable';
    setVideoBitrateMode: (val: 'constant' | 'variable') => void;
    fps: number;
    setFps: (val: number) => void;
    outputAspectTarget: 'landscape' | 'portrait';
    setOutputAspectTarget: (val: 'landscape' | 'portrait') => void;
    preRollEnabled: boolean;
    setPreRollEnabled: (val: boolean) => void;
    preRollType: 'text' | 'qr';
    setPreRollType: (val: 'text' | 'qr') => void;
    preRollText: string;
    setPreRollText: (val: string) => void;
    preRollSeconds: number;
    setPreRollSeconds: (val: number) => void;
    preRollPreviewEnabled: boolean;
    setPreRollPreviewEnabled: (val: boolean) => void;
    preRollPreviewStartSeconds: number;
    setPreRollPreviewStartSeconds: (val: number) => void;
    preRollPreviewDurationSeconds: number;
    setPreRollPreviewDurationSeconds: (val: number) => void;
    preRollPreviewShowTitle: boolean;
    setPreRollPreviewShowTitle: (val: boolean) => void;
    preRollShowHeading: boolean;
    setPreRollShowHeading: (val: boolean) => void;
    preRollHeadingText: string;
    setPreRollHeadingText: (val: string) => void;
    preRollCardShowTitle: boolean;
    setPreRollCardShowTitle: (val: boolean) => void;
    preRollCardTitleText: string;
    setPreRollCardTitleText: (val: string) => void;
    preRollCardTheme: 'clean' | 'bold';
    setPreRollCardTheme: (val: 'clean' | 'bold') => void;
    postRollEnabled: boolean;
    setPostRollEnabled: (val: boolean) => void;
    postRollType: 'text' | 'qr';
    setPostRollType: (val: 'text' | 'qr') => void;
    postRollText: string;
    setPostRollText: (val: string) => void;
    postRollSeconds: number;
    setPostRollSeconds: (val: number) => void;
    postRollShowHeading: boolean;
    setPostRollShowHeading: (val: boolean) => void;
    postRollHeadingText: string;
    setPostRollHeadingText: (val: string) => void;
    colorEvents: ColorEvent[];
    onAddColorEvent: (event: ColorEvent) => void;
    onRemoveColorEvent: (index: number) => void;
    onUpdateColorEvent: (index: number, event: ColorEvent) => void;
    currentTime: number;
    onReset: () => void;
}

const VisualizerSettings: React.FC<VisualizerSettingsProps> = ({
    activeTab,
    savedPresets, onSavePreset, onApplySavedPreset, onDeleteSavedPreset,
    templatePreset, onTemplateChange,
    fontFamily, setFontFamily, activeColor, setActiveColor, inactiveColor, setInactiveColor,
    smoothingFactor, setSmoothingFactor, verticalOffset, setVerticalOffset, inactiveOpacity, setInactiveOpacity,
    mainVisualizerEnabled, showTitle, setShowTitle, logoPosition, setLogoPosition, logoScale, setLogoScale, logoOpacity, setLogoOpacity,
    logoPulseEnabled, setLogoPulseEnabled, logoPulseStyle, setLogoPulseStyle, logoPulseGap, setLogoPulseGap, logoPulseScale, setLogoPulseScale, logoPulseSensitivity, setLogoPulseSensitivity,
    qt6Style, setQt6Style, qt6BarCount, setQt6BarCount, qt6Sensitivity, setQt6Sensitivity,
    qt6SpectrogramSpeed, setQt6SpectrogramSpeed, qt6ParticleDensity, setQt6ParticleDensity, qt6RingCount, setQt6RingCount, qt6LedSegments, setQt6LedSegments, qt6SpectrogramPalette, setQt6SpectrogramPalette,
    onApplyQt6LookPreset, onRandomizeQt6Look,
    videoBitrate, setVideoBitrate, videoBitrateMode, setVideoBitrateMode,
    fps, setFps,
    outputAspectTarget, setOutputAspectTarget,
    preRollEnabled, setPreRollEnabled, preRollType, setPreRollType, preRollText, setPreRollText, preRollSeconds, setPreRollSeconds,
    preRollPreviewEnabled, setPreRollPreviewEnabled, preRollPreviewStartSeconds, setPreRollPreviewStartSeconds, preRollPreviewDurationSeconds, setPreRollPreviewDurationSeconds, preRollPreviewShowTitle, setPreRollPreviewShowTitle, preRollShowHeading, setPreRollShowHeading, preRollHeadingText, setPreRollHeadingText,
    preRollCardShowTitle, setPreRollCardShowTitle, preRollCardTitleText, setPreRollCardTitleText, preRollCardTheme, setPreRollCardTheme,
    postRollEnabled, setPostRollEnabled, postRollType, setPostRollType, postRollText, setPostRollText, postRollSeconds, setPostRollSeconds, postRollShowHeading, setPostRollShowHeading, postRollHeadingText, setPostRollHeadingText,
    colorEvents, onAddColorEvent, onRemoveColorEvent, onUpdateColorEvent, currentTime,
    onReset
}) => {
  const [newPresetName, setNewPresetName] = useState('');
  const [selectedSavedPresetId, setSelectedSavedPresetId] = useState('');
  const [selectedLookPreset, setSelectedLookPreset] = useState<'retro-led' | 'broadcast-vu' | 'neon-spectrogram' | 'club-radial' | 'organic-ambient' | 'social-hybrid'>('retro-led');
  const showsBarCountControl = ['bars', 'stereo-bars', 'log-bars', 'led-bars', 'radial-spectrum', 'wave-spectrum'].includes(qt6Style);
  const showsLedSegmentsControl = qt6Style === 'led-bars';
  const showsSpectrogramSpeedControl = qt6Style === 'spectrogram';
  const showsParticleDensityControl = qt6Style === 'particle-pulse';
  const showsRingCountControl = qt6Style === 'multi-band-ring';
  const logoVisualizerMode: 'off' | 'expanding-circle' | 'radial-bars' | 'circular-wave' =
    logoPulseEnabled ? logoPulseStyle : 'off';

  const preDuration = Math.max(0, preRollEnabled ? preRollSeconds : 0);
  const postDuration = Math.max(0, postRollEnabled ? postRollSeconds : 0);
  const timelineSummary = useMemo(() => {
    const parts = [
      preDuration > 0 ? `Pre-roll ${preDuration.toFixed(1)}s` : 'No pre-roll',
      'Song',
      postDuration > 0 ? `Post-roll ${postDuration.toFixed(1)}s` : 'No post-roll'
    ];
    return parts.join(' -> ');
  }, [postDuration, preDuration]);

  const handleSavePreset = () => {
    const clean = newPresetName.trim();
    if (!clean) return;
    onSavePreset(clean);
    setNewPresetName('');
  };

  const renderStyleTab = () => (
    <div className="space-y-4">
      <div className="border border-[var(--app-panel-border)] bg-slate-950/40 rounded-xl p-3 space-y-2">
        <div className="flex items-center justify-between mb-1">
          <span className="text-[11px] font-semibold text-slate-300 uppercase tracking-wider">Presets</span>
          <AppButton variant="secondary" size="xs" onClick={onReset} className="text-[var(--app-accent)] border-[var(--app-accent)]/30 hover:bg-[var(--app-accent)]/10">Reset</AppButton>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
          <AppInput value={newPresetName} onChange={(e) => setNewPresetName(e.target.value)} placeholder="Preset name" className="h-9" />
          <AppButton variant="primary" onClick={handleSavePreset} size="sm">Save</AppButton>
          <AppButton variant="secondary" onClick={() => selectedSavedPresetId && onApplySavedPreset(selectedSavedPresetId)} disabled={!selectedSavedPresetId} size="sm">Load</AppButton>
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
          <AppSelect value={selectedSavedPresetId} onChange={(e) => setSelectedSavedPresetId(e.target.value)} className="h-9">
            <option value="">Select saved preset...</option>
            {savedPresets.map((preset) => (
              <option key={preset.id} value={preset.id}>{preset.name}</option>
            ))}
          </AppSelect>
          <div className="flex items-center gap-2">
            <AppButton variant="danger" onClick={() => { if (!selectedSavedPresetId) return; onDeleteSavedPreset(selectedSavedPresetId); setSelectedSavedPresetId(''); }} disabled={!selectedSavedPresetId} size="sm">Delete</AppButton>
            <span className="text-[10px] text-slate-500 font-mono">{savedPresets.length} saved</span>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <div className="border border-[var(--app-panel-border)] rounded-xl p-3 space-y-3 bg-slate-950/20">
          <h4 className="text-[11px] uppercase tracking-wider font-semibold text-slate-300">Template</h4>
          <div>
            <AppFieldLabel>Template Preset</AppFieldLabel>
            <AppSelect value={templatePreset} onChange={(e) => onTemplateChange(e.target.value as any)} className="h-9">
              <option value="classic">Classic Cover Lyrics</option>
              <option value="clean-lyrics">Clean Lyric Frame</option>
              <option value="corner-pulse">Corner Pulse Logo</option>
              <option value="cinematic-bars">Cinematic Bars</option>
            </AppSelect>
          </div>
          <div>
            <AppFieldLabel>Font Family</AppFieldLabel>
            <AppSelect value={fontFamily} onChange={(e) => setFontFamily(e.target.value)} className="h-9">
              {VISUALIZER_FONTS.map(f => <option key={f.value} value={f.value}>{f.label}</option>)}
            </AppSelect>
          </div>
        </div>

        <div className="border border-[var(--app-panel-border)] rounded-xl p-3 space-y-3 bg-slate-950/20">
          <h4 className="text-[11px] uppercase tracking-wider font-semibold text-slate-300">Colors</h4>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <AppFieldLabel>Active Color</AppFieldLabel>
              <div className="flex items-center gap-2">
                <input type="color" value={activeColor} onChange={(e) => setActiveColor(e.target.value)} aria-label="Active color" className="w-8 h-8 rounded border border-slate-700 bg-transparent cursor-pointer" />
                <span className="text-[10px] text-slate-400 font-mono">{activeColor}</span>
              </div>
            </div>
            <div>
              <AppFieldLabel>Inactive Color</AppFieldLabel>
              <div className="flex items-center gap-2">
                <input type="color" value={inactiveColor} onChange={(e) => setInactiveColor(e.target.value)} aria-label="Inactive color" className="w-8 h-8 rounded border border-slate-700 bg-transparent cursor-pointer" />
                <span className="text-[10px] text-slate-400 font-mono">{inactiveColor}</span>
              </div>
            </div>
          </div>
          <SliderRow label="Inactive Opacity" value={inactiveOpacity}>
            <input type="range" min="0.05" max="1" step="0.05" value={inactiveOpacity} onChange={(e) => setInactiveOpacity(parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[var(--app-accent)]" />
          </SliderRow>
          <SliderRow label="Scroll Smoothing" value={smoothingFactor}>
            <input type="range" min="0.01" max="0.5" step="0.01" value={smoothingFactor} onChange={(e) => setSmoothingFactor(parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[var(--app-accent)]" />
          </SliderRow>
          <SliderRow label="Vertical Position" value={verticalOffset}>
            <input type="range" min="-0.4" max="0.4" step="0.01" value={verticalOffset} onChange={(e) => setVerticalOffset(parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[var(--app-accent)]" />
          </SliderRow>
        </div>

        <div className="border border-[var(--app-panel-border)] rounded-xl p-3 space-y-3 bg-slate-950/20">
          <h4 className="text-[11px] uppercase tracking-wider font-semibold text-slate-300">Branding</h4>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <AppFieldLabel>Show Song Title</AppFieldLabel>
              <AppButton variant={showTitle ? 'primary' : 'secondary'} size="sm" onClick={() => setShowTitle(!showTitle)} className="w-full text-[10px]">
                {showTitle ? 'Visible' : 'Hidden'}
              </AppButton>
            </div>
            <div>
              <AppFieldLabel>Logo Position</AppFieldLabel>
              <AppSelect value={logoPosition} onChange={(e) => setLogoPosition(e.target.value as any)} className="h-9">
                <option value="bottom-right">Bottom Right</option>
                <option value="bottom-left">Bottom Left</option>
                <option value="top-right">Top Right</option>
                <option value="top-left">Top Left</option>
              </AppSelect>
            </div>
          </div>
          <SliderRow label="Logo Size" value={logoScale}>
            <input type="range" min="0.08" max="0.45" step="0.01" value={logoScale} onChange={(e) => setLogoScale(parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[var(--app-accent)]" />
          </SliderRow>
          <SliderRow label="Logo Opacity" value={logoOpacity}>
            <input type="range" min="0.2" max="1" step="0.05" value={logoOpacity} onChange={(e) => setLogoOpacity(parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[var(--app-accent)]" />
          </SliderRow>
          <div>
            <AppFieldLabel>Logo Visualizer</AppFieldLabel>
            <AppSelect value={logoVisualizerMode} onChange={(e) => {
              const value = e.target.value as 'off' | 'expanding-circle' | 'radial-bars' | 'circular-wave';
              if (value === 'off') { setLogoPulseEnabled(false); return; }
              setLogoPulseEnabled(true); setLogoPulseStyle(value);
            }} className="h-9">
              <option value="off">Off</option>
              <option value="expanding-circle">Expanding Circle</option>
              <option value="radial-bars">Radial Bars</option>
              <option value="circular-wave">Circular Wave</option>
            </AppSelect>
          </div>
          {logoPulseEnabled && (
            <div className="grid grid-cols-3 gap-2">
              <SliderRow label="Pulse Size" value={logoPulseScale}>
                <input type="range" min="0.35" max="2.8" step="0.05" value={logoPulseScale} onChange={(e) => setLogoPulseScale(parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[var(--app-accent)]" />
              </SliderRow>
              <SliderRow label="Pulse Gap" value={logoPulseGap}>
                <input type="range" min="-40" max="80" step="1" value={logoPulseGap} onChange={(e) => setLogoPulseGap(parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[var(--app-accent)]" />
              </SliderRow>
              <SliderRow label="Sensitivity" value={logoPulseSensitivity}>
                <input type="range" min="0.5" max="3" step="0.1" value={logoPulseSensitivity} onChange={(e) => setLogoPulseSensitivity(parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[var(--app-accent)]" />
              </SliderRow>
            </div>
          )}
        </div>
      </div>
    </div>
  );

  const renderTimelineTab = () => (
    <div className="space-y-4">
      <div className="rounded-xl bg-slate-950/60 border border-[var(--app-panel-border)] p-3 text-xs text-slate-300 font-mono uppercase tracking-tighter">
        <div className="font-bold text-slate-400 mb-1">Playback Order</div>
        <div className="flex items-center gap-2">
          <span className="text-[var(--app-accent)]">●</span> {timelineSummary}
        </div>
      </div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="border border-[var(--app-panel-border)] bg-slate-950/40 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-bold text-slate-200 uppercase tracking-widest">Pre-Roll</label>
            <AppButton data-testid="preroll-toggle" size="xs" variant={preRollEnabled ? 'primary' : 'secondary'} onClick={() => setPreRollEnabled(!preRollEnabled)} className="h-6">
              {preRollEnabled ? 'ENABLED' : 'DISABLED'}
            </AppButton>
          </div>
          <AppSelect value={preRollType} onChange={(e) => setPreRollType(e.target.value as 'text' | 'qr')} className="h-9" disabled={!preRollEnabled}>
            <option value="text">Text Message</option>
            <option value="qr">QR Code</option>
          </AppSelect>
          <AppTextarea data-testid="preroll-text" value={preRollText} onChange={(e) => setPreRollText(e.target.value)} placeholder={preRollType === 'qr' ? 'https://your-link.example' : 'Thank you for supporting my work'} className="h-20 text-[11px]" disabled={!preRollEnabled} />
          <div>
            <AppFieldLabel>Card Heading</AppFieldLabel>
            <label className="mb-2 flex items-center justify-between text-[11px] text-slate-300 cursor-pointer">
              <span>Show Heading</span>
              <input type="checkbox" checked={preRollShowHeading} onChange={(e) => setPreRollShowHeading(e.target.checked)} disabled={!preRollEnabled} className="h-4 w-4 rounded border-slate-700 bg-slate-900" />
            </label>
            <AppInput type="text" value={preRollHeadingText} onChange={(e) => setPreRollHeadingText(e.target.value)} className="h-9 text-[11px]" disabled={!preRollEnabled || !preRollShowHeading} placeholder={preRollPreviewEnabled ? 'Preview Intro' : 'Pre-Roll'} />
          </div>
          <div>
            <AppFieldLabel>Card Duration (s)</AppFieldLabel>
            <AppInput data-testid="preroll-seconds" type="number" min={1} max={15} value={preRollSeconds} onChange={(e) => setPreRollSeconds(Number(e.target.value))} className="h-9" disabled={!preRollEnabled} />
          </div>
          <div className="pt-2 border-t border-[var(--app-panel-border)]/60 space-y-2">
            <label className="flex items-center justify-between text-[11px] text-slate-300 cursor-pointer">
              <span>Use Song Preview Intro</span>
              <input data-testid="preroll-preview-toggle" type="checkbox" checked={preRollPreviewEnabled} onChange={(e) => setPreRollPreviewEnabled(e.target.checked)} disabled={!preRollEnabled} className="h-4 w-4 rounded border-slate-700 bg-slate-900" />
            </label>
            <p className="text-[10px] text-slate-500 leading-tight">Social hooks: pick a short snippet (under 10s), then playback restarts at song beginning.</p>
            <div className="grid grid-cols-2 gap-2">
              <AppInput data-testid="preroll-preview-start" type="number" min={0} max={3600} step={0.1} value={preRollPreviewStartSeconds} onChange={(e) => setPreRollPreviewStartSeconds(Number(e.target.value))} className="h-9" disabled={!preRollEnabled || !preRollPreviewEnabled} title="Preview start timestamp (seconds)" />
              <AppInput data-testid="preroll-preview-duration" type="number" min={1} max={10} step={0.1} value={preRollPreviewDurationSeconds} onChange={(e) => setPreRollPreviewDurationSeconds(Number(e.target.value))} className="h-9" disabled={!preRollEnabled || !preRollPreviewEnabled} title="Preview duration (max 10s)" />
            </div>
            <label className="flex items-center justify-between text-[11px] text-slate-300 cursor-pointer">
              <span>Show Track Title in Intro</span>
              <input data-testid="preroll-preview-title-toggle" type="checkbox" checked={preRollPreviewShowTitle} onChange={(e) => setPreRollPreviewShowTitle(e.target.checked)} disabled={!preRollEnabled || !preRollPreviewEnabled} className="h-4 w-4 rounded border-slate-700 bg-slate-900" />
            </label>
          </div>
          <div className="pt-2 border-t border-[var(--app-panel-border)]/60 space-y-2">
            <p className="text-[11px] font-bold text-slate-300 uppercase tracking-widest">Card Design</p>
            <AppSelect value={preRollCardTheme} onChange={(e) => setPreRollCardTheme(e.target.value as 'clean' | 'bold')} className="h-9" disabled={!preRollEnabled}>
              <option value="clean">Theme: Clean</option>
              <option value="bold">Theme: Bold</option>
            </AppSelect>
            <label className="flex items-center justify-between text-[11px] text-slate-300 cursor-pointer">
              <span>Show Title on Card</span>
              <input type="checkbox" checked={preRollCardShowTitle} onChange={(e) => setPreRollCardShowTitle(e.target.checked)} disabled={!preRollEnabled} className="h-4 w-4 rounded border-slate-700 bg-slate-900" />
            </label>
            <AppInput type="text" value={preRollCardTitleText} onChange={(e) => setPreRollCardTitleText(e.target.value)} className="h-9 text-[11px]" disabled={!preRollEnabled || !preRollCardShowTitle} placeholder="Track title override (optional)" />
          </div>
        </div>

        <div className="border border-[var(--app-panel-border)] bg-slate-950/40 rounded-xl p-3 space-y-2">
          <div className="flex items-center justify-between">
            <label className="text-[11px] font-bold text-slate-200 uppercase tracking-widest">Post-Roll</label>
            <AppButton data-testid="postroll-toggle" size="xs" variant={postRollEnabled ? 'primary' : 'secondary'} onClick={() => setPostRollEnabled(!postRollEnabled)} className="h-6">
              {postRollEnabled ? 'ENABLED' : 'DISABLED'}
            </AppButton>
          </div>
          <AppSelect value={postRollType} onChange={(e) => setPostRollType(e.target.value as 'text' | 'qr')} className="h-9" disabled={!postRollEnabled}>
            <option value="text">Text Message</option>
            <option value="qr">QR Code</option>
          </AppSelect>
          <AppTextarea data-testid="postroll-text" value={postRollText} onChange={(e) => setPostRollText(e.target.value)} placeholder={postRollType === 'qr' ? 'https://your-link.example' : 'Artist Name'} className="h-20 text-[11px]" disabled={!postRollEnabled} />
          <div>
            <AppFieldLabel>Card Heading</AppFieldLabel>
            <label className="mb-2 flex items-center justify-between text-[11px] text-slate-300 cursor-pointer">
              <span>Show Heading</span>
              <input type="checkbox" checked={postRollShowHeading} onChange={(e) => setPostRollShowHeading(e.target.checked)} disabled={!postRollEnabled} className="h-4 w-4 rounded border-slate-700 bg-slate-900" />
            </label>
            <AppInput type="text" value={postRollHeadingText} onChange={(e) => setPostRollHeadingText(e.target.value)} className="h-9 text-[11px]" disabled={!postRollEnabled || !postRollShowHeading} placeholder="Post-Roll" />
          </div>
          <div>
            <AppFieldLabel>Card Duration (s)</AppFieldLabel>
            <AppInput type="number" min={1} max={15} value={postRollSeconds} onChange={(e) => setPostRollSeconds(Number(e.target.value))} className="h-9" disabled={!postRollEnabled} />
          </div>
        </div>
      </div>

      <div className="border border-[var(--app-panel-border)] rounded-xl p-3 space-y-3 bg-slate-950/20">
        <h4 className="text-[11px] uppercase tracking-wider font-semibold text-slate-300">Export Engine</h4>
        <div className="grid grid-cols-1 md:grid-cols-4 gap-2">
          <div>
            <AppFieldLabel>Render Target</AppFieldLabel>
            <AppSelect value={outputAspectTarget} onChange={(e) => setOutputAspectTarget(e.target.value as 'landscape' | 'portrait')} className="h-9">
              <option value="landscape">16:9 Output (1920x1080)</option>
              <option value="portrait">9:16 Output (1080x1920)</option>
            </AppSelect>
          </div>
          <div>
            <AppFieldLabel>FPS</AppFieldLabel>
            <AppSelect value={fps} onChange={(e) => setFps(Number(e.target.value))} className="h-9">
              <option value="30">30 FPS</option>
              <option value="60">60 FPS</option>
            </AppSelect>
          </div>
          <div>
            <AppFieldLabel>Bitrate (bps)</AppFieldLabel>
            <AppInput type="number" value={videoBitrate} onChange={(e) => setVideoBitrate(Number(e.target.value))} className="h-9" step={100000} />
          </div>
          <div>
            <AppFieldLabel>Mode</AppFieldLabel>
            <AppSelect value={videoBitrateMode} onChange={(e) => setVideoBitrateMode(e.target.value as 'constant' | 'variable')} className="h-9">
              <option value="variable">VBR</option>
              <option value="constant">CBR</option>
            </AppSelect>
          </div>
        </div>
      </div>
    </div>
  );

  const renderDspTab = () => (
    <div className="space-y-4">
      <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
        <AppSelect value={selectedLookPreset} onChange={(e) => setSelectedLookPreset(e.target.value as typeof selectedLookPreset)} className="h-9">
          <option value="retro-led">Retro LED</option>
          <option value="broadcast-vu">Broadcast VU</option>
          <option value="neon-spectrogram">Neon Spectrogram</option>
          <option value="club-radial">Club Radial</option>
          <option value="organic-ambient">Organic Ambient</option>
          <option value="social-hybrid">Social Hybrid</option>
        </AppSelect>
        <AppButton variant="primary" onClick={() => onApplyQt6LookPreset(selectedLookPreset)} size="sm">Apply Look</AppButton>
        <AppButton variant="secondary" onClick={onRandomizeQt6Look} size="sm">Randomize</AppButton>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="space-y-3">
          <div className="border border-[var(--app-panel-border)] rounded-xl p-3 space-y-3 bg-slate-950/20">
            <h4 className="text-[11px] uppercase tracking-wider font-semibold text-slate-300">Algorithm</h4>
            <AppSelect value={qt6Style} onChange={(e) => setQt6Style(e.target.value as Qt6Style)} className="h-9">
              <option value="wave">Oscilloscope (Wave)</option>
              <option value="bars">Stylish Bars</option>
              <option value="circle">Expanding Circle</option>
              <option value="circular-wave">Circular Wave</option>
              <option value="stereo-wave">Stereo Waveform</option>
              <option value="stereo-bars">Stereo EQ Bars</option>
              <option value="log-bars">Log Spectrum Bars</option>
              <option value="led-bars">LED Dot Matrix EQ</option>
              <option value="radial-spectrum">Radial Spectrum Bars</option>
              <option value="wave-spectrum">Waveform + Spectrum</option>
              <option value="vu-meter">Peak / VU Meter</option>
              <option value="spectrogram">Scrolling Spectrogram</option>
              <option value="particle-pulse">Particle Pulse</option>
              <option value="organic-blob">Organic Blob</option>
              <option value="multi-band-ring">Multi-band Ring</option>
            </AppSelect>
            {showsBarCountControl && (
              <div>
                <AppFieldLabel>Bar Count</AppFieldLabel>
                <AppSelect value={qt6BarCount} onChange={(e) => setQt6BarCount(Number(e.target.value))} className="h-9">
                  <option value="32">32 Bars (Chunky)</option>
                  <option value="64">64 Bars (Standard)</option>
                  <option value="128">128 Bars (Detailed)</option>
                </AppSelect>
              </div>
            )}
            <SliderRow label="Sensitivity (Gain)" value={qt6Sensitivity}>
              <input type="range" min="0.5" max="3.0" step="0.1" value={qt6Sensitivity} onChange={(e) => setQt6Sensitivity(parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[var(--app-accent)]" />
            </SliderRow>
            {showsLedSegmentsControl && (
              <SliderRow label="LED Segments" value={qt6LedSegments}>
                <input type="range" min="8" max="24" step="1" value={qt6LedSegments} onChange={(e) => setQt6LedSegments(Number(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[var(--app-accent)]" />
              </SliderRow>
            )}
            {showsSpectrogramSpeedControl && (
              <>
                <SliderRow label="Scroll Speed" value={qt6SpectrogramSpeed}>
                  <input type="range" min="1" max="4" step="1" value={qt6SpectrogramSpeed} onChange={(e) => setQt6SpectrogramSpeed(Number(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[var(--app-accent)]" />
                </SliderRow>
                <div>
                  <AppFieldLabel>Palette</AppFieldLabel>
                  <AppSelect value={qt6SpectrogramPalette} onChange={(e) => setQt6SpectrogramPalette(e.target.value as any)} className="h-9">
                    <option value="neon">Neon</option>
                    <option value="fire">Fire</option>
                    <option value="ice">Ice</option>
                    <option value="mono">Mono</option>
                  </AppSelect>
                </div>
              </>
            )}
            {showsParticleDensityControl && (
              <SliderRow label="Particle Density" value={qt6ParticleDensity}>
                <input type="range" min="0.5" max="3" step="0.1" value={qt6ParticleDensity} onChange={(e) => setQt6ParticleDensity(parseFloat(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[var(--app-accent)]" />
              </SliderRow>
            )}
            {showsRingCountControl && (
              <SliderRow label="Ring Count" value={qt6RingCount}>
                <input type="range" min="2" max="5" step="1" value={qt6RingCount} onChange={(e) => setQt6RingCount(Number(e.target.value))} className="w-full h-1.5 bg-slate-700 rounded-lg appearance-none cursor-pointer accent-[var(--app-accent)]" />
              </SliderRow>
            )}
          </div>
        </div>

        <div className="border border-[var(--app-panel-border)] rounded-xl p-3 space-y-3 bg-slate-950/20">
          <div className="flex items-center justify-between">
            <h4 className="text-[11px] uppercase tracking-wider font-semibold text-slate-300">
              Color Events
              <span className="ml-1.5 inline-flex items-center justify-center min-w-[1rem] h-4 px-1 text-[9px] font-semibold rounded bg-[var(--app-accent)]/15 text-[var(--app-accent)]">
                {colorEvents.length}
              </span>
            </h4>
          </div>
          <div className="flex justify-between items-center">
            <span className="text-xs text-slate-500">Current: {formatTime(currentTime)}</span>
            <button onClick={() => onAddColorEvent({ time: currentTime, activeColor, inactiveColor })} className="text-xs bg-[var(--app-accent)]/15 hover:bg-[var(--app-accent)]/25 text-[var(--app-accent)] border border-[var(--app-accent)]/30 px-3 py-1.5 rounded-lg transition-colors font-semibold">
              + Add at {formatTime(currentTime)}
            </button>
          </div>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {colorEvents.length === 0 && (
              <div className="text-center py-3 text-xs text-slate-600">No color changes. Default colors used throughout.</div>
            )}
            {[...colorEvents].sort((a, b) => a.time - b.time).map((event, idx) => (
              <div key={idx} className="bg-slate-950/60 rounded-lg p-2 flex items-center gap-3 border border-[var(--app-panel-border)]/50">
                <div className="w-16">
                  <label className="text-[9px] text-slate-500 block">Time</label>
                  <input type="number" step="0.1" value={event.time} onChange={(e) => onUpdateColorEvent(idx, { ...event, time: parseFloat(e.target.value) })} className="w-full bg-slate-900 border border-[var(--app-panel-border)] rounded px-1 py-0.5 text-xs text-slate-300" />
                </div>
                <div>
                  <label className="text-[9px] text-slate-500 block">Active</label>
                  <input type="color" value={event.activeColor} onChange={(e) => onUpdateColorEvent(idx, { ...event, activeColor: e.target.value })} aria-label="Event active color" className="w-6 h-6 rounded cursor-pointer bg-transparent border-none p-0" />
                </div>
                <div>
                  <label className="text-[9px] text-slate-500 block">Inactive</label>
                  <input type="color" value={event.inactiveColor} onChange={(e) => onUpdateColorEvent(idx, { ...event, inactiveColor: e.target.value })} aria-label="Event inactive color" className="w-6 h-6 rounded cursor-pointer bg-transparent border-none p-0" />
                </div>
                <button onClick={() => onRemoveColorEvent(idx)} className="ml-auto text-red-400 hover:text-red-300 p-1 hover:bg-red-900/20 rounded" title="Remove">
                  <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-4 h-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M14.74 9l-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 01-2.244 2.077H8.084a2.25 2.25 0 01-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 00-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 013.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 00-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 00-7.5 0" />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  if (activeTab === 'style') return renderStyleTab();
  if (activeTab === 'timeline') return renderTimelineTab();
  if (activeTab === 'dsp') return renderDspTab();
  return null;
};

export default VisualizerSettings;
