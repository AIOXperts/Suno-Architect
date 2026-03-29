import QRCode from 'qrcode';
import { Qt6Style } from '../types';
import type { VisualizerFrameData } from './visualizer';
import { saveVisualizerRender } from '../services/offlineDb';

type RollConfig = {
    enabled: boolean;
    type: 'text' | 'qr';
    text: string;
    seconds: number;
    previewEnabled?: boolean;
    previewStartSeconds?: number;
    previewDurationSeconds?: number;
    previewShowTitle?: boolean;
    showTitle?: boolean;
    titleText?: string;
    theme?: 'clean' | 'bold';
};

const getSerializableRenderSettings = (config: {
    width: number;
    height: number;
    bitrate: number;
    videoBitrate: number;
    videoBitrateMode: 'constant' | 'variable';
    fps: number;
    title: string;
    visualMode: 'cover' | 'qt6' | 'hybrid';
    qt6Style: Qt6Style;
    customVideo?: HTMLVideoElement | null;
    customBgType?: 'image' | 'video';
    outputAspectTarget?: 'landscape' | 'portrait';
    preRoll?: RollConfig;
    postRoll?: RollConfig;
}) => {
    const { customVideo, ...serializable } = config;
    return {
        ...serializable,
        hasCustomVideo: !!customVideo
    };
};

const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const loadImage = (src: string): Promise<HTMLImageElement> =>
    new Promise((resolve, reject) => {
        const img = new Image();
        img.onload = () => resolve(img);
        img.onerror = () => reject(new Error('Failed loading image for roll card.'));
        img.src = src;
    });

const createQrImage = async (text: string): Promise<HTMLImageElement | null> => {
    const trimmed = text.trim();
    if (!trimmed) return null;
    try {
        const dataUrl = await QRCode.toDataURL(trimmed, {
            errorCorrectionLevel: 'M',
            margin: 1,
            color: {
                dark: '#ffffff',
                light: '#00000000'
            }
        });
        return await loadImage(dataUrl);
    } catch {
        return null;
    }
};

const drawRollCard = (
    ctx: CanvasRenderingContext2D,
    width: number,
    height: number,
    roll: RollConfig,
    title: string,
    qrImage: HTMLImageElement | null
) => {
    ctx.save();
    const isBold = roll.theme === 'bold';
    ctx.fillStyle = isBold ? 'rgba(12, 10, 34, 0.78)' : 'rgba(3, 7, 18, 0.72)';
    ctx.fillRect(0, 0, width, height);

    const pad = Math.max(24, Math.round(width * 0.06));
    const panelWidth = Math.min(width - pad * 2, Math.round(width * 0.88));
    const panelHeight = Math.min(height - pad * 2, Math.round(height * 0.7));
    const panelX = (width - panelWidth) / 2;
    const panelY = (height - panelHeight) / 2;

    ctx.fillStyle = isBold ? 'rgba(30, 27, 75, 0.86)' : 'rgba(15, 23, 42, 0.88)';
    ctx.strokeStyle = isBold ? 'rgba(236, 72, 153, 0.55)' : 'rgba(148, 163, 184, 0.35)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(panelX, panelY, panelWidth, panelHeight, 18);
    ctx.fill();
    ctx.stroke();

    const heading = roll.previewEnabled ? 'Preview Intro' : 'Message Card';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.fillStyle = '#f8fafc';
    ctx.font = `700 ${Math.max(22, Math.round(width * 0.035))}px Inter, Arial, sans-serif`;
    ctx.fillText(heading, width / 2, panelY + Math.max(18, Math.round(panelHeight * 0.08)));

    const effectiveTitle = (roll.titleText || '').trim() || title.trim();
    const shouldShowTitle = !!roll.showTitle || (!!roll.previewEnabled && !!roll.previewShowTitle);
    if (shouldShowTitle && effectiveTitle) {
        ctx.fillStyle = 'rgba(186, 230, 253, 0.92)';
        ctx.font = `600 ${Math.max(18, Math.round(width * 0.026))}px Inter, Arial, sans-serif`;
        ctx.fillText(effectiveTitle, width / 2, panelY + Math.max(56, Math.round(panelHeight * 0.22)));
    }

    if (roll.type === 'qr' && qrImage) {
        const qrSize = Math.min(panelWidth * 0.5, panelHeight * 0.5);
        const qrX = width / 2 - qrSize / 2;
        const qrY = panelY + panelHeight / 2 - qrSize / 2 + Math.max(16, Math.round(panelHeight * 0.06));
        ctx.drawImage(qrImage, qrX, qrY, qrSize, qrSize);
    } else {
        const message = roll.text?.trim() || ' ';
        const textY = panelY + panelHeight / 2;
        ctx.fillStyle = '#e2e8f0';
        ctx.font = `500 ${Math.max(20, Math.round(width * 0.024))}px Inter, Arial, sans-serif`;
        ctx.textBaseline = 'middle';

        const maxWidth = panelWidth * 0.82;
        const words = message.split(/\s+/).filter(Boolean);
        const lines: string[] = [];
        let current = '';

        for (const word of words) {
            const next = current ? `${current} ${word}` : word;
            if (ctx.measureText(next).width <= maxWidth) {
                current = next;
            } else {
                if (current) lines.push(current);
                current = word;
            }
        }
        if (current) lines.push(current);

        const lineHeight = Math.max(28, Math.round(width * 0.032));
        const totalHeight = lines.length * lineHeight;
        let y = textY - totalHeight / 2 + lineHeight / 2;
        for (const line of lines.slice(0, 6)) {
            ctx.fillText(line, width / 2, y);
            y += lineHeight;
        }
    }

    ctx.restore();
};

