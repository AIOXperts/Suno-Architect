import { MasteringSettings } from '../offlineDb';
import { encodeWavAsync } from './wavEncoder';

let worker: Worker | null = null;

function getWorker(): Worker {
  if (!worker) {
    worker = new Worker(new URL('./masteringWorker.ts', import.meta.url), { type: 'module' });
  }
  return worker;
}

export interface NativeMasteringProgress {
  phase: 'decode' | 'render' | 'encode';
  progress: number;
  message: string;
}

export interface NativeMasteringResult {
  blob: Blob;
  fileName: string;
  settingsForVariant: MasteringSettings;
}

export interface NativePreviewRenderResult {
  originalBuffer: AudioBuffer;
  previewBuffer: AudioBuffer;
  measuredLufs?: number;
  measuredTruePeak?: number;
  decodedBuffer?: AudioBuffer;
}

export function createDefaultMasteringSettings(): MasteringSettings {
  return {
    inputGain: 0,
    glueCompression: false,
    deharsh: true,
    cleanLowEnd: true,
    autoLevel: false,
    addPunch: true,
    stereoWidth: 100,
    centerBass: true,
    cutMud: false,
    addAir: true,
    tapeWarmth: true,
    normalizeLoudness: true,
    targetLufs: -14,
    truePeakLimit: true,
    ceiling: -1,
    sampleRate: 48000,
    bitDepth: 24,
    eq: {
      low: 0,
      lowMid: 0,
      mid: 0,
      highMid: 0,
      high: 0,
    },
  };
}

export async function decodeAudioBlobToBuffer(blob: Blob): Promise<AudioBuffer> {
  const ctx = new (window.AudioContext || (window as any).webkitAudioContext)();
  try {
    const arrayBuffer = await blob.arrayBuffer();
    const copy = arrayBuffer.slice(0);
    return await ctx.decodeAudioData(copy);
  } finally {
    await ctx.close();
  }
}

function createAudioBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
  const length = channels[0]?.length ?? 0;
  const audioBuffer = new AudioBuffer({
    numberOfChannels: channels.length,
    length,
    sampleRate,
  });
  channels.forEach((channel, index) => audioBuffer.copyToChannel(channel, index));
  return audioBuffer;
}

function cloneAudioBuffer(source: AudioBuffer): AudioBuffer {
  const channels: Float32Array[] = [];
  for (let i = 0; i < source.numberOfChannels; i++) {
    channels.push(source.getChannelData(i).slice());
  }
  return createAudioBuffer(channels, source.sampleRate);
}

/**
 * Resample an AudioBuffer to `targetRate` using the browser's high-quality
 * OfflineAudioContext resampler. Returns the same buffer if rates already match.
 * This makes the "Sample Rate" output setting (44.1 kHz vs 48 kHz) actually
 * take effect — previously it was ignored and the WAV was always written at
 * the source's native rate.
 */
async function resampleAudioBuffer(buffer: AudioBuffer, targetRate: number): Promise<AudioBuffer> {
  if (buffer.sampleRate === targetRate) return buffer;
  const targetLength = Math.max(1, Math.ceil(buffer.duration * targetRate));
  const ctx = new OfflineAudioContext(buffer.numberOfChannels, targetLength, targetRate);
  const src = ctx.createBufferSource();
  src.buffer = buffer;
  src.connect(ctx.destination);
  src.start();
  return await ctx.startRendering();
}

export async function renderNativeMasteredWavFromBlob(
  inputBlob: Blob,
  sourceFileName: string,
  settings: MasteringSettings,
  onProgress?: (update: NativeMasteringProgress) => void
): Promise<NativeMasteringResult> {
  onProgress?.({ phase: 'decode', progress: 0.1, message: 'Decoding source...' });
  const decoded = await decodeAudioBlobToBuffer(inputBlob);
  const targetRate = settings.sampleRate || decoded.sampleRate;
  const resampled = await resampleAudioBuffer(decoded, targetRate);
  const processingInput = cloneAudioBuffer(resampled);
  
  onProgress?.({ phase: 'render', progress: 0.3, message: 'Processing DSP chain...' });
  const result = await runMasteringWorker(processingInput, settings);
  
  onProgress?.({ phase: 'encode', progress: 0.8, message: 'Encoding WAV...' });
  const masteredBuffer = createAudioBuffer(result.channels, resampled.sampleRate);
  const wavBlob = await encodeWavAsync(masteredBuffer, resampled.sampleRate, (settings.bitDepth || 24) as 16 | 24);
  
  onProgress?.({ phase: 'encode', progress: 1.0, message: 'Done' });
  const fileName = sourceFileName.replace(/\.[^/.]+$/, "") + " (Mastered).wav";
  
  return { 
    blob: new Blob([wavBlob], { type: 'audio/wav' }), 
    fileName, 
    settingsForVariant: settings 
  };
}

export async function renderNativePreviewBufferFromBlob(
  inputBlob: Blob,
  settings: MasteringSettings,
  onProgress?: (update: NativeMasteringProgress) => void,
  cachedDecoded?: AudioBuffer
): Promise<NativePreviewRenderResult> {
  let decoded: AudioBuffer;
  if (cachedDecoded) {
    decoded = cachedDecoded;
  } else {
    onProgress?.({ phase: 'decode', progress: 0.1, message: 'Decoding source for preview...' });
    decoded = await decodeAudioBlobToBuffer(inputBlob);
  }
  const originalBuffer = cloneAudioBuffer(decoded);
  const targetRate = settings.sampleRate || decoded.sampleRate;
  const resampled = await resampleAudioBuffer(decoded, targetRate);
  const processingInput = cloneAudioBuffer(resampled);
  
  onProgress?.({ phase: 'render', progress: 0.5, message: 'Rendering preview DSP...' });
  const result = await runMasteringWorker(processingInput, settings);
  const previewBuffer = createAudioBuffer(result.channels, resampled.sampleRate);
  
  return { 
    originalBuffer, 
    previewBuffer,
    measuredLufs: result.measuredLufs,
    measuredTruePeak: result.measuredTruePeak,
    decodedBuffer: decoded,
  };
}

interface WorkerResult {
  channels: Float32Array[];
  measuredLufs?: number;
  measuredTruePeak?: number;
}

async function runMasteringWorker(buffer: AudioBuffer, settings: MasteringSettings): Promise<WorkerResult> {
  return new Promise((resolve, reject) => {
    const w = getWorker();
    const id = Math.random();
    const channels: Float32Array[] = [];
    const transferables: ArrayBuffer[] = [];
    
    for (let i = 0; i < buffer.numberOfChannels; i++) {
      const data = buffer.getChannelData(i).slice();
      channels.push(data);
      transferables.push(data.buffer);
    }

    const handler = (e: MessageEvent) => {
      if (e.data.id === id) {
        w.removeEventListener('message', handler);
        if (e.data.success) {
          resolve(e.data.result as WorkerResult);
        } else {
          reject(new Error(e.data.error || 'Worker DSP error'));
        }
      }
    };

    w.addEventListener('message', handler);
    w.postMessage({ 
      id, 
      data: { 
        channels, 
        sampleRate: buffer.sampleRate, 
        settings 
      } 
    }, transferables);
  });
}
