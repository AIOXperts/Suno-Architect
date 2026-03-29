
import React from 'react';
import { ASPECT_RATIOS } from '../../../constants';
import { Qt6Style } from '../../../types';
import { AppButton, AppCard, AppFieldLabel, AppSelect } from '../../ui/AppPrimitives';

interface MediaCardProps {
  showBackgroundLayer: boolean;
  setShowBackgroundLayer: (val: boolean) => void;
  mainVisualizerEnabled: boolean;
  setMainVisualizerEnabled: (val: boolean) => void;
  customBg: { url: string, type: 'image' | 'video', name: string } | null;
  setCustomBg: (bg: { url: string, type: 'image' | 'video', name: string } | null) => void;
  logoAsset: { url: string, name: string } | null;
  setLogoAsset: (logo: { url: string, name: string } | null) => void;
  hasDefaultLogo: boolean;
  customAudio: { url: string, name: string } | null;
  setCustomAudio: (audio: { url: string, name: string } | null) => void;
  imgSrc: string;
  qt6Style: Qt6Style;
  aspectRatio: keyof typeof ASPECT_RATIOS;
  setAspectRatio: (ratio: keyof typeof ASPECT_RATIOS) => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
  onFileUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onAudioUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onLogoUpload: (e: React.ChangeEvent<HTMLInputElement>) => void;
  onSetLogoAsDefault: () => void;
  onClearDefaultLogo: () => void;
  handleImageError: () => void;
}