export const performOfflineRender = async (
    audioSrc: string,
    canvas: HTMLCanvasElement,
    config: {
        width: number;
        height: number;
        bitrate: number;
        videoBitrate: number;
        videoBitrateMode: 'constant' | 'variable';
        fps: number;
        title: string;
        visualMode: 'cover' | 'qt6' | 'hybrid';
        qt6Style: Qt6Style;
        customVideo?: HTMLVideoElement | null;
        customBgType?: 'image' | 'video';
        outputAspectTarget?: 'landscape' | 'portrait';
        preRoll?: RollConfig;
        postRoll?: RollConfig;
    },
    onProgress: (progress: number) => void,
    onRenderFrame: (ctx: CanvasRenderingContext2D, time: number, data: VisualizerFrameData) => void
) => {
    return new Promise<void>((resolve, reject) => {
        onProgress(0);

        const audio = new Audio(audioSrc);
        audio.crossOrigin = 'anonymous';

        let audioCtx: AudioContext | null = null;
        let dest: MediaStreamAudioDestinationNode | null = null;
        let sourceNode: MediaElementAudioSourceNode | null = null;

        const chunks: BlobPart[] = [];
        let mediaRecorder: MediaRecorder | null = null;
        let renderRAF: number | null = null;
        let done = false;
        const ctx = canvas.getContext('2d')!;

        const finish = (error?: Error) => {
            if (done) return;
            done = true;
            if (renderRAF) {
                cancelAnimationFrame(renderRAF);
                renderRAF = null;
            }
            try {
                audio.pause();
            } catch {}
            audio.src = '';

            if (sourceNode) {
                try {
                    sourceNode.disconnect();
                } catch {}
            }
            if (dest) {
                try {
                    dest.disconnect();
                } catch {}
            }
            if (audioCtx) {
                audioCtx.close().catch(() => undefined);
            }

            if (error) {
                reject(error);
                return;
            }

            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
            }
        };

        audio.onloadedmetadata = async () => {
            try {
                audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
                dest = audioCtx.createMediaStreamDestination();
                sourceNode = audioCtx.createMediaElementSource(audio);
                sourceNode.connect(audioCtx.destination);
                sourceNode.connect(dest);

                const canvasStream = canvas.captureStream(config.fps);
                const audioTrack = dest.stream.getAudioTracks()[0];
                if (audioTrack) {
                    canvasStream.addTrack(audioTrack);
                }

                try {
                    mediaRecorder = new MediaRecorder(canvasStream, {
                        mimeType: 'video/webm;codecs=vp9,opus',
                        videoBitsPerSecond: config.videoBitrate,
                        audioBitsPerSecond: config.bitrate
                    });
                } catch {
                    mediaRecorder = new MediaRecorder(canvasStream, {
                        mimeType: 'video/webm',
                        videoBitsPerSecond: config.videoBitrate,
                        audioBitsPerSecond: config.bitrate
                    });
                }

                mediaRecorder.ondataavailable = (e) => {
                    if (e.data && e.data.size > 0) chunks.push(e.data);
                };

                mediaRecorder.onstop = async () => {
                    const blob = new Blob(chunks, { type: 'video/webm' });
                    try {
                        const url = URL.createObjectURL(blob);
                        const a = document.createElement('a');
                        a.href = url;
                        a.download = `${config.title || 'rendered'}.webm`;
                        a.click();
                        URL.revokeObjectURL(url);

                        try {
                            const id = `render_${Date.now()}`;
                            await saveVisualizerRender({
                                id,
                                clipId: `clip_${Date.now()}`,
                                clipTitle: config.title,
                                createdAt: Date.now(),
                                settings: getSerializableRenderSettings(config)
                            });
                        } catch (saveErr: any) {
                            console.warn('Failed to save render to local history:', saveErr);
                        }

                        resolve();
                    } catch (e: any) {
                        if (e.name === 'QuotaExceededError') {
                            reject(new Error('Storage quota exceeded. Please delete old renders from History.'));
                        } else {
                            reject(e);
                        }
                    }
                };

                const songDuration = Number.isFinite(audio.duration) ? audio.duration : 0;
                const preRollEnabled = !!config.preRoll?.enabled;
                const postRollEnabled = !!config.postRoll?.enabled;
                const preRollSeconds = preRollEnabled ? clamp(config.preRoll?.seconds || 0, 0, 15) : 0;
                const postRollSeconds = postRollEnabled ? clamp(config.postRoll?.seconds || 0, 0, 15) : 0;

                const previewEnabled = preRollEnabled && !!config.preRoll?.previewEnabled;
                const previewStartSeconds = previewEnabled
                    ? clamp(config.preRoll?.previewStartSeconds || 0, 0, Math.max(0, songDuration - 0.05))
                    : 0;
                const previewDurationSeconds = previewEnabled
                    ? clamp(config.preRoll?.previewDurationSeconds || 7, 0.25, 10)
                    : 0;

                const totalDuration = preRollSeconds + songDuration + postRollSeconds;

                const preQrImage = config.preRoll?.type === 'qr' ? await createQrImage(config.preRoll.text) : null;
                const postQrImage = config.postRoll?.type === 'qr' ? await createQrImage(config.postRoll.text) : null;

                let switchedToMainTrack = !previewEnabled;

                if (previewEnabled) {
                    audio.currentTime = previewStartSeconds;
                    await audio.play();
                } else if (preRollSeconds <= 0) {
                    audio.currentTime = 0;
                    await audio.play();
                } else {
                    audio.pause();
                }

                mediaRecorder.start();
                const startMs = performance.now();

                const drawLoop = () => {
                    if (done) return;

                    const elapsed = (performance.now() - startMs) / 1000;
                    const clampedElapsed = Math.min(elapsed, totalDuration);

                    if (preRollSeconds > 0 && clampedElapsed < preRollSeconds) {
                        if (previewEnabled) {
                            const previewEnd = previewStartSeconds + previewDurationSeconds;
                            if (audio.currentTime >= previewEnd || audio.ended) {
                                audio.currentTime = previewStartSeconds;
                                audio.play().catch(() => undefined);
                            }
                            onRenderFrame(ctx, audio.currentTime, new Uint8Array(0));
                        } else {
                            onRenderFrame(ctx, 0, new Uint8Array(0));
                        }

                        drawRollCard(
                            ctx,
                            config.width,
                            config.height,
                            config.preRoll || { enabled: false, type: 'text', text: '', seconds: 0 },
                            config.title,
                            preQrImage
                        );
                    } else if (clampedElapsed < preRollSeconds + songDuration) {
                        if (!switchedToMainTrack) {
                            switchedToMainTrack = true;
                            audio.currentTime = 0;
                            audio.play().catch(() => undefined);
                        }

                        const mainTime = clamp(clampedElapsed - preRollSeconds, 0, songDuration);
                        onRenderFrame(ctx, mainTime, new Uint8Array(0));
                    } else if (postRollSeconds > 0 && clampedElapsed < totalDuration) {
                        onRenderFrame(ctx, songDuration, new Uint8Array(0));
                        drawRollCard(
                            ctx,
                            config.width,
                            config.height,
                            config.postRoll || { enabled: false, type: 'text', text: '', seconds: 0 },
                            config.title,
                            postQrImage
                        );
                    }

                    const pct = totalDuration > 0 ? (clampedElapsed / totalDuration) * 100 : 100;
                    onProgress(pct);

                    if (clampedElapsed >= totalDuration) {
                        onProgress(100);
                        finish();
                        return;
                    }

                    renderRAF = requestAnimationFrame(drawLoop);
                };

                drawLoop();
            } catch (e: any) {
                finish(e instanceof Error ? e : new Error(e?.message || 'Render setup failed.'));
            }
        };

        audio.onerror = () => {
            finish(new Error('Failed to load audio for rendering.'));
        };
    });
};
