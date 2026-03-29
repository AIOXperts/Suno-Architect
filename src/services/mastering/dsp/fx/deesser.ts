import { BiquadFilter, dbToLinear } from '../utils';
import { Compressor } from './compressor';

/**
 * De-Esser: A dynamic EQ specifically tuned for the 4-10kHz range.
 * Reduces sibilance by compressing the signal only when high-frequency content is dominant.
 */
export class DeEsser {
  private scFilter = new BiquadFilter(); // Sidechain filter
  private compressor: Compressor;
  private freq = 6000;
  private strength = 0.35;
  private minGain = dbToLinear(-3);

  constructor(sampleRate: number) {
    this.compressor = new Compressor(sampleRate);
    this.scFilter.setHighPass(this.freq, 0.707, sampleRate);
    
    // Keep the detector gentle. This is broad-band attenuation, not split-band.
    this.compressor.setThreshold(-18);
    this.compressor.setRatio(2.5);
    this.compressor.setAttack(0.003);
    this.compressor.setRelease(0.08);
  }

  setThreshold(db: number) { this.compressor.setThreshold(db); }
  setRatio(r: number) { this.compressor.setRatio(r); }
  setStrength(strength: number) { this.strength = Math.max(0, Math.min(1, strength)); }
  setMaxReduction(db: number) { this.minGain = dbToLinear(-Math.max(0, db)); }
  
  setFrequency(f: number, sampleRate: number) {
    this.freq = f;
    this.scFilter.setHighPass(f, 0.707, sampleRate);
  }

  process(channels: Float32Array[]) {
    const numChannels = channels.length;
    const len = channels[0].length;

    for (let i = 0; i < len; i++) {
      let maxSc = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        // Feed sidechain filter with each channel's sample
        const scSample = this.scFilter.process(channels[ch][i], ch);
        maxSc = Math.max(maxSc, Math.abs(scSample));
      }

      // Calculate gain reduction based on maximum sidechain sample (linked)
      const detectedGain = this.compressor.processSample(maxSc);
      const softenedGain = 1 - (1 - detectedGain) * this.strength;
      const gain = Math.max(this.minGain, softenedGain);

      // Apply gain reduction to original signal
      for (let ch = 0; ch < numChannels; ch++) {
        channels[ch][i] *= gain;
      }
    }
  }
}
