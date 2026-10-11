import { describe, expect, it, vi } from 'vitest';
import { drawLogoWatermark, formatTime, hexToRgba } from './visualizer';

// Only pure / mockable exports are covered here. drawCover, drawCornerPulseVisualizer,
// drawLogoExpandingCircle, drawLogoCircularWave, drawQt6Visualizer and drawScrollingLyrics
// require a real CanvasRenderingContext2D (gradients, paths, measureText, DOM element checks)
// and are intentionally out of scope for the node environment.

describe('hexToRgba', () => {
    it('converts 6-digit hex to rgba with the given alpha', () => {
        expect(hexToRgba('#ff8800', 0.5)).toBe('rgba(255,136,0,0.5)');
        expect(hexToRgba('#000000', 1)).toBe('rgba(0,0,0,1)');
    });

    it('expands 3-digit shorthand hex', () => {
        expect(hexToRgba('#f80', 0.25)).toBe('rgba(255,136,0,0.25)');
        expect(hexToRgba('#FFF', 1)).toBe('rgba(255,255,255,1)');
    });

    it('falls back to white for invalid input while preserving alpha', () => {
        expect(hexToRgba('not-a-color', 0.3)).toBe('rgba(255,255,255,0.3)');
        expect(hexToRgba('ff8800', 0.3)).toBe('rgba(255,255,255,0.3)');
        expect(hexToRgba('#ff88', 0.3)).toBe('rgba(255,255,255,0.3)');
        expect(hexToRgba('', 0.3)).toBe('rgba(255,255,255,0.3)');
    });
});

describe('formatTime', () => {
    it('returns 0:00 for zero, NaN and falsy input', () => {
        expect(formatTime(0)).toBe('0:00');
        expect(formatTime(NaN)).toBe('0:00');
        expect(formatTime(undefined as unknown as number)).toBe('0:00');
    });

    it('formats m:ss with zero-padded seconds, flooring fractions', () => {
        expect(formatTime(5.9)).toBe('0:05');
        expect(formatTime(65)).toBe('1:05');
        expect(formatTime(599.99)).toBe('9:59');
    });

    it('does not pad minutes and handles > 60 minutes', () => {
        expect(formatTime(3600)).toBe('60:00');
        expect(formatTime(3725)).toBe('62:05');
    });
});

describe('drawLogoWatermark (mock context)', () => {
    const makeCtx = () => ({
        globalAlpha: 1,
        save: vi.fn(),
        restore: vi.fn(),
        drawImage: vi.fn(),
    });
    const logo = {} as CanvasImageSource;

    it('clamps opacity to [0.1, 1] and draws a square logo at the given position', () => {
        const low = makeCtx();
        drawLogoWatermark(low as unknown as CanvasRenderingContext2D, logo, 10, 20, 64, 0);
        expect(low.globalAlpha).toBe(0.1);
        expect(low.drawImage).toHaveBeenCalledWith(logo, 10, 20, 64, 64);

        const high = makeCtx();
        drawLogoWatermark(high as unknown as CanvasRenderingContext2D, logo, 0, 0, 32, 5);
        expect(high.globalAlpha).toBe(1);

        const mid = makeCtx();
        drawLogoWatermark(mid as unknown as CanvasRenderingContext2D, logo, 0, 0, 32, 0.42);
        expect(mid.globalAlpha).toBe(0.42);
    });

    it('wraps drawing in save/restore exactly once', () => {
        const ctx = makeCtx();
        drawLogoWatermark(ctx as unknown as CanvasRenderingContext2D, logo, 0, 0, 16, 0.5);
        expect(ctx.save).toHaveBeenCalledTimes(1);
        expect(ctx.restore).toHaveBeenCalledTimes(1);
        expect(ctx.save.mock.invocationCallOrder[0]).toBeLessThan(ctx.drawImage.mock.invocationCallOrder[0]);
        expect(ctx.drawImage.mock.invocationCallOrder[0]).toBeLessThan(ctx.restore.mock.invocationCallOrder[0]);
    });
});
