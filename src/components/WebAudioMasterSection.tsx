import React, { useState, useRef, useEffect, useCallback } from 'react';
import { AppCard } from './ui/AppPrimitives';
import LibraryPickerModal, { LibrarySelection } from './LibraryPickerModal';
import WebAudioMasterNativeControls from './WebAudioMasterNativeControls';
import WebAudioMasterNativePreview, { NativePreviewStatusSummary } from './WebAudioMasterNativePreview';
import { MasteringSettings, OfflineTrack, TrackVariant } from '../services/offlineDb';
import { authorizeSunoDownload, convertToWav, isEncryptedSunoStream, resolveSunoAudioUrl, SunoDownloadError, waitForWavConversion } from '../services/sunoApi';
import { createDefaultMasteringSettings, renderNativeMasteredWavFromBlob } from '../services/mastering/nativeMasteringPipeline';

type SelectedReference = {
  track: OfflineTrack;
  variant?: TrackVariant;
  sourceKind: 'library-original' | 'library-variant' | 'uploaded';
};

function mapWamSettingsToVariantSettings(raw?: Record<string, any>): MasteringSettings | undefined {
  if (!raw) return undefined;

  return {
    inputGain: Number(raw.inputGain ?? 0),
    glueCompression: Boolean(raw.glueCompression),
    deharsh: Boolean(raw.deharsh),
    cleanLowEnd: Boolean(raw.cleanLowEnd),
    autoLevel: Boolean(raw.autoLevel),
    addPunch: Boolean(raw.addPunch),
    stereoWidth: Number(raw.stereoWidth ?? 100),
    centerBass: Boolean(raw.centerBass),
    cutMud: Boolean(raw.cutMud),
    addAir: Boolean(raw.addAir),
    tapeWarmth: Boolean(raw.tapeWarmth),
    normalizeLoudness: Boolean(raw.normalizeLoudness),
    targetLufs: Number(raw.targetLufs ?? -14),
    truePeakLimit: Boolean(raw.truePeakLimit),
    ceiling: Number(raw.truePeakCeiling ?? -1),
    sampleRate: Number(raw.sampleRate ?? 48000),
    bitDepth: Number(raw.bitDepth ?? 24),
    eq: {
      low: Number(raw.eqLow ?? 0),
      lowMid: Number(raw.eqLowMid ?? 0),
      mid: Number(raw.eqMid ?? 0),
      highMid: Number(raw.eqHighMid ?? 0),
      high: Number(raw.eqHigh ?? 0),
    },
  };
}

interface WebAudioMasterSectionProps {
  /** Suno bearer token; needed to resolve presigned audio links for library tracks. */
  sunoCookie?: string;
}

