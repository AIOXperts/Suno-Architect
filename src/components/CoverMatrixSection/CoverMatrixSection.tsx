import React, { useState, useEffect, useMemo, useRef } from 'react';
import {
  SunoClip,
  VarietyLevel,
  CoverSliderMatrixItem,
  CoverSliderMatrixConfig,
} from '../../types';
import {
  getSunoClip,
  triggerSunoCoverGeneration,
  generateCoverMatrix,
  formatVarietyName,
} from '../../services/sunoApi';
import { SUNO_MODEL_MAPPINGS } from '../../constants';

interface CoverMatrixSectionProps {
  sunoCookie: string;
  sunoModel: string;
  sunoCredits: number | null;
  onOpenSettings?: () => void;
  initialSongId?: string;
}

export const CoverMatrixSection: React.FC<CoverMatrixSectionProps> = ({
  sunoCookie,
  sunoModel,
  sunoCredits,
  onOpenSettings,
  initialSongId = '91fb180d-5cfe-48d9-91aa-e4099ae0e2f1',
}) => {
  const [songInput, setSongInput] = useState(initialSongId);
  const [songClip, setSongClip] = useState<SunoClip | null>(null);
  const [isLoadingSong, setIsLoadingSong] = useState(false);
  const [loadError, setLoadError] = useState<string | null>(null);

  const [prefix, setPrefix] = useState('RFR');
  const [model, setModel] = useState(sunoModel || 'chirp-hawk');
  const [tags, setTags] = useState('');
  const [lyrics, setLyrics] = useState('');
  const [isInstrumental, setIsInstrumental] = useState(false);

  // Sliders multi-select state
  const [selectedVarieties, setSelectedVarieties] = useState<VarietyLevel[]>([0, 1, 2, 3, 4]);
  const [selectedAi, setSelectedAi] = useState<number[]>([0, 25, 50, 75, 100]);
  const [selectedSi, setSelectedSi] = useState<number[]>([50]);
  const [selectedW, setSelectedW] = useState<number[]>([50]);
  const [selectedMax, setSelectedMax] = useState<boolean[]>([false]);

  // Execution state
  const [delaySec, setDelaySec] = useState(8);
  const [isRunning, setIsRunning] = useState(false);
  const [isPaused, setIsPaused] = useState(false);
  const isPausedRef = useRef(false);
  const isRunningRef = useRef(false);

  const [matrixItems, setMatrixItems] = useState<CoverSliderMatrixItem[]>([]);
  const [statusMessage, setStatusMessage] = useState<string>('');

  const cleanSongId = useMemo(() => {
    const match = songInput.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
    return match ? match[0] : songInput.trim();
  }, [songInput]);

  // Load song details from Suno
  const handleLoadSong = async (idToFetch: string = cleanSongId) => {
    if (!idToFetch) return;
    setIsLoadingSong(true);
    setLoadError(null);

    try {
      // First try via API
      const clip = await getSunoClip(idToFetch, sunoCookie || 'anonymous');
      if (clip) {
        setSongClip(clip);
        if (clip.title) {
          const words = clip.title.replace(/[^a-zA-Z0-9\s]/g, '').trim().split(/\s+/);
          const acronym = words.length > 1 ? words.map((w: string) => w[0].toUpperCase()).join('') : clip.title.slice(0, 4).toUpperCase();
          setPrefix(acronym || 'COVER');
        }
        if (clip.metadata?.tags) setTags(clip.metadata.tags);
        if (clip.metadata?.prompt) setLyrics(clip.metadata.prompt);
      }
    } catch (e: any) {
      setLoadError(`Note: Could not automatically load song metadata (${e.message}). You can still provide the ID and tags manually.`);
    } finally {
      setIsLoadingSong(false);
    }
  };

  useEffect(() => {
    if (cleanSongId) {
      handleLoadSong(cleanSongId);
    }
  }, []);

  // Compute matrix items whenever configuration changes
  const computedMatrix = useMemo(() => {
    const config: CoverSliderMatrixConfig = {
      baseSongId: cleanSongId,
      titlePrefix: prefix.trim() || 'COVER',
      model,
      tags,
      lyrics,
      varieties: selectedVarieties.length ? selectedVarieties : [1],
      audioInfluences: selectedAi.length ? selectedAi : [50],
      styleInfluences: selectedSi.length ? selectedSi : [50],
      weirdnessValues: selectedW.length ? selectedW : [50],
      maxModes: selectedMax.length ? selectedMax : [false],
    };
    return generateCoverMatrix(config);
  }, [cleanSongId, prefix, model, tags, lyrics, selectedVarieties, selectedAi, selectedSi, selectedW, selectedMax]);

  // Sync matrix items when not running
  useEffect(() => {
    if (!isRunning) {
      setMatrixItems(computedMatrix);
    }
  }, [computedMatrix, isRunning]);

  const totalRuns = matrixItems.length;
  const estimatedCredits = totalRuns * 10;
  const estimatedMinutes = Math.ceil((totalRuns * delaySec) / 60);

  const completedCount = matrixItems.filter((m) => m.status === 'completed').length;
  const failedCount = matrixItems.filter((m) => m.status === 'failed').length;

  const toggleVariety = (v: VarietyLevel) => {
    setSelectedVarieties((prev) =>
      prev.includes(v) ? (prev.length > 1 ? prev.filter((x) => x !== v) : prev) : [...prev, v].sort()
    );
  };

  const toggleAi = (val: number) => {
    setSelectedAi((prev) =>
      prev.includes(val) ? (prev.length > 1 ? prev.filter((x) => x !== val) : prev) : [...prev, val].sort((a, b) => a - b)
    );
  };

  const toggleSi = (val: number) => {
    setSelectedSi((prev) =>
      prev.includes(val) ? (prev.length > 1 ? prev.filter((x) => x !== val) : prev) : [...prev, val].sort((a, b) => a - b)
    );
  };

  const toggleW = (val: number) => {
    setSelectedW((prev) =>
      prev.includes(val) ? (prev.length > 1 ? prev.filter((x) => x !== val) : prev) : [...prev, val].sort((a, b) => a - b)
    );
  };

  const handleStartRun = async () => {
    if (!sunoCookie) {
      if (onOpenSettings) onOpenSettings();
      alert('Please connect your Suno token/cookie in Settings before running generation.');
      return;
    }
    if (!cleanSongId) {
      alert('Please provide a source song ID.');
      return;
    }

    const confirmed = window.confirm(
      `Start Cover Slider Matrix?\n\n• Total Generations: ${totalRuns} (2 clips each)\n• Estimated Credits: ${estimatedCredits}\n• Model: ${model}\n\nContinue?`
    );
    if (!confirmed) return;

    setIsRunning(true);
    isRunningRef.current = true;
    setIsPaused(false);
    isPausedRef.current = false;
    setStatusMessage('Starting matrix execution...');

    const items = [...matrixItems];

    for (let i = 0; i < items.length; i++) {
      if (!isRunningRef.current) break;

      while (isPausedRef.current) {
        setStatusMessage('Paused. Waiting to resume...');
        await new Promise((r) => setTimeout(r, 1000));
        if (!isRunningRef.current) break;
      }

      const item = items[i];
      if (item.status === 'completed') continue;

      item.status = 'running';
      setMatrixItems([...items]);
      setStatusMessage(`[${i + 1}/${items.length}] Generating: ${item.title}`);

      try {
        const res = await triggerSunoCoverGeneration(
          {
            songId: cleanSongId,
            title: item.title,
            prompt: lyrics,
            tags,
            model,
            audioWeight: item.audioInfluence / 100,
            styleWeight: item.styleInfluence / 100,
            weirdness: item.weirdness / 100,
            variety: item.variety,
            isMaxMode: item.isMaxMode,
            makeInstrumental: isInstrumental,
          },
          sunoCookie
        );

        const clips = res?.clips || [];
        item.clipIds = clips.map((c: any) => c.id);
        item.status = 'completed';
      } catch (err: any) {
        item.status = 'failed';
        item.error = err.message || String(err);
      }

      setMatrixItems([...items]);

      if (i < items.length - 1 && isRunningRef.current) {
        setStatusMessage(`Pacing: waiting ${delaySec}s before next call to prevent rate limiting...`);
        await new Promise((r) => setTimeout(r, delaySec * 1000));
      }
    }

    setIsRunning(false);
    isRunningRef.current = false;
    setStatusMessage('Matrix run completed!');
  };

  const handlePauseToggle = () => {
    isPausedRef.current = !isPaused;
    setIsPaused(!isPaused);
  };

  const handleStop = () => {
    isRunningRef.current = false;
    isPausedRef.current = false;
    setIsRunning(false);
    setIsPaused(false);
    setStatusMessage('Execution stopped by user.');
  };

  const cliCommand = useMemo(() => {
    const vStr = selectedVarieties.join(',');
    const aiStr = selectedAi.join(',');
    const siStr = selectedSi.join(',');
    const wStr = selectedW.join(',');
    const maxStr = selectedMax.length === 2 ? 'both' : selectedMax[0] ? 'on' : 'off';
    return `bun run suno:matrix --song=${cleanSongId} --prefix=${prefix} --model=${model} --variety=${vStr} --ai=${aiStr} --si=${siStr} --w=${wStr} --max=${maxStr} --delay=${delaySec}`;
  }, [cleanSongId, prefix, model, selectedVarieties, selectedAi, selectedSi, selectedW, selectedMax, delaySec]);

  return (
    <div className="space-y-6 max-w-7xl mx-auto pb-12">
      {/* Header Banner */}
      <div className="bg-gradient-to-r from-slate-900 via-indigo-950/40 to-slate-900 border border-[var(--app-panel-border)] rounded-2xl p-6 shadow-xl relative overflow-hidden">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-2.5 py-1 rounded-full bg-pink-500/10 border border-pink-500/20 text-pink-400 text-xs font-bold uppercase tracking-wider mb-2">
              <span className="w-2 h-2 rounded-full bg-pink-500 animate-pulse"></span>
              Suno v6 Cover Suite
            </div>
            <h1 className="text-2xl font-black text-white flex items-center gap-3">
              Cover Slider Matrix Generator
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Automate multi-dimensional parameter exploration for Suno v6 covers across Variety, Audio Influence, Style Influence, Weirdness, and Max Mode.
            </p>
          </div>

          <div className="flex items-center gap-3 bg-slate-950/60 border border-white/5 rounded-xl p-3">
            <div>
              <span className="text-xs text-slate-500 block">Active Model</span>
              <span className="text-sm font-bold text-pink-400">{model === 'chirp-hawk' ? 'V6 (chirp-hawk)' : model}</span>
            </div>
            <div className="h-8 w-px bg-white/10"></div>
            <div>
              <span className="text-xs text-slate-500 block">Credits</span>
              <span className="text-sm font-bold text-emerald-400">
                {sunoCredits !== null ? sunoCredits : 'Unconnected'}
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Main Grid: Config & Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
        {/* Left Column: Configuration Controls (5 cols) */}
        <div className="lg:col-span-5 space-y-6">
          {/* 1. Base Song Input Card */}
          <div className="bg-[var(--app-panel)] border border-[var(--app-panel-border)] rounded-xl p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
                <span className="w-2 h-2 rounded-full bg-pink-500"></span>
                1. Base Song Selection
              </h2>
              {songClip && (
                <span className="text-xs text-emerald-400 bg-emerald-500/10 px-2 py-0.5 rounded border border-emerald-500/20">
                  Loaded
                </span>
              )}
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1.5">
                Suno Song ID or URL
              </label>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={songInput}
                  onChange={(e) => setSongInput(e.target.value)}
                  placeholder="Paste UUID or suno.com/song/... URL"
                  className="flex-1 bg-slate-950 border border-[var(--app-panel-border)] rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-600 focus:outline-none focus:ring-1 focus:ring-pink-500"
                />
                <button
                  onClick={() => handleLoadSong(cleanSongId)}
                  disabled={isLoadingSong || !cleanSongId}
                  className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-bold transition-all disabled:opacity-50"
                >
                  {isLoadingSong ? 'Fetching...' : 'Fetch'}
                </button>
              </div>
              {loadError && <p className="text-xs text-yellow-500/80 mt-2">{loadError}</p>}
            </div>

            {songClip && (
              <div className="bg-slate-950/70 border border-white/5 rounded-lg p-3 flex gap-3 items-center">
                {songClip.imageUrl ? (
                  <img src={songClip.imageUrl} alt="" className="w-12 h-12 rounded object-cover flex-shrink-0" />
                ) : (
                  <div className="w-12 h-12 rounded bg-slate-800 flex items-center justify-center flex-shrink-0 text-slate-500">
                    🎵
                  </div>
                )}
                <div className="min-w-0 flex-1">
                  <div className="text-sm font-bold text-white truncate">{songClip.title || 'Untitled'}</div>
                  <div className="text-xs text-slate-400 truncate">Model: {songClip.model_name || 'chirp'}</div>
                </div>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Title Prefix</label>
                <input
                  type="text"
                  value={prefix}
                  onChange={(e) => setPrefix(e.target.value)}
                  placeholder="e.g. RFR"
                  className="w-full bg-slate-950 border border-[var(--app-panel-border)] rounded-lg px-3 py-1.5 text-xs text-white font-mono uppercase"
                />
              </div>

              <div>
                <label className="block text-xs font-medium text-slate-400 mb-1">Model</label>
                <select
                  value={model}
                  onChange={(e) => setModel(e.target.value)}
                  className="w-full bg-slate-950 border border-[var(--app-panel-border)] rounded-lg px-2 py-1.5 text-xs text-white"
                >
                  {SUNO_MODEL_MAPPINGS.map((m) => (
                    <option key={m.value} value={m.value}>
                      {m.label} ({m.value})
                    </option>
                  ))}
                </select>
              </div>
            </div>
          </div>

          {/* 2. Slider Dimensions Selection Card */}
          <div className="bg-[var(--app-panel)] border border-[var(--app-panel-border)] rounded-xl p-5 space-y-4">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-500"></span>
              2. Slider Test Grid Dimensions
            </h2>

            {/* Variety Slider */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-medium text-slate-300">
                  Variety (<span className="text-pink-400 font-mono">v</span> / aug_creativity)
                </label>
                <span className="text-[11px] text-slate-500">
                  {selectedVarieties.map((v) => formatVarietyName(v)).join(', ')}
                </span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {([0, 1, 2, 3, 4] as VarietyLevel[]).map((v) => {
                  const active = selectedVarieties.includes(v);
                  return (
                    <button
                      key={v}
                      type="button"
                      onClick={() => toggleVariety(v)}
                      className={`py-1.5 px-2 rounded text-xs font-bold transition-all text-center border ${
                        active
                          ? 'bg-pink-600/30 border-pink-500 text-pink-300'
                          : 'bg-slate-950/60 border-white/5 text-slate-400 hover:text-white'
                      }`}
                    >
                      {formatVarietyName(v)} ({v})
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Audio Influence Slider */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-medium text-slate-300">
                  Audio Influence (<span className="text-purple-400 font-mono">ai</span> / audio_weight)
                </label>
                <span className="text-[11px] text-slate-500">{selectedAi.map((n) => `${n}%`).join(', ')}</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {[0, 25, 50, 75, 100].map((val) => {
                  const active = selectedAi.includes(val);
                  return (
                    <button
                      key={val}
                      type="button"
                      onClick={() => toggleAi(val)}
                      className={`py-1.5 px-2 rounded text-xs font-bold transition-all text-center border ${
                        active
                          ? 'bg-purple-600/30 border-purple-500 text-purple-300'
                          : 'bg-slate-950/60 border-white/5 text-slate-400 hover:text-white'
                      }`}
                    >
                      {val}%
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Style Influence */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-medium text-slate-300">
                  Style Influence (<span className="text-blue-400 font-mono">si</span> / style_weight)
                </label>
                <span className="text-[11px] text-slate-500">{selectedSi.map((n) => `${n}%`).join(', ')}</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {[0, 25, 50, 75, 100].map((val) => {
                  const active = selectedSi.includes(val);
                  return (
                    <button
                      key={val}
                      type="button"
                      onClick={() => toggleSi(val)}
                      className={`py-1.5 px-2 rounded text-xs font-bold transition-all text-center border ${
                        active
                          ? 'bg-blue-600/30 border-blue-500 text-blue-300'
                          : 'bg-slate-950/60 border-white/5 text-slate-400 hover:text-white'
                      }`}
                    >
                      {val}%
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Weirdness */}
            <div>
              <div className="flex justify-between items-center mb-1.5">
                <label className="text-xs font-medium text-slate-300">
                  Weirdness (<span className="text-emerald-400 font-mono">w</span> / weirdness_constraint)
                </label>
                <span className="text-[11px] text-slate-500">{selectedW.map((n) => `${n}%`).join(', ')}</span>
              </div>
              <div className="grid grid-cols-5 gap-1.5">
                {[0, 25, 50, 75, 100].map((val) => {
                  const active = selectedW.includes(val);
                  return (
                    <button
                      key={val}
                      type="button"
                      onClick={() => toggleW(val)}
                      className={`py-1.5 px-2 rounded text-xs font-bold transition-all text-center border ${
                        active
                          ? 'bg-emerald-600/30 border-emerald-500 text-emerald-300'
                          : 'bg-slate-950/60 border-white/5 text-slate-400 hover:text-white'
                      }`}
                    >
                      {val}%
                    </button>
                  );
                })}
              </div>
            </div>

            {/* Max Mode */}
            <div>
              <label className="block text-xs font-medium text-slate-300 mb-1.5">
                Max Mode (<span className="text-amber-400 font-mono">maxOn / maxOff</span>)
              </label>
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedMax([false])}
                  className={`py-1.5 px-2 rounded text-xs font-bold border transition-all ${
                    selectedMax.length === 1 && !selectedMax[0]
                      ? 'bg-amber-600/30 border-amber-500 text-amber-300'
                      : 'bg-slate-950/60 border-white/5 text-slate-400'
                  }`}
                >
                  Max Off (Default)
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedMax([true])}
                  className={`py-1.5 px-2 rounded text-xs font-bold border transition-all ${
                    selectedMax.length === 1 && selectedMax[0]
                      ? 'bg-amber-600/30 border-amber-500 text-amber-300'
                      : 'bg-slate-950/60 border-white/5 text-slate-400'
                  }`}
                >
                  Max On
                </button>
                <button
                  type="button"
                  onClick={() => setSelectedMax([false, true])}
                  className={`py-1.5 px-2 rounded text-xs font-bold border transition-all ${
                    selectedMax.length === 2
                      ? 'bg-amber-600/30 border-amber-500 text-amber-300'
                      : 'bg-slate-950/60 border-white/5 text-slate-400'
                  }`}
                >
                  Test Both
                </button>
              </div>
            </div>
          </div>

          {/* 3. Optional Prompt & Pacing Settings */}
          <div className="bg-[var(--app-panel)] border border-[var(--app-panel-border)] rounded-xl p-5 space-y-3">
            <h2 className="text-sm font-bold text-white uppercase tracking-wider flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-teal-500"></span>
              3. Style & Pacing
            </h2>

            <div>
              <label className="block text-xs font-medium text-slate-400 mb-1">Style Tags (Prompt)</label>
              <textarea
                value={tags}
                onChange={(e) => setTags(e.target.value)}
                placeholder="Leave blank to use original song tags, or enter cover style description..."
                className="w-full h-16 bg-slate-950 border border-[var(--app-panel-border)] rounded-lg p-2.5 text-xs text-slate-300 custom-scrollbar resize-none focus:outline-none focus:ring-1 focus:ring-pink-500"
              />
            </div>

            <div className="flex items-center justify-between pt-1">
              <label className="text-xs text-slate-400">Pacing Delay between calls:</label>
              <div className="flex items-center gap-2">
                <input
                  type="number"
                  min={2}
                  max={60}
                  value={delaySec}
                  onChange={(e) => setDelaySec(Math.max(2, parseInt(e.target.value, 10) || 8))}
                  className="w-16 bg-slate-950 border border-[var(--app-panel-border)] rounded px-2 py-1 text-xs text-white text-right font-mono"
                />
                <span className="text-xs text-slate-500">sec</span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Execution Dashboard & Live Matrix (7 cols) */}
        <div className="lg:col-span-7 space-y-6">
          {/* Summary & Run Card */}
          <div className="bg-[var(--app-panel)] border border-[var(--app-panel-border)] rounded-xl p-5 shadow-lg space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 border-b border-[var(--app-panel-border)] pb-4">
              <div>
                <h3 className="text-base font-bold text-white">Execution Plan</h3>
                <p className="text-xs text-slate-400 mt-0.5">
                  Calculated Cartesian product of selected slider coordinates
                </p>
              </div>

              <div className="flex items-center gap-2">
                {!isRunning ? (
                  <button
                    onClick={handleStartRun}
                    disabled={totalRuns === 0}
                    className="px-5 py-2.5 bg-gradient-to-r from-pink-600 to-purple-600 hover:from-pink-500 hover:to-purple-500 text-white rounded-xl text-sm font-bold shadow-lg shadow-pink-500/20 transition-all flex items-center gap-2 disabled:opacity-50"
                  >
                    <span>▶</span> Start Automated Run ({totalRuns})
                  </button>
                ) : (
                  <div className="flex gap-2">
                    <button
                      onClick={handlePauseToggle}
                      className="px-4 py-2 bg-amber-600 hover:bg-amber-500 text-white rounded-xl text-xs font-bold transition-all"
                    >
                      {isPaused ? '▶ Resume' : '⏸ Pause'}
                    </button>
                    <button
                      onClick={handleStop}
                      className="px-4 py-2 bg-red-600 hover:bg-red-500 text-white rounded-xl text-xs font-bold transition-all"
                    >
                      ⏹ Stop
                    </button>
                  </div>
                )}
              </div>
            </div>

            {/* Key Metrics */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-slate-950/60 p-3 rounded-lg border border-white/5">
                <span className="text-[11px] text-slate-500 uppercase font-semibold">Generations</span>
                <div className="text-xl font-bold text-white mt-1">{totalRuns}</div>
                <span className="text-[10px] text-slate-400">{totalRuns * 2} songs</span>
              </div>
              <div className="bg-slate-950/60 p-3 rounded-lg border border-white/5">
                <span className="text-[11px] text-slate-500 uppercase font-semibold">Est. Credits</span>
                <div className="text-xl font-bold text-purple-400 mt-1">{estimatedCredits}</div>
                <span className="text-[10px] text-slate-400">10 / generation</span>
              </div>
              <div className="bg-slate-950/60 p-3 rounded-lg border border-white/5">
                <span className="text-[11px] text-slate-500 uppercase font-semibold">Est. Time</span>
                <div className="text-xl font-bold text-blue-400 mt-1">~{estimatedMinutes}m</div>
                <span className="text-[10px] text-slate-400">{delaySec}s pacing</span>
              </div>
              <div className="bg-slate-950/60 p-3 rounded-lg border border-white/5">
                <span className="text-[11px] text-slate-500 uppercase font-semibold">Progress</span>
                <div className="text-xl font-bold text-emerald-400 mt-1">
                  {completedCount}/{totalRuns}
                </div>
                <span className="text-[10px] text-red-400">{failedCount > 0 ? `${failedCount} failed` : '0 errors'}</span>
              </div>
            </div>

            {statusMessage && (
              <div className="bg-slate-950 border border-white/10 rounded-lg p-3 text-xs font-mono text-slate-300 flex items-center justify-between">
                <span>{statusMessage}</span>
                {isRunning && <span className="animate-spin text-pink-400">⟳</span>}
              </div>
            )}
          </div>

          {/* Matrix Items Table */}
          <div className="bg-[var(--app-panel)] border border-[var(--app-panel-border)] rounded-xl overflow-hidden shadow-lg flex flex-col">
            <div className="p-4 border-b border-[var(--app-panel-border)] flex items-center justify-between bg-slate-950/40">
              <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                Matrix Combinations ({totalRuns})
              </h4>
              <span className="text-[11px] text-slate-500 font-mono">Format: {prefix}-v*-ai*-si*-w*-max*</span>
            </div>

            <div className="max-h-[500px] overflow-y-auto custom-scrollbar">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-950 text-slate-400 border-b border-[var(--app-panel-border)] sticky top-0 z-10">
                  <tr>
                    <th className="py-2.5 px-3 w-10">#</th>
                    <th className="py-2.5 px-3">Title</th>
                    <th className="py-2.5 px-2 text-center">Variety</th>
                    <th className="py-2.5 px-2 text-center">AI</th>
                    <th className="py-2.5 px-2 text-center">SI</th>
                    <th className="py-2.5 px-2 text-center">W</th>
                    <th className="py-2.5 px-2 text-center">Max</th>
                    <th className="py-2.5 px-3 text-right">Status</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--app-panel-border)]/50">
                  {matrixItems.map((item, idx) => {
                    return (
                      <tr key={item.id} className="hover:bg-white/[0.02] transition-colors">
                        <td className="py-2 px-3 text-slate-500 font-mono">{idx + 1}</td>
                        <td className="py-2 px-3 font-mono text-slate-200 truncate max-w-[240px]">
                          {item.title}
                        </td>
                        <td className="py-2 px-2 text-center text-pink-400 font-semibold">
                          {formatVarietyName(item.variety)}
                        </td>
                        <td className="py-2 px-2 text-center text-purple-400">{item.audioInfluence}%</td>
                        <td className="py-2 px-2 text-center text-blue-400">{item.styleInfluence}%</td>
                        <td className="py-2 px-2 text-center text-emerald-400">{item.weirdness}%</td>
                        <td className="py-2 px-2 text-center text-amber-400">
                          {item.isMaxMode ? 'on' : 'off'}
                        </td>
                        <td className="py-2 px-3 text-right">
                          {item.status === 'completed' && (
                            <span className="text-emerald-400 font-semibold">✓ Done</span>
                          )}
                          {item.status === 'running' && (
                            <span className="text-pink-400 animate-pulse font-semibold">Running...</span>
                          )}
                          {item.status === 'failed' && (
                            <span className="text-red-400 font-semibold" title={item.error}>
                              ✗ Failed
                            </span>
                          )}
                          {item.status === 'pending' && <span className="text-slate-600">Pending</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>

          {/* CLI Script Helper */}
          <div className="bg-slate-950/60 border border-[var(--app-panel-border)] rounded-xl p-4">
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs font-bold text-slate-400 uppercase tracking-wider">
                Run from CLI Terminal
              </span>
              <button
                onClick={() => {
                  navigator.clipboard.writeText(cliCommand);
                  alert('Copied CLI command to clipboard!');
                }}
                className="text-xs text-pink-400 hover:text-pink-300 transition-colors"
              >
                Copy Command
              </button>
            </div>
            <div className="bg-black/60 p-2.5 rounded-lg border border-white/5 font-mono text-[11px] text-slate-300 overflow-x-auto">
              {cliCommand}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};

export default CoverMatrixSection;
