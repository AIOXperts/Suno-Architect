export type WamWorkerProgressHandler = (progress: number, status?: string) => void;

type PendingRequest = {
  resolve: (value: any) => void;
  reject: (reason?: unknown) => void;
  onProgress?: WamWorkerProgressHandler | null;
  timeoutId?: number;
};

type WorkerProgressMessage = {
  id: number;
  type: 'PROGRESS';
  progress: number;
  status?: string;
};

type WorkerResultMessage = {
  id: number;
  success: boolean;
  result?: any;
  error?: string;
};

export interface WamRenderFullChainResult {
  audioBuffer: AudioBuffer;
  lufs: number;
  measuredLufs?: number;
}

export interface WamWorkerRenderSettings {
  normalizeLoudness: boolean;
  targetLufs: number;
  truePeakLimit: boolean;
  truePeakCeiling: number;
  cleanLowEnd: boolean;
  glueCompression: boolean;
  deharsh: boolean;
  stereoWidth: number;
  centerBass: boolean;
  cutMud: boolean;
  addAir: boolean;
  tapeWarmth: boolean;
  autoLevel: boolean;
  addPunch: boolean;
  sampleRate: number;
  bitDepth: number;
  inputGain: number;
  eqLow: number;
  eqLowMid: number;
  eqMid: number;
  eqHighMid: number;
  eqHigh: number;
}

export class WamDSPWorkerClient {
  private worker: Worker | null = null;
  private pending = new Map<number, PendingRequest>();
  private nextId = 0;
  private readonly requestTimeoutMs = 120000;
  isReady = false;

  async init() {
    if (this.worker) return;
    this.worker = new Worker('/web-audio-master/workers/dsp-worker.js', { type: 'module' });
    this.worker.onmessage = (e) => this.handleMessage(e.data as WorkerProgressMessage | WorkerResultMessage);
    this.worker.onerror = (e) => {
      console.error('[WamDSPWorkerClient] Worker error', e);
      this.failAllPending(new Error('W-A-M DSP worker failed to load or crashed. Check console/network for /web-audio-master worker asset errors.'));
      this.isReady = false;
    };
    this.worker.onmessageerror = () => {
      this.failAllPending(new Error('W-A-M DSP worker message serialization failed.'));
    };
    this.isReady = true;
  }

  terminate() {
    if (!this.worker) return;
    this.worker.terminate();
    this.worker = null;
    this.isReady = false;
    for (const req of this.pending.values()) {
      req.reject(new Error('Worker terminated'));
    }
    this.pending.clear();
  }

  async renderFullChain(
    audioBuffer: AudioBuffer,
    settings: WamWorkerRenderSettings,
    mode: 'preview' | 'export' = 'export',
    onProgress?: WamWorkerProgressHandler
  ): Promise<WamRenderFullChainResult> {
    const { channels, sampleRate, transferables } = this.extractChannelData(audioBuffer);
    const result = await this.send(
      'RENDER_FULL_CHAIN',
      { channels, sampleRate, settings, mode },
      onProgress ?? null,
      transferables
    );

    return {
      audioBuffer: this.createAudioBuffer(result.channels as Float32Array[], sampleRate),
      lufs: result.lufs,
      measuredLufs: result.measuredLufs,
    };
  }

  private handleMessage(data: WorkerProgressMessage | WorkerResultMessage) {
    if ((data as WorkerProgressMessage).type === 'PROGRESS') {
      const progressMsg = data as WorkerProgressMessage;
      const pending = this.pending.get(progressMsg.id);
      pending?.onProgress?.(progressMsg.progress, progressMsg.status);
      return;
    }

    const msg = data as WorkerResultMessage;
    const pending = this.pending.get(msg.id);
    if (!pending) return;
    if (pending.timeoutId) window.clearTimeout(pending.timeoutId);
    this.pending.delete(msg.id);

    if (msg.success) {
      pending.resolve(msg.result);
    } else {
      pending.reject(new Error(msg.error || 'Unknown worker error'));
    }
  }

  private send(type: string, data: any, onProgress: WamWorkerProgressHandler | null, transferables: Transferable[]) {
    if (!this.worker) {
      return Promise.reject(new Error('Worker not initialized'));
    }

    return new Promise<any>((resolve, reject) => {
      const id = this.nextId++;
      const timeoutId = window.setTimeout(() => {
        const pending = this.pending.get(id);
        if (!pending) return;
        this.pending.delete(id);
        pending.reject(new Error(`W-A-M DSP worker timed out after ${Math.round(this.requestTimeoutMs / 1000)}s (${type})`));
      }, this.requestTimeoutMs);

      this.pending.set(id, { resolve, reject, onProgress, timeoutId });

      try {
        this.worker!.postMessage({ type, id, data }, transferables);
      } catch (error) {
        window.clearTimeout(timeoutId);
        this.pending.delete(id);
        reject(error);
      }
    });
  }

  private failAllPending(error: Error) {
    for (const [id, pending] of this.pending.entries()) {
      if (pending.timeoutId) window.clearTimeout(pending.timeoutId);
      pending.reject(error);
      this.pending.delete(id);
    }
  }

  private extractChannelData(audioBuffer: AudioBuffer) {
    const channels: Float32Array[] = [];
    const transferables: ArrayBuffer[] = [];

    for (let i = 0; i < audioBuffer.numberOfChannels; i++) {
      const channelData = audioBuffer.getChannelData(i).slice();
      channels.push(channelData);
      transferables.push(channelData.buffer);
    }

    return {
      channels,
      sampleRate: audioBuffer.sampleRate,
      transferables,
    };
  }

  private createAudioBuffer(channels: Float32Array[], sampleRate: number): AudioBuffer {
    const length = channels[0]?.length ?? 0;
    const audioBuffer = new AudioBuffer({
      numberOfChannels: channels.length,
      length,
      sampleRate,
    });
    channels.forEach((channel, index) => audioBuffer.copyToChannel(channel, index));
    return audioBuffer;
  }
}

let sharedClient: WamDSPWorkerClient | null = null;

export async function getWamDSPWorkerClient() {
  if (!sharedClient) {
    sharedClient = new WamDSPWorkerClient();
  }
  await sharedClient.init();
  return sharedClient;
}
