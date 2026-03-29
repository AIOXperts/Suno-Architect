
import { AlignedWord, Qt6Style } from '../types';

export const hexToRgba = (hex: string, alpha: number) => {
    let c: any;
    if(/^#([A-Fa-f0-9]{3}){1,2}$/.test(hex)){
        c= hex.substring(1).split('');
        if(c.length== 3) c= [c[0], c[0], c[1], c[1], c[2], c[2]];
        c= '0x'+c.join('');
        return 'rgba('+[(c>>16)&255, (c>>8)&255, c&255].join(',')+','+alpha+')';
    }
    return `rgba(255,255,255,${alpha})`;
};

export const formatTime = (seconds: number) => {
    if (!seconds || isNaN(seconds)) return "0:00";
    const m = Math.floor(seconds / 60);
    const s = Math.floor(seconds % 60);
    return `${m}:${s.toString().padStart(2, '0')}`;
};

export const drawCover = (ctx: CanvasRenderingContext2D, img: CanvasImageSource | HTMLVideoElement | HTMLImageElement, w: number, h: number) => {
    let imgW = 0; let imgH = 0;
    if (img instanceof HTMLVideoElement) { imgW = img.videoWidth; imgH = img.videoHeight; } 
    else if (img instanceof HTMLImageElement) { imgW = img.naturalWidth || img.width; imgH = img.naturalHeight || img.height; }
    if (!imgW || !imgH) return;
    const imgRatio = imgW / imgH; const winRatio = w / h;
    let drawW, drawH, startX, startY;
    if (imgRatio > winRatio) { drawH = h; drawW = h * imgRatio; startX = (w - drawW) / 2; startY = 0; } 
    else { drawW = w; drawH = w / imgRatio; startX = 0; startY = (h - drawH) / 2; }
    ctx.drawImage(img, startX, startY, drawW, drawH);
};

export const drawLogoWatermark = (
    ctx: CanvasRenderingContext2D,
    logo: CanvasImageSource | HTMLImageElement,
    x: number,
    y: number,
    size: number,
    opacity: number
) => {
    ctx.save();
    ctx.globalAlpha = Math.max(0.1, Math.min(1, opacity));
    ctx.drawImage(logo, x, y, size, size);
    ctx.restore();
};

const drawRadialBar = (ctx: CanvasRenderingContext2D, cx: number, cy: number, r: number, h: number, angle: number) => {
    const x1 = cx + Math.cos(angle) * r;
    const y1 = cy + Math.sin(angle) * r;
    const x2 = cx + Math.cos(angle) * (r + h);
    const y2 = cy + Math.sin(angle) * (r + h);
    
    ctx.beginPath();
    ctx.moveTo(x1, y1);
    ctx.lineTo(x2, y2);
    ctx.stroke();
};

