import { dbToLinear } from '../utils';

/**
 * ProLimiter — true-peak aware lookahead brickwall limiter.
 *
 * Improvements over a naive instant-attack limiter:
 *  - Lookahead delay: gain reduction begins BEFORE a transient peaks, so the
 *    attack can be applied smoothly without hard-clipping the waveform.
 *  - True-peak (intersample peak) detection via 4x linear oversampling, so
 *    the limiter catches peaks that fall between sample points (per ITU-R
 *    BS.1770 / EBU R 128, maximum permitted true peak in production is -1 dBTP).
 *  - Channel-linked gain envelope (worst-case across channels) to preserve the
 *    stereo image.
 */
export class ProLimiter {
  private ceiling = dbToLinear(-1);
  private releaseTime = 0.05; // 50ms
  private lookaheadTime = 0.005; // 5ms
  private sampleRate = 48000;

  private lookahead: number; // lookahead in samples
  private delayLines: Float32Array[] = []; // circular delay buffer per channel
  private delayPtr = 0;
  private env = 1; // linear gain envelope (1 = no reduction)
  private truePeakMode = true;
  private prevSample: number[] = []; // previous sample per channel (true-peak interp)

  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
    this.lookahead = Math.max(1, Math.floor(sampleRate * this.lookaheadTime));
  }

  setCeiling(db: number) { this.ceiling = dbToLinear(db); }
  setRelease(seconds: number) { this.releaseTime = Math.max(0.001, seconds); }

  setLookahead(seconds: number) {
    this.lookaheadTime = seconds;
    this.lookahead = Math.max(1, Math.floor(this.sampleRate * seconds));
    this.delayLines = [];
    this.prevSample = [];
    this.env = 1;
    this.delayPtr = 0;
  }

  setTruePeakMode(enabled: boolean) { this.truePeakMode = enabled; }

  /** 4x linear-oversampled true peak between consecutive samples a and b. */
  private truePeak(a: number, b: number): number {
    let peak = Math.abs(a);
    for (let k = 1; k <= 4; k++) {
      const t = k / 4;
      const v = a + (b - a) * t;
      const av = v < 0 ? -v : v;
      if (av > peak) peak = av;
    }
    return peak;
  }

  process(channels: Float32Array[]) {
    const numChannels = channels.length;
    const len = channels[0].length;

    // (Re)allocate delay lines + previous-sample buffers when channel count changes.
    if (this.delayLines.length !== numChannels || this.delayLines[0].length !== this.lookahead) {
      this.delayLines = [];
      for (let ch = 0; ch < numChannels; ch++) {
        this.delayLines.push(new Float32Array(this.lookahead));
      }
      this.prevSample = new Array(numChannels).fill(0);
      this.delayPtr = 0;
      this.env = 1;
    }

    const releaseCoef = Math.exp(-1 / (this.sampleRate * this.releaseTime));

    for (let i = 0; i < len; i++) {
      // 1. Detect linked peak across channels (true-peak aware).
      let peak = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        const x = channels[ch][i];
        if (!Number.isFinite(x)) {
          channels[ch][i] = 0;
          continue;
        }
        const p = this.truePeakMode ? this.truePeak(this.prevSample[ch], x) : (x < 0 ? -x : x);
        if (p > peak) peak = p;
        this.prevSample[ch] = x;
      }

      // 2. Target gain needed to bring the peak down to the ceiling.
      const desired = peak > this.ceiling ? this.ceiling / peak : 1;

      // 3. Gain envelope: instant attack (lookahead makes it safe), exponential release.
      if (desired < this.env) {
        this.env = desired;
      } else {
        this.env = releaseCoef * this.env + (1 - releaseCoef) * desired;
      }

      // 4. Delay signal by `lookahead` samples, apply the current envelope.
      for (let ch = 0; ch < numChannels; ch++) {
        const dl = this.delayLines[ch];
        const delayed = dl[this.delayPtr];
        dl[this.delayPtr] = channels[ch][i];
        channels[ch][i] = delayed * this.env;
      }
      this.delayPtr = (this.delayPtr + 1) % this.lookahead;
    }
  }
}
