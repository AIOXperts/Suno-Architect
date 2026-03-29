import { dbToLinear } from '../utils';

/**
 * Saturation: Implements tape/analog saturation modeling.
 * Using a soft-clipping function to add harmonics and warmth.
 */
export class Saturation {
  private drive = 1.0; // Linear gain
  private mix = 1.0; // Wet/Dry mix
  
  constructor(driveDb: number) {
    this.drive = dbToLinear(driveDb);
  }

  setDrive(db: number) { this.drive = dbToLinear(db); }
  setMix(m: number) { this.mix = m; }

  private softClip(x: number): number {
    // tanh-based soft clipping
    return Math.tanh(x);
  }

  process(channels: Float32Array[]) {
    const numChannels = channels.length;
    const len = channels[0].length;

    for (let i = 0; i < len; i++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const x = channels[ch][i];
        const driven = x * this.drive;
        const saturated = this.softClip(driven);
        
        // Compensate gain (roughly, using Math.max to avoid division by zero)
        const output = (saturated / Math.max(1, this.drive)) * this.mix + x * (1 - this.mix);
        channels[ch][i] = output;
      }
    }
  }
}
