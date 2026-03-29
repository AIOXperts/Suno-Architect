import { DelayLine } from '../utils';

/**
 * Low-pass Feedback Comb Filter (LPFBCF)
 */
class CombFilter {
  private delay: DelayLine;
  private feedback: number;
  private damp: number;
  private lastOut = 0;

  constructor(size: number, feedback: number, damp: number) {
    this.delay = new DelayLine(size);
    this.feedback = feedback;
    this.damp = damp;
  }

  process(x: number): number {
    const output = this.delay.read(0); // Actually the delayed value
    // Dampening: simple low-pass in the feedback loop
    this.lastOut = (output * (1 - this.damp)) + (this.lastOut * this.damp);
    
    // Feedback: x + damp_out * feedback
    this.delay.push(x + this.lastOut * this.feedback);
    
    return output;
  }
  
  reset() {
      this.delay.reset();
      this.lastOut = 0;
  }
}

/**
 * All-Pass Filter for diffusion
 */
class AllPassFilter {
  private delay: DelayLine;
  private feedback: number;

  constructor(size: number, feedback: number) {
    this.delay = new DelayLine(size);
    this.feedback = feedback;
  }

  process(x: number): number {
    const delayOut = this.delay.read(0);
    const output = -x + delayOut;
    this.delay.push(x + delayOut * this.feedback);
    return output;
  }
  
  reset() {
      this.delay.reset();
  }
}

/**
 * Algorithmic Reverb based on Freeverb architecture.
 * Refined for better stereo width and stability.
 */
export class Reverb {
  private combsL: CombFilter[] = [];
  private combsR: CombFilter[] = [];
  private allpassesL: AllPassFilter[] = [];
  private allpassesR: AllPassFilter[] = [];
  
  private mix = 0.1;
  private readonly stereoSpread = 23;

  constructor(sampleRate: number) {
    const combSizes = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617];
    const allPassSizes = [556, 441, 341, 225];
    
    const feedback = 0.84;
    const damp = 0.2;

    for (const size of combSizes) {
      const s = Math.floor(size * (sampleRate / 44100));
      this.combsL.push(new CombFilter(s, feedback, damp));
      this.combsR.push(new CombFilter(s + this.stereoSpread, feedback, damp));
    }
    
    for (const size of allPassSizes) {
      const s = Math.floor(size * (sampleRate / 44100));
      this.allpassesL.push(new AllPassFilter(s, 0.5));
      this.allpassesR.push(new AllPassFilter(s + this.stereoSpread, 0.5));
    }
  }

  setMix(m: number) { this.mix = m; }

  process(channels: Float32Array[]) {
    const numChannels = channels.length;
    const len = channels[0].length;

    for (let i = 0; i < len; i++) {
      let inL = channels[0][i];
      let inR = numChannels > 1 ? channels[1][i] : inL;

      let outL = 0;
      let outR = 0;

      // Parallel combs
      for (let j = 0; j < this.combsL.length; j++) {
        outL += this.combsL[j].process(inL);
        outR += this.combsR[j].process(inR);
      }

      // Serial all-passes
      for (let j = 0; j < this.allpassesL.length; j++) {
        outL = this.allpassesL[j].process(outL);
        outR = this.allpassesR[j].process(outR);
      }

      // Mix back
      channels[0][i] = inL * (1 - this.mix) + outL * this.mix * 0.1;
      if (numChannels > 1) {
        channels[1][i] = inR * (1 - this.mix) + outR * this.mix * 0.1;
      }
    }
  }
}