export const drawCornerPulseVisualizer = (
    ctx: CanvasRenderingContext2D,
    data: Uint8Array | Float32Array,
    settings: {
        activeColor: string;
        qt6Sensitivity: number;
        centerX: number;
        centerY: number;
        radius: number;
    }
) => {
    const { activeColor, qt6Sensitivity, centerX, centerY, radius } = settings;
    const bufferLength = data.length;
    const usefulLimit = Math.floor(bufferLength * 0.5);
    const totalBars = 56;
    const halfBars = totalBars / 2;
    const step = Math.max(1, Math.floor((usefulLimit - 2) / halfBars));
    const maxExtrude = radius * 0.85;

    let bassSum = 0;
    for(let k = 2; k < 16; k++) bassSum += (data[k] as number);
    const bassEnergy = (bassSum / 14 / 255.0) * qt6Sensitivity;
    const currentRadius = radius + (bassEnergy * 10);

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 2.5;
    ctx.strokeStyle = activeColor;

    for(let i = 0; i < halfBars; i++) {
        let sum = 0;
        let count = 0;
        for(let j = 0; j < step; j++) {
            const idx = 2 + (i * step) + j;
            if(idx < usefulLimit) {
                sum += (data[idx] as number);
                count++;
            }
        }
        const avg = count > 0 ? (sum / count) : 0;
        const val = (avg / 255.0) * qt6Sensitivity;
        const barH = Math.max(2, Math.pow(val, 1.7) * maxExtrude);

        const angleStep = Math.PI / halfBars;
        const angleOffset = i * angleStep;
        drawRadialBar(ctx, centerX, centerY, currentRadius, barH, -Math.PI / 2 + angleOffset);
        if (i > 0) drawRadialBar(ctx, centerX, centerY, currentRadius, barH, -Math.PI / 2 - angleOffset);
    }

    ctx.beginPath();
    ctx.arc(centerX, centerY, currentRadius - 4, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(activeColor, 0.12 + (bassEnergy * 0.18));
    ctx.fill();
    ctx.strokeStyle = hexToRgba(activeColor, 0.45);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
};

export const drawLogoExpandingCircle = (
    ctx: CanvasRenderingContext2D,
    data: Uint8Array | Float32Array,
    settings: {
        activeColor: string;
        sensitivity: number;
        centerX: number;
        centerY: number;
        radius: number;
    }
) => {
    const { activeColor, sensitivity, centerX, centerY, radius } = settings;
    let bassSum = 0;
    let bins = 0;
    for (let i = 2; i < 24 && i < data.length; i++) {
        bassSum += (data[i] as number);
        bins++;
    }
    const bass = bins > 0 ? bassSum / bins : 0;
    const energy = (bass / 255) * Math.max(0.3, sensitivity);
    const pulse = radius * (0.25 + (energy * 0.7));

    ctx.save();
    const halo = ctx.createRadialGradient(
        centerX,
        centerY,
        Math.max(2, radius * 0.06),
        centerX,
        centerY,
        radius + pulse
    );
    halo.addColorStop(0, hexToRgba(activeColor, 0.18 + (energy * 0.25)));
    halo.addColorStop(1, hexToRgba(activeColor, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + pulse, 0, Math.PI * 2);
    ctx.fill();

    ctx.strokeStyle = hexToRgba(activeColor, 0.65);
    ctx.lineWidth = Math.max(2, radius * 0.06);
    ctx.beginPath();
    ctx.arc(centerX, centerY, radius + (energy * radius * 0.6), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
};

export const drawLogoCircularWave = (
    ctx: CanvasRenderingContext2D,
    data: Uint8Array | Float32Array,
    settings: {
        activeColor: string;
        sensitivity: number;
        centerX: number;
        centerY: number;
        radius: number;
    }
) => {
    const { activeColor, sensitivity, centerX, centerY, radius } = settings;
    const bufferLength = data.length;
    const usefulLimit = Math.max(8, Math.floor(bufferLength * 0.4));
    const numPoints = 96;
    const maxAmp = radius * 0.9;

    const points: Array<{ x: number; y: number }> = [];

    for (let i = 0; i < numPoints; i++) {
        const angle = (Math.PI * 2 * i) / numPoints - (Math.PI / 2);
        const sampleIdx = 2 + Math.floor((i / numPoints) * (usefulLimit - 2));
        const sample = Math.max(0, Math.min(255, data[sampleIdx] as number));
        const energy = Math.pow(sample / 255, 1.45) * Math.max(0.3, sensitivity);
        const r = radius + (energy * maxAmp);
        points.push({
            x: centerX + Math.cos(angle) * r,
            y: centerY + Math.sin(angle) * r,
        });
    }

    ctx.save();
    ctx.beginPath();
    if (points.length > 0) {
        const last = points[points.length - 1];
        const first = points[0];
        ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
        for (let i = 0; i < points.length; i++) {
            const p = points[i];
            const next = points[(i + 1) % points.length];
            ctx.quadraticCurveTo(p.x, p.y, (p.x + next.x) / 2, (p.y + next.y) / 2);
        }
    }
    ctx.closePath();
    ctx.lineWidth = Math.max(2, radius * 0.06);
    ctx.strokeStyle = activeColor;
    ctx.stroke();

    const fill = ctx.createRadialGradient(centerX, centerY, radius * 0.4, centerX, centerY, radius + maxAmp);
    fill.addColorStop(0, hexToRgba(activeColor, 0.03));
    fill.addColorStop(1, hexToRgba(activeColor, 0.18));
    ctx.fillStyle = fill;
    ctx.fill();
    ctx.restore();
};

type NumericArray = Uint8Array | Float32Array;
export type VisualizerFrameData = NumericArray | {
    frequencyData: NumericArray;
    timeData?: NumericArray;
    leftFrequencyData?: NumericArray;
    rightFrequencyData?: NumericArray;
    leftTimeData?: NumericArray;
    rightTimeData?: NumericArray;
};

type Particle = { x: number; y: number; vx: number; vy: number; life: number; size: number; hueOffset: number };
const peakHoldCache = new WeakMap<CanvasRenderingContext2D, Map<string, number[]>>();
const spectrogramCache = new WeakMap<CanvasRenderingContext2D, HTMLCanvasElement>();
const particleCache = new WeakMap<CanvasRenderingContext2D, Particle[]>();

const getFrequencyData = (data: VisualizerFrameData): NumericArray => {
    return (data as any).frequencyData ? (data as any).frequencyData : (data as NumericArray);
};

const getTimeData = (data: VisualizerFrameData): NumericArray | null => {
    if ((data as any).timeData) return (data as any).timeData as NumericArray;
    if ((data as any).frequencyData) return null;
    return data as NumericArray;
};

const getStereoFrequencyData = (data: VisualizerFrameData): { left: NumericArray | null; right: NumericArray | null } => {
    if ((data as any).leftFrequencyData || (data as any).rightFrequencyData) {
        return {
            left: ((data as any).leftFrequencyData as NumericArray) || null,
            right: ((data as any).rightFrequencyData as NumericArray) || null,
        };
    }
    return { left: null, right: null };
};

const getStereoTimeData = (data: VisualizerFrameData): { left: NumericArray | null; right: NumericArray | null } => {
    if ((data as any).leftTimeData || (data as any).rightTimeData) {
        return {
            left: ((data as any).leftTimeData as NumericArray) || null,
            right: ((data as any).rightTimeData as NumericArray) || null,
        };
    }
    return { left: null, right: null };
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

const sampleByte = (data: NumericArray, idx: number) => {
    const i = Math.max(0, Math.min(data.length - 1, idx));
    if (data instanceof Float32Array) {
        return Math.round((clamp01(((data[i] as number) + 1) / 2)) * 255);
    }
    return Math.max(0, Math.min(255, data[i] as number));
};

const sampleWaveNorm = (data: NumericArray, idx: number) => {
    const i = Math.max(0, Math.min(data.length - 1, idx));
    if (data instanceof Float32Array) return Math.max(-1, Math.min(1, data[i] as number));
    return ((data[i] as number) - 128) / 128;
};

const avgBins = (data: NumericArray, start: number, end: number) => {
    const s = Math.max(0, Math.floor(start));
    const e = Math.max(s + 1, Math.min(data.length, Math.floor(end)));
    let sum = 0;
    let count = 0;
    for (let i = s; i < e; i++) {
        sum += sampleByte(data, i);
        count++;
    }
    return count > 0 ? sum / count : 0;
};

const getBandValues = (
    data: NumericArray,
    count: number,
    options: { startBin?: number; endRatio?: number; logScale?: boolean; gamma?: number; sensitivity?: number } = {}
) => {
    const startBin = options.startBin ?? 2;
    const endRatio = options.endRatio ?? 0.65;
    const usefulLimit = Math.max(startBin + 1, Math.min(data.length, Math.floor(data.length * endRatio)));
    const gamma = options.gamma ?? 1.35;
    const sensitivity = Math.max(0.2, options.sensitivity ?? 1);
    const vals: number[] = [];
    for (let i = 0; i < count; i++) {
        let from: number;
        let to: number;
        if (options.logScale) {
            const t0 = i / count;
            const t1 = (i + 1) / count;
            const p0 = Math.pow(t0, 2.2);
            const p1 = Math.pow(t1, 2.2);
            from = startBin + p0 * (usefulLimit - startBin);
            to = startBin + p1 * (usefulLimit - startBin);
        } else {
            from = startBin + (i / count) * (usefulLimit - startBin);
            to = startBin + ((i + 1) / count) * (usefulLimit - startBin);
        }
        const avg = avgBins(data, from, to);
        const v = clamp01(Math.pow(avg / 255, gamma) * sensitivity);
        vals.push(v);
    }
    return vals;
};

const getBassEnergy = (data: NumericArray, sensitivity: number) => {
    const bass = avgBins(data, 2, Math.min(24, data.length));
    return clamp01((bass / 255) * sensitivity);
};

const getPeakArray = (ctx: CanvasRenderingContext2D, key: string, values: number[], decay = 0.015) => {
    let store = peakHoldCache.get(ctx);
    if (!store) {
        store = new Map();
        peakHoldCache.set(ctx, store);
    }
    let peaks = store.get(key);
    if (!peaks || peaks.length !== values.length) {
        peaks = values.slice();
        store.set(key, peaks);
        return peaks;
    }
    for (let i = 0; i < values.length; i++) {
        peaks[i] = Math.max(values[i], peaks[i] - decay);
    }
    return peaks;
};

const getSpectrogramBuffer = (ctx: CanvasRenderingContext2D, width: number, height: number) => {
    let buffer = spectrogramCache.get(ctx);
    if (!buffer || buffer.width !== width || buffer.height !== height) {
        buffer = document.createElement('canvas');
        buffer.width = width;
        buffer.height = height;
        spectrogramCache.set(ctx, buffer);
    }
    return buffer;
};

const roundRectCompat = (ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) => {
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, r);
    else ctx.rect(x, y, w, h);
};

const drawOscilloscopeLine = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    timeData: NumericArray,
    activeColor: string,
    sensitivity: number
) => {
    const bufferLength = timeData.length;
    let trigger = 0;
    const searchLimit = Math.floor(bufferLength / 2);
    for (let i = 0; i < searchLimit - 1; i++) {
        const val = sampleWaveNorm(timeData, i);
        const nextVal = sampleWaveNorm(timeData, i + 1);
        if (val <= 0 && nextVal > 0) {
            trigger = i;
            break;
        }
    }

    const windowSize = Math.max(8, Math.floor(bufferLength * 0.5));
    const sliceWidth = width / windowSize;
    const baseline = height * 0.5;
    const scale = height * 0.4 * sensitivity;

    ctx.beginPath();
    for (let i = 0; i < windowSize; i++) {
        const idx = trigger + i;
        if (idx >= bufferLength) break;
        const v = sampleWaveNorm(timeData, idx);
        const x = i * sliceWidth;
        const y = baseline - (v * scale);
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
    }
    const grad = ctx.createLinearGradient(width * 0.8, 0, width, 0);
    grad.addColorStop(0, activeColor);
    grad.addColorStop(1, hexToRgba(activeColor, 0));
    ctx.strokeStyle = grad;
    ctx.lineWidth = 2;
    ctx.stroke();
};

const drawBarSeries = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    values: number[],
    activeColor: string,
    options: { yBase?: number; maxHeight?: number; rounded?: boolean; alpha?: number; mirrored?: boolean } = {}
) => {
    const yBase = options.yBase ?? height * 0.95;
    const maxHeight = options.maxHeight ?? (height * 0.5);
    const slot = width / Math.max(1, values.length);
    const barWidth = slot * 0.78;
    const gap = slot - barWidth;
    ctx.save();
    ctx.fillStyle = options.alpha ? hexToRgba(activeColor, options.alpha) : activeColor;
    for (let i = 0; i < values.length; i++) {
        const barH = Math.max(2, values[i] * maxHeight);
        const x = i * slot + gap / 2;
        const y = yBase - barH;
        if (options.rounded) roundRectCompat(ctx, x, y, barWidth, barH, 4);
        else { ctx.beginPath(); ctx.rect(x, y, barWidth, barH); }
        ctx.fill();
        if (options.mirrored) {
            const y2 = yBase + 2;
            if (options.rounded) roundRectCompat(ctx, x, y2, barWidth, barH, 4);
            else { ctx.beginPath(); ctx.rect(x, y2, barWidth, barH); }
            ctx.fill();
        }
    }
    ctx.restore();
};

const drawExistingCircleStyle = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    data: NumericArray,
    sensitivity: number,
    activeColor: string
) => {
    const centerX = width / 2;
    const centerY = height / 2;
    const baseRadius = Math.min(width, height) * 0.20;
    const maxExtrude = Math.min(width, height) * 0.25;
    const bassEnergy = getBassEnergy(data, sensitivity);
    const currentRadius = baseRadius + (bassEnergy * 20);
    const totalBars = 64;
    const halfBars = totalBars / 2;
    const usefulLimit = Math.floor(data.length * 0.5);
    const step = Math.max(1, Math.floor((usefulLimit - 2) / halfBars));

    ctx.save();
    ctx.lineCap = 'round';
    ctx.lineWidth = 4;
    ctx.strokeStyle = activeColor;
    for (let i = 0; i < halfBars; i++) {
        const avg = avgBins(data, 2 + i * step, 2 + (i + 1) * step);
        const val = clamp01((avg / 255) * sensitivity);
        const barH = Math.max(4, Math.pow(val, 2) * maxExtrude);
        const angleStep = Math.PI / halfBars;
        const angleOffset = i * angleStep;
        drawRadialBar(ctx, centerX, centerY, currentRadius, barH, -Math.PI / 2 + angleOffset);
        if (i > 0) drawRadialBar(ctx, centerX, centerY, currentRadius, barH, -Math.PI / 2 - angleOffset);
    }
    ctx.beginPath();
    ctx.arc(centerX, centerY, currentRadius - 5, 0, Math.PI * 2);
    ctx.fillStyle = hexToRgba(activeColor, 0.1 + (bassEnergy * 0.2));
    ctx.fill();
    ctx.strokeStyle = hexToRgba(activeColor, 0.5);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
};

