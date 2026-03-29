import { dbToLinear } from '../utils';

export class ProLimiter {
  private ceiling = dbToLinear(-1);
  private releaseTime = 0.05; // 50ms
  private env = 0;
  private sampleRate = 48000;

  constructor(sampleRate = 48000) {
    this.sampleRate = sampleRate;
  }

  setCeiling(db: number) { this.ceiling = dbToLinear(db); }
  setRelease(seconds: number) { this.releaseTime = seconds; }

  process(channels: Float32Array[]) {
    const numChannels = channels.length;
    const len = channels[0].length;
    
    // Exponential release coefficient
    const releaseCoef = Math.exp(-1 / (this.sampleRate * this.releaseTime));

    for (let i = 0; i < len; i++) {
      let maxAbs = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        const x = channels[ch][i];
        if (!Number.isFinite(x)) {
            channels[ch][i] = 0;
        } else {
          maxAbs = Math.max(maxAbs, Math.abs(x));
        }
      }

      // Attack is instant (limiter)
      if (maxAbs > this.env) {
        this.env = maxAbs;
      } else {
        this.env = releaseCoef * this.env + (1 - releaseCoef) * maxAbs;
      }

      // Limiting gain - only reduce, never amplify
      let gain = (this.env > this.ceiling) ? (this.ceiling / this.env) : 1;
      
      // Safety: clamp gain to [0, 1] - limiter only attenuates
      if (!Number.isFinite(gain) || gain < 0) gain = 1;
      if (gain > 1) gain = 1;

      for (let ch = 0; ch < numChannels; ch++) {
        channels[ch][i] *= gain;
      }
    }
  }
}
