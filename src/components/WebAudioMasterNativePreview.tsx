import React, { useEffect, useMemo, useRef, useState } from 'react';
import { MasteringSettings } from '../services/offlineDb';
import { renderNativePreviewBufferFromBlob } from '../services/mastering/nativeMasteringPipeline';

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

function getRmsDbFromFloatTimeDomain(data: Float32Array) {
  if (!data.length) return -Infinity;
  let sum = 0;
  for (let i = 0; i < data.length; i++) sum += data[i] * data[i];
  const rms = Math.sqrt(sum / data.length);
  return rms > 0 ? 20 * Math.log10(rms) : -Infinity;
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

const WebAudioMasterNativePreview: React.FC<Props> = ({ sourceBlob, sourceFileName, settings, onStatusChange }) => {
  const [status, setStatus] = useState<PlaybackState>('idle');
  const [statusMessage, setStatusMessage] = useState('');
  const [renderProgress, setRenderProgress] = useState<number | null>(null);
  const [originalBuffer, setOriginalBuffer] = useState<AudioBuffer | null>(null);
  const [processedBuffer, setProcessedBuffer] = useState<AudioBuffer | null>(null);
  const [bypassFx, setBypassFx] = useState(false);
  const [levelMatchEnabled, setLevelMatchEnabled] = useState(false);
  const [duration, setDuration] = useState(0);
  const [currentTime, setCurrentTime] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [renderedLufs, setRenderedLufs] = useState<number | null>(null);
  const [rmsDbOriginal, setRmsDbOriginal] = useState<number | null>(null);
  const [rmsDbProcessed, setRmsDbProcessed] = useState<number | null>(null);
  const [meterL, setMeterL] = useState<number>(-Infinity);
  const [meterR, setMeterR] = useState<number>(-Infinity);
  const [peakHoldL, setPeakHoldL] = useState<number>(-Infinity);
  const [peakHoldR, setPeakHoldR] = useState<number>(-Infinity);
  const [truePeakDb, setTruePeakDb] = useState<number>(-Infinity);
  const [truePeakHoldDb, setTruePeakHoldDb] = useState<number>(-Infinity);
  const [isOverloaded, setIsOverloaded] = useState(false);
  const [showSpectrum, setShowSpectrum] = useState(true);

  const waveformCanvasRef = useRef<HTMLCanvasElement>(null);
  const waveformStaticCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const waveformOriginalStaticRef = useRef<HTMLCanvasElement | null>(null);
  const meterCanvasRef = useRef<HTMLCanvasElement>(null);
  const spectrumCanvasRef = useRef<HTMLCanvasElement>(null);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const sourceNodeRef = useRef<AudioBufferSourceNode | null>(null);
  const analyserLRef = useRef<AnalyserNode | null>(null);
  const analyserRRef = useRef<AnalyserNode | null>(null);
  const gainRef = useRef<GainNode | null>(null);
  const splitterRef = useRef<ChannelSplitterNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const startTimeRef = useRef(0);
  const pauseTimeRef = useRef(0);
  const renderSeqRef = useRef(0);
  const transportSeqRef = useRef(0);
  const isPlayingRef = useRef(false);
  const durationRef = useRef(0);
  const currentTimeRef = useRef(0);
  const activeBufferRef = useRef<AudioBuffer | null>(null);
  const originalBufferRef = useRef<AudioBuffer | null>(null);
  const processedBufferRef = useRef<AudioBuffer | null>(null);
  const playbackBufferRef = useRef<AudioBuffer | null>(null);
  const peakHoldLRef = useRef<number>(-Infinity);
  const peakHoldRRef = useRef<number>(-Infinity);
  const truePeakHoldDbRef = useRef<number>(-Infinity);
  const isOverloadedRef = useRef(false);
  const showSpectrumRef = useRef(true);

  const activeBuffer = useMemo(
    () => (bypassFx ? originalBuffer : processedBuffer) ?? null,
    [bypassFx, processedBuffer, originalBuffer]
  );

  const getPreviewGainLinear = () => {
    if (!levelMatchEnabled || bypassFx || rmsDbOriginal == null || rmsDbProcessed == null) return 1;
    const deltaDb = Math.max(-6, Math.min(6, rmsDbOriginal - rmsDbProcessed));
    return Math.pow(10, deltaDb / 20);
  };

  const applyOutputGain = () => {
    const ctx = audioCtxRef.current;
    const gain = gainRef.current;
    if (!ctx || !gain) return;
    const now = ctx.currentTime;
    gain.gain.cancelScheduledValues(now);
    gain.gain.setValueAtTime(getPreviewGainLinear(), now);
  };

  useEffect(() => { isPlayingRef.current = isPlaying; }, [isPlaying]);
  useEffect(() => { durationRef.current = duration; }, [duration]);
  useEffect(() => { currentTimeRef.current = currentTime; }, [currentTime]);
  useEffect(() => { activeBufferRef.current = activeBuffer; }, [activeBuffer]);
  useEffect(() => { originalBufferRef.current = originalBuffer; }, [originalBuffer]);
  useEffect(() => { processedBufferRef.current = processedBuffer; }, [processedBuffer]);
  const decodedBufferRef = useRef<AudioBuffer | null>(null);
  const prevSourceBlobRef = useRef<Blob | null>(null);
  const lastSourceBlobRef = useRef<Blob | null>(null);

  useEffect(() => { peakHoldLRef.current = peakHoldL; }, [peakHoldL]);
  useEffect(() => { peakHoldRRef.current = peakHoldR; }, [peakHoldR]);
  useEffect(() => { truePeakHoldDbRef.current = truePeakHoldDb; }, [truePeakHoldDb]);
  useEffect(() => { isOverloadedRef.current = isOverloaded; }, [isOverloaded]);
  useEffect(() => { showSpectrumRef.current = showSpectrum; }, [showSpectrum]);

  useEffect(() => {
    return () => {
      if (rafRef.current) cancelAnimationFrame(rafRef.current);
      if (sourceNodeRef.current) {
        try { sourceNodeRef.current.stop(); } catch {}
      }
      if (audioCtxRef.current && audioCtxRef.current.state !== 'closed') {
        void audioCtxRef.current.close().catch(() => {});
      }
    };
  }, []);

  useEffect(() => {
    if (!sourceBlob) {
      setStatus('idle');
      setStatusMessage('');
      setOriginalBuffer(null);
      setProcessedBuffer(null);
      setDuration(0);
      setCurrentTime(0);
      setRenderedLufs(null);
      setRenderProgress(null);
      decodedBufferRef.current = null;
      return;
    }

    const seq = ++renderSeqRef.current;
    setStatus('rendering');
    setStatusMessage('Rendering native preview...');
    setRenderProgress(0.02);

    const sourceChanged = sourceBlob !== prevSourceBlobRef.current;
    if (sourceChanged) {
      decodedBufferRef.current = null;
    }
    prevSourceBlobRef.current = sourceBlob;

    const cachedDecoded = sourceChanged ? undefined : decodedBufferRef.current;
    const needsDecode = sourceChanged || !decodedBufferRef.current;

    if (needsDecode) {
      setStatusMessage('Decoding source for preview...');
      setRenderProgress(0.1);
    } else {
      setStatusMessage('Rendering preview DSP...');
      setRenderProgress(0.5);
    }

    void renderNativePreviewBufferFromBlob(sourceBlob, settings, (update) => {
      if (renderSeqRef.current !== seq) return;
      if (needsDecode) {
        setRenderProgress(Math.max(0.1, Math.min(0.5, update.progress)));
      } else {
        setRenderProgress(Math.max(0.5, Math.min(1, update.progress)));
      }
    }, cachedDecoded).then((result) => {
      if (renderSeqRef.current !== seq) return;
      setOriginalBuffer(result.originalBuffer);
      setProcessedBuffer(result.previewBuffer);
      setDuration(result.previewBuffer.duration || result.originalBuffer.duration);
      setCurrentTime(0);
      currentTimeRef.current = 0;
      pauseTimeRef.current = 0;
      setRenderedLufs(typeof result.measuredLufs === 'number' ? result.measuredLufs : null);
      setRmsDbOriginal(getRmsDbFromBuffer(result.originalBuffer));
      setRmsDbProcessed(getRmsDbFromBuffer(result.previewBuffer));
      if (result.decodedBuffer) {
        decodedBufferRef.current = result.decodedBuffer;
      }
      setStatus('ready');
      setStatusMessage('Native preview ready.');
      setRenderProgress(1);
    }).catch((error) => {
      if (renderSeqRef.current !== seq) return;
      console.error('Preview render failed:', error);
      setStatus('error');
      setStatusMessage(error instanceof Error ? error.message : String(error));
      setRenderProgress(null);
    });

    return () => {
      renderSeqRef.current++;
    };
  }, [sourceBlob, settings]);

  useEffect(() => {
    onStatusChange?.({
      status,
      statusMessage,
      hasSource: !!sourceBlob,
      hasPreview: !!processedBuffer,
      renderProgress,
    });
  }, [status, statusMessage, sourceBlob, processedBuffer, renderProgress, onStatusChange]);

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
    if (!processedBuffer) return;
    const width = 960;
    const height = 180;
    let staticCanvas = waveformStaticCanvasRef.current;
    if (!staticCanvas) {
      staticCanvas = document.createElement('canvas');
      staticCanvas.width = width;
      staticCanvas.height = height;
      waveformStaticCanvasRef.current = staticCanvas;
    }
    staticCanvas.width = width;
    staticCanvas.height = height;
    renderWaveformToCanvas(processedBuffer, staticCanvas, '#34d399');
  }, [processedBuffer]);

  useEffect(() => {
    if (!originalBuffer) return;
    const width = 960;
    const height = 180;
    let originalCanvas = waveformOriginalStaticRef.current;
    if (!originalCanvas) {
      originalCanvas = document.createElement('canvas');
      originalCanvas.width = width;
      originalCanvas.height = height;
      waveformOriginalStaticRef.current = originalCanvas;
    }
    originalCanvas.width = width;
    originalCanvas.height = height;
    renderWaveformToCanvas(originalBuffer, originalCanvas, '#94a3b8');
  }, [originalBuffer]);

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

    const sourceCanvas = bypassFx 
      ? waveformOriginalStaticRef.current 
      : waveformStaticCanvasRef.current;
    
    if (sourceCanvas) {
      ctx.drawImage(sourceCanvas, 0, 0);
    }
  }, [bypassFx]);

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
  }, [currentTime, duration, activeBuffer]);

  const ensureAudioGraph = async () => {
    const AudioContextCtor = window.AudioContext || (window as any).webkitAudioContext;
    if (!audioCtxRef.current) {
      const ctx = new AudioContextCtor();
      const gain = ctx.createGain();
      const splitter = ctx.createChannelSplitter(2);
      const analyserL = ctx.createAnalyser();
      const analyserR = ctx.createAnalyser();
      analyserL.fftSize = 2048;
      analyserR.fftSize = 2048;
      gain.connect(splitter);
      splitter.connect(analyserL, 0);
      splitter.connect(analyserR, 1);
      gain.connect(ctx.destination);
      audioCtxRef.current = ctx;
      gainRef.current = gain;
      splitterRef.current = splitter;
      analyserLRef.current = analyserL;
      analyserRRef.current = analyserR;
    }
    if (audioCtxRef.current.state === 'suspended') {
      await audioCtxRef.current.resume();
    }
    return audioCtxRef.current;
  };

  const stopPlayback = () => {
    transportSeqRef.current += 1;
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch {}
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    playbackBufferRef.current = null;
    setIsPlaying(false);
    isPlayingRef.current = false;
    if (rafRef.current) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
  };

  const disposeAudioGraph = () => {
    const ctx = audioCtxRef.current;
    audioCtxRef.current = null;
    sourceNodeRef.current = null;
    analyserLRef.current = null;
    analyserRRef.current = null;
    gainRef.current = null;
    splitterRef.current = null;
    if (ctx && ctx.state !== 'closed') {
      void ctx.close().catch(() => {});
    }
  };

  const tickMeters = () => {
    const ctx = audioCtxRef.current;
    const analyserL = analyserLRef.current;
    const analyserR = analyserRRef.current;
    if (!ctx || !analyserL || !analyserR) return;

    const dataL = new Float32Array(analyserL.fftSize);
    const dataR = new Float32Array(analyserR.fftSize);
    analyserL.getFloatTimeDomainData(dataL);
    analyserR.getFloatTimeDomainData(dataR);
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

    const canvas = meterCanvasRef.current;
    const c = canvas?.getContext('2d');
    if (canvas && c) {
      const w = canvas.width;
      const h = canvas.height;
      c.clearRect(0, 0, w, h);
      c.fillStyle = '#020617';
      c.fillRect(0, 0, w, h);
      const map = (db: number) => {
        const normalized = Math.max(0, Math.min(1, (db + 48) / 48));
        return normalized * (w - 8);
      };
      const leftW = map(nextMeterL);
      const rightW = map(nextMeterR);
      const leftHold = map(nextPeakHoldL);
      const rightHold = map(nextPeakHoldR);
      c.fillStyle = '#22c55e';
      c.fillRect(4, 6, leftW, 10);
      c.fillStyle = '#38bdf8';
      c.fillRect(4, 22, rightW, 10);
      c.fillStyle = '#f8fafc';
      c.fillRect(4 + leftHold, 5, 2, 12);
      c.fillRect(4 + rightHold, 21, 2, 12);
      if (nextOverloaded) {
        c.fillStyle = '#7f1d1d';
        c.fillRect(w - 64, 4, 56, h - 8);
        c.fillStyle = '#fecaca';
        c.font = 'bold 12px sans-serif';
        c.fillText('CLIP', w - 51, 26);
      }
    }

    const spectrumCanvas = spectrumCanvasRef.current;
    const sctx = spectrumCanvas?.getContext('2d');
    if (showSpectrumRef.current && spectrumCanvas && sctx) {
      const w = spectrumCanvas.width;
      const h = spectrumCanvas.height;
      sctx.fillStyle = '#020617';
      sctx.fillRect(0, 0, w, h);

      const freqL = new Uint8Array(analyserL.frequencyBinCount);
      const freqR = new Uint8Array(analyserR.frequencyBinCount);
      analyserL.getByteFrequencyData(freqL);
      analyserR.getByteFrequencyData(freqR);

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
        sctx.fillStyle = `hsla(${hue}, 90%, 60%, 0.95)`;
        sctx.fillRect(x + 1, h - bh - 2, Math.max(1, barWidth - 2), bh);
      }
    }

    if (isPlayingRef.current) {
      rafRef.current = requestAnimationFrame(tickMeters);
    }
  };

  const playFrom = async (time: number) => {
    const buffer = activeBuffer;
    if (!buffer) return false;

    const requestId = transportSeqRef.current + 1;
    stopPlayback();
    disposeAudioGraph();
    transportSeqRef.current = requestId;
    const ctx = await ensureAudioGraph();
    if (transportSeqRef.current !== requestId) return false;
    const source = ctx.createBufferSource();
    source.buffer = buffer;
    applyOutputGain();
    source.connect(gainRef.current!);
    source.onended = () => {
      if (sourceNodeRef.current !== source) return;
      sourceNodeRef.current = null;
      setIsPlaying(false);
      isPlayingRef.current = false;
      pauseTimeRef.current = Math.min(buffer.duration, Math.max(0, ctx.currentTime - startTimeRef.current));
      currentTimeRef.current = pauseTimeRef.current;
      setCurrentTime(pauseTimeRef.current);
      setStatus((s) => (s === 'error' ? s : 'ready'));
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    sourceNodeRef.current = source;
    playbackBufferRef.current = buffer;
    const startAt = Math.min(Math.max(0, time), Math.max(0, buffer.duration - 0.01));
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

  const handlePlayPause = async () => {
    if (!activeBuffer) return;
    if (isPlaying) {
      const ctx = audioCtxRef.current;
      if (ctx) pauseTimeRef.current = Math.max(0, ctx.currentTime - startTimeRef.current);
      stopPlayback();
      disposeAudioGraph();
      setStatus((s) => (s === 'error' ? s : 'paused'));
      return;
    }
    const started = await playFrom(pauseTimeRef.current || 0);
    if (started) {
      setStatus((s) => (s === 'error' ? s : 'playing'));
    }
  };

  const handleStop = () => {
    pauseTimeRef.current = 0;
    setCurrentTime(0);
    currentTimeRef.current = 0;
    stopPlayback();
    setStatus((s) => (s === 'error' ? s : activeBuffer ? 'ready' : 'idle'));
  };

  const handleSeek = async (value: number) => {
    pauseTimeRef.current = value;
    setCurrentTime(value);
    currentTimeRef.current = value;
    if (isPlaying) await playFrom(value);
  };

  useEffect(() => {
    stopPlayback();
    disposeAudioGraph();
    pauseTimeRef.current = 0;
    setCurrentTime(0);
    currentTimeRef.current = 0;
    setIsPlaying(false);
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
  }, [originalBuffer, processedBuffer]);

  useEffect(() => {
    applyOutputGain();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [levelMatchEnabled, rmsDbOriginal, rmsDbProcessed, bypassFx]);

  useEffect(() => {
    if (!isPlaying || !originalBuffer || !processedBuffer) return;
    const currentPosition = currentTimeRef.current || pauseTimeRef.current || 0;
    const requestId = transportSeqRef.current + 1;
    if (sourceNodeRef.current) {
      try { sourceNodeRef.current.stop(); } catch {}
      sourceNodeRef.current.disconnect();
      sourceNodeRef.current = null;
    }
    transportSeqRef.current = requestId;
    const ctx = audioCtxRef.current;
    if (!ctx) return;
    const source = ctx.createBufferSource();
    source.buffer = activeBuffer;
    applyOutputGain();
    source.connect(gainRef.current!);
    source.onended = () => {
      if (sourceNodeRef.current !== source) return;
      sourceNodeRef.current = null;
      setIsPlaying(false);
      isPlayingRef.current = false;
      pauseTimeRef.current = Math.min(activeBuffer.duration, Math.max(0, ctx.currentTime - startTimeRef.current));
      currentTimeRef.current = pauseTimeRef.current;
      setCurrentTime(pauseTimeRef.current);
      setStatus((s) => (s === 'error' ? s : 'ready'));
      if (rafRef.current) {
        cancelAnimationFrame(rafRef.current);
        rafRef.current = null;
      }
    };
    sourceNodeRef.current = source;
    playbackBufferRef.current = activeBuffer;
    const startAt = Math.min(Math.max(0, currentPosition), Math.max(0, activeBuffer.duration - 0.01));
    startTimeRef.current = ctx.currentTime - startAt;
    pauseTimeRef.current = startAt;
    currentTimeRef.current = startAt;
    setCurrentTime(startAt);
    source.start(0, startAt);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bypassFx]);

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
      ? 'Preparing Preview'
      : status === 'ready'
        ? 'Preview Ready'
        : status === 'playing'
          ? 'Preview Playing'
          : status === 'paused'
            ? 'Preview Paused'
            : status === 'error'
              ? 'Preview Error'
              : 'Awaiting Source';

  return (
    <div className="rounded-xl border border-slate-800 bg-slate-950/50 p-4 space-y-3">
      <div className="flex flex-col md:flex-row md:items-center md:justify-between gap-3">
        <div>
          <h3 className="text-lg font-semibold text-white">Native Preview / Analysis</h3>
          <p className="text-sm text-slate-400">
            React transport + waveform + meters + bypass/level-match using W-A-M worker preview render.
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
          {statusMessage || (sourceBlob ? 'Preparing preview analysis and playback buffer...' : 'Select or upload a source to build the native preview.')}
        </div>
        {typeof renderProgress === 'number' && status === 'rendering' && (
          <div className="mt-2 h-1.5 rounded-full bg-slate-900/70 overflow-hidden">
            <div
              className="h-full bg-gradient-to-r from-blue-400 to-cyan-300 transition-[width] duration-200"
              style={{ width: `${Math.max(2, Math.round(renderProgress * 100))}%` }}
            />
          </div>
        )}
      </div>

      <div className="text-xs text-slate-400 flex flex-wrap gap-4">
        <span>Source: {sourceFileName || 'No source selected'}</span>
        <span>Status: {statusMessage || status}</span>
        <span>LUFS: {renderedLufs == null ? '--' : renderedLufs.toFixed(1)}</span>
        <span>Src Dur: {originalBuffer ? formatTime(originalBuffer.duration) : '--'}</span>
        <span>Preview Dur: {processedBuffer ? formatTime(processedBuffer.duration) : '--'}</span>
        <span>True Peak: {Number.isFinite(truePeakHoldDb) ? `${truePeakHoldDb.toFixed(1)} dBTP` : '--'}</span>
        <span className={isOverloaded ? 'text-red-300' : 'text-slate-400'}>{isOverloaded ? 'Overload Detected' : 'No Clip'}</span>
      </div>

      <div className="rounded-lg border border-slate-800 overflow-hidden bg-slate-950 relative">
        <canvas ref={waveformCanvasRef} width={960} height={180} className="w-full h-40 block" />
        {(status === 'rendering' || !activeBuffer) && (
          <div className="absolute inset-0 grid place-items-center bg-slate-950/70">
            <div className="text-center px-4">
              {status === 'rendering' ? (
                <>
                  <div className="mx-auto mb-2 h-5 w-5 rounded-full border-2 border-blue-300 border-t-transparent animate-spin" />
                  <div className="text-sm text-blue-200 font-medium">Rendering preview waveform + analysis</div>
                </>
              ) : (
                <div className="text-sm text-slate-400">Waveform appears once a source is loaded and analyzed.</div>
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
        <button type="button" onClick={handlePlayPause} disabled={!activeBuffer || status === 'rendering'} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 text-white text-sm">
          {isPlaying ? 'Pause' : 'Play'}
        </button>
        <button type="button" onClick={handleStop} disabled={!activeBuffer} className="px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 disabled:bg-slate-900 text-white text-sm">
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
          disabled={!activeBuffer}
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