const drawExistingCircularWaveStyle = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    data: NumericArray,
    sensitivity: number,
    activeColor: string
) => {
    const centerX = width / 2;
    const centerY = height / 2;
    const radius = Math.min(width, height) * 0.2;
    const maxAmp = Math.min(width, height) * 0.25;
    let energy = 0;
    const usefulLimit = Math.max(8, Math.floor(data.length * 0.35));
    for (let i = 2; i < Math.min(20, usefulLimit); i++) energy += sampleByte(data, i);
    const pulse = (energy / 18 / 255.0) * 15 * sensitivity;

    const numPoints = 120;
    const wavePoints: { x: number; y: number }[] = [];
    for (let i = 0; i < numPoints; i++) {
        const relativeIdx = i < (numPoints / 2) ? i / (numPoints / 2) : (numPoints - i) / (numPoints / 2);
        const mappedIdx = Math.floor(Math.pow(relativeIdx, 1.2) * (usefulLimit - 2)) + 2;
        const val = avgBins(data, mappedIdx - 1, mappedIdx + 2);
        const scaledVal = Math.pow(val / 255, 1.5);
        const offset = scaledVal * maxAmp * sensitivity;
        const r = radius + pulse + offset;
        const angle = (Math.PI * 2 * i) / numPoints - (Math.PI / 2);
        wavePoints.push({ x: centerX + Math.cos(angle) * r, y: centerY + Math.sin(angle) * r });
    }

    ctx.save();
    ctx.beginPath();
    if (wavePoints.length > 0) {
        const last = wavePoints[wavePoints.length - 1];
        const first = wavePoints[0];
        ctx.moveTo((last.x + first.x) / 2, (last.y + first.y) / 2);
        for (let i = 0; i < wavePoints.length; i++) {
            const p = wavePoints[i];
            const nextP = wavePoints[(i + 1) % wavePoints.length];
            ctx.quadraticCurveTo(p.x, p.y, (p.x + nextP.x) / 2, (p.y + nextP.y) / 2);
        }
    }
    ctx.closePath();
    ctx.lineWidth = 3;
    ctx.strokeStyle = activeColor;
    ctx.stroke();
    const grad = ctx.createRadialGradient(centerX, centerY, radius * 0.5, centerX, centerY, radius + maxAmp);
    grad.addColorStop(0, hexToRgba(activeColor, 0.05));
    grad.addColorStop(1, hexToRgba(activeColor, 0.25));
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.restore();
};