const MediaCard: React.FC<MediaCardProps> = ({
  showBackgroundLayer, setShowBackgroundLayer,
  mainVisualizerEnabled, setMainVisualizerEnabled,
  customBg, setCustomBg,
  logoAsset, setLogoAsset,
  hasDefaultLogo,
  customAudio, setCustomAudio,
  imgSrc, qt6Style,
  aspectRatio, setAspectRatio,
  videoRef,
  onFileUpload, onAudioUpload, onLogoUpload,
  onSetLogoAsDefault, onClearDefaultLogo,
  handleImageError
}) => {
  return (
    <AppCard className="rounded-xl overflow-hidden shadow-lg p-4 space-y-4">
      {/* Cover Art / Visualizer Preview */}
      <div className="relative group rounded-lg overflow-hidden border border-[var(--app-panel-border)]/50">
          {showBackgroundLayer ? (
            <>
                <img 
                    id="source-img"
                    src={imgSrc} 
                    alt="Cover" 
                    crossOrigin="anonymous" 
                    onError={handleImageError}
                    className={`w-full h-32 object-cover ${customBg ? 'opacity-50' : 'opacity-100'}`}
                />
                {customBg && (
                    <div className="absolute inset-0 flex items-center justify-center">
                        {customBg.type === 'video' ? (
                            <div className="bg-black/70 p-2 rounded-full">
                                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-6 h-6 text-white">
                                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.75 5.25v13.5m-7.5-13.5v13.5m-3.75-13.5H9m3 0h3.75M9 18.75H5.25m8.25 0h3.75" />
                                </svg>
                            </div>
                        ) : (
                            <img src={customBg.url} className="w-full h-full object-cover" alt="custom" />
                        )}
                        <AppButton
                            variant="danger"
                            onClick={() => setCustomBg(null)}
                            className="absolute top-1 right-1 h-auto min-h-0 p-1 rounded-full shadow-lg bg-red-600 text-white border-red-500 hover:bg-red-500"
                            title="Remove Custom BG"
                        >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                                <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                            </svg>
                        </AppButton>
                    </div>
                )}
            </>
          ) : mainVisualizerEnabled ? (
            <div className="w-full h-32 bg-gradient-to-b from-slate-800 to-black flex flex-col items-center justify-center border-b border-[var(--app-panel-border)] gap-2">
                <span className="text-xs font-bold text-white uppercase tracking-wider">Qt6 Style: {qt6Style}</span>
                <div className="flex gap-2">
                    <div className={`w-2 h-6 rounded-full ${qt6Style === 'wave' ? 'bg-[var(--app-accent)]' : 'bg-slate-700'}`}></div>
                    <div className={`w-2 h-6 rounded-full ${qt6Style === 'bars' ? 'bg-[var(--app-accent)]' : 'bg-slate-700'}`}></div>
                    <div className={`w-2 h-6 rounded-full ${qt6Style === 'circle' ? 'bg-[var(--app-accent)]' : 'bg-slate-700'}`}></div>
                    <div className={`w-2 h-6 rounded-full ${qt6Style === 'circular-wave' ? 'bg-[var(--app-accent)]' : 'bg-slate-700'}`}></div>
                </div>
            </div>
          ) : (
            <div className="w-full h-32 bg-black/70 flex items-center justify-center border-b border-[var(--app-panel-border)]">
              <span className="text-xs text-slate-400">No Background / No Main Visualizer</span>
            </div>
          )}
          
          {/* Hidden Custom Media Elements */}
          {customBg?.type === 'image' && (
              <img 
                id="custom-bg-img"
                src={customBg.url}
                className="hidden"
                crossOrigin="anonymous"
                alt="custom-bg"
              />
          )}
          <video 
              ref={videoRef}
              src={customBg?.type === 'video' ? customBg.url : ''}
              className="hidden"
              crossOrigin="anonymous"
              muted
              playsInline
              loop
          />
      </div>

      {/* Settings */}
      <div className="space-y-3">
              {/* Aspect Ratio Selector */}
              <div>
                  <AppFieldLabel>Aspect Ratio</AppFieldLabel>
                  <AppSelect
                    value={aspectRatio}
                    onChange={(e) => setAspectRatio(e.target.value as keyof typeof ASPECT_RATIOS)}
                    className="p-2 text-xs"
                  >
                      {Object.entries(ASPECT_RATIOS).map(([key, val]) => (
                          <option key={key} value={key}>{val.label} ({val.width}x{val.height})</option>
                      ))}
                  </AppSelect>
              </div>

              {/* Layer Toggles */}
              <div>
                  <AppFieldLabel>Layers</AppFieldLabel>
                  <div className="grid grid-cols-2 gap-2">
                      <AppButton
                        onClick={() => setShowBackgroundLayer(!showBackgroundLayer)}
                        className={`text-[10px] py-2 ${showBackgroundLayer ? 'bg-slate-700 border-slate-600 text-white' : 'bg-slate-900 border-[var(--app-panel-border)] text-slate-400'}`}
                      >
                        Background Media
                      </AppButton>
                      <AppButton
                        variant={mainVisualizerEnabled ? 'primary' : 'secondary'}
                        onClick={() => setMainVisualizerEnabled(!mainVisualizerEnabled)}
                        className={`text-[10px] py-2 ${mainVisualizerEnabled ? 'bg-[var(--app-accent)] border-purple-500 text-white' : 'bg-slate-900 border-[var(--app-panel-border)] text-slate-400'}`}
                      >
                        Main Visualizer
                      </AppButton>
                  </div>
              </div>

              {/* Background File Upload */}
              {showBackgroundLayer && (
                  <div className="space-y-2">
                      <AppFieldLabel>Custom Media</AppFieldLabel>
                      <label className="flex flex-col items-center justify-center w-full min-h-[64px] border-2 border-dashed border-slate-700 rounded-xl cursor-pointer hover:border-cyan-500/50 hover:bg-cyan-500/5 transition-all group bg-slate-900/50">
                          <input 
                            type="file" 
                            accept="image/png, image/jpeg, image/webp, video/mp4, video/webm" 
                            className="hidden" 
                            onChange={onFileUpload}
                          />
                          <div className="flex flex-col items-center gap-1 text-slate-500 group-hover:text-cyan-400">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 opacity-70">
                                  <path fillRule="evenodd" d="M3 17a1 1 0 011-1h12a1 1 0 110 2H4a1 1 0 01-1-1zM6.293 6.707a1 1 0 010-1.414l3-3a1 1 0 011.414 0l3 3a1 1 0 01-1.414 1.414L11 5.414V13a1 1 0 11-2 0V5.414L7.707 6.707a1 1 0 01-1.414 0z" clipRule="evenodd" />
                              </svg>
                              <span className="text-[10px] font-bold uppercase tracking-widest">Upload Loop / Image</span>
                          </div>
                      </label>
                  </div>
              )}

              <div className="space-y-2">
                  <AppFieldLabel>Watermark / Logo</AppFieldLabel>
                  {logoAsset ? (
                    <div className="space-y-2">
                        <div className="flex items-center justify-between bg-cyan-950/20 border border-cyan-500/30 rounded-lg p-2 group">
                            <div className="flex items-center gap-2 overflow-hidden">
                                <div className="w-6 h-6 rounded bg-black/40 border border-cyan-900 flex-shrink-0 overflow-hidden">
                                    <img src={logoAsset.url} className="w-full h-full object-contain" alt="" />
                                </div>
                                <span className="text-[10px] font-mono text-cyan-200 truncate pr-3 uppercase tracking-tighter" title={logoAsset.name}>{logoAsset.name}</span>
                            </div>
                            <AppButton 
                              tone="console" 
                              variant="console-secondary" 
                              size="xs" 
                              icon="icon-circle"
                              onClick={() => setLogoAsset(null)} 
                              className="opacity-0 group-hover:opacity-100 transition-opacity"
                            >
                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                                    <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                                </svg>
                            </AppButton>
                        </div>
                        <div className="grid grid-cols-2 gap-2">
                            <AppButton tone="console" variant="console-primary" size="xs" onClick={onSetLogoAsDefault} data-testid="save-default-logo">
                                Save Local
                            </AppButton>
                            <AppButton tone="console" variant="console-danger" size="xs" onClick={onClearDefaultLogo} disabled={!hasDefaultLogo} data-testid="clear-default-logo">
                                Clear Local
                            </AppButton>
                        </div>
                    </div>
                  ) : (
                    <div className="space-y-2">
                      <label className="flex flex-col items-center justify-center w-full min-h-[56px] border border-dashed border-slate-700 rounded-lg cursor-pointer hover:border-cyan-500/40 hover:bg-cyan-500/5 transition-all group bg-slate-900/30">
                          <input
                              type="file"
                              accept="image/png, image/jpeg, image/webp"
                              className="hidden"
                              onChange={onLogoUpload}
                          />
                          <span className="text-[10px] font-bold uppercase tracking-widest text-slate-500 group-hover:text-cyan-400">Add Watermark (PNG)</span>
                      </label>
                      {hasDefaultLogo && (
                        <p className="text-[10px] font-mono text-cyan-800 uppercase tracking-tighter text-center">
                          ● Persistence Active: My Logo Loaded
                        </p>
                      )}
                    </div>
                  )}
                  {logoAsset && <img id="custom-logo-img" src={logoAsset.url} alt="logo-watermark" className="hidden" crossOrigin="anonymous" />}
              </div>

              {/* Audio File Upload */}
              <div className="space-y-2">
                  <AppFieldLabel>Audio Source Override</AppFieldLabel>
                  {customAudio ? (
                      <div className="flex items-center justify-between bg-emerald-950/20 border border-emerald-500/30 rounded-lg p-2 group">
                          <div className="flex items-center gap-2 overflow-hidden">
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-4 h-4 text-emerald-400 flex-shrink-0">
                                  <path fillRule="evenodd" d="M9.383 3.076A1 1 0 0110 4v12a1 1 0 01-1.707.707L4.586 13H2a1 1 0 01-1-1V8a1 1 0 011-1h2.586l3.707-3.707a1 1 0 011.09-.217zM14.657 2.929a1 1 0 011.414 0A9.972 9.972 0 0119 10a9.972 9.972 0 01-2.929 7.071 1 1 0 01-1.414-1.414A7.971 7.971 0 0017 10c0-2.21-.894-4.208-2.343-5.657a1 1 0 010-1.414zm-2.829 2.828a1 1 0 011.415 0A5.983 5.983 0 0115 10a5.984 5.984 0 01-1.757 4.243 1 1 0 01-1.415-1.415A3.984 3.984 0 0013 10a3.983 3.983 0 00-1.172-2.828 1 1 0 010-1.415z" clipRule="evenodd" />
                              </svg>
                              <span className="text-[10px] font-mono text-emerald-300 truncate pr-3 uppercase" title={customAudio.name}>{customAudio.name}</span>
                          </div>
                          <AppButton 
                            tone="console" 
                            variant="console-secondary" 
                            size="xs" 
                            icon="icon-circle"
                            onClick={() => setCustomAudio(null)} 
                            className="opacity-0 group-hover:opacity-100 transition-opacity"
                          >
                              <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-3 h-3">
                                  <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
                              </svg>
                          </AppButton>
                      </div>
                  ) : (
                    <label className="flex flex-col items-center justify-center w-full min-h-[56px] border border-dashed border-slate-700 rounded-lg cursor-pointer hover:border-emerald-500/40 hover:bg-emerald-500/5 transition-all group bg-slate-900/30">
                        <input 
                            type="file" 
                            accept="audio/*" 
                            className="hidden" 
                            onChange={onAudioUpload}
                        />
                        <div className="flex flex-col items-center gap-0.5 text-slate-500 group-hover:text-emerald-400">
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 20 20" fill="currentColor" className="w-5 h-5 opacity-70">
                                <path d="M7 4a3 3 0 016 0v6a3 3 0 11-6 0V4z" />
                                <path d="M5.5 9.643a.75.75 0 00-1.5 0V10c0 3.06 2.29 5.585 5.25 5.954V17.5h-1.5a.75.75 0 000 1.5h4.5a.75.75 0 000-1.5h-1.5v-1.546A6.001 6.001 0 0016 10v-.357a.75.75 0 00-1.5 0V10a4.5 4.5 0 01-9 0v-.357z" />
                            </svg>
                            <span className="text-[10px] font-bold uppercase tracking-widest">Load Mastering Export (WAV)</span>
                        </div>
                    </label>
                  )}
              </div>
      </div>
    </AppCard>
  );
};

export default MediaCard;
