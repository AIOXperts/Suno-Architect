import { LinkwitzRileyFilter } from '../utils';
import { Compressor } from './compressor';

export class MultibandCompressor {
  private lowMidXover: LinkwitzRileyFilter;
  private midHighXover: LinkwitzRileyFilter;
  
  private lowComp: Compressor;
  private midComp: Compressor;
  private highComp: Compressor;

  constructor(sampleRate: number) {
    this.lowMidXover = new LinkwitzRileyFilter(200, sampleRate);
    this.midHighXover = new LinkwitzRileyFilter(3000, sampleRate);

    this.lowComp = new Compressor(sampleRate);
    this.midComp = new Compressor(sampleRate);
    this.highComp = new Compressor(sampleRate);

    // Default "Glue" settings
    this.lowComp.setThreshold(-18);
    this.lowComp.setRatio(2.5);
    this.lowComp.setAttack(0.02);
    this.lowComp.setRelease(0.2);

    this.midComp.setThreshold(-20);
    this.midComp.setRatio(2.0);
    this.midComp.setAttack(0.01);
    this.midComp.setRelease(0.15);

    this.highComp.setThreshold(-22);
    this.highComp.setRatio(2.0);
    this.highComp.setAttack(0.005);
    this.highComp.setRelease(0.1);
  }

  process(channels: Float32Array[]) {
    const numChannels = channels.length;
    const len = channels[0].length;

    for (let i = 0; i < len; i++) {
      const bandLow: number[] = [];
      const bandMid: number[] = [];
      const bandHigh: number[] = [];

      // 1. Split each channel into 3 bands
      for (let ch = 0; ch < numChannels; ch++) {
        const x = channels[ch][i];
        const { low, high: midHigh } = this.lowMidXover.process(x, ch);
        const { low: mid, high } = this.midHighXover.process(midHigh, ch);
        
        bandLow.push(low);
        bandMid.push(mid);
        bandHigh.push(high);
      }

      // 2. Compute linked gain reduction per band
      let maxLow = 0, maxMid = 0, maxHigh = 0;
      for (let ch = 0; ch < numChannels; ch++) {
        maxLow = Math.max(maxLow, Math.abs(bandLow[ch]));
        maxMid = Math.max(maxMid, Math.abs(bandMid[ch]));
        maxHigh = Math.max(maxHigh, Math.abs(bandHigh[ch]));
      }

      const lowG = this.lowComp.processSample(maxLow);
      const midG = this.midComp.processSample(maxMid);
      const highG = this.highComp.processSample(maxHigh);

      // 3. Recombine and write back
      for (let ch = 0; ch < numChannels; ch++) {
        channels[ch][i] = (bandLow[ch] * lowG) + (bandMid[ch] * midG) + (bandHigh[ch] * highG);
      }
    }
  }
}
