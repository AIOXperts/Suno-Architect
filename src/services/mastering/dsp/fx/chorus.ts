import { DelayLine } from '../utils';

/**
 * Chorus Effect: Uses modulated delay lines to create width and thickness.
 */
export class Chorus {
  private delayL: DelayLine;
  private delayR: DelayLine;
  private lfoPhase = 0;
  private lfoRate = 0.5; // Hz
  private lfoDepth = 20; // Samples
  private mix = 0.3;
  private sampleRate = 48000;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    this.delayL = new DelayLine(Math.floor(sampleRate * 0.1));
    this.delayR = new DelayLine(Math.floor(sampleRate * 0.1));
  }

  setMix(m: number) { this.mix = m; }
  setRate(r: number) { this.lfoRate = r; }
  setDepth(d: number) { this.lfoDepth = d; }

  process(channels: Float32Array[]) {
    const numChannels = channels.length;
    if (numChannels < 2) return;

    const len = channels[0].length;
    const lfoInc = (2 * Math.PI * this.lfoRate) / this.sampleRate;
    const baseDelay = Math.floor(this.sampleRate * 0.02); // 20ms

    for (let i = 0; i < len; i++) {
      this.lfoPhase += lfoInc;
      if (this.lfoPhase > 2 * Math.PI) this.lfoPhase -= 2 * Math.PI;

      const offset = Math.sin(this.lfoPhase) * this.lfoDepth;
      const offsetR = Math.sin(this.lfoPhase + Math.PI) * this.lfoDepth;

      const l = channels[0][i];
      const r = channels[1][i];

      this.delayL.push(l);
      this.delayR.push(r);

      const modL = this.delayL.readFrac(baseDelay + offset);
      const modR = this.delayR.readFrac(baseDelay + offsetR);

      channels[0][i] = l * (1 - this.mix) + modL * this.mix;
      channels[1][i] = r * (1 - this.mix) + modR * this.mix;
    }
  }
}