const drawStereoBars = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    data: NumericArray,
    sensitivity: number,
    activeColor: string,
    barCount: number,
    stereo?: { left?: NumericArray | null; right?: NumericArray | null }
) => {
    const half = Math.max(8, Math.floor(barCount / 2));
    const leftSrc = stereo?.left || data;
    const rightSrc = stereo?.right || data;
    const leftValues = getBandValues(leftSrc, half, { logScale: true, sensitivity, gamma: 1.25, endRatio: 0.65 });
    const rightValues = getBandValues(rightSrc, half, { logScale: true, sensitivity, gamma: 1.25, endRatio: 0.65 });
    const centerY = height * 0.62;
    ctx.save();
    ctx.fillStyle = hexToRgba(activeColor, 0.9);
    for (let i = 0; i < half; i++) {
        const slot = (width / 2) / half;
        const bw = slot * 0.75;
        const maxH = height * 0.32;
        const lH = Math.max(2, leftValues[i] * maxH);
        const rH = Math.max(2, rightValues[i] * maxH);
        const lx = (width / 2) - ((i + 1) * slot) + (slot - bw) / 2;
        const rx = (width / 2) + (i * slot) + (slot - bw) / 2;
        roundRectCompat(ctx, lx, centerY - lH, bw, lH, 3); ctx.fill();
        roundRectCompat(ctx, rx, centerY - rH, bw, rH, 3); ctx.fill();
    }
    const peaksL = getPeakArray(ctx, `stereo-l-${half}`, leftValues, 0.02);
    const peaksR = getPeakArray(ctx, `stereo-r-${half}`, rightValues, 0.02);
    ctx.fillStyle = '#ffffff';
    for (let i = 0; i < half; i++) {
        const slot = (width / 2) / half;
        const bw = slot * 0.75;
        const xGap = (slot - bw) / 2;
        const maxH = height * 0.32;
        const lY = centerY - Math.max(2, peaksL[i] * maxH);
        const rY = centerY - Math.max(2, peaksR[i] * maxH);
        ctx.fillRect((width / 2) - ((i + 1) * slot) + xGap, lY - 2, bw, 2);
        ctx.fillRect((width / 2) + (i * slot) + xGap, rY - 2, bw, 2);
    }
    ctx.strokeStyle = hexToRgba(activeColor, 0.35);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, centerY + 2);
    ctx.lineTo(width, centerY + 2);
    ctx.stroke();
    ctx.restore();
};

const drawLogBars = (ctx: CanvasRenderingContext2D, width: number, height: number, data: NumericArray, sensitivity: number, activeColor: string, barCount: number) => {
    const values = getBandValues(data, Math.max(16, Math.min(128, barCount)), { logScale: true, sensitivity, gamma: 1.15 });
    const peaks = getPeakArray(ctx, `log-bars-${values.length}`, values, 0.01);
    drawBarSeries(ctx, width, height, values, activeColor, { rounded: true, yBase: height * 0.94, maxHeight: height * 0.52 });
    ctx.save();
    ctx.fillStyle = hexToRgba('#ffffff', 0.8);
    const slot = width / values.length;
    const bw = slot * 0.78;
    for (let i = 0; i < values.length; i++) {
        const x = i * slot + (slot - bw) / 2;
        const y = height * 0.94 - (peaks[i] * height * 0.52);
        ctx.fillRect(x, y - 2, bw, 2);
    }
    ctx.restore();
};

const drawLedBars = (ctx: CanvasRenderingContext2D, width: number, height: number, data: NumericArray, sensitivity: number, activeColor: string, barCount: number, segments = 14) => {
    const count = Math.max(12, Math.min(80, Math.floor(barCount / 2)));
    const values = getBandValues(data, count, { logScale: true, sensitivity, gamma: 1.2 });
    const segmentCount = Math.max(6, Math.min(32, Math.round(segments)));
    const slot = width / count;
    const bw = slot * 0.68;
    const segGap = 3;
    const usableH = height * 0.52;
    const segH = (usableH - (segmentCount - 1) * segGap) / segmentCount;
    const baseY = height * 0.92;
    const peaks = getPeakArray(ctx, `led-${count}`, values, 0.02);
    for (let i = 0; i < count; i++) {
        const x = i * slot + (slot - bw) / 2;
        const litSegments = Math.round(values[i] * segmentCount);
        const peakSeg = Math.min(segmentCount - 1, Math.max(0, Math.round(peaks[i] * segmentCount)));
        for (let s = 0; s < segmentCount; s++) {
            const y = baseY - ((s + 1) * segH) - (s * segGap);
            const lit = s < litSegments;
            const peak = s === peakSeg;
            ctx.fillStyle = peak ? '#ffffff' : (lit ? hexToRgba(activeColor, 0.95) : hexToRgba(activeColor, 0.12));
            roundRectCompat(ctx, x, y, bw, segH, 2);
            ctx.fill();
        }
    }
};

