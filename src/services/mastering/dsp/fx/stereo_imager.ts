import { BiquadFilter, dbToLinear } from '../utils';

/**
 * Stereo Imager: Controls width and mono compatibility.
 * Implements M/S processing for width and a high-pass on the side channel for mono bass.
 */
export class StereoImager {
  private width = 1.0; // Linear width multiplier
  private sideHp = new BiquadFilter();
  private sideHpFreq = 200; // Hz
  private bassMono = true;

  constructor(sampleRate: number) {
    this.sideHp.setHighPass(this.sideHpFreq, 0.707, sampleRate);
  }

  setWidth(w: number) { this.width = w; }
  setBassMono(enable: boolean) { this.bassMono = enable; }
  setBassMonoFreq(f: number, sampleRate: number) {
    this.sideHpFreq = f;
    this.sideHp.setHighPass(f, 0.707, sampleRate);
  }

  process(channels: Float32Array[]) {
    if (channels.length < 2) return; // Stereo only

    const len = channels[0].length;
    const L = channels[0];
    const R = channels[1];

    for (let i = 0; i < len; i++) {
      const l = L[i];
      const r = R[i];

      // Convert to Mid/Side
      let mid = (l + r) / 2;
      let side = (l - r) / 2;

      // Apply width control
      side *= this.width;

      // Apply bass mono (HP on side channel)
      if (this.bassMono) {
        side = this.sideHp.process(side, 0);
      }

      // Re-combine to L/R
      L[i] = mid + side;
      R[i] = mid - side;
    }
  }
}
