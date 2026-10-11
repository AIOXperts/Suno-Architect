import { BiquadFilter } from '../utils';

/**
 * Metering — EBU R 128 / ITU-R BS.1770-4 loudness + true-peak metering.
 *
 *  - Integrated loudness: K-weighted, gated (absolute gate -70 LUFS, relative
 *    gate -10 LU below the ungated integrated value), over 400 ms gating blocks.
 *  - True peak (dBTP): 4x oversampled inter-sample peak.
 *  - Short-term (3 s) and momentary (400 ms) ungated loudness.
 *  - Loudness range (LRA) from the distribution of short-term loudness.
 */
export class Metering {
  private preFilter = new BiquadFilter(); // K-weighting: high shelf 1.5kHz, +4dB
  private rlbFilter = new BiquadFilter(); // RLB: high pass 100Hz
  private sampleRate = 48000;
  private blockSize: number; // samples per 400 ms gating block

  private blockSumSquares = 0;
  private blockSamples = 0;
  private gatingBlocks: number[] = []; // mean-square per completed 400 ms block

  private maxTruePeak = 0;
  private prevSample: number[] = [];

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.preFilter.setHighShelf(1500, 1.0, 4.0, sampleRate);
    this.rlbFilter.setHighPass(100, 0.707, sampleRate);
    this.blockSize = Math.max(1, Math.round(sampleRate * 0.4)); // 400 ms
  }

  process(channels: Float32Array[]) {
    const numChannels = channels.length;
    const len = channels[0].length;

    if (this.prevSample.length !== numChannels) {
      this.prevSample = new Array(numChannels).fill(0);
    }

    for (let i = 0; i < len; i++) {
      let channelSum = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        let x = channels[ch][i];
        if (!Number.isFinite(x)) x = 0;

        // True-peak tracking (4x linear oversampled inter-sample peak).
        const prev = this.prevSample[ch];
        let tp = prev < 0 ? -prev : prev;
        for (let k = 1; k <= 4; k++) {
          const v = prev + (x - prev) * (k / 4);
          const av = v < 0 ? -v : v;
          if (av > tp) tp = av;
        }
        if (tp > this.maxTruePeak) this.maxTruePeak = tp;
        this.prevSample[ch] = x;

        // K-weighting (pre-filter + RLB).
        x = this.preFilter.process(x, ch);
        x = this.rlbFilter.process(x, ch);
        if (!Number.isFinite(x)) x = 0;

        channelSum += x * x;
      }
      this.blockSumSquares += channelSum / numChannels;
      this.blockSamples++;

      if (this.blockSamples >= this.blockSize) {
        this.gatingBlocks.push(this.blockSumSquares / this.blockSamples);
        // Bound memory in long-lived realtime sessions (~55 min of 400 ms blocks).
        // Offline whole-file renders never approach this cap, so gated integrated
        // loudness remains exact there.
        if (this.gatingBlocks.length > 8192) {
          this.gatingBlocks.splice(0, this.gatingBlocks.length - 8192);
        }
        this.blockSumSquares = 0;
        this.blockSamples = 0;
      }
    }
  }

  private lufsFromMeanSquare(ms: number): number {
    if (ms <= 1e-10) return -Infinity;
    return -0.691 + 10 * Math.log10(ms);
  }

  /** Gated integrated loudness (ITU-R BS.1770-4), in LUFS. */
  getLufs(): number {
    const blocks = this.allBlocks();
    if (!blocks.length) return -144;

    // Absolute gate: -70 LUFS.
    const absGated = blocks.filter((ms) => this.lufsFromMeanSquare(ms) > -70);
    if (!absGated.length) return -144;

    // Ungated integrated over abs-gated blocks.
    let sum = 0;
    for (const ms of absGated) sum += ms;
    const integrated1 = this.lufsFromMeanSquare(sum / absGated.length);

    // Relative gate: -10 LU below the ungated integrated value.
    const relThreshold = integrated1 - 10;
    const relGated = absGated.filter((ms) => this.lufsFromMeanSquare(ms) > relThreshold);
    if (!relGated.length) return integrated1;

    let sum2 = 0;
    for (const ms of relGated) sum2 += ms;
    return this.lufsFromMeanSquare(sum2 / relGated.length);
  }

  /** Maximum true peak observed so far, in dBTP. */
  getTruePeakDb(): number {
    return this.maxTruePeak > 0 ? 20 * Math.log10(this.maxTruePeak) : -Infinity;
  }

  /** Momentary loudness (last 400 ms), in LUFS. */
  getMomentaryLufs(): number {
    if (this.blockSamples > 0) {
      return this.lufsFromMeanSquare(this.blockSumSquares / this.blockSamples);
    }
    if (!this.gatingBlocks.length) return -Infinity;
    return this.lufsFromMeanSquare(this.gatingBlocks[this.gatingBlocks.length - 1]);
  }

  /** Short-term loudness (last 3 s), in LUFS. */
  getShortTermLufs(): number {
    // Read directly from the tail (no full-array copy) — this runs every block
    // in the realtime loudness loop.
    let sum = 0;
    let count = 0;
    if (this.blockSamples > 0) {
      sum += this.blockSumSquares / this.blockSamples;
      count = 1;
    }
    const start = Math.max(0, this.gatingBlocks.length - (count === 1 ? 7 : 8));
    for (let i = start; i < this.gatingBlocks.length; i++) {
      sum += this.gatingBlocks[i];
      count++;
    }
    if (count === 0) return -Infinity;
    return this.lufsFromMeanSquare(sum / count);
  }

  /** Loudness range (EBU Tech 3342): distribution of 3 s short-term loudness. */
  getLra(): number {
    const blocks = this.gatingBlocks.slice();
    if (this.blockSamples > 0) blocks.push(this.blockSumSquares / this.blockSamples);
    if (blocks.length < 2) return 0;

    const st: number[] = [];
    for (let i = 0; i < blocks.length; i++) {
      const n = Math.min(8, i + 1);
      let sum = 0;
      for (let j = i - n + 1; j <= i; j++) sum += blocks[Math.max(0, j)];
      st.push(this.lufsFromMeanSquare(sum / n));
    }
    st.sort((a, b) => a - b);
    const lowIdx = Math.min(st.length - 1, Math.floor(st.length * 0.1));
    const highIdx = Math.min(st.length - 1, Math.floor(st.length * 0.95));
    return Math.max(0, st[highIdx] - st[lowIdx]);
  }

  private allBlocks(): number[] {
    const blocks = this.gatingBlocks.slice();
    if (this.blockSamples > 0) blocks.push(this.blockSumSquares / this.blockSamples);
    return blocks;
  }

  reset() {
    this.blockSumSquares = 0;
    this.blockSamples = 0;
    this.gatingBlocks = [];
    this.maxTruePeak = 0;
    this.prevSample = [];
    this.preFilter.reset();
    this.rlbFilter.reset();
  }
}
