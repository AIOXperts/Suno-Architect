export class BiquadFilter {
  private b0 = 1; private b1 = 0; private b2 = 0;
  private a0 = 1; private a1 = 0; private a2 = 0;
  // Direct Form I state (x1, x2, y1, y2) per channel
  private x1 = [0, 0]; private x2 = [0, 0];
  private y1 = [0, 0]; private y2 = [0, 0];

  private setCoefficients(b0: number, b1: number, b2: number, a0: number, a1: number, a2: number) {
    this.b0 = b0 / a0;
    this.b1 = b1 / a0;
    this.b2 = b2 / a0;
    this.a1 = a1 / a0;
    this.a2 = a2 / a0;
  }

  setLowPass(freq: number, q: number, sampleRate: number) {
    const w0 = 2 * Math.PI * freq / sampleRate;
    const cosw0 = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    this.setCoefficients(
      (1 - cosw0) / 2,
      1 - cosw0,
      (1 - cosw0) / 2,
      1 + alpha,
      -2 * cosw0,
      1 - alpha
    );
  }

  setHighPass(freq: number, q: number, sampleRate: number) {
    const w0 = 2 * Math.PI * freq / sampleRate;
    const cosw0 = Math.cos(w0);
    const alpha = Math.sin(w0) / (2 * q);
    this.setCoefficients(
      (1 + cosw0) / 2,
      -(1 + cosw0),
      (1 + cosw0) / 2,
      1 + alpha,
      -2 * cosw0,
      1 - alpha
    );
  }

  setLowShelf(freq: number, q: number, gainDb: number, sampleRate: number) {
    const w0 = 2 * Math.PI * freq / sampleRate;
    const A = Math.pow(10, gainDb / 40);
    const alpha = Math.sin(w0) / (2 * q);
    const cosw0 = Math.cos(w0);
    const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;

    this.setCoefficients(
      A * ((A + 1) - (A - 1) * cosw0 + twoSqrtAAlpha),
      2 * A * ((A - 1) - (A + 1) * cosw0),
      A * ((A + 1) - (A - 1) * cosw0 - twoSqrtAAlpha),
      (A + 1) + (A - 1) * cosw0 + twoSqrtAAlpha,
      -2 * ((A - 1) + (A + 1) * cosw0),
      (A + 1) + (A - 1) * cosw0 - twoSqrtAAlpha
    );
  }

  setHighShelf(freq: number, q: number, gainDb: number, sampleRate: number) {
    const w0 = 2 * Math.PI * freq / sampleRate;
    const A = Math.pow(10, gainDb / 40);
    const alpha = Math.sin(w0) / (2 * q);
    const cosw0 = Math.cos(w0);
    const twoSqrtAAlpha = 2 * Math.sqrt(A) * alpha;

    this.setCoefficients(
      A * ((A + 1) + (A - 1) * cosw0 + twoSqrtAAlpha),
      -2 * A * ((A - 1) + (A + 1) * cosw0),
      A * ((A + 1) + (A - 1) * cosw0 - twoSqrtAAlpha),
      (A + 1) - (A - 1) * cosw0 + twoSqrtAAlpha,
      2 * ((A - 1) - (A + 1) * cosw0),
      (A + 1) - (A - 1) * cosw0 - twoSqrtAAlpha
    );
  }

  setPeaking(freq: number, q: number, gainDb: number, sampleRate: number) {
    const w0 = 2 * Math.PI * freq / sampleRate;
    const A = Math.pow(10, gainDb / 40);
    const alpha = Math.sin(w0) / (2 * q);
    const cosw0 = Math.cos(w0);

    this.setCoefficients(
      1 + alpha * A,
      -2 * cosw0,
      1 - alpha * A,
      1 + alpha / A,
      -2 * cosw0,
      1 - alpha / A
    );
  }

  setAllPass(freq: number, q: number, sampleRate: number) {
    const w0 = 2 * Math.PI * freq / sampleRate;
    const alpha = Math.sin(w0) / (2 * q);
    const cosw0 = Math.cos(w0);
    this.setCoefficients(
      1 - alpha,
      -2 * cosw0,
      1 + alpha,
      1 + alpha,
      -2 * cosw0,
      1 - alpha
    );
  }

  process(x: number, channel = 0) {
    if (this.x1.length <= channel) {
      this.x1.push(0); this.x2.push(0);
      this.y1.push(0); this.y2.push(0);
    }
    
    // Direct Form I
    const y = this.b0 * x + this.b1 * this.x1[channel] + this.b2 * this.x2[channel] 
            - this.a1 * this.y1[channel] - this.a2 * this.y2[channel];
    
    // Check for NaN or Infinity to prevent cascade failure
    if (!Number.isFinite(y)) {
        this.reset();
        return 0;
    }

    this.x2[channel] = this.x1[channel];
    this.x1[channel] = x;
    this.y2[channel] = this.y1[channel];
    this.y1[channel] = y;
    
    return y;
  }
  
  reset() {
    this.x1.fill(0); this.x2.fill(0);
    this.y1.fill(0); this.y2.fill(0);
  }
}

export class DelayLine {
  private buffer: Float32Array;
  private ptr = 0;
  private size: number;

  constructor(maxSize: number) {
    this.size = maxSize;
    this.buffer = new Float32Array(maxSize);
  }

  push(x: number) {
    this.buffer[this.ptr] = x;
    this.ptr = (this.ptr + 1) % this.size;
  }

  // Read value from 'delaySamples' ago
  read(delaySamples: number): number {
    // Current ptr points to the "next" index to be written.
    // Index 'ptr-1' is the last written sample (delay=0).
    // Index 'ptr-delaySamples' is 'delaySamples' ago.
    let readIdx = (this.ptr - Math.floor(delaySamples)) % this.size;
    while (readIdx < 0) readIdx += this.size;
    return this.buffer[readIdx];
  }

  // Fractional delay with linear interpolation
  readFrac(delaySamples: number): number {
    const dInt = Math.floor(delaySamples);
    const dFrac = delaySamples - dInt;
    const s1 = this.read(dInt);
    const s2 = this.read(dInt + 1);
    return s1 + dFrac * (s2 - s1);
  }
  
  reset() {
      this.buffer.fill(0);
      this.ptr = 0;
  }
}

/**
 * Linkwitz-Riley 4th Order Crossover.
 * Formed by cascading two 2nd order Butterworth filters.
 */
export class LinkwitzRileyFilter {
  private lp1 = new BiquadFilter();
  private lp2 = new BiquadFilter();
  private hp1 = new BiquadFilter();
  private hp2 = new BiquadFilter();

  constructor(freq: number, sampleRate: number) {
    const q = 0.7071067811865476; // Butterworth Q
    this.lp1.setLowPass(freq, q, sampleRate);
    this.lp2.setLowPass(freq, q, sampleRate);
    this.hp1.setHighPass(freq, q, sampleRate);
    this.hp2.setHighPass(freq, q, sampleRate);
  }

  process(x: number, channel = 0): { low: number, high: number } {
    const low = this.lp2.process(this.lp1.process(x, channel), channel);
    const high = this.hp2.process(this.hp1.process(x, channel), channel);
    return { low, high };
  }
}

export function dbToLinear(db: number) { return Math.pow(10, db / 20); }
export function linearToDb(linear: number) { 
  if (linear <= 1e-10) return -200;
  return 20 * Math.log10(linear); 
}