const drawRadialSpectrum = (ctx: CanvasRenderingContext2D, width: number, height: number, data: NumericArray, sensitivity: number, activeColor: string, barCount: number) => {
    const centerX = width / 2;
    const centerY = height / 2;
    const innerR = Math.min(width, height) * 0.16;
    const values = getBandValues(data, Math.max(24, Math.min(180, barCount)), { logScale: true, sensitivity, gamma: 1.25, endRatio: 0.7 });
    const maxExtrude = Math.min(width, height) * 0.18;
    ctx.save();
    ctx.lineCap = 'round';
    for (let i = 0; i < values.length; i++) {
        const angle = (Math.PI * 2 * i) / values.length - Math.PI / 2;
        const h = Math.max(2, values[i] * maxExtrude);
        ctx.strokeStyle = hexToRgba(activeColor, 0.45 + values[i] * 0.55);
        ctx.lineWidth = 1.5 + values[i] * 2.5;
        drawRadialBar(ctx, centerX, centerY, innerR, h, angle);
    }
    ctx.beginPath();
    ctx.arc(centerX, centerY, innerR - 6, 0, Math.PI * 2);
    ctx.strokeStyle = hexToRgba(activeColor, 0.35);
    ctx.lineWidth = 2;
    ctx.stroke();
    ctx.restore();
};

const drawWaveSpectrumCombo = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    freqData: NumericArray,
    timeData: NumericArray | null,
    sensitivity: number,
    activeColor: string,
    barCount: number
) => {
    const bars = getBandValues(freqData, Math.max(24, Math.min(128, barCount)), { logScale: true, sensitivity, gamma: 1.2 });
    drawBarSeries(ctx, width, height, bars, activeColor, { rounded: true, alpha: 0.22, yBase: height * 0.88, maxHeight: height * 0.32 });
    const wave = timeData ?? freqData;
    ctx.save();
    ctx.shadowColor = hexToRgba(activeColor, 0.6);
    ctx.shadowBlur = 12;
    drawOscilloscopeLine(ctx, width, Math.round(height * 0.78), wave, activeColor, Math.max(0.8, sensitivity * 0.85));
    ctx.restore();
};

const drawStereoWave = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    fallback: NumericArray,
    sensitivity: number,
    activeColor: string,
    stereo?: { left?: NumericArray | null; right?: NumericArray | null }
) => {
    const left = stereo?.left || fallback;
    const right = stereo?.right || fallback;
    const mid = height / 2;
    ctx.save();
    ctx.strokeStyle = hexToRgba(activeColor, 0.25);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, mid);
    ctx.lineTo(width, mid);
    ctx.stroke();

    const drawLane = (data: NumericArray, top: number, laneHeight: number, color: string) => {
        ctx.save();
        ctx.beginPath();
        const bufferLength = data.length;
        const windowSize = Math.max(8, Math.floor(bufferLength * 0.55));
        const sliceWidth = width / windowSize;
        const baseline = top + laneHeight / 2;
        const scale = laneHeight * 0.42 * sensitivity;
        let trigger = 0;
        for (let i = 0; i < Math.floor(bufferLength / 2) - 1; i++) {
            const v = sampleWaveNorm(data, i);
            const n = sampleWaveNorm(data, i + 1);
            if (v <= 0 && n > 0) { trigger = i; break; }
        }
        for (let i = 0; i < windowSize; i++) {
            const idx = Math.min(bufferLength - 1, trigger + i);
            const x = i * sliceWidth;
            const y = baseline - sampleWaveNorm(data, idx) * scale;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        const grad = ctx.createLinearGradient(0, top, width, top + laneHeight);
        grad.addColorStop(0, hexToRgba(color, 0.95));
        grad.addColorStop(1, hexToRgba(color, 0.1));
        ctx.strokeStyle = grad;
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.restore();
    };

    drawLane(left, height * 0.12, height * 0.3, activeColor);
    drawLane(right, height * 0.58, height * 0.3, '#22d3ee');

    ctx.fillStyle = hexToRgba('#ffffff', 0.85);
    ctx.font = `700 ${Math.max(10, Math.round(height * 0.018))}px sans-serif`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText('L', 10, height * 0.27);
    ctx.fillText('R', 10, height * 0.73);
    ctx.restore();
};

const drawVuMeter = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    data: NumericArray,
    sensitivity: number,
    activeColor: string,
    stereo?: { left?: NumericArray | null; right?: NumericArray | null }
) => {
    const leftSrc = stereo?.left || data;
    const rightSrc = stereo?.right || data;
    const left = clamp01((avgBins(leftSrc, 2, Math.floor(leftSrc.length * 0.55)) / 255) * sensitivity);
    const right = clamp01((avgBins(rightSrc, 2, Math.floor(rightSrc.length * 0.55)) / 255) * sensitivity);
    const values = [left, right];
    const peaks = getPeakArray(ctx, 'vu-meter', values, 0.012);
    const meterW = width * 0.34;
    const meterH = Math.max(18, height * 0.05);
    const startX = (width - meterW) / 2;
    const startY = height * 0.72;
    ['L', 'R'].forEach((label, idx) => {
        const y = startY + idx * (meterH + 18);
        ctx.fillStyle = hexToRgba('#0f172a', 0.75);
        roundRectCompat(ctx, startX, y, meterW, meterH, 8); ctx.fill();
        const filled = meterW * values[idx];
        const grad = ctx.createLinearGradient(startX, y, startX + meterW, y);
        grad.addColorStop(0, '#22c55e');
        grad.addColorStop(0.65, activeColor);
        grad.addColorStop(1, '#ef4444');
        ctx.fillStyle = grad;
        roundRectCompat(ctx, startX, y, Math.max(4, filled), meterH, 8); ctx.fill();
        const px = startX + meterW * peaks[idx];
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(px - 1, y - 2, 2, meterH + 4);
        ctx.fillStyle = hexToRgba('#ffffff', 0.8);
        ctx.font = `700 ${Math.max(12, Math.round(height * 0.02))}px sans-serif`;
        ctx.textAlign = 'right';
        ctx.textBaseline = 'middle';
        ctx.fillText(label, startX - 10, y + meterH / 2);
    });
};

