
import React from 'react';
import { AIProviderConfig, SunoClip } from '../../types';
import VisualizerHeader from './VisualizerHeader';
import VisualizerSettings from './VisualizerSettings';
import { formatTime } from '../../utils/visualizer';
import { useVisualizer } from './hooks/useVisualizer';
import { AppButton, AppCard, AppInput, AppSelect, AppTextarea, StatusMessage } from '../ui/AppPrimitives';
import { LibrarySelection } from '../LibraryPickerModal';

// Subcomponents
import MetadataCard from './subcomponents/MetadataCard';
import MediaCard from './subcomponents/MediaCard';
import AiControlsCard from './subcomponents/AiControlsCard';
import ActionButtons from './subcomponents/ActionButtons';
import CanvasPreview from './subcomponents/CanvasPreview';
import PlaybackControls from './subcomponents/PlaybackControls';
import ColorEventsManager from './subcomponents/ColorEventsManager';

interface VisualizerSectionProps {
  history: SunoClip[];
  sunoCookie?: string;
  onUpdateClip: (id: string, updates: Partial<SunoClip>) => void;
  apiKey?: string;
  geminiModel?: string;
  providerConfig?: AIProviderConfig;
}

const VisualizerSection: React.FC<VisualizerSectionProps> = ({ history, sunoCookie, onUpdateClip, apiKey, geminiModel, providerConfig }) => {
  const { state, setters, refs, handlers } = useVisualizer(history, sunoCookie, onUpdateClip, apiKey, geminiModel, providerConfig);
  const [publishTarget, setPublishTarget] = React.useState<'youtube' | 'facebook' | 'both'>('youtube');
  const [fbAspect, setFbAspect] = React.useState<'landscape' | 'portrait'>('landscape');
  const [publishTitle, setPublishTitle] = React.useState('');
  const [publishDescription, setPublishDescription] = React.useState('');
  const [publishState, setPublishState] = React.useState<'idle' | 'publishing' | 'done' | 'error'>('idle');
  const [publishMessage, setPublishMessage] = React.useState('');

  React.useEffect(() => {
    if (!state.clipData) return;
    setPublishTitle(state.clipData.title || 'Untitled');
    if (!publishDescription.trim()) {
      setPublishDescription((state.clipData.metadata?.prompt || '').slice(0, 1000));
    }
  }, [state.clipData]);

  const effectiveAspect: 'landscape' | 'portrait' =
    publishTarget === 'youtube' ? 'landscape' : publishTarget === 'facebook' ? fbAspect : fbAspect;

  const handleSelectFromLibrary = React.useCallback((selection: LibrarySelection) => {
    const clipId = selection.track.sunoId || selection.track.id;
    if (clipId) {
      setters.setSelectedClipId(clipId);
      setters.setManualId(clipId);
    }
  }, [setters]);

  const handlePublish = async () => {
    if (!state.clipData) return;
    setPublishState('publishing');
    setPublishMessage('Publishing pipeline started...');
    try {
      const basePayload = {
        clipId: state.clipData.id,
        title: publishTitle.trim() || state.clipData.title || 'Untitled',
        description: publishDescription.trim(),
        aspect: effectiveAspect,
        dryRun: true,
      };

      if (publishTarget === 'youtube') {
        const ytRes = await fetch('/api/publish/youtube', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...basePayload, aspect: 'landscape' }),
        });
        const ytJson = await ytRes.json();
        if (!ytRes.ok) throw new Error(ytJson?.error || 'YouTube publish failed.');
        setPublishState('done');
        setPublishMessage(`YouTube publish queued (${ytJson?.jobId || 'stub'}).`);
        return;
      }

      if (publishTarget === 'facebook') {
        const fbRes = await fetch('/api/publish/facebook', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ ...basePayload, aspect: fbAspect }),
        });
        const fbJson = await fbRes.json();
        if (!fbRes.ok) throw new Error(fbJson?.error || 'Facebook publish failed.');
        setPublishState('done');
        setPublishMessage(`Facebook publish queued (${fbJson?.jobId || 'stub'}).`);
        return;
      }

      const fbRes = await fetch('/api/publish/facebook', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ ...basePayload, aspect: fbAspect }),
      });
      const fbJson = await fbRes.json();
      if (!fbRes.ok) throw new Error(fbJson?.error || 'Facebook publish failed.');

      const fbUrl = fbJson?.publishedUrl || fbJson?.stub?.publishedUrl || '';
      const ytDescription = fbUrl
        ? `${publishDescription.trim()}\n\nFacebook Post: ${fbUrl}`
        : publishDescription.trim();

      const ytRes = await fetch('/api/publish/youtube', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          ...basePayload,
          aspect: 'landscape',
          description: ytDescription,
          crossPost: { facebookUrl: fbUrl || null },
        }),
      });
      const ytJson = await ytRes.json();
      if (!ytRes.ok) throw new Error(ytJson?.error || 'YouTube publish failed.');

      setPublishState('done');
      setPublishMessage(`Cross-publish complete. FB (${fbJson?.jobId || 'stub'}) -> YT (${ytJson?.jobId || 'stub'}).`);
    } catch (error: any) {
      console.error('Publish workflow failed', error);
      setPublishState('error');
      setPublishMessage(error?.message || 'Publish workflow failed.');
    }
  };

  return (
    <div className="animate-in fade-in duration-500 max-w-7xl mx-auto space-y-8">
        
        <VisualizerHeader 
            history={history}
            selectedClipId={state.selectedClipId}
            setSelectedClipId={setters.setSelectedClipId}
            manualId={state.manualId}
            setManualId={setters.setManualId}
            onManualLoad={handlers.handleManualLoad}
            onSelectFromLibrary={handleSelectFromLibrary}
        />

        {/* Main Content */}
        {state.selectedClipId && state.clipData && (
             <>
             <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
                 {/* Left: Controls & Info */}
                 <div className="lg:col-span-1 space-y-6">
                     <AppCard className="p-3">
                        <p className="text-xs uppercase tracking-wider text-slate-400 font-semibold">Workflow</p>
                        <p className="text-xs text-slate-300 mt-1">1) Load clip 2) Tune lyrics/media 3) Preview timeline with pre/post cards 4) Render export.</p>
                     </AppCard>

                     {state.renderError && (
                        <div className="bg-red-500/10 border border-red-500/40 rounded-xl p-3 text-xs text-red-200">
                            <div className="font-bold mb-1">Last Render Error</div>
                            <div className="font-mono break-words">{state.renderError}</div>
                        </div>
                     )}

                     <MetadataCard 
                        lyricSource={state.lyricSource}
                        setLyricSource={setters.setLyricSource}
                        lrcDraft={state.lrcDraft}
                        setLrcDraft={setters.setLrcDraft}
                        onApplyLyrics={handlers.handleApplyLyrics}
                        onApplyLrc={handlers.handleApplyLrc}
                        onGenerateLrcFromCurrentLines={handlers.handleGenerateLrcFromCurrentLines}
                        applyStatus={state.applyStatus}
                        lrcApplyStatus={state.lrcApplyStatus}
                        hasAlignment={!!state.alignment}
                        longLineIssues={state.longLineIssues}
                        longLrcGapIssues={state.longLrcGapIssues}
                        lrcInvalidLineNumbers={state.lrcInvalidLineNumbers}
                        lrcParsedLineCount={state.lrcParsedLineCount}
                     />

                     <MediaCard 
                        showBackgroundLayer={state.showBackgroundLayer} setShowBackgroundLayer={setters.setShowBackgroundLayer}
                        mainVisualizerEnabled={state.mainVisualizerEnabled} setMainVisualizerEnabled={setters.setMainVisualizerEnabled}
                        customBg={state.customBg} setCustomBg={setters.setCustomBg}
                        logoAsset={state.logoAsset} setLogoAsset={setters.setLogoAsset}
                        hasDefaultLogo={state.hasDefaultLogo}
                        customAudio={state.customAudio} setCustomAudio={setters.setCustomAudio}
                        imgSrc={state.imgSrc}
                        qt6Style={state.qt6Style}
                        aspectRatio={state.aspectRatio} setAspectRatio={setters.setAspectRatio}
                        videoRef={refs.customVideoRef}
                        onFileUpload={handlers.handleFileUpload}
                        onAudioUpload={handlers.handleAudioUpload}
                        onLogoUpload={handlers.handleLogoUpload}
                        onSetLogoAsDefault={handlers.handleSetLogoAsDefault}
                        onClearDefaultLogo={handlers.handleClearDefaultLogo}
                        handleImageError={handlers.handleImageError}
                     />
                     
                     <AiControlsCard 
                        alignment={state.alignment}
                        sunoCookie={sunoCookie}
                        isGrouping={state.isGrouping}
                        isRendering={state.isRendering}
                        onSmartGroup={handlers.handleSmartGroup}
                     />

                     {/* Audio Player (Hidden visually but used for logic) */}
                     <div className="bg-slate-900 p-4 rounded-xl border border-[var(--app-panel-border)] hidden">
                         <audio 
                            ref={refs.audioRef} 
                            controls 
                            src={state.customAudio ? state.customAudio.url : `https://cdn1.suno.ai/${state.selectedClipId}.mp3`}
                            crossOrigin="anonymous" // CRITICAL FOR RECORDING
                            className="w-full h-8"
                            onLoadedMetadata={(e) => handlers.setDuration(e.currentTarget.duration)}
                            onPlay={() => setters.setIsPlaying(true)} 
                            onPause={() => setters.setIsPlaying(false)} 
                         />
                     </div>

                     <ActionButtons 
                        audioBitrate={state.audioBitrate}
                        setAudioBitrate={setters.setAudioBitrate}
                        fps={state.fps}
                        setFps={setters.setFps}
                        isRendering={state.isRendering}
                        renderProgress={state.renderProgress}
                        renderSpeed={state.renderSpeed}
                        onStartRender={handlers.startOfflineRender}
                        isPreparing={state.isPreparing}
                        hasAlignment={!!state.alignment}
                     />

                      <details className="group">
                        <summary className="cursor-pointer list-none">
                          <AppCard className="p-3 flex items-center justify-between">
                            <p className="text-sm font-semibold text-white">Publishing Workflow</p>
                            <span className="text-xs text-slate-400 group-open:hidden">Expand</span>
                            <span className="text-xs text-slate-400 hidden group-open:inline">Collapse</span>
                          </AppCard>
                        </summary>
                        <AppCard className="space-y-3 mt-2">
                          <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                            <AppSelect
                              value={publishTarget}
                              onChange={(e) => setPublishTarget(e.target.value as 'youtube' | 'facebook' | 'both')}
                              className="h-10"
                            >
                              <option value="youtube">Publish: YouTube (16:9)</option>
                              <option value="facebook">Publish: Facebook (16:9 / 9:16)</option>
                              <option value="both">Publish: Both (FB then YT)</option>
                            </AppSelect>

                            {(publishTarget === 'facebook' || publishTarget === 'both') && (
                              <AppSelect
                                value={fbAspect}
                                onChange={(e) => setFbAspect(e.target.value as 'landscape' | 'portrait')}
                                className="h-10"
                              >
                                <option value="landscape">Facebook Aspect: 16:9 Landscape</option>
                                <option value="portrait">Facebook Aspect: 9:16 Portrait</option>
                              </AppSelect>
                            )}
                          </div>

                          <AppInput
                            value={publishTitle}
                            onChange={(e) => setPublishTitle(e.target.value)}
                            placeholder="Publish title"
                          />
                          <AppTextarea
                            value={publishDescription}
                            onChange={(e) => setPublishDescription(e.target.value)}
                            placeholder="Publish description"
                            className="h-24 resize-y"
                          />

                          <AppButton
                            variant="primary"
                            onClick={handlePublish}
                            disabled={!state.clipData || publishState === 'publishing'}
                            className="w-full"
                          >
                            {publishState === 'publishing' ? 'Publishing...' : 'Run Publish Workflow'}
                          </AppButton>

                          <StatusMessage state={publishState} message={publishMessage} />
                        </AppCard>
                      </details>
                 </div>

                 {/* Right: Canvas Preview */}
                 <div className="lg:col-span-2 space-y-4">
                     <CanvasPreview 
                        canvasRef={refs.canvasRef}
                        aspectRatio={state.aspectRatio}
                        isPreparing={state.isPreparing}
                     />
                     
                     <VisualizerSettings 
                        savedPresets={state.savedPresets}
                        onSavePreset={handlers.saveCurrentPreset}
                        onApplySavedPreset={handlers.applySavedPreset}
                        onDeleteSavedPreset={handlers.deleteSavedPreset}
                        templatePreset={state.templatePreset}
                        onTemplateChange={handlers.applyTemplatePreset}
                        fontFamily={state.fontFamily} setFontFamily={setters.setFontFamily}
                        activeColor={state.activeColor} setActiveColor={setters.setActiveColor}
                        inactiveColor={state.inactiveColor} setInactiveColor={setters.setInactiveColor}
                        smoothingFactor={state.smoothingFactor} setSmoothingFactor={setters.setSmoothingFactor}
                        verticalOffset={state.verticalOffset} setVerticalOffset={setters.setVerticalOffset}
                        inactiveOpacity={state.inactiveOpacity} setInactiveOpacity={setters.setInactiveOpacity}
                        mainVisualizerEnabled={state.mainVisualizerEnabled}
                        showTitle={state.showTitle} setShowTitle={setters.setShowTitle}
                        logoPosition={state.logoPosition} setLogoPosition={setters.setLogoPosition}
                        logoScale={state.logoScale} setLogoScale={setters.setLogoScale}
                        logoOpacity={state.logoOpacity} setLogoOpacity={setters.setLogoOpacity}
                        logoPulseEnabled={state.logoPulseEnabled} setLogoPulseEnabled={setters.setLogoPulseEnabled}
                        logoPulseStyle={state.logoPulseStyle} setLogoPulseStyle={setters.setLogoPulseStyle}
                        logoPulseGap={state.logoPulseGap} setLogoPulseGap={setters.setLogoPulseGap}
                        logoPulseScale={state.logoPulseScale} setLogoPulseScale={setters.setLogoPulseScale}
                        logoPulseSensitivity={state.logoPulseSensitivity} setLogoPulseSensitivity={setters.setLogoPulseSensitivity}
                        qt6Style={state.qt6Style} setQt6Style={setters.setQt6Style}
                        qt6BarCount={state.qt6BarCount} setQt6BarCount={setters.setQt6BarCount}
                        qt6Sensitivity={state.qt6Sensitivity} setQt6Sensitivity={setters.setQt6Sensitivity}
                        qt6SpectrogramSpeed={state.qt6SpectrogramSpeed} setQt6SpectrogramSpeed={setters.setQt6SpectrogramSpeed}
                        qt6ParticleDensity={state.qt6ParticleDensity} setQt6ParticleDensity={setters.setQt6ParticleDensity}
                        qt6RingCount={state.qt6RingCount} setQt6RingCount={setters.setQt6RingCount}
                        qt6LedSegments={state.qt6LedSegments} setQt6LedSegments={setters.setQt6LedSegments}
                        qt6SpectrogramPalette={state.qt6SpectrogramPalette} setQt6SpectrogramPalette={setters.setQt6SpectrogramPalette}
                        onApplyQt6LookPreset={handlers.applyQt6LookPreset}
                        onRandomizeQt6Look={handlers.randomizeQt6Look}
                        videoBitrate={state.videoBitrate} setVideoBitrate={setters.setVideoBitrate}
                        videoBitrateMode={state.videoBitrateMode} setVideoBitrateMode={setters.setVideoBitrateMode}
                        fps={state.fps} setFps={setters.setFps}
                        outputAspectTarget={state.outputAspectTarget} setOutputAspectTarget={setters.setOutputAspectTarget}
                        preRollEnabled={state.preRollEnabled} setPreRollEnabled={setters.setPreRollEnabled}
                        preRollType={state.preRollType} setPreRollType={setters.setPreRollType}
                        preRollText={state.preRollText} setPreRollText={setters.setPreRollText}
                        preRollSeconds={state.preRollSeconds} setPreRollSeconds={setters.setPreRollSeconds}
                        preRollPreviewEnabled={state.preRollPreviewEnabled} setPreRollPreviewEnabled={setters.setPreRollPreviewEnabled}
                        preRollPreviewStartSeconds={state.preRollPreviewStartSeconds} setPreRollPreviewStartSeconds={setters.setPreRollPreviewStartSeconds}
                        preRollPreviewDurationSeconds={state.preRollPreviewDurationSeconds} setPreRollPreviewDurationSeconds={setters.setPreRollPreviewDurationSeconds}
                        preRollPreviewShowTitle={state.preRollPreviewShowTitle} setPreRollPreviewShowTitle={setters.setPreRollPreviewShowTitle}
                        preRollCardShowTitle={state.preRollCardShowTitle} setPreRollCardShowTitle={setters.setPreRollCardShowTitle}
                        preRollCardTitleText={state.preRollCardTitleText} setPreRollCardTitleText={setters.setPreRollCardTitleText}
                        preRollCardTheme={state.preRollCardTheme} setPreRollCardTheme={setters.setPreRollCardTheme}
                        postRollEnabled={state.postRollEnabled} setPostRollEnabled={setters.setPostRollEnabled}
                        postRollType={state.postRollType} setPostRollType={setters.setPostRollType}
                        postRollText={state.postRollText} setPostRollText={setters.setPostRollText}
                        postRollSeconds={state.postRollSeconds} setPostRollSeconds={setters.setPostRollSeconds}
                        onReset={() => {
                            handlers.applyTemplatePreset('classic');
                            setters.setActiveColor('#e879f9');
                            setters.setInactiveColor('#ffffff');
                            setters.setInactiveOpacity(0.3);
                            setters.setFontFamily('Inter, sans-serif');
                            setters.setSmoothingFactor(0.1);
                            setters.setVerticalOffset(0);
                            setters.setShowBackgroundLayer(true);
                            setters.setMainVisualizerEnabled(false);
                            setters.setQt6Style('wave');
                            setters.setQt6BarCount(64);
                            setters.setQt6Sensitivity(1.0);
                            setters.setQt6SpectrogramSpeed(1);
                            setters.setQt6ParticleDensity(1);
                            setters.setQt6RingCount(3);
                            setters.setQt6LedSegments(14);
                            setters.setQt6SpectrogramPalette('neon');
                            setters.setVideoBitrate(5000000);
                            setters.setVideoBitrateMode('variable');
                            setters.setFps(30);
                            setters.setOutputAspectTarget('landscape');
                            setters.setPreRollEnabled(false);
                            setters.setPreRollType('text');
                            setters.setPreRollText('Thank you for supporting my work');
                            setters.setPreRollSeconds(4);
                            setters.setPreRollPreviewEnabled(false);
                            setters.setPreRollPreviewStartSeconds(20);
                            setters.setPreRollPreviewDurationSeconds(7);
                            setters.setPreRollPreviewShowTitle(true);
                            setters.setPreRollCardShowTitle(true);
                            setters.setPreRollCardTitleText('');
                            setters.setPreRollCardTheme('clean');
                            setters.setPostRollEnabled(false);
                            setters.setPostRollType('text');
                            setters.setPostRollText('Tripped Out Tim');
                            setters.setPostRollSeconds(4);
                            setters.setShowTitle(true);
                            setters.setLogoPosition('bottom-right');
                            setters.setLogoScale(0.14);
                            setters.setLogoOpacity(0.9);
                            setters.setLogoPulseEnabled(false);
                            setters.setLogoPulseStyle('expanding-circle');
                            setters.setLogoPulseGap(0);
                            setters.setLogoPulseScale(1.35);
                            setters.setLogoPulseSensitivity(1.3);
                        }}
                     />

                     <ColorEventsManager 
                        colorEvents={state.colorEvents}
                        onAddEvent={setters.addColorEvent}
                        onRemoveEvent={setters.removeColorEvent}
                        onUpdateEvent={setters.updateColorEvent}
                        currentTime={state.progress}
                        activeColor={state.activeColor}
                        inactiveColor={state.inactiveColor}
                     />

                     <PlaybackControls 
                        progress={state.progress}
                        duration={state.duration}
                        isPlaying={state.isPlaying}
                        onSeek={handlers.handleSeek}
                        onTogglePlay={handlers.togglePlay}
                        aspectRatio={state.aspectRatio}
                        isRendering={state.isRendering}
                        formatTime={formatTime}
                     />
                 </div>
             </div>

             <details className="group">
                <summary className="cursor-pointer list-none">
                  <AppCard className="p-3 flex items-center justify-between">
                    <p className="text-sm font-semibold text-white">Advanced: Word Alignment Editor</p>
                    <span className="text-xs text-slate-400 group-open:hidden">Expand</span>
                    <span className="text-xs text-slate-400 hidden group-open:inline">Collapse</span>
                  </AppCard>
                </summary>
                <div className="mt-2">
                  <WordAlignmentEditorCard
                    alignment={state.alignment}
                    currentTime={state.progress}
                    onApplyAlignment={handlers.handleReplaceAlignment}
                  />
                </div>
             </details>
             </>
        )}
        
        {!state.selectedClipId && (
            <div className="flex flex-col items-center justify-center py-20 border-2 border-dashed border-[var(--app-panel-border)] rounded-2xl bg-[var(--app-panel)] text-slate-600">
                <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-16 h-16 opacity-20 mb-4">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
                </svg>
                <p>Select a song from history or enter an ID to start.</p>
            </div>
        )}
    </div>
  );
};

export default VisualizerSection;
