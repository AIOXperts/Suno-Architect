import React, { useEffect, useRef, useState } from 'react';
import { MasteringSettings } from '../services/offlineDb';
import { decodeAudioBlobToBuffer } from '../services/mastering/nativeMasteringPipeline';
import { RealtimeMasteringProcessor } from '../services/mastering/realtimeMasteringProcessor';

interface Props {
  sourceBlob: Blob | null;
  sourceFileName: string;
  settings: MasteringSettings;
  onStatusChange?: (summary: NativePreviewStatusSummary) => void;
}

type PlaybackState = 'idle' | 'rendering' | 'ready' | 'playing' | 'paused' | 'error';

export interface NativePreviewStatusSummary {
  status: PlaybackState;
  statusMessage: string;
  hasSource: boolean;
  hasPreview: boolean;
  renderProgress: number | null;
}

type WorkletMeterMessage = {
  type: 'meter';
  lufs: number;
  rmsDb: number;
  truePeakDb?: number;
  shortTermLufs?: number;
};

type ProcessingNode = AudioWorkletNode | ScriptProcessorNode;

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value));
}

function formatTime(value: number) {
  if (!Number.isFinite(value)) return '0:00';
  const total = Math.max(0, Math.floor(value));
  const m = Math.floor(total / 60);
  const s = total % 60;
  return `${m}:${String(s).padStart(2, '0')}`;
}