const drawSpectrogram = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    data: NumericArray,
    sensitivity: number,
    speed = 1,
    palette: 'neon' | 'fire' | 'ice' | 'mono' = 'neon'
) => {
    const buffer = getSpectrogramBuffer(ctx, width, height);
    const bctx = buffer.getContext('2d');
    if (!bctx) return;
    const scroll = Math.max(1, Math.min(6, Math.round(speed)));
    bctx.drawImage(buffer, -scroll, 0);
    const bands = getBandValues(data, Math.max(48, Math.floor(height / 6)), { logScale: true, sensitivity, gamma: 0.95, endRatio: 0.9 });
    for (let x = 0; x < scroll; x++) {
        for (let y = 0; y < bands.length; y++) {
            const v = bands[y];
            if (palette === 'mono') {
                const light = 8 + (v * 82);
                bctx.fillStyle = `hsla(0, 0%, ${light}%, 1)`;
            } else if (palette === 'fire') {
                const hue = 40 - (v * 40);
                const sat = 92;
                const light = 10 + (v * 62);
                bctx.fillStyle = `hsla(${hue}, ${sat}%, ${light}%, 1)`;
            } else if (palette === 'ice') {
                const hue = 215 - (v * 35);
                const sat = 80;
                const light = 12 + (v * 66);
                bctx.fillStyle = `hsla(${hue}, ${sat}%, ${light}%, 1)`;
            } else {
                const hue = 220 - (v * 210);
                const sat = 90;
                const light = 10 + (v * 60);
                bctx.fillStyle = `hsla(${hue}, ${sat}%, ${light}%, 1)`;
            }
            const rowH = height / bands.length;
            bctx.fillRect(width - scroll + x, height - ((y + 1) * rowH), 1, Math.ceil(rowH));
        }
    }
    ctx.save();
    ctx.globalAlpha = 0.95;
    ctx.drawImage(buffer, 0, 0, width, height);
    ctx.restore();
};

const drawParticlePulse = (ctx: CanvasRenderingContext2D, width: number, height: number, data: NumericArray, sensitivity: number, activeColor: string, density = 1) => {
    let particles = particleCache.get(ctx);
    if (!particles) {
        particles = [];
        particleCache.set(ctx, particles);
    }
    const bass = getBassEnergy(data, sensitivity);
    const highs = clamp01((avgBins(data, Math.floor(data.length * 0.35), Math.floor(data.length * 0.8)) / 255) * sensitivity);
    const densityScale = Math.max(0.4, Math.min(3, density));
    const spawnCount = Math.min(Math.round(20 * densityScale), Math.floor((bass * 10 + 1) * densityScale));
    const cx = width / 2;
    const cy = height / 2;
    const maxParticles = Math.round(240 * densityScale);
    for (let i = 0; i < spawnCount && particles.length < maxParticles; i++) {
        const angle = Math.random() * Math.PI * 2;
        const speed = 0.6 + (bass * 3.2) + (Math.random() * 1.5);
        particles.push({
            x: cx + (Math.random() - 0.5) * width * 0.08,
            y: cy + (Math.random() - 0.5) * height * 0.08,
            vx: Math.cos(angle) * speed,
            vy: Math.sin(angle) * speed,
            life: 18 + Math.random() * 38,
            size: 1 + highs * 2.5 + Math.random() * 2,
            hueOffset: (Math.random() - 0.5) * 20
        });
    }
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (let i = particles.length - 1; i >= 0; i--) {
        const p = particles[i];
        p.life -= 1;
        p.x += p.vx;
        p.y += p.vy;
        p.vx *= 0.985;
        p.vy *= 0.985;
        if (p.life <= 0 || p.x < -20 || p.x > width + 20 || p.y < -20 || p.y > height + 20) {
            particles.splice(i, 1);
            continue;
        }
        const alpha = clamp01(p.life / 40);
        ctx.fillStyle = hexToRgba(activeColor, alpha * 0.7);
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fill();
    }
    const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, Math.min(width, height) * 0.28);
    halo.addColorStop(0, hexToRgba(activeColor, 0.08 + bass * 0.18));
    halo.addColorStop(1, hexToRgba(activeColor, 0));
    ctx.fillStyle = halo;
    ctx.beginPath();
    ctx.arc(cx, cy, Math.min(width, height) * 0.28, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
};

const drawOrganicBlob = (ctx: CanvasRenderingContext2D, width: number, height: number, data: NumericArray, sensitivity: number, activeColor: string) => {
    const centerX = width / 2;
    const centerY = height / 2;
    const baseR = Math.min(width, height) * 0.16;
    const points = 72;
    const bands = getBandValues(data, points, { logScale: true, sensitivity, gamma: 1.3, endRatio: 0.75 });
    ctx.save();
    ctx.beginPath();
    for (let i = 0; i < points; i++) {
        const angle = (Math.PI * 2 * i) / points - Math.PI / 2;
        const wobble = Math.sin(i * 0.7) * baseR * 0.03;
        const r = baseR + (bands[i] * baseR * 0.95) + wobble;
        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;
        if (i === 0) ctx.moveTo(x, y);
        else {
            const prevAngle = (Math.PI * 2 * (i - 1)) / points - Math.PI / 2;
            const px = centerX + Math.cos(prevAngle) * (baseR + (bands[i - 1] * baseR * 0.95));
            const py = centerY + Math.sin(prevAngle) * (baseR + (bands[i - 1] * baseR * 0.95));
            ctx.quadraticCurveTo(px, py, (px + x) / 2, (py + y) / 2);
        }
    }
    ctx.closePath();
    const grad = ctx.createRadialGradient(centerX, centerY, baseR * 0.2, centerX, centerY, baseR * 2.2);
    grad.addColorStop(0, hexToRgba(activeColor, 0.12));
    grad.addColorStop(1, hexToRgba(activeColor, 0.42));
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = hexToRgba(activeColor, 0.95);
    ctx.lineWidth = 2.5;
    ctx.stroke();
    ctx.restore();
};

