
import React from 'react';
import { AIProviderConfig, SunoClip } from '../../types';
import { formatTime } from '../../utils/visualizer';
import { useVisualizer } from './hooks/useVisualizer';
import { AppButton, AppInput, AppSelect, AppTextarea, StatusMessage } from '../ui/AppPrimitives';
import { LibrarySelection } from '../LibraryPickerModal';

import CanvasPreview from './subcomponents/CanvasPreview';
import VisualizerSettings from './VisualizerSettings';

import MetadataCard from './subcomponents/MetadataCard';
import MediaCard from './subcomponents/MediaCard';
import AiControlsCard from './subcomponents/AiControlsCard';
import ActionButtons from './subcomponents/ActionButtons';
import WordAlignmentEditorCard from './subcomponents/WordAlignmentEditorCard';
import LibraryPickerModal from '../LibraryPickerModal';

type TabKey = 'lyrics' | 'style' | 'media' | 'timeline' | 'dsp' | 'export';

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
  const [activeTab, setActiveTab] = React.useState<TabKey>('lyrics');
  const [showLibraryPicker, setShowLibraryPicker] = React.useState(false);
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
        const ytRes = await fetch('/api/publish/youtube', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...basePayload, aspect: 'landscape' }) });
        const ytJson = await ytRes.json();
        if (!ytRes.ok) throw new Error(ytJson?.error || 'YouTube publish failed.');
        setPublishState('done');
        setPublishMessage(`Simulated: YouTube publish queued (stub).`);
        return;
      }

      if (publishTarget === 'facebook') {
        const fbRes = await fetch('/api/publish/facebook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...basePayload, aspect: fbAspect }) });
        const fbJson = await fbRes.json();
        if (!fbRes.ok) throw new Error(fbJson?.error || 'Facebook publish failed.');
        setPublishState('done');
        setPublishMessage(`Simulated: Facebook publish queued (stub).`);
        return;
      }

      const fbRes = await fetch('/api/publish/facebook', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...basePayload, aspect: fbAspect }) });
      const fbJson = await fbRes.json();
      if (!fbRes.ok) throw new Error(fbJson?.error || 'Facebook publish failed.');
      const fbUrl = fbJson?.publishedUrl || fbJson?.stub?.publishedUrl || '';
      const ytDescription = fbUrl ? `${publishDescription.trim()}\n\nFacebook Post: ${fbUrl}` : publishDescription.trim();
      const ytRes = await fetch('/api/publish/youtube', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ...basePayload, aspect: 'landscape', description: ytDescription, crossPost: { facebookUrl: fbUrl || null } }) });
      const ytJson = await ytRes.json();
      if (!ytRes.ok) throw new Error(ytJson?.error || 'YouTube publish failed.');
      setPublishState('done');
      setPublishMessage(`Simulated: Cross-publish complete. FB -> YT (stub).`);
    } catch (error: any) {
      console.error('Publish workflow failed', error);
      setPublishState('error');
      setPublishMessage(error?.message || 'Publish workflow failed.');
    }
  };

  const tabs: { key: TabKey; label: string; badge?: string }[] = [
    { key: 'lyrics', label: 'Lyrics' },
    { key: 'style', label: 'Style & Branding' },
    { key: 'media', label: 'Media & Assets' },
    { key: 'timeline', label: 'Timeline', badge: state.preRollEnabled || state.postRollEnabled ? '●' : undefined },
    { key: 'dsp', label: 'DSP Engine', badge: state.mainVisualizerEnabled ? 'ON' : undefined },
    { key: 'export', label: 'Export' },
  ];

  const renderTabPanel = () => {
    switch (activeTab) {
      case 'lyrics':
        return (
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
            <div className="space-y-3">
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
            </div>
            <div className="space-y-3">
              <AiControlsCard
                alignment={state.alignment}
                sunoCookie={sunoCookie}
                isGrouping={state.isGrouping}
                isRendering={state.isRendering}
                onSmartGroup={handlers.handleSmartGroup}
              />
              <details className="group">
                <summary className="cursor-pointer list-none">
                  <div className="flex items-center justify-between p-3 rounded-xl border border-[var(--app-panel-border)] bg-[var(--app-panel)] backdrop-blur-sm">
                    <span className="text-xs font-semibold text-white">Advanced: Word Alignment Editor</span>
                    <span className="text-xs text-slate-500 group-open:hidden">Expand</span>
                    <span className="text-xs text-slate-500 hidden group-open:inline">Collapse</span>
                  </div>
                </summary>
                <div className="mt-2">
                  <WordAlignmentEditorCard
                    alignment={state.alignment}
                    currentTime={state.progress}
                    onApplyAlignment={handlers.handleReplaceAlignment}
                  />
                </div>
              </details>
            </div>
          </div>
        );

      case 'style':
        return (
          <VisualizerSettings
            activeTab="style"
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
            preRollShowHeading={state.preRollShowHeading} setPreRollShowHeading={setters.setPreRollShowHeading}
            preRollHeadingText={state.preRollHeadingText} setPreRollHeadingText={setters.setPreRollHeadingText}
            preRollCardShowTitle={state.preRollCardShowTitle} setPreRollCardShowTitle={setters.setPreRollCardShowTitle}
            preRollCardTitleText={state.preRollCardTitleText} setPreRollCardTitleText={setters.setPreRollCardTitleText}
            preRollCardTheme={state.preRollCardTheme} setPreRollCardTheme={setters.setPreRollCardTheme}
            postRollEnabled={state.postRollEnabled} setPostRollEnabled={setters.setPostRollEnabled}
            postRollType={state.postRollType} setPostRollType={setters.setPostRollType}
            postRollText={state.postRollText} setPostRollText={setters.setPostRollText}
            postRollSeconds={state.postRollSeconds} setPostRollSeconds={setters.setPostRollSeconds}
            postRollShowHeading={state.postRollShowHeading} setPostRollShowHeading={setters.setPostRollShowHeading}
            postRollHeadingText={state.postRollHeadingText} setPostRollHeadingText={setters.setPostRollHeadingText}
            colorEvents={state.colorEvents}
            onAddColorEvent={handlers.addColorEvent}
            onRemoveColorEvent={handlers.removeColorEvent}
            onUpdateColorEvent={handlers.updateColorEvent}
            currentTime={state.progress}
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
              setters.setPreRollShowHeading(true);
              setters.setPreRollHeadingText('');
              setters.setPreRollCardShowTitle(true);
              setters.setPreRollCardTitleText('');
              setters.setPreRollCardTheme('clean');
              setters.setPostRollEnabled(false);
              setters.setPostRollType('text');
              setters.setPostRollText('Tripped Out Tim');
              setters.setPostRollSeconds(4);
              setters.setPostRollShowHeading(true);
              setters.setPostRollHeadingText('');
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
        );

      case 'media':
        return (
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
        );

      case 'timeline':
        return (
          <VisualizerSettings
            activeTab="timeline"
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
            preRollShowHeading={state.preRollShowHeading} setPreRollShowHeading={setters.setPreRollShowHeading}
            preRollHeadingText={state.preRollHeadingText} setPreRollHeadingText={setters.setPreRollHeadingText}
            preRollCardShowTitle={state.preRollCardShowTitle} setPreRollCardShowTitle={setters.setPreRollCardShowTitle}
            preRollCardTitleText={state.preRollCardTitleText} setPreRollCardTitleText={setters.setPreRollCardTitleText}
            preRollCardTheme={state.preRollCardTheme} setPreRollCardTheme={setters.setPreRollCardTheme}
            postRollEnabled={state.postRollEnabled} setPostRollEnabled={setters.setPostRollEnabled}
            postRollType={state.postRollType} setPostRollType={setters.setPostRollType}
            postRollText={state.postRollText} setPostRollText={setters.setPostRollText}
            postRollSeconds={state.postRollSeconds} setPostRollSeconds={setters.setPostRollSeconds}
            postRollShowHeading={state.postRollShowHeading} setPostRollShowHeading={setters.setPostRollShowHeading}
            postRollHeadingText={state.postRollHeadingText} setPostRollHeadingText={setters.setPostRollHeadingText}
            colorEvents={state.colorEvents}
            onAddColorEvent={handlers.addColorEvent}
            onRemoveColorEvent={handlers.removeColorEvent}
            onUpdateColorEvent={handlers.updateColorEvent}
            currentTime={state.progress}
            onReset={() => {}}
          />
        );

      case 'dsp':
        return (
          <VisualizerSettings
            activeTab="dsp"
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
            preRollShowHeading={state.preRollShowHeading} setPreRollShowHeading={setters.setPreRollShowHeading}
            preRollHeadingText={state.preRollHeadingText} setPreRollHeadingText={setters.setPreRollHeadingText}
            preRollCardShowTitle={state.preRollCardShowTitle} setPreRollCardShowTitle={setters.setPreRollCardShowTitle}
            preRollCardTitleText={state.preRollCardTitleText} setPreRollCardTitleText={setters.setPreRollCardTitleText}
            preRollCardTheme={state.preRollCardTheme} setPreRollCardTheme={setters.setPreRollCardTheme}
            postRollEnabled={state.postRollEnabled} setPostRollEnabled={setters.setPostRollEnabled}
            postRollType={state.postRollType} setPostRollType={setters.setPostRollType}
            postRollText={state.postRollText} setPostRollText={setters.setPostRollText}
            postRollSeconds={state.postRollSeconds} setPostRollSeconds={setters.setPostRollSeconds}
            postRollShowHeading={state.postRollShowHeading} setPostRollShowHeading={setters.setPostRollShowHeading}
            postRollHeadingText={state.postRollHeadingText} setPostRollHeadingText={setters.setPostRollHeadingText}
            colorEvents={state.colorEvents}
            onAddColorEvent={handlers.addColorEvent}
            onRemoveColorEvent={handlers.removeColorEvent}
            onUpdateColorEvent={handlers.updateColorEvent}
            currentTime={state.progress}
            onReset={() => {}}
          />
        );

      case 'export':
        return (
          <div className="space-y-4">
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
            <details className="group" open>
              <summary className="cursor-pointer list-none">
                <div className="flex items-center justify-between p-3 rounded-xl border border-[var(--app-panel-border)] bg-[var(--app-panel)] backdrop-blur-sm">
                  <span className="text-sm font-semibold text-white">Publishing Workflow</span>
                  <span className="text-xs text-slate-400 group-open:hidden">Expand</span>
                  <span className="text-xs text-slate-400 hidden group-open:inline">Collapse</span>
                </div>
              </summary>
              <div className="mt-2 space-y-3 p-4 rounded-xl border border-[var(--app-panel-border)] bg-[var(--app-panel)] backdrop-blur-sm">
                <div data-testid="publish-dry-run-banner" role="status" className="flex items-start gap-2 px-3 py-2 rounded-lg border border-amber-500/30 bg-amber-500/10 text-amber-300 text-xs leading-relaxed">
                  <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4 shrink-0 mt-0.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v3.75m-9.303 3.376c-.866 1.5.217 3.374 1.948 3.374h14.71c1.73 0 2.813-1.874 1.948-3.374L13.949 3.378c-.866-1.5-3.032-1.5-3.898 0L2.697 16.126zM12 15.75h.007v.008H12v-.008z" />
                  </svg>
                  <span>Dry-run preview — no upload happens yet (YouTube/Facebook publishing is not connected).</span>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-2 gap-2">
                  <AppSelect value={publishTarget} onChange={(e) => setPublishTarget(e.target.value as 'youtube' | 'facebook' | 'both')} className="h-10">
                    <option value="youtube">Publish: YouTube (16:9)</option>
                    <option value="facebook">Publish: Facebook (16:9 / 9:16)</option>
                    <option value="both">Publish: Both (FB then YT)</option>
                  </AppSelect>
                  {(publishTarget === 'facebook' || publishTarget === 'both') && (
                    <AppSelect value={fbAspect} onChange={(e) => setFbAspect(e.target.value as 'landscape' | 'portrait')} className="h-10">
                      <option value="landscape">Facebook Aspect: 16:9 Landscape</option>
                      <option value="portrait">Facebook Aspect: 9:16 Portrait</option>
                    </AppSelect>
                  )}
                </div>
                <AppInput value={publishTitle} onChange={(e) => setPublishTitle(e.target.value)} placeholder="Publish title" />
                <AppTextarea value={publishDescription} onChange={(e) => setPublishDescription(e.target.value)} placeholder="Publish description" className="h-24 resize-y" />
                <AppButton variant="primary" onClick={handlePublish} disabled={!state.clipData || publishState === 'publishing'} className="w-full">
                  {publishState === 'publishing' ? 'Publishing...' : 'Run Dry-Run Publish Preview'}
                </AppButton>
                <StatusMessage state={publishState} message={publishMessage} />
              </div>
            </details>
          </div>
        );
    }
  };

  const isClipLoaded = state.selectedClipId && state.clipData;

  return (
    <div className="flex flex-col h-full">
      {/* ─── Top Bar ─── */}
      <div className="flex items-center justify-between px-4 sm:px-6 h-12 min-h-[3rem] bg-[rgba(15,23,42,0.6)] backdrop-blur-md border-b border-[var(--app-panel-border)]">
        <div className="flex items-center gap-3">
          <span className="text-sm font-bold text-white">Lyric Video <span className="text-[var(--app-accent)]">Visualizer</span></span>
          {isClipLoaded && (
            <>
              <div className="w-px h-5 bg-[var(--app-panel-border)]" />
              <div className="flex items-center gap-2 text-[13px] text-slate-400">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                {state.clipData!.title || state.clipData!.id}
              </div>
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          {!isClipLoaded && (
            <>
              <AppSelect
                value={state.selectedClipId}
                onChange={(e) => setters.setSelectedClipId(e.target.value)}
                className="w-48 text-slate-300 text-xs"
              >
                <option value="">From History...</option>
                {history.filter(c => !c.id.startsWith('draft_')).map(c => (
                  <option key={c.id} value={c.id}>{c.title || c.id}</option>
                ))}
              </AppSelect>
              <div className="flex items-center gap-1">
                <AppInput
                  type="text"
                  placeholder="Or paste Suno ID / UUID manually..."
                  value={state.manualId}
                  onChange={(e) => setters.setManualId(e.target.value)}
                  className="w-40 text-xs"
                />
                <AppButton variant="secondary" size="sm" onClick={handlers.handleManualLoad}>Load ID</AppButton>
              </div>
            </>
          )}
          <button
            onClick={() => setShowLibraryPicker(true)}
            aria-label="Open library picker"
            className="flex items-center gap-1.5 px-3 py-1.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors text-xs"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6a2 2 0 0 1 2-2h3v16H5a2 2 0 0 0-2 2z" />
              <path d="M21 6a2 2 0 0 0-2-2h-3v16h3a2 2 0 0 1 2 2z" />
              <path d="M8 4h8v16H8z" />
            </svg>
            Library
          </button>
        </div>
      </div>

      {/* ─── Canvas Area ─── */}
      {isClipLoaded ? (
        <>
          <div className="flex-1 flex items-center justify-center relative min-h-0 overflow-hidden">
            <CanvasPreview
              canvasRef={refs.canvasRef}
              aspectRatio={state.aspectRatio}
              isPreparing={state.isPreparing}
            />
            {/* Playback Overlay positioned over canvas */}
            <div className="absolute bottom-0 left-0 right-0 p-4">
              <div className="max-w-[min(72vw,960px)] mx-auto">
                <div className="bg-gradient-to-t from-black/80 to-transparent pt-8 pb-1 px-1 rounded-b-xl">
                  <input
                    type="range"
                    min={0}
                    max={state.duration || 100}
                    value={state.progress}
                    onChange={handlers.handleSeek}
                    className="w-full h-1 bg-[var(--app-panel)] rounded-lg appearance-none cursor-pointer accent-[var(--app-accent)]"
                    style={{
                      background: `linear-gradient(to right, var(--app-accent) ${(state.progress / (state.duration || 1)) * 100}%, rgba(148,163,184,0.15) ${(state.progress / (state.duration || 1)) * 100}%)`
                    }}
                  />
                  <div className="flex items-center gap-3 mt-2">
                    <button
                      type="button"
                      onClick={handlers.togglePlay}
                      aria-label={state.isPlaying ? 'Pause' : 'Play'}
                      className="w-8 h-8 min-h-0 p-0 flex items-center justify-center rounded-full bg-white/15 text-white border border-white/20 hover:bg-white/25 backdrop-blur-sm transition-colors cursor-pointer"
                    >
                      {state.isPlaying ? (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4">
                          <path fillRule="evenodd" d="M6.75 5.25a.75.75 0 01.75-.75H9a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H7.5a.75.75 0 01-.75-.75V5.25zm7.5 0A.75.75 0 0115 4.5h1.5a.75.75 0 01.75.75v13.5a.75.75 0 01-.75.75H15a.75.75 0 01-.75-.75V5.25z" clipRule="evenodd" />
                        </svg>
                      ) : (
                        <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="currentColor" className="w-4 h-4 ml-0.5">
                          <path fillRule="evenodd" d="M4.5 5.653c0-1.426 1.529-2.33 2.779-1.643l11.54 6.348c1.295.712 1.295 2.573 0 3.285L7.28 19.991c-1.25.687-2.779-.217-2.779-1.643V5.653z" clipRule="evenodd" />
                        </svg>
                      )}
                    </button>
                    <span className="text-xs font-mono text-slate-400">
                      <span className="text-white">{formatTime(state.progress)}</span> / {formatTime(state.duration)}
                    </span>
                    <span className="ml-auto text-[10px] font-mono text-slate-500 uppercase tracking-wider">
                      {state.isRendering ? 'Rendering' : 'Preview'}
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          {/* Hidden audio element */}
          <audio
            ref={refs.audioRef}
            controls
            src={state.customAudio ? state.customAudio.url : (state.clipData?.audioUrl || undefined)}
            crossOrigin="anonymous"
            className="hidden"
            onLoadedMetadata={(e) => handlers.setDuration(e.currentTarget.duration)}
            onPlay={() => setters.setIsPlaying(true)}
            onPause={() => setters.setIsPlaying(false)}
          />

          {/* ─── Tab Strip ─── */}
          <div className="flex items-center h-11 min-h-[2.75rem] bg-[rgba(15,23,42,0.5)] backdrop-blur-md border-t border-b border-[var(--app-panel-border)] px-4 overflow-x-auto">
            {tabs.map((tab) => (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`px-4 py-2 text-xs font-semibold border-b-2 transition-colors whitespace-nowrap ${
                  activeTab === tab.key
                    ? 'text-[var(--app-accent)] border-[var(--app-accent)]'
                    : 'text-slate-500 border-transparent hover:text-slate-300'
                }`}
              >
                {tab.label}
                {tab.badge && (
                  <span className="ml-1.5 inline-flex items-center justify-center min-w-[1rem] h-4 px-1 text-[9px] font-semibold rounded bg-[var(--app-accent)]/15 text-[var(--app-accent)]">
                    {tab.badge}
                  </span>
                )}
              </button>
            ))}
            <div className="ml-auto flex items-center gap-2">
              <AppButton variant="secondary" size="xs" onClick={() => setActiveTab('style')} className="text-[var(--app-accent)] border-[var(--app-accent)]/30 hover:bg-[var(--app-accent)]/10">
                Presets
              </AppButton>
            </div>
          </div>

          {/* ─── Panel Content ─── */}
          <div className="max-h-[40vh] min-h-[12rem] overflow-y-auto bg-[rgba(15,23,42,0.4)] backdrop-blur-sm p-4 sm:p-5">
            {renderTabPanel()}
          </div>
        </>
      ) : (
        <div className="flex-1 flex flex-col items-center justify-center p-8">
          <div className="flex flex-col items-center justify-center py-20 px-8 border-2 border-dashed border-[var(--app-panel-border)] rounded-2xl bg-[var(--app-panel)] text-slate-500 max-w-lg w-full">
            <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={1.5} stroke="currentColor" className="w-16 h-16 opacity-20 mb-4">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3.75 3v11.25A2.25 2.25 0 006 16.5h2.25M3.75 3h-1.5m1.5 0h16.5m0 0h1.5m-1.5 0v11.25A2.25 2.25 0 0118 16.5h-2.25m-7.5 0h7.5m-7.5 0l-1 3m8.5-3l1 3m0 0l.5 1.5m-.5-1.5h-9.5m0 0l-.5 1.5M9 11.25v1.5M12 9v3.75m3-6v6" />
            </svg>
            <p className="text-center">Select a song from history or enter an ID to start.</p>
          </div>
        </div>
      )}

      <LibraryPickerModal
        isOpen={showLibraryPicker}
        onClose={() => setShowLibraryPicker(false)}
        onSelectTrack={handleSelectFromLibrary}
      />
    </div>
  );
};

export default VisualizerSection;