function getPeakDbFromFloatTimeDomain(data: Float32Array) {
  let peak = 0;
  for (let i = 0; i < data.length; i++) peak = Math.max(peak, Math.abs(data[i]));
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

function getRmsDbFromBuffer(buffer: AudioBuffer) {
  const channels = Math.min(2, buffer.numberOfChannels);
  if (!channels) return -Infinity;
  const length = buffer.length;
  let sum = 0;
  for (let ch = 0; ch < channels; ch++) {
    const data = buffer.getChannelData(ch);
    for (let i = 0; i < length; i++) sum += data[i] * data[i];
  }
  const rms = Math.sqrt(sum / (length * channels));
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
}

function estimateTruePeakDb(dataL: Float32Array, dataR: Float32Array) {
  let peak = 0;
  const scan = (data: Float32Array) => {
    for (let i = 0; i < data.length; i++) {
      peak = Math.max(peak, Math.abs(data[i]));
      if (i < data.length - 1) {
        const a = data[i];
        const b = data[i + 1];
        peak = Math.max(
          peak,
          Math.abs(a + (b - a) * 0.25),
          Math.abs(a + (b - a) * 0.5),
          Math.abs(a + (b - a) * 0.75)
        );
      }
    }
  };
  scan(dataL);
  scan(dataR);
  return peak > 0 ? 20 * Math.log10(peak) : -Infinity;
}

interface PreviewGraph {
  dryGain: GainNode;
  wetGain: GainNode;
  previewGain: GainNode;
  analyserSplitter: ChannelSplitterNode;
  analyserL: AnalyserNode;
  analyserR: AnalyserNode;
}

const workletModuleUrl = new URL('../services/mastering/realtimeMasteringWorklet.js', import.meta.url).href;

const WebAudioMasterNativePreview: React.FC<Props> = ({ sourceBlob, sourceFileName, settings, onStatusChange }) => {
  const [status, setStatus] = useState<PlaybackState>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [renderProgress, setRenderProgress] = useState<number | null>(null);
  const [originalBuffer, setOriginalBuffer] = useState<AudioBuffer | null>(null);
  const [bypassFx, setBypassFx] = useState(false);
  const [levelMatchEnabled, setLevelMatchEnabled] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [renderedLufs, setRenderedLufs] = useState<number | null>(null);
  const [rmsDbOriginal, setRmsDbOriginal] = useState<number | null>(null);
  const [previewRmsDb, setPreviewRmsDb] = useState<number | null>(null);
  const [meterL, setMeterL] = useState<number>(-Infinity);
  const [meterR, setMeterR] = useState<number>(-Infinity);
  const [peakHoldL, setPeakHoldL] = useState<number>(-Infinity);
  const [peakHoldR, setPeakHoldR] = useState<number>(-Infinity);
  const [truePeakDb, setTruePeakDb] = useState<number>(-Infinity);
  const [truePeakHoldDb, setTruePeakHoldDb] = useState<number>(-Infinity);
  const [isOverloaded, setIsOverloaded] = useState(false);
  const [showSpectrum, setShowSpectrum] = useState(true);
  const [shortTermLufs, setShortTermLufs] = useState<number | null>(null);
  const [correlation, setCorrelation] = useState<number>(1);

  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const waveformStaticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const meterCanvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const graphRef = useRef<PreviewGraph | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const workletNodeRef = useRef<AudioWorkletNode | null>(null);
  const scriptProcessorRef = useRef<ScriptProcessorNode | null>(null);
  const fallbackProcessorRef = useRef<RealtimeMasteringProcessor | null>(null);
  const workletLoadedRef = useRef(false);
  const usingWorkletRef = useRef(false);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef(0);
  const pauseTimeRef = useRef(0);
  const transportSeqRef = useRef(0);
  const loadSeqRef = useRef(0);
  const isPlayingRef = useRef(false);
  const durationRef = useRef(0);
  const currentTimeRef = useRef(0);
  const peakHoldLRef = useRef<number>(-Infinity);
  const peakHoldRRef = useRef<number>(-Infinity);
  const truePeakHoldDbRef = useRef<number>(-Infinity);
  const isOverloadedRef = useRef(false);
  const showSpectrumRef = useRef(true);

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { durationRef.current = duration; }, [duration]);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { peakHoldLRef.current = peakHoldL; }, [peakHoldL]);
  useEffect(() => { peakHoldRRef.current = peakHoldR; }, [peakHoldR]);
  useEffect(() => { truePeakHoldDbRef.current = truePeakHoldDb; }, [truePeakHoldDb]);
  useEffect(() => { isOverloadedRef.current = isOverloaded; }, [isOverloaded]);
  useEffect(() => { showSpectrumRef.current = showSpectrum; }, [showSpectrum]);

  const resetMeters = () => {
    setMeterL(-Infinity);
    setMeterR(-Infinity);
    setPeakHoldL(-Infinity);
    setPeakHoldR(-Infinity);
    setTruePeakDb(-Infinity);
    setTruePeakHoldDb(-Infinity);
    setIsOverloaded(false);
    peakHoldLRef.current = -Infinity;
    peakHoldRRef.current = -Infinity;
    truePeakHoldDbRef.current = -Infinity;
    isOverloadedRef.current = false;
  };

  const applyPreviewGain = () => {
    const ctx = audioCtxRef.current;
    const graph = graphRef.current;
    if (!ctx || !graph) return;
    const sourceRms = rmsDbOriginal;
    const wetRms = previewRmsDb;
    const deltaDb =
      levelMatchEnabled && !bypassFx && sourceRms != null && wetRms != null
        ? clamp(sourceRms - wetRms, -6, 6)
        : 0;
    const now = ctx.currentTime;
    graph.previewGain.gain.cancelScheduledValues(now);
    graph.previewGain.gain.setTargetAtTime(Math.pow(10, deltaDb / 20), now, 0.02);
  };

  const applyWetDry = () => {
    const ctx = audioCtxRef.current;
    const graph = graphRef.current;
    const worklet = workletNodeRef.current;
    const fallback = fallbackProcessorRef.current;
    if (!ctx || !graph) return;
    const now = ctx.currentTime;
    graph.dryGain.gain.cancelScheduledValues(now);
    graph.wetGain.gain.cancelScheduledValues(now);
    graph.dryGain.gain.setTargetAtTime(bypassFx ? 1 : 0, now, 0.01);
    graph.wetGain.gain.setTargetAtTime(bypassFx ? 0 : 1, now, 0.01);
    worklet?.port.postMessage({ type: 'settings', settings });
    fallback?.setSettings(settings);
    applyPreviewGain();
  };

  const ensureAudioGraph = async () => {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!audioCtxRef.current) {
      const ctx = new AudioContextCtor();
      try {
        usingWorkletRef.current = !!ctx.audioWorklet?.addModule;
        if (usingWorkletRef.current && !workletLoadedRef.current) {
          await ctx.audioWorklet.addModule(workletModuleUrl);
          workletLoadedRef.current = true;
        }

        const dryGain = ctx.createGain();
        const wetGain = ctx.createGain();
        const previewGain = ctx.createGain();
        const analyserSplitter = ctx.createChannelSplitter(2);
        const analyserL = ctx.createAnalyser();
        const analyserR = ctx.createAnalyser();
        analyserL.fftSize = 2048;
        analyserR.fftSize = 2048;

        dryGain.connect(previewGain);
        wetGain.connect(previewGain);
        previewGain.connect(analyserSplitter);
        analyserSplitter.connect(analyserL, 0);
        analyserSplitter.connect(analyserR, 1);
        previewGain.connect(ctx.destination);

        graphRef.current = {
          dryGain,
          wetGain,
          previewGain,
          analyserSplitter,
          analyserL,
          analyserR,
        };
        audioCtxRef.current = ctx;
      } catch (error) {
        workletLoadedRef.current = false;
        usingWorkletRef.current = false;
        await ctx.close().catch(() => {});
        throw error;
      }
    }

    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  const disposeAudioGraph = () => {
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    graphRef.current = null;
    sourceNodeRef.current = null;
    workletNodeRef.current = null;
    scriptProcessorRef.current = null;
    fallbackProcessorRef.current = null;
    workletLoadedRef.current = false;
    usingWorkletRef.current = false;
    if (ctx && ctx.state !== 'closed') {
      void ctx.close().catch(() => {});
    }
  };

  const stopPlayback = () => {
    transportSeqRef.current += 1;
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch {}
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    if (workletNodeRef.current) {
      workletNodeRef.current.port.onmessage = null;
      workletNodeRef.current.disconnect();
      workletNodeRef.current = null;
    }
    if (scriptProcessorRef.current) {
      scriptProcessorRef.current.onaudioprocess = null;
      scriptProcessorRef.current.disconnect();
      scriptProcessorRef.current = null;
    }
    fallbackProcessorRef.current = null;
    setIsPlaying(false);
    isPlayingRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const tickMeters = () => {
    const ctx = audioCtxRef.current;
    const graph = graphRef.current;
    if (!ctx || !graph) return;

    const dataL = new Float32Array(graph.analyserL.fftSize);
    const dataR = new Float32Array(graph.analyserR.fftSize);
    graph.analyserL.getFloatTimeDomainData(dataL);
    graph.analyserR.getFloatTimeDomainData(dataR);
    // Stereo phase correlation: +1 = in-phase/mono-compatible, 0 = uncorrelated, -1 = out-of-phase.
    let sumLR = 0;
    let sumLL = 0;
    let sumRR = 0;
    for (let i = 0; i < dataL.length; i++) {
      sumLR += dataL[i] * dataR[i];
      sumLL += dataL[i] * dataL[i];
      sumRR += dataR[i] * dataR[i];
    }
    const nextCorrelation = sumLL === 0 || sumRR === 0 ? 0 : sumLR / Math.sqrt(sumLL * sumRR);
    setCorrelation(Number.isFinite(nextCorrelation) ? nextCorrelation : 0);
    const nextMeterL = getPeakDbFromFloatTimeDomain(dataL);
    const nextMeterR = getPeakDbFromFloatTimeDomain(dataR);
    const nextTruePeak = estimateTruePeakDb(dataL, dataR);
    const nextPeakHoldL = Math.max(peakHoldLRef.current - 0.15, nextMeterL);
    const nextPeakHoldR = Math.max(peakHoldRRef.current - 0.15, nextMeterR);
    const nextTruePeakHold = Math.max(truePeakHoldDbRef.current - 0.15, nextTruePeak);
    const nextOverloaded = nextTruePeak >= -0.1 || nextMeterL >= -0.1 || nextMeterR >= -0.1;

    peakHoldLRef.current = nextPeakHoldL;
    peakHoldRRef.current = nextPeakHoldR;
    truePeakHoldDbRef.current = nextTruePeakHold;
    isOverloadedRef.current = nextOverloaded;

    setMeterL(nextMeterL);
    setMeterR(nextMeterR);
    setPeakHoldL(nextPeakHoldL);
    setPeakHoldR(nextPeakHoldR);
    setTruePeakDb(nextTruePeak);
    setTruePeakHoldDb(nextTruePeakHold);
    setIsOverloaded(nextOverloaded);

    if (isPlayingRef.current) {
      const nextTime = Math.min(durationRef.current, Math.max(0, ctx.currentTime - startTimeRef.current));
      currentTimeRef.current = nextTime;
      pauseTimeRef.current = nextTime;
      setCurrentTime(nextTime);
    }

    const meterCanvas = meterCanvasRef.current;
    const meterCtx = meterCanvas?.getContext('2d');
    if (meterCanvas && meterCtx) {
      const w = meterCanvas.width;
      const h = meterCanvas.height;
      meterCtx.clearRect(0, 0, w, h);
      meterCtx.fillStyle = '#020617';
      meterCtx.fillRect(0, 0, w, h);
      const map = (db: number) => clamp((db + 48) / 48, 0, 1) * (w - 8);
      meterCtx.fillStyle = '#22c55e';
      meterCtx.fillRect(4, 6, map(nextMeterL), 10);
      meterCtx.fillStyle = '#38bdf8';
      meterCtx.fillRect(4, 22, map(nextMeterR), 10);
      meterCtx.fillStyle = '#f8fafc';
      meterCtx.fillRect(4 + map(nextPeakHoldL), 5, 2, 12);
      meterCtx.fillRect(4 + map(nextPeakHoldR), 21, 2, 12);
      if (nextOverloaded) {
        meterCtx.fillStyle = '#7f1d1d';
        meterCtx.fillRect(w - 64, 4, 56, h - 8);
        meterCtx.fillStyle = '#fecaca';
        meterCtx.font = 'bold 12px sans-serif';
        meterCtx.fillText('CLIP', w - 51, 26);
      }
    }

    const spectrumCanvas = spectrumCanvasRef.current;
    const spectrumCtx = spectrumCanvas?.getContext('2d');
    if (showSpectrumRef.current && spectrumCanvas && spectrumCtx) {
      const w = spectrumCanvas.width;
      const h = spectrumCanvas.height;
      spectrumCtx.fillStyle = '#020617';
      spectrumCtx.fillRect(0, 0, w, h);
      const freqL = new Uint8Array(graph.analyserL.frequencyBinCount);
      const freqR = new Uint8Array(graph.analyserR.frequencyBinCount);
      graph.analyserL.getByteFrequencyData(freqL);
      graph.analyserR.getByteFrequencyData(freqR);
      const bars = 96;
      const binStep = Math.max(1, Math.floor(freqL.length / bars));
      const barWidth = w / bars;
      for (let i = 0; i < bars; i++) {
        let sumL = 0;
        let sumR = 0;
        for (let j = 0; j < binStep; j++) {
          const idx = Math.min(freqL.length - 1, i * binStep + j);
          sumL += freqL[idx];
          sumR += freqR[idx];
        }
        const avg = ((sumL + sumR) / 2) / binStep;
        const normalized = avg / 255;
        const bh = Math.max(1, normalized * (h - 4));
        const x = i * barWidth;
        const hue = 180 - Math.round((i / bars) * 120);
        spectrumCtx.fillStyle = `hsla(${hue}, 90%, 60%, 0.95)`;
        spectrumCtx.fillRect(x + 1, h - bh - 2, Math.max(1, barWidth - 2), bh);
      }
    }

    if (isPlayingRef.current) {
      rafRef.current = requestAnimationFrame(tickMeters);
    }
  };

  const createWorkletNode = (ctx: AudioContext) => {
    const node = new AudioWorkletNode(ctx, 'realtime-mastering-processor', {
      numberOfInputs: 1,
      numberOfOutputs: 1,
      outputChannelCount: [2],
      channelCount: 2,
      channelCountMode: 'explicit',
      channelInterpretation: 'speakers',
      processorOptions: { settings },
    });
    node.port.onmessage = (event: MessageEvent<WorkletMeterMessage>) => {
      const data = event.data;
      if (data?.type !== 'meter') return;
      if (Number.isFinite(data.lufs)) setRenderedLufs(data.lufs);
      if (Number.isFinite(data.rmsDb)) setPreviewRmsDb(data.rmsDb);
      if (Number.isFinite(data.shortTermLufs)) setShortTermLufs(data.shortTermLufs);
    };
    return node;
  };

  const createFallbackProcessorNode = (ctx: AudioContext) => {
    const node = ctx.createScriptProcessor(1024, 2, 2);
    const processor = new RealtimeMasteringProcessor(ctx.sampleRate, settings, (data) => {
      setRenderedLufs(data.lufs);
      setPreviewRmsDb(data.rmsDb);
      setShortTermLufs(data.shortTermLufs);
    });
    fallbackProcessorRef.current = processor;
    node.onaudioprocess = (event) => {
      processor.process(event.inputBuffer, event.outputBuffer);
    };
    scriptProcessorRef.current = node;
    return node;
  };

  const playFrom = async (time: number) => {
    if (!originalBuffer) return false;

    stopPlayback();
    const ctx = await ensureAudioGraph();
    const graph = graphRef.current;
    if (!graph) return false;

    const requestId = transportSeqRef.current + 1;
    transportSeqRef.current = requestId;

    const source = ctx.createBufferSource();
    const processingNode: ProcessingNode = usingWorkletRef.current
      ? createWorkletNode(ctx)
      : createFallbackProcessorNode(ctx);
    if (processingNode instanceof AudioWorkletNode) {
      workletNodeRef.current = processingNode;
    } else {
      scriptProcessorRef.current = processingNode;
    }

    source.buffer = originalBuffer;
    source.connect(graph.dryGain);
    source.connect(processingNode);
    processingNode.connect(graph.wetGain);

    applyWetDry();

    source.onended = () => {
      if (sourceNodeRef.current !== source) return;
      sourceNodeRef.current = null;
      if (processingNode instanceof AudioWorkletNode && workletNodeRef.current === processingNode) {
        processingNode.port.onmessage = null;
        processingNode.disconnect();
        workletNodeRef.current = null;
      }
      if (!(processingNode instanceof AudioWorkletNode) && scriptProcessorRef.current === processingNode) {
        processingNode.onaudioprocess = null;
        processingNode.disconnect();
        scriptProcessorRef.current = null;
        fallbackProcessorRef.current = null;
      }
      setIsPlaying(false);
      isPlayingRef.current = false;
      pauseTimeRef.current = Math.min(originalBuffer.duration, Math.max(0, ctx.currentTime - startTimeRef.current));
      currentTimeRef.current = pauseTimeRef.current;
      setCurrentTime(pauseTimeRef.current);
      setStatus((s) => (s === 'error' ? s : 'ready'));
      setStatusMessage(usingWorkletRef.current ? 'Realtime mastering preview ready.' : 'Realtime mastering preview ready (fallback processor).');
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };

    sourceNodeRef.current = source;
    const startAt = Math.min(Math.max(0, time), Math.max(0, originalBuffer.duration - 0.01));
    startTimeRef.current = ctx.currentTime - startAt;
    pauseTimeRef.current = startAt;
    currentTimeRef.current = startAt;
    setCurrentTime(startAt);
    source.start(0, startAt);
    setIsPlaying(true);
    isPlayingRef.current = true;
    rafRef.current = requestAnimationFrame(tickMeters);
    return true;
  };

  useEffect(() => {
    return () => {
      stopPlayback();
      disposeAudioGraph();
    };
  }, []);

  useEffect(() => {
    if (!sourceBlob) {
      stopPlayback();
      disposeAudioGraph();
      setStatus('idle');
      setStatusMessage('');
      setOriginalBuffer(null);
      setDuration(0);
      setCurrentTime(0);
      setRenderedLufs(null);
      setRmsDbOriginal(null);
      setPreviewRmsDb(null);
      setShortTermLufs(null);
      setCorrelation(1);
      setRenderProgress(null);
      resetMeters();
      return;
    }

    const seq = ++loadSeqRef.current;
    stopPlayback();
    disposeAudioGraph();
    resetMeters();
    setStatus('rendering');
    setStatusMessage('Decoding source for dedicated realtime preview...');
    setRenderProgress(0.1);

    void decodeAudioBlobToBuffer(sourceBlob).then((decoded) => {
      if (loadSeqRef.current !== seq) return;
      setOriginalBuffer(decoded);
      setDuration(decoded.duration);
      setCurrentTime(0);
      setRenderedLufs(null);
      setPreviewRmsDb(null);
      setShortTermLufs(null);
      setCorrelation(1);
      setRmsDbOriginal(getRmsDbFromBuffer(decoded));
      setStatus('ready');
      setStatusMessage('Realtime mastering preview ready.');
      setRenderProgress(1);
      void ensureAudioGraph().catch((error) => {
        if (loadSeqRef.current !== seq) return;
        console.error('Realtime preview graph init failed:', error);
        setStatus('error');
        setStatusMessage(`Realtime preview graph failed to initialize: ${error instanceof Error ? error.message : String(error)}`);
      });
    }).catch((error) => {
      if (loadSeqRef.current !== seq) return;
      console.error('Realtime preview decode failed:', error);
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : String(error));
      setRenderProgress(null);
    });
  }, [sourceBlob]);

  useEffect(() => {
    if (!workletNodeRef.current) return;
    workletNodeRef.current.port.postMessage({ type: 'settings', settings });
  }, [settings]);

  useEffect(() => {
    fallbackProcessorRef.current?.setSettings(settings);
  }, [settings]);

  useEffect(() => {
    applyWetDry();
  }, [settings, bypassFx, levelMatchEnabled, previewRmsDb, rmsDbOriginal]);

  useEffect(() => {
    onStatusChange?.({
      status,
      statusMessage,
      hasSource: !!sourceBlob,
      hasPreview: !!originalBuffer,
      renderProgress,
    });
  }, [status, statusMessage, sourceBlob, originalBuffer, renderProgress, onStatusChange]);

  const renderWaveformToCanvas = (buffer: AudioBuffer, canvas: HTMLCanvasElement, color: string) => {
    const width = canvas.width;
    const height = canvas.height;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, width, height);

    const ch0 = buffer.getChannelData(0);
    const step = Math.max(1, Math.floor(ch0.length / width));
    const amp = height * 0.42;
    ctx.strokeStyle = color;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 0; x < width; x++) {
      let min = 1;
      let max = -1;
      const start = x * step;
      const end = Math.min(start + step, ch0.length);
      for (let i = start; i < end; i++) {
        const v = ch0[i];
        if (v < min) min = v;
        if (v > max) max = v;
      }
      ctx.moveTo(x + 0.5, height / 2 + min * amp);
      ctx.lineTo(x + 0.5, height / 2 + max * amp);
    }
    ctx.stroke();
  };

  useEffect(() => {
    if (!originalBuffer) return;
    const width = 960;
    const height = 180;
    let staticCanvas = waveformStaticCanvasRef.current;
    if (!staticCanvas) {
      staticCanvas = document.createElement('canvas');
      waveformStaticCanvasRef.current = staticCanvas;
    }
    staticCanvas.width = width;
    staticCanvas.height = height;
    renderWaveformToCanvas(originalBuffer, staticCanvas, bypassFx ? '#94a3b8' : '#34d399');
  }, [originalBuffer, bypassFx]);

  useEffect(() => {
    const canvas = waveformCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const width = canvas.width;
    const height = canvas.height;

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = '#030712';
    ctx.fillRect(0, 0, width, height);

    if (waveformStaticCanvasRef.current) {
      ctx.drawImage(waveformStaticCanvasRef.current, 0, 0);
    }

    const progressX = duration > 0 ? (currentTime / duration) * width : 0;
    ctx.strokeStyle = '#f8fafc';
    ctx.beginPath();
    ctx.moveTo(progressX, 0);
    ctx.lineTo(progressX, height);
    ctx.stroke();
  }, [currentTime, duration, originalBuffer, bypassFx]);

  const handlePlayPause = async () => {
    if (!originalBuffer) return;
    if (isPlaying) {
      const ctx = audioCtxRef.current;
      if (ctx) pauseTimeRef.current = Math.max(0, ctx.currentTime - startTimeRef.current);
      stopPlayback();
      setStatus((s) => (s === 'error' ? s : 'paused'));
      setStatusMessage('Realtime mastering preview paused.');
      return;
    }
    try {
      const started = await playFrom(pauseTimeRef.current || 0);
      if (started) {
        setStatus((s) => (s === 'error' ? s : 'playing'));
        setStatusMessage('Realtime mastering preview playing.');
      }
    } catch (error) {
      console.error('Realtime preview playback failed:', error);
      setStatus('error');
      setStatusMessage(`Realtime preview playback failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  };

  const handleStop = () => {
    pauseTimeRef.current = 0;
    currentTimeRef.current = 0;
    setCurrentTime(0);
    stopPlayback();
    setStatus((s) => (s === 'error' ? s : originalBuffer ? 'ready' : 'idle'));
    if (originalBuffer) {
      setStatusMessage('Realtime mastering preview ready.');
    }
  };

  const handleSeek = async (value: number) => {
    pauseTimeRef.current = value;
    currentTimeRef.current = value;
    setCurrentTime(value);
    if (isPlaying) {
      await playFrom(value);
    }
  };

  const statusTone =
    status === 'error'
      ? 'border-red-700/60 bg-red-950/30 text-red-200'
      : status === 'rendering'
        ? 'border-blue-700/60 bg-blue-950/30 text-blue-200'
        : status === 'ready' || status === 'playing' || status === 'paused'
          ? 'border-emerald-700/60 bg-emerald-950/20 text-emerald-200'
          : 'border-slate-700 bg-slate-900/40 text-slate-300';

  const statusLabel =
    status === 'rendering'
      ? 'Preparing Realtime Preview'
      : status === 'ready'
        ? 'Realtime Preview Ready'
        : status === 'playing'
          ? 'Realtime Preview Playing'
          : status === 'paused'
            ? 'Realtime Preview Paused'
            : status === 'error'
              ? 'Realtime Preview Error'
              : 'Awaiting Source';

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 space-y-3">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">Realtime Preview / Analysis</h3>
          <p className="text-sm text-slate-400">
            Dedicated realtime mastering processor for preview. Export still uses the full offline render path.
          </p>
        </div>
        <div className="flex items-center gap-2 text-xs">
          <button type="button" onClick={() => setShowSpectrum((v) => !v)} className={`px-3 py-1.5 rounded-lg border ${showSpectrum ? 'border-cyan-500 text-cyan-300' : 'border-slate-700 text-slate-300'}`}>{showSpectrum ? 'Spectrum On' : 'Spectrum Off'}</button>
          <button type="button" onClick={() => setBypassFx(false)} className={`px-3 py-1.5 rounded-lg border ${!bypassFx ? 'border-emerald-500 text-emerald-300' : 'border-slate-700 text-slate-300'}`}>FX On</button>
          <button type="button" onClick={() => setBypassFx(true)} className={`px-3 py-1.5 rounded-lg border ${bypassFx ? 'border-slate-300 text-white' : 'border-slate-700 text-slate-300'}`}>Bypass</button>
          <button type="button" onClick={() => setLevelMatchEnabled((v) => !v)} className={`px-3 py-1.5 rounded-lg border ${levelMatchEnabled ? 'border-violet-500 text-violet-300' : 'border-slate-700 text-slate-300'}`}>Lvl Match {levelMatchEnabled ? 'On' : 'Off'}</button>
        </div>
      </div>

      <div className={`rounded-lg border px-3 py-3 ${statusTone}`}>
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2">
          <div className="flex items-center gap-2">
            {status === 'rendering' && (
              <span className="inline-block h-3.5 w-3.5 rounded-full border-2 border-current border-t-transparent animate-spin" />
            )}
            <span className="text-sm font-semibold">{statusLabel}</span>
          </div>
          {typeof renderProgress === 'number' && status === 'rendering' && (
            <span className="text-xs tabular-nums">{Math.round(renderProgress * 100)}%</span>
          )}
        </div>
        <div className="mt-1 text-xs opacity-90">
          {statusMessage || (sourceBlob ? 'Preparing dedicated realtime mastering preview...' : 'Select or upload a source to build the realtime preview.')}
        </div>
        {typeof renderProgress === 'number' && status === 'rendering' && (
          <div className="mt-2 h-1.5 rounded-full bg-slate-900/70 overflow-hidden">
            <div className="h-full bg-gradient-to-r from-blue-400 to-cyan-300 transition-[width] duration-200" style={{ width: `${Math.max(2, Math.round(renderProgress * 100))}%` }} />
          </div>
        )}
      </div>

      <div className="text-xs text-slate-400 flex flex-wrap gap-4">
        <span>Source: {sourceFileName || 'No source selected'}</span>
        <span>Status: {statusMessage || status}</span>
        <span>Preview LUFS: {renderedLufs == null ? '--' : renderedLufs.toFixed(1)}</span>
        <span>Short-term LUFS: {shortTermLufs == null ? '--' : shortTermLufs.toFixed(1)}</span>
        <span className={correlation < -0.1 ? 'text-amber-300 font-medium' : 'text-slate-400'}>
          Correlation: {correlation.toFixed(2)}{correlation < -0.1 ? ' (phase warning)' : ''}
        </span>
        <span>Source RMS: {rmsDbOriginal == null ? '--' : `${rmsDbOriginal.toFixed(1)} dB`}</span>
        <span>Preview RMS: {previewRmsDb == null ? '--' : `${previewRmsDb.toFixed(1)} dB`}</span>
        <span>Preview Dur: {originalBuffer ? formatTime(originalBuffer.duration) : '--'}</span>
        <span>True Peak: {Number.isFinite(truePeakHoldDb) ? `${truePeakHoldDb.toFixed(1)} dBTP` : '--'}</span>
        <span className={isOverloaded ? 'text-red-300' : 'text-slate-400'}>{isOverloaded ? 'Overload Detected' : 'No Clip'}</span>
      </div>

      <div className="rounded-lg border border-slate-800 overflow-hidden bg-slate-950 relative">
        <canvas ref={waveformCanvasRef} width={960} height={180} className="w-full h-40 block" />
        {(status === 'rendering' || !originalBuffer) && (
          <div className="absolute inset-0 grid place-items-center bg-slate-950/70">
            <div className="text-center px-4">
              {status === 'rendering' ? (
                <>
                  <div className="mx-auto mb-2 h-5 w-5 rounded-full border-2 border-blue-300 border-t-transparent animate-spin" />
                  <div className="text-sm text-blue-200 font-medium">Decoding source for realtime mastering</div>
                </>
              ) : (
                <div className="text-sm text-slate-400">Waveform appears once a source is loaded.</div>
              )}
            </div>
          </div>
        )}
      </div>

      <div className="rounded-lg border border-slate-800 overflow-hidden bg-slate-950">
        <canvas ref={meterCanvasRef} width={960} height={38} className="w-full h-10 block" />
      </div>

      {showSpectrum && (
        <div className="rounded-lg border border-slate-800 overflow-hidden bg-slate-950">
          <canvas ref={spectrumCanvasRef} width={960} height={140} className="w-full h-28 block" />
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-[auto_auto_auto_1fr_auto] gap-2 items-center">
        <button type="button" onClick={handlePlayPause} disabled={!originalBuffer || status === 'rendering'} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 text-white text-sm">
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={handleStop} disabled={!originalBuffer} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 text-white text-sm">
          Stop
        </button>
        <div className="text-xs text-slate-300">
          {formatTime(currentTime)} / {formatTime(duration)}
        </div>
        <input
          type="range"
          min={0}
          max={duration || 0}
          step={0.01}
          value={Math.min(currentTime, duration || 0)}
          onChange={(e) => void handleSeek(Number(e.target.value))}
          disabled={!originalBuffer}
          className="w-full"
        />
        <div className="text-xs text-slate-400 whitespace-nowrap">
          L {Number.isFinite(meterL) ? meterL.toFixed(1) : '-∞'} dB (pk {Number.isFinite(peakHoldL) ? peakHoldL.toFixed(1) : '-∞'}) | R {Number.isFinite(meterR) ? meterR.toFixed(1) : '-∞'} dB (pk {Number.isFinite(peakHoldR) ? peakHoldR.toFixed(1) : '-∞'}) | TP {Number.isFinite(truePeakDb) ? truePeakDb.toFixed(1) : '-∞'} dBTP
        </div>
      </div>
    </div>
  );
};

export default WebAudioMasterNativePreview;