const drawMultiBandRing = (ctx: CanvasRenderingContext2D, width: number, height: number, data: NumericArray, sensitivity: number, activeColor: string, ringCount = 3) => {
    const cx = width / 2;
    const cy = height / 2;
    const dims = Math.min(width, height);
    const presets = [
        { start: 2, end: Math.floor(data.length * 0.08), r: dims * 0.12, color: '#22d3ee' },
        { start: Math.floor(data.length * 0.08), end: Math.floor(data.length * 0.28), r: dims * 0.17, color: activeColor },
        { start: Math.floor(data.length * 0.28), end: Math.floor(data.length * 0.6), r: dims * 0.22, color: '#f97316' }
    ];
    const bands = Array.from({ length: Math.max(2, Math.min(6, Math.round(ringCount))) }, (_, i) => {
        const t0 = i / Math.max(1, Math.max(2, Math.min(6, Math.round(ringCount))));
        const t1 = (i + 1) / Math.max(1, Math.max(2, Math.min(6, Math.round(ringCount))));
        const start = 2 + Math.floor(t0 * data.length * 0.65);
        const end = Math.max(start + 2, 2 + Math.floor(t1 * data.length * 0.65));
        const base = presets[i % presets.length];
        return { start, end, r: dims * (0.11 + i * 0.045), color: base.color };
    });
    ctx.save();
    bands.forEach((band, ringIdx) => {
        const points = 84;
        const vals: number[] = [];
        for (let i = 0; i < points; i++) {
            const from = band.start + ((i / points) * (band.end - band.start));
            const to = band.start + (((i + 1) / points) * (band.end - band.start));
            vals.push(clamp01(Math.pow(avgBins(data, from, to) / 255, 1.2) * sensitivity));
        }
        ctx.beginPath();
        for (let i = 0; i < points; i++) {
            const angle = (Math.PI * 2 * i) / points - Math.PI / 2;
            const r = band.r + (vals[i] * dims * 0.05);
            const x = cx + Math.cos(angle) * r;
            const y = cy + Math.sin(angle) * r;
            if (i === 0) ctx.moveTo(x, y);
            else ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = hexToRgba(band.color, 0.65 + ringIdx * 0.08);
        ctx.lineWidth = 2 + ringIdx;
        ctx.stroke();
    });
    ctx.restore();
};

export const drawQt6Visualizer = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    data: VisualizerFrameData,
    type: Qt6Style,
    settings: {
        activeColor: string;
        qt6Sensitivity: number;
        qt6BarCount: number;
        qt6SpectrogramSpeed?: number;
        qt6ParticleDensity?: number;
        qt6RingCount?: number;
        qt6LedSegments?: number;
        qt6SpectrogramPalette?: 'neon' | 'fire' | 'ice' | 'mono';
    }
) => {
    const { activeColor, qt6Sensitivity, qt6BarCount } = settings;
    const freqData = getFrequencyData(data);
    const timeData = getTimeData(data);
    const stereoData = getStereoFrequencyData(data);
    const stereoTimeData = getStereoTimeData(data);

    if (type === 'wave') {
        drawOscilloscopeLine(ctx, width, height, timeData ?? freqData, activeColor, qt6Sensitivity);
        return;
    }
    if (type === 'stereo-wave') {
        drawStereoWave(ctx, width, height, timeData ?? freqData, qt6Sensitivity, activeColor, { left: stereoTimeData.left, right: stereoTimeData.right });
        return;
    }
    if (type === 'bars') {
        const values = getBandValues(freqData, Math.max(16, Math.min(128, qt6BarCount)), { sensitivity: qt6Sensitivity, gamma: 1.25 });
        drawBarSeries(ctx, width, height, values, activeColor, { rounded: true, yBase: height * 0.95, maxHeight: height * 0.5 });
        return;
    }
    if (type === 'circle') {
        drawExistingCircleStyle(ctx, width, height, freqData, qt6Sensitivity, activeColor);
        return;
    }
    if (type === 'circular-wave') {
        drawExistingCircularWaveStyle(ctx, width, height, freqData, qt6Sensitivity, activeColor);
        return;
    }
    if (type === 'stereo-bars') {
        drawStereoBars(ctx, width, height, freqData, qt6Sensitivity, activeColor, qt6BarCount, { left: stereoData.left, right: stereoData.right });
        return;
    }
    if (type === 'log-bars') {
        drawLogBars(ctx, width, height, freqData, qt6Sensitivity, activeColor, qt6BarCount);
        return;
    }
    if (type === 'led-bars') {
        drawLedBars(ctx, width, height, freqData, qt6Sensitivity, activeColor, qt6BarCount, (settings as any).qt6LedSegments ?? 14);
        return;
    }
    if (type === 'radial-spectrum') {
        drawRadialSpectrum(ctx, width, height, freqData, qt6Sensitivity, activeColor, qt6BarCount);
        return;
    }
    if (type === 'wave-spectrum') {
        drawWaveSpectrumCombo(ctx, width, height, freqData, timeData, qt6Sensitivity, activeColor, qt6BarCount);
        return;
    }
    if (type === 'vu-meter') {
        drawVuMeter(ctx, width, height, freqData, qt6Sensitivity, activeColor, { left: stereoData.left, right: stereoData.right });
        return;
    }
    if (type === 'spectrogram') {
        drawSpectrogram(ctx, width, height, freqData, qt6Sensitivity, (settings as any).qt6SpectrogramSpeed ?? 1, (settings as any).qt6SpectrogramPalette ?? 'neon');
        return;
    }
    if (type === 'particle-pulse') {
        drawParticlePulse(ctx, width, height, freqData, qt6Sensitivity, activeColor, (settings as any).qt6ParticleDensity ?? 1);
        return;
    }
    if (type === 'organic-blob') {
        drawOrganicBlob(ctx, width, height, freqData, qt6Sensitivity, activeColor);
        return;
    }
    if (type === 'multi-band-ring') {
        drawMultiBandRing(ctx, width, height, freqData, qt6Sensitivity, activeColor, (settings as any).qt6RingCount ?? 3);
    }
};

