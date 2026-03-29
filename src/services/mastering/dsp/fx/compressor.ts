import { dbToLinear, linearToDb } from '../utils';

export class Compressor {
  private thresholdLinear = dbToLinear(-20);
  private ratio = 4;
  private attack = 0.01; // seconds
  private release = 0.1; // seconds
  private knee = 0; // dB
  private makeUpGainLinear = dbToLinear(0);
  
  private env = 0;
  private sampleRate = 48000;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
  }

  setThreshold(db: number) { this.thresholdLinear = dbToLinear(db); }
  setRatio(r: number) { this.ratio = r; }
  setAttack(s: number) { this.attack = s; }
  setRelease(s: number) { this.release = s; }
  setKnee(db: number) { this.knee = db; }
  setMakeUpGain(db: number) { this.makeUpGainLinear = dbToLinear(db); }

  process(channels: Float32Array[]) {
    const numChannels = channels.length;
    const len = channels[0].length;
    
    const attackCoef = Math.exp(-1 / (this.sampleRate * this.attack));
    const releaseCoef = Math.exp(-1 / (this.sampleRate * this.release));

    for (let i = 0; i < len; i++) {
      let maxAbs = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        maxAbs = Math.max(maxAbs, Math.abs(channels[ch][i]));
      }

      // Detector (Peak)
      if (maxAbs > this.env) {
        this.env = attackCoef * this.env + (1 - attackCoef) * maxAbs;
      } else {
        this.env = releaseCoef * this.env + (1 - releaseCoef) * maxAbs;
      }

      // Gain reduction calculation
      let gain = 1;
      if (this.env > 0) {
        const envDb = linearToDb(this.env);
        const thresholdDb = linearToDb(this.thresholdLinear);
        
        if (envDb > thresholdDb) {
          const grDb = (envDb - thresholdDb) * (1 / this.ratio - 1);
          gain = dbToLinear(grDb);
        }
      }

      // Apply gain + make-up
      const totalGain = gain * this.makeUpGainLinear;
      for (let ch = 0; ch < numChannels; ch++) {
        channels[ch][i] *= totalGain;
      }
    }
  }

  // Process a single sample across multiple channels and return gain reduction
  // Note: This expects the input to be the MAX absolute sample across channels for linked compression
  processSample(maxAbs: number): number {
    const attackCoef = Math.exp(-1 / (this.sampleRate * this.attack));
    const releaseCoef = Math.exp(-1 / (this.sampleRate * this.release));

    if (maxAbs > this.env) {
      this.env = attackCoef * this.env + (1 - attackCoef) * maxAbs;
    } else {
      this.env = releaseCoef * this.env + (1 - releaseCoef) * maxAbs;
    }

    let gain = 1;
    if (this.env > 0) {
      const envDb = linearToDb(this.env);
      const thresholdDb = linearToDb(this.thresholdLinear);
      
      if (envDb > thresholdDb) {
        const grDb = (envDb - thresholdDb) * (1 / this.ratio - 1);
        gain = dbToLinear(grDb);
      }
    }
    return gain * this.makeUpGainLinear;
  }
}
