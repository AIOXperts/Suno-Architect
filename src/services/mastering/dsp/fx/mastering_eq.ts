import { BiquadFilter, dbToLinear } from '../utils';

/**
 * Mastering EQ: Multi-band parametric EQ with Mid/Side support.
 */
export class MasteringEQ {
  private midBands: BiquadFilter[] = [];
  private sideBands: BiquadFilter[] = [];
  private lowShelfMid = new BiquadFilter();
  private lowShelfSide = new BiquadFilter();
  private highShelfMid = new BiquadFilter();
  private highShelfSide = new BiquadFilter();
  private sampleRate = 48000;

  constructor(sampleRate: number) {
    this.sampleRate = sampleRate;
    // Standard 5 peaking bands
    for (let i = 0; i < 5; i++) {
      this.midBands.push(new BiquadFilter());
      this.sideBands.push(new BiquadFilter());
    }
    this.resetBands();
  }

  private resetBands() {
    const freqs = [100, 400, 1000, 4000, 12000];
    const qs = [0.7, 1.0, 1.0, 1.0, 0.7];
    for (let i = 0; i < 5; i++) {
      this.midBands[i].setPeaking(freqs[i], qs[i], 0, this.sampleRate);
      this.sideBands[i].setPeaking(freqs[i], qs[i], 0, this.sampleRate);
    }
    this.lowShelfMid.setLowShelf(80, 0.707, 0, this.sampleRate);
    this.lowShelfSide.setLowShelf(80, 0.707, 0, this.sampleRate);
    this.highShelfMid.setHighShelf(12000, 0.707, 0, this.sampleRate);
    this.highShelfSide.setHighShelf(12000, 0.707, 0, this.sampleRate);
  }

  setMidBand(bandIdx: number, freq: number, q: number, gainDb: number) {
    if (bandIdx >= 0 && bandIdx < 5) {
      this.midBands[bandIdx].setPeaking(freq, q, gainDb, this.sampleRate);
    }
  }

  setSideBand(bandIdx: number, freq: number, q: number, gainDb: number) {
    if (bandIdx >= 0 && bandIdx < 5) {
      this.sideBands[bandIdx].setPeaking(freq, q, gainDb, this.sampleRate);
    }
  }

  setHighShelf(freq: number, q: number, gainDb: number) {
    this.highShelfMid.setHighShelf(freq, q, gainDb, this.sampleRate);
  }

  setLowShelf(freq: number, q: number, gainDb: number) {
    this.lowShelfMid.setLowShelf(freq, q, gainDb, this.sampleRate);
  }

  process(channels: Float32Array[]) {
    if (channels.length < 2) {
      // Mono path
      const L = channels[0];
      const len = L.length;
      for (let i = 0; i < len; i++) {
        let x = L[i];
        x = this.lowShelfMid.process(x, 0);
        for (let b = 0; b < 5; b++) x = this.midBands[b].process(x, 0);
        x = this.highShelfMid.process(x, 0);
        L[i] = x;
      }
      return;
    }

    const L = channels[0];
    const R = channels[1];
    const len = L.length;

    for (let i = 0; i < len; i++) {
      const l = L[i];
      const r = R[i];

      let mid = (l + r) / 2;
      let side = (l - r) / 2;

      // Apply Mid EQ
      mid = this.lowShelfMid.process(mid, 0);
      for (let b = 0; b < 5; b++) mid = this.midBands[b].process(mid, 0);
      mid = this.highShelfMid.process(mid, 0);

      // Apply Side EQ
      side = this.lowShelfSide.process(side, 0);
      for (let b = 0; b < 5; b++) side = this.sideBands[b].process(side, 0);
      side = this.highShelfSide.process(side, 0);

      // Re-combine
      L[i] = mid + side;
      R[i] = mid - side;
    }
  }
}
