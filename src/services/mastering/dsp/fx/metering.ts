import { BiquadFilter, linearToDb } from '../utils';

/**
 * Metering: Implements K-weighted LUFS metering (ITU-R BS.1770).
 */
export class Metering {
  private preFilter = new BiquadFilter(); // Pre-filter for LUFS
  private rlbFilter = new BiquadFilter(); // RLB-filter for LUFS
  private sampleRate = 48000;
  private sumSquares = 0;
  private sampleCount = 0;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    // K-Weighting coefficients
    // Pre-filter: High shelf @ 1.5kHz, +4dB
    this.preFilter.setHighShelf(1500, 1.0, 4.0, sampleRate);
    // RLB-filter: High pass @ 100Hz
    this.rlbFilter.setHighPass(100, 0.707, sampleRate);
  }

  process(channels: Float32Array[]) {
    const numChannels = channels.length;
    const len = channels[0].length;

    for (let i = 0; i < len; i++) {
      let channelSum = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        let x = channels[ch][i];
        
        if (!Number.isFinite(x)) {
            x = 0;
        }

        // Apply K-weighting
        x = this.preFilter.process(x, ch);
        x = this.rlbFilter.process(x, ch);
        
        if (!Number.isFinite(x)) x = 0;
        
        channelSum += x * x;
      }
      this.sumSquares += channelSum / numChannels;
      this.sampleCount++;
    }
  }

  getLufs(): number {
    if (this.sampleCount === 0) return -144;
    const meanSquare = this.sumSquares / this.sampleCount;
    // ITU-R BS.1770-4: LUFS = -0.691 + 10 * log10(sum(wi * mean(xi^2)))
    // For stereo, wi=1.0 for L/R.
    // Our sumSquares is already mean(L^2 + R^2) / 2
    const lufs = -0.691 + 10 * Math.log10(Math.max(1e-12, meanSquare));
    return lufs;
  }

  reset() {
    this.sumSquares = 0;
    this.sampleCount = 0;
    this.preFilter.reset();
    this.rlbFilter.reset();
  }
}