const WebAudioMasterSection: React.FC<WebAudioMasterSectionProps> = ({ sunoCookie }) => {
  const settingsStorageKey = 'wam_native_settings_v1';
  const [showLibraryPicker, setShowLibraryPicker] = useState(false);
  const [selectedReference, setSelectedReference] = useState<SelectedReference | null>(null);
  const [isConvertingToWav, setIsConvertingToWav] = useState(false);
  const [wavProgress, setWavProgress] = useState('');
  const [saveStatus, setSaveStatus] = useState<string>('');
  const [selectedSourceBlob, setSelectedSourceBlob] = useState<Blob | null>(null);
  const [selectedSourceFileName, setSelectedSourceFileName] = useState<string>('');
  const [nativeSettings, setNativeSettings] = useState<MasteringSettings>(() => {
    const defaults = createDefaultMasteringSettings();
    try {
      const raw = localStorage.getItem(settingsStorageKey);
      if (!raw) return defaults;
      const parsed = JSON.parse(raw) as Partial<MasteringSettings>;
      return {
        ...defaults,
        ...parsed,
        eq: {
          ...defaults.eq,
          ...(parsed.eq || {}),
        },
      };
    } catch {
      return defaults;
    }
  });
  const [isNativeRendering, setIsNativeRendering] = useState(false);
  const [nativeProgress, setNativeProgress] = useState<string>('');
  const [previewStatus, setPreviewStatus] = useState<NativePreviewStatusSummary>({
    status: 'idle',
    statusMessage: '',
    hasSource: false,
    hasPreview: false,
    renderProgress: null,
  });
  const fileInputRef = useRef<HTMLInputElement>(null);

  const getSunoApiWavKey = () => {
    const keys = ['sunoapi_key', 'suno_api_key', 'sunoApiKey'];
    for (const key of keys) {
      const value = localStorage.getItem(key);
      if (value?.trim()) return value.trim();
    }
    return '';
  };

  useEffect(() => {
    try {
      localStorage.setItem(settingsStorageKey, JSON.stringify(nativeSettings));
    } catch {
      // ignore storage quota/private mode errors
    }
  }, [nativeSettings]);

  const loadBlobReference = useCallback(async (blob: Blob, fileName: string, reference: SelectedReference) => {
    setSelectedReference(reference);
    setWavProgress('Loading audio...');
    setSelectedSourceBlob(blob);
    setSelectedSourceFileName(fileName);
    setWavProgress('');
    setSaveStatus('');
    setNativeProgress('');
  }, []);

  const handleSelectFromLibrary = useCallback(async ({ track, variant }: LibrarySelection) => {
    const reference: SelectedReference = {
      track,
      variant,
      sourceKind: variant ? 'library-variant' : 'library-original',
    };

    if (variant?.audioBlob) {
      const variantExt = variant.title.toLowerCase().endsWith('.wav') ? '' : '.wav';
      await loadBlobReference(variant.audioBlob, `${variant.title}${variantExt}`, reference);
      return;
    }

    let sourceUrl = variant?.audioUrl || track.audioUrl;
    setSelectedReference(reference);
    setWavProgress('Loading audio...');

    try {
      if (!variant && (!sourceUrl || isEncryptedSunoStream(sourceUrl))) {
        if (!sunoCookie) throw new Error('Connect your Suno account in Settings to load library audio.');
        const clipId = track.sunoId || track.id;
        try {
          sourceUrl = (await resolveSunoAudioUrl(clipId, sunoCookie)).url;
        } catch (err) {
          if (!(err instanceof SunoDownloadError) || !err.needsUnlock) throw err;
          // Spending a monthly download needs an explicit OK.
          const ok = window.confirm(`"${track.title}" is not unlocked for download on Suno yet.\nUnlock it now? This uses 1 of your monthly Suno downloads.`);
          if (!ok) throw new Error('Song is not unlocked on Suno.');
          await authorizeSunoDownload(clipId, sunoCookie);
          sourceUrl = (await resolveSunoAudioUrl(clipId, sunoCookie)).url;
        }
      }
      const response = await fetch(sourceUrl);
      const blob = await response.blob();
      const ext = sourceUrl.split('.').pop() || (variant ? 'wav' : 'mp3');
      const sourceTitle = variant?.title || track.title;
      await loadBlobReference(blob, `${sourceTitle}.${ext}`, reference);
    } catch (error) {
      console.error('Failed to load track audio:', error);
      setWavProgress(error instanceof Error && error.message ? `Failed to load audio: ${error.message}` : 'Failed to load audio');
    }
  }, [loadBlobReference, sunoCookie]);

  const handleUploadWav = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      setSelectedReference({
        track: {
          id: 'uploaded',
          sunoId: '',
          title: file.name.replace(/\.[^.]+$/, ''),
          audioUrl: '',
          imageUrl: '',
          lyricsText: '',
          lrcContent: '',
          srtContent: '',
          metadata: { tags: [], prompt: '', durationMs: 0 },
          cachedLocally: false,
          raw: null,
          updatedAt: Date.now(),
          createdAt: Date.now(),
        },
        sourceKind: 'uploaded',
      });
      setSaveStatus('');
      setSelectedSourceBlob(file);
      setSelectedSourceFileName(file.name);
      setNativeProgress('');
      setWavProgress('');
    }
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const handleNativeQuickMaster = async () => {
    if (!selectedSourceBlob || !selectedSourceFileName) {
      setNativeProgress('Select a library track or upload a file first.');
      return;
    }

    setIsNativeRendering(true);
    setNativeProgress('Preparing native mastering pipeline...');
    setSaveStatus('');

    try {
      const result = await renderNativeMasteredWavFromBlob(
        selectedSourceBlob,
        selectedSourceFileName,
        nativeSettings,
        (update) => {
          const pct = Math.round(update.progress * 100);
          setNativeProgress(`${pct}% • ${update.message}`);
        }
      );

      const url = URL.createObjectURL(result.blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = result.fileName;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      setTimeout(() => URL.revokeObjectURL(url), 1000);

      await saveMasteredToLibrary(result.blob, result.fileName);

      setNativeProgress(
        `Native pipeline complete.`
      );
    } catch (error) {
      console.error('Native mastering pipeline failed:', error);
      setNativeProgress(`Native pipeline failed: ${error instanceof Error ? error.message : String(error)}`);
    } finally {
      setIsNativeRendering(false);
    }
  };

  const sourceIsLoading = isConvertingToWav || (!!wavProgress && !selectedSourceBlob);
  const previewIsRendering = previewStatus.status === 'rendering';
  const previewReady = previewStatus.hasPreview && ['ready', 'playing', 'paused'].includes(previewStatus.status);
  const canRunNativeMaster = !!selectedSourceBlob && !sourceIsLoading && !isNativeRendering && previewReady;
  const sourceLooksLikeNonWavLibraryOriginal =
    !!selectedReference &&
    selectedReference.sourceKind === 'library-original' &&
    !!selectedSourceFileName &&
    !/\.wav$/i.test(selectedSourceFileName);
  const nativeMasterDisabledReason =
    !selectedSourceBlob
      ? 'Select or upload a source first.'
      : sourceIsLoading
        ? 'Source audio is still loading/converting.'
        : previewIsRendering
          ? 'Wait for Native Preview analysis to finish.'
          : !previewReady
            ? 'Native Preview is not ready yet.'
            : isNativeRendering
              ? 'Native master render is already in progress.'
              : '';

  const saveMasteredToLibrary = async (blob: Blob, fileName: string, rawSettings?: Record<string, any>) => {
    if (!selectedReference || selectedReference.sourceKind === 'uploaded') {
      setSaveStatus('Exported WAV generated (not saved to library because source is a local upload).');
      return;
    }

    try {
      const { getTrackById, updateTrack } = await import('../services/offlineDb');
      const track = await getTrackById(selectedReference.track.id);

      if (!track) {
        setSaveStatus('Mastered export completed, but the source track was not found in the library.');
        return;
      }

      const variant: TrackVariant = {
        id: crypto.randomUUID(),
        type: 'mastered',
        title: fileName.replace(/\.wav$/i, ''),
        audioUrl: '',
        audioBlob: blob,
        imageUrl: track.imageUrl,
        createdAt: Date.now(),
        settings: mapWamSettingsToVariantSettings(rawSettings),
        parentVariantId: selectedReference.variant?.id,
      };

      const variants = track.variants || [];
      variants.push(variant);

      await updateTrack({
        ...track,
        variants
      });

      setSaveStatus(`Saved mastered variant to library: ${variant.title}`);
    } catch (error) {
      console.error('Failed to save mastered track:', error);
      setSaveStatus('Mastered export completed, but saving the variant to the library failed.');
    }
  };

  const handleConvertAndLoad = async (track: OfflineTrack) => {
    setSelectedReference({
      track,
      sourceKind: 'library-original',
    });
    setIsConvertingToWav(true);
    setWavProgress('Requesting WAV conversion...');
    setSaveStatus('');

    try {
      const apiKey = getSunoApiWavKey();
      if (!apiKey) {
        setWavProgress('No SunoAPI WAV key configured (`sunoapi_key`). Loading MP3 instead.');
        await handleSelectFromLibrary({ track });
        return;
      }

      const { taskId } = await convertToWav(track.sunoId, 0, apiKey);
      if (!taskId) {
        throw new Error('WAV conversion endpoint returned no task id');
      }
      setWavProgress('Converting to WAV (this may take a minute)...');

      const result = await waitForWavConversion(taskId, apiKey);
      
      if (result.audioWavUrl) {
        setWavProgress('Downloading WAV...');
        const response = await fetch(result.audioWavUrl);
        const blob = await response.blob();
        const fileName = `${track.title}.wav`;

        await loadBlobReference(blob, fileName, {
          track,
          sourceKind: 'library-original',
        });
        setWavProgress('Loaded Suno WAV source.');
      } else {
        throw new Error('WAV conversion finished but no audioWavUrl was returned');
      }
    } catch (error) {
      console.error('WAV conversion failed:', error);
      setWavProgress(`Suno WAV unavailable (${error instanceof Error ? error.message : String(error)}). Loading MP3 instead.`);
      await handleSelectFromLibrary({ track });
    } finally {
      setIsConvertingToWav(false);
    }
  };

  return (
    <section className="max-w-7xl mx-auto space-y-4">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
        <div>
          <h2 className="text-2xl font-bold text-white">Web-Audio-Master</h2>
          <p className="text-sm text-slate-400 mt-1">
            Suno-native mastering workflow using the full Web-Audio-Master engine and DSP chain.
          </p>
        </div>
        <div className="flex items-center gap-3 flex-wrap">
          <button
            onClick={() => setShowLibraryPicker(true)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 text-white rounded-lg font-medium transition-colors"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M3 6a2 2 0 0 1 2-2h3v16H5a2 2 0 0 0-2 2z" />
              <path d="M21 6a2 2 0 0 0-2-2h-3v16h3a2 2 0 0 1 2 2z" />
              <path d="M8 4h8v16H8z" />
            </svg>
            Select from Library
          </button>
          <label className="flex items-center gap-2 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors cursor-pointer">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
              <polyline points="17 8 12 3 7 8" />
              <line x1="12" y1="3" x2="12" y2="15" />
            </svg>
            Upload WAV
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,.mp3,.wav,.flac,.aac,.m4a,.mp4"
              onChange={handleUploadWav}
              className="hidden"
            />
          </label>
        </div>
      </div>

      {wavProgress && (
        <div className="flex items-center gap-3 px-4 py-3 bg-blue-900/30 border border-blue-700/50 rounded-lg">
          <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-blue-400"></div>
          <span className="text-blue-300 text-sm">{wavProgress}</span>
        </div>
      )}

      {selectedReference && (
        <div className="flex items-center gap-3 px-4 py-3 bg-slate-800/50 border border-[var(--app-panel-border)] rounded-lg">
          <div className="w-10 h-10 rounded-md bg-slate-700/70 grid place-items-center text-slate-300">
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M9 18V5l12-2v13" />
              <circle cx="6" cy="18" r="3" />
              <circle cx="18" cy="16" r="3" />
            </svg>
          </div>
          <div className="flex-grow">
            <p className="text-white font-medium">{selectedReference.track.title}</p>
            <p className="text-slate-400 text-sm">
              {selectedReference.variant
                ? `Reference: ${selectedReference.variant.type} variant`
                : selectedReference.sourceKind === 'uploaded'
                  ? 'Reference: local upload'
                : 'Reference: Suno library original'}
            </p>
          </div>
          {!selectedReference.variant && selectedReference.sourceKind !== 'uploaded' && (
            <button
              onClick={() => handleConvertAndLoad(selectedReference.track)}
              disabled={isConvertingToWav}
              className="px-3 py-1.5 text-sm bg-purple-600 hover:bg-purple-500 disabled:bg-slate-600 text-white rounded-lg transition-colors"
            >
              Use Suno WAV
            </button>
          )}
        </div>
      )}

      {sourceLooksLikeNonWavLibraryOriginal && (
        <div className="px-4 py-3 rounded-lg border border-amber-700/50 bg-amber-900/20 text-amber-200 text-sm">
          This looks like a non-WAV Suno library source (`{selectedSourceFileName}`). Suno MP3/library preview audio can fade out and stop early.
          Use <span className="font-semibold">Use Suno WAV</span> before Native Preview / Native Master for a full-length source.
        </div>
      )}

      {saveStatus && (
        <div className="px-4 py-3 rounded-lg border border-emerald-800/60 bg-emerald-900/20 text-emerald-300 text-sm">
          {saveStatus}
        </div>
      )}

      <AppCard className="bg-slate-950/60 border-[var(--app-panel-border)] rounded-xl p-4 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
          <div>
            <h3 className="text-lg font-semibold text-white">Native Mastering Pipeline (W-A-M Worker)</h3>
            <p className="text-sm text-slate-400">
              Typed React settings + native preview/analyzer + direct W-A-M worker render/export.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setNativeSettings(createDefaultMasteringSettings())}
              type="button"
              className="px-3 py-2 rounded-lg border border-slate-700 hover:border-slate-500 text-slate-200 text-sm"
            >
              Reset Defaults
            </button>
            <button
              onClick={handleNativeQuickMaster}
              disabled={!canRunNativeMaster}
              className="px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:bg-slate-700 disabled:text-slate-400 text-white font-medium transition-colors"
              title={nativeMasterDisabledReason || 'Render a full master and save it as a library variant'}
            >
              {isNativeRendering ? 'Rendering...' : 'Native Master + Save Variant'}
            </button>
          </div>
        </div>

        <div className="rounded-lg border border-slate-800 bg-slate-900/40 p-3">
          <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-2">
            <div className="text-sm text-white font-medium">Native Master Readiness</div>
            <div className="flex flex-wrap items-center gap-2 text-xs">
              <span className={`px-2 py-1 rounded-md border ${selectedSourceBlob ? 'border-emerald-700/60 text-emerald-200 bg-emerald-950/20' : 'border-slate-700 text-slate-400 bg-slate-900/40'}`}>
                Source {selectedSourceBlob ? 'Loaded' : 'Missing'}
              </span>
              <span className={`px-2 py-1 rounded-md border ${sourceIsLoading ? 'border-blue-700/60 text-blue-200 bg-blue-950/20' : 'border-slate-700 text-slate-400 bg-slate-900/40'}`}>
                {sourceIsLoading ? 'Source Loading…' : 'Source Idle'}
              </span>
              <span className={`px-2 py-1 rounded-md border ${previewReady ? 'border-emerald-700/60 text-emerald-200 bg-emerald-950/20' : previewIsRendering ? 'border-blue-700/60 text-blue-200 bg-blue-950/20' : previewStatus.status === 'error' ? 'border-red-700/60 text-red-200 bg-red-950/20' : 'border-slate-700 text-slate-400 bg-slate-900/40'}`}>
                {previewReady ? 'Preview Ready' : previewIsRendering ? `Preview Rendering${typeof previewStatus.renderProgress === 'number' ? ` (${Math.round(previewStatus.renderProgress * 100)}%)` : ''}` : previewStatus.status === 'error' ? 'Preview Error' : 'Preview Pending'}
              </span>
            </div>
          </div>
          <p className="mt-2 text-xs text-slate-400">
            {canRunNativeMaster
              ? 'Ready to render a full master and save it as a new library variant.'
              : nativeMasterDisabledReason || 'Waiting for source and preview readiness.'}
          </p>
          {sourceLooksLikeNonWavLibraryOriginal && (
            <p className="mt-1 text-xs text-amber-300">
              Source warning: non-WAV Suno library audio may be a preview clip with fade-out behavior.
            </p>
          )}
        </div>

        <WebAudioMasterNativeControls settings={nativeSettings} onChange={setNativeSettings} />

        <div className="text-xs text-slate-400">
          Source: {selectedSourceFileName || 'No source selected'}
        </div>
        {nativeProgress && (
          <div className="text-sm text-blue-300 bg-blue-900/20 border border-blue-800/40 rounded-lg px-3 py-2">
            {nativeProgress}
          </div>
        )}
      </AppCard>

      <WebAudioMasterNativePreview
        sourceBlob={selectedSourceBlob}
        sourceFileName={selectedSourceFileName}
        settings={nativeSettings}
        onStatusChange={setPreviewStatus}
      />

      <LibraryPickerModal
        isOpen={showLibraryPicker}
        onClose={() => setShowLibraryPicker(false)}
        onSelectTrack={handleSelectFromLibrary}
      />
    </section>
  );
};

export default WebAudioMasterSection;