export const drawScrollingLyrics = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    time: number,
    lines: AlignedWord[][],
    currentLineRef: { current: number },
    settings: {
        fontFamily: string;
        activeColor: string;
        inactiveColor: string;
        inactiveOpacity: number;
        smoothingFactor: number;
        verticalOffset: number;
        aspectRatio: string;
        colorEvents?: any[];
    }
) => {
    if (lines.length === 0) return;
    
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    
    let activeLineIdx = lines.findIndex(line => {
        if (line.length === 0) return false;
        const start = line[0].start_s;
        const end = line[line.length - 1].end_s;
        return time >= start && time <= end;
    });

    if (activeLineIdx === -1) {
        const upcomingIdx = lines.findIndex(line => line.length > 0 && line[0].start_s > time);
        if (upcomingIdx !== -1) {
            const timeToStart = lines[upcomingIdx][0].start_s - time;
            if (upcomingIdx === 0 && timeToStart > 4) {
                    activeLineIdx = -1;
            } else {
                    activeLineIdx = upcomingIdx;
            }
        } else {
            activeLineIdx = lines.length - 1;
        }
    }
    
    if (activeLineIdx !== -1) {
        const diff = activeLineIdx - currentLineRef.current;
        if (Math.abs(diff) > 4) {
            currentLineRef.current = activeLineIdx;
        } else {
            const factor = settings.smoothingFactor;
            currentLineRef.current += diff * factor;
        }
    }

    const renderCenterIdx = currentLineRef.current;
    const baseIdx = Math.floor(renderCenterIdx);
    const PADDING = settings.aspectRatio === "9:16" ? 60 : 40;
    const centerY = (height / 2) + (height * settings.verticalOffset);

    const getLayout = (idx: number, scale: number) => {
        if (idx < 0 || idx >= lines.length) return null;
        const line = lines[idx];
        if (line.length === 0) return null;

        let fontSize = 48 * scale;
        if (settings.aspectRatio === "9:16") fontSize = 36 * scale; 
        
        ctx.font = `bold ${fontSize}px ${settings.fontFamily}`;
        const lineHeight = fontSize * 1.3;
        const maxW = width * 0.85;

        const wordsWithWidths = line.map(w => ({
            ...w,
            width: ctx.measureText(w.word + " ").width
        }));

        const rows: { words: typeof wordsWithWidths, width: number }[] = [];
        let currentRow: typeof wordsWithWidths = [];
        let currentWidth = 0;

        wordsWithWidths.forEach(w => {
            if (currentWidth + w.width > maxW && currentRow.length > 0) {
                rows.push({ words: currentRow, width: currentWidth });
                currentRow = [w];
                currentWidth = w.width;
            } else {
                currentRow.push(w);
                currentWidth += w.width;
            }
        });
        if (currentRow.length > 0) {
            rows.push({ words: currentRow, width: currentWidth });
        }
        return { rows, totalHeight: rows.length * lineHeight, lineHeight, fontSize };
    };

    const visibleLines = [];
    for (let i = baseIdx - 2; i <= baseIdx + 3; i++) {
        if (i >= 0 && i < lines.length) {
            const dist = Math.abs(i - renderCenterIdx);
            const scale = Math.max(0.6, 1.2 - (dist * 0.3)); 
            const opacity = Math.max(0.1, 1 - (dist * 0.5));
            
            const layout = getLayout(i, scale);
            if (layout) {
                visibleLines.push({ index: i, layout, scale, opacity });
            }
        }
    }

    const fractional = renderCenterIdx - baseIdx;
    const baseLayoutRef = getLayout(baseIdx, 1.0); 
    const nextLayoutRef = getLayout(baseIdx + 1, 1.0);
    
    const baseH = baseLayoutRef ? baseLayoutRef.totalHeight : 60;
    const nextH = nextLayoutRef ? nextLayoutRef.totalHeight : 60;
    
    const scrollDist = (baseH / 2) + PADDING + (nextH / 2);
    const pixelOffset = fractional * scrollDist;

    visibleLines.forEach(item => {
        const relIndex = item.index - baseIdx; 
        let yOffset = 0;
        
        if (relIndex === 0) {
            yOffset = 0;
        } else if (relIndex > 0) {
            let hSum = baseH / 2 + PADDING; 
            for (let k = baseIdx + 1; k < item.index; k++) {
                    const l = getLayout(k, 1.0);
                    hSum += (l ? l.totalHeight : 60) + PADDING;
            }
            const l = getLayout(item.index, 1.0);
            hSum += (l ? l.totalHeight : 60) / 2;
            yOffset = hSum;
        } else {
            let hSum = baseH / 2 + PADDING;
            for (let k = baseIdx - 1; k > item.index; k--) {
                const l = getLayout(k, 1.0);
                hSum += (l ? l.totalHeight : 60) + PADDING;
            }
            const l = getLayout(item.index, 1.0);
            hSum += (l ? l.totalHeight : 60) / 2;
            yOffset = -hSum;
        }

        const drawY = centerY - pixelOffset + yOffset;
        
        ctx.font = `bold ${item.layout.fontSize}px ${settings.fontFamily}`;
        const startTextY = drawY - ((item.layout.rows.length - 1) * item.layout.lineHeight) / 2;

        item.layout.rows.forEach((row: any, rowIdx: number) => {
            const rowY = startTextY + (rowIdx * item.layout.lineHeight);
            let currentX = (width - row.width) / 2;

            row.words.forEach((w: any) => {
                const isWordActive = time >= w.start_s && time <= w.end_s;
                const isWordPast = time > w.end_s;
                const isLineActive = item.index === activeLineIdx;

                // Determine colors for this word
                let wordActiveColor = settings.activeColor;
                let wordInactiveColor = settings.inactiveColor;
                
                if (settings.colorEvents && settings.colorEvents.length > 0) {
                    // Find the last event that happened before or at this word's start time
                    const evt = [...settings.colorEvents].reverse().find((e: any) => e.time <= w.start_s);
                    if (evt) {
                        wordActiveColor = evt.activeColor;
                        wordInactiveColor = evt.inactiveColor;
                    }
                }

                if (isLineActive) {
                    if (isWordActive) {
                        ctx.fillStyle = wordActiveColor;
                        ctx.shadowColor = wordActiveColor; 
                        ctx.shadowBlur = 25;
                    } else if (isWordPast) {
                        ctx.fillStyle = hexToRgba(wordInactiveColor, 0.9);
                        ctx.shadowBlur = 0;
                    } else {
                        ctx.fillStyle = hexToRgba(wordInactiveColor, settings.inactiveOpacity);
                        ctx.shadowBlur = 0;
                    }
                } else {
                    ctx.fillStyle = hexToRgba(wordInactiveColor, item.opacity * settings.inactiveOpacity);
                    ctx.shadowBlur = 0;
                }

                ctx.textAlign = 'left';
                ctx.fillText(w.word, currentX, rowY);
                currentX += w.width;
            });
        });
        ctx.shadowBlur = 0;
    });
};
