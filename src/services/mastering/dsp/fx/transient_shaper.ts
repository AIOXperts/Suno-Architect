import { dbToLinear } from '../utils';

/**
 * Transient Shaper: Adjusts the attack and sustain of audio independently.
 * Useful for making drums punchier or controlling tail length.
 */
export class TransientShaper {
  private attackGain = 1.0; // Linear gain
  private sustainGain = 1.0; // Linear gain
  
  private fastEnv = 0;
  private slowEnv = 0;
  private smoothedGain = 1.0;
  
  private attackMs = 5;
  private sustainMs = 50;
  private gainSmoothingMs = 10;
  private sampleRate = 48000;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  setAttack(db: number) { this.attackGain = dbToLinear(db); }
  setSustain(db: number) { this.sustainGain = dbToLinear(db); }

  process(channels: Float32Array[]) {
    const numChannels = channels.length;
    const len = channels[0].length;

    const fastCoef = Math.exp(-1 / (this.sampleRate * (this.attackMs / 1000)));
    const slowCoef = Math.exp(-1 / (this.sampleRate * (this.sustainMs / 1000)));
    const smoothingCoef = Math.exp(-1 / (this.sampleRate * (this.gainSmoothingMs / 1000)));

    for (let i = 0; i < len; i++) {
      let maxAbs = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        maxAbs = Math.max(maxAbs, Math.abs(channels[ch][i]));
      }

      // Use separate fast/slow releases to detect attack energy without
      // collapsing gain during sustained or decaying passages.
      if (maxAbs > this.fastEnv) this.fastEnv = maxAbs;
      else this.fastEnv += (maxAbs - this.fastEnv) * (1 - fastCoef);

      if (maxAbs > this.slowEnv) this.slowEnv = maxAbs;
      else this.slowEnv += (maxAbs - this.slowEnv) * (1 - slowCoef);

      const envFloor = Math.max(this.slowEnv, 1e-4);
      const transientStrength = Math.min(1, Math.max(0, this.fastEnv - this.slowEnv) / envFloor);
      const sustainStrength = Math.min(1, Math.max(0, this.slowEnv - this.fastEnv) / envFloor);

      let targetGain = 1 + (this.attackGain - 1) * transientStrength;
      if (this.sustainGain !== 1) {
        targetGain *= 1 + (this.sustainGain - 1) * sustainStrength;
      }
      targetGain = Math.max(0.25, Math.min(4, targetGain));
      this.smoothedGain += (targetGain - this.smoothedGain) * (1 - smoothingCoef);
      
      for (let ch = 0; ch < numChannels; ch++) {
        channels[ch][i] *= this.smoothedGain;
      }
    }
  }
}
