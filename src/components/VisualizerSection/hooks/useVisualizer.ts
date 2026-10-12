
import React, { useState, useEffect, useRef, useCallback } from 'react';
import { SunoClip, AlignedWord, Qt6Style, AIProviderConfig } from '../../../types';
import { getLyricAlignment, getSunoClip, resolveSunoAudioUrl, isEncryptedSunoStream } from '../../../services/sunoApi';
import { ASPECT_RATIOS } from '../../../constants';
import { drawCover, drawQt6Visualizer, drawScrollingLyrics, drawCornerPulseVisualizer, drawLogoCircularWave, drawLogoExpandingCircle, drawLogoWatermark, type VisualizerFrameData } from '../../../utils/visualizer';
import { groupLyricsByLines, matchWordsToPrompt, groupWordsByTiming, stripMetaTags, getCleanAlignedWords, groupWordsByLrcWithText, generateLrc, parseLrc, detectLongLyricLines, detectLongLrcGaps, looksLikeTimedLyricsJson, parseTimedLyricsJson } from '../../../utils/lyrics';
import { performOfflineRender } from '../../../utils/offlineRender';
import { createProvider, getDefaultModelForProvider, validateProviderConfig } from '../../../services/providers/providerFactory';

type VisualMode = 'cover' | 'qt6' | 'hybrid';
type VisualizerTemplate = 'classic' | 'clean-lyrics' | 'corner-pulse' | 'cinematic-bars';
type LogoPosition = 'bottom-right' | 'bottom-left' | 'top-right' | 'top-left';
type LogoPulseStyle = 'expanding-circle' | 'radial-bars' | 'circular-wave';
type Qt6LookPreset = 'retro-led' | 'broadcast-vu' | 'neon-spectrogram' | 'club-radial' | 'organic-ambient' | 'social-hybrid';
type SpectrogramPalette = 'neon' | 'fire' | 'ice' | 'mono';
type VisualizerConfig = {
    aspectRatio: keyof typeof ASPECT_RATIOS;
    showBackgroundLayer: boolean;
    mainVisualizerEnabled: boolean;
    templatePreset: VisualizerTemplate;
    activeColor: string;
    inactiveColor: string;
    inactiveOpacity: number;
    fontFamily: string;
    smoothingFactor: number;
    verticalOffset: number;
    qt6Style: Qt6Style;
    qt6BarCount: number;
    qt6Sensitivity: number;
    qt6SpectrogramSpeed: number;
    qt6ParticleDensity: number;
    qt6RingCount: number;
    qt6LedSegments: number;
    qt6SpectrogramPalette: SpectrogramPalette;
    logoPosition: LogoPosition;
    logoScale: number;
    logoOpacity: number;
    logoPulseEnabled: boolean;
    logoPulseStyle: LogoPulseStyle;
    logoPulseGap: number;
    logoPulseScale: number;
    logoPulseSensitivity: number;
    showTitle: boolean;
    videoBitrate: number;
    videoBitrateMode: 'constant' | 'variable';
    audioBitrate: number;
    fps: number;
    outputAspectTarget: 'landscape' | 'portrait';
    preRollEnabled: boolean;
    preRollType: 'text' | 'qr';
    preRollText: string;
    preRollSeconds: number;
    preRollPreviewEnabled: boolean;
    preRollPreviewStartSeconds: number;
    preRollPreviewDurationSeconds: number;
    preRollPreviewShowTitle: boolean;
    preRollShowHeading: boolean;
    preRollHeadingText: string;
    preRollCardShowTitle: boolean;
    preRollCardTitleText: string;
    preRollCardTheme: 'clean' | 'bold';
    postRollEnabled: boolean;
    postRollType: 'text' | 'qr';
    postRollText: string;
    postRollSeconds: number;
    postRollShowHeading: boolean;
    postRollHeadingText: string;
};
type SavedVisualizerPreset = {
    id: string;
    name: string;
    config: VisualizerConfig;
    createdAt: string;
};

const SESSION_KEY = 'suno_architect_visualizer_session_v1';
const PRESET_KEY = 'suno_architect_visualizer_saved_presets_v1';
const DEFAULT_LOGO_STORAGE_KEY = 'suno_architect_default_logo_v1';
const CLIP_QUERY_PARAM = 'clipId';

export const useVisualizer = (
    history: SunoClip[],
    sunoCookie: string | undefined,
    onUpdateClip: (id: string, updates: Partial<SunoClip>) => void,
    apiKey: string | undefined,
    geminiModel: string | undefined,
    providerConfig?: AIProviderConfig
) => {
    const getClipIdFromUrl = useCallback((): string => {
        const params = new URLSearchParams(window.location.search);
        const id = (params.get(CLIP_QUERY_PARAM) || '').trim();
        return id;
    }, []);

    // Selection State
    const [selectedClipId, setSelectedClipId] = useState<string>('');
    const [manualId, setManualId] = useState('');
    const [manualLoadVersion, setManualLoadVersion] = useState(0);
    
    // Visual Settings
    const [aspectRatio, setAspectRatio] = useState<keyof typeof ASPECT_RATIOS>("16:9");
    const [showBackgroundLayer, setShowBackgroundLayer] = useState(true);
    const [mainVisualizerEnabled, setMainVisualizerEnabled] = useState(false);
    const [templatePreset, setTemplatePreset] = useState<VisualizerTemplate>('classic');
    const [customBg, setCustomBg] = useState<{ url: string, type: 'image' | 'video', name: string } | null>(null);
    const [logoAsset, setLogoAsset] = useState<{ url: string, name: string } | null>(null);
    const [logoPosition, setLogoPosition] = useState<LogoPosition>('bottom-right');
    const [logoScale, setLogoScale] = useState(0.14);
    const [logoOpacity, setLogoOpacity] = useState(0.9);
    const [logoPulseEnabled, setLogoPulseEnabled] = useState(false);
    const [logoPulseStyle, setLogoPulseStyle] = useState<LogoPulseStyle>('expanding-circle');
    const [logoPulseGap, setLogoPulseGap] = useState(0);
    const [logoPulseScale, setLogoPulseScale] = useState(1.35);
    const [logoPulseSensitivity, setLogoPulseSensitivity] = useState(1.3);
    const [showTitle, setShowTitle] = useState(true);
    const [customAudio, setCustomAudio] = useState<{ url: string, name: string } | null>(null);
    const [audioBitrate, setAudioBitrate] = useState(320000);
    const [videoBitrate, setVideoBitrate] = useState(5000000);
    const [videoBitrateMode, setVideoBitrateMode] = useState<'constant' | 'variable'>('variable');
    const [fps, setFps] = useState(30);
    const [outputAspectTarget, setOutputAspectTarget] = useState<'landscape' | 'portrait'>('landscape');
    const [preRollEnabled, setPreRollEnabled] = useState(false);
    const [preRollType, setPreRollType] = useState<'text' | 'qr'>('text');
    const [preRollText, setPreRollText] = useState('Thank you for supporting my work');
    const [preRollSeconds, setPreRollSeconds] = useState(4);
    const [preRollPreviewEnabled, setPreRollPreviewEnabled] = useState(false);
    const [preRollPreviewStartSeconds, setPreRollPreviewStartSeconds] = useState(20);
    const [preRollPreviewDurationSeconds, setPreRollPreviewDurationSeconds] = useState(7);
    const [preRollPreviewShowTitle, setPreRollPreviewShowTitle] = useState(true);
    const [preRollShowHeading, setPreRollShowHeading] = useState(true);
    const [preRollHeadingText, setPreRollHeadingText] = useState('');
    const [preRollCardShowTitle, setPreRollCardShowTitle] = useState(true);
    const [preRollCardTitleText, setPreRollCardTitleText] = useState('');
    const [preRollCardTheme, setPreRollCardTheme] = useState<'clean' | 'bold'>('clean');
    const [postRollEnabled, setPostRollEnabled] = useState(false);
    const [postRollType, setPostRollType] = useState<'text' | 'qr'>('text');
    const [postRollText, setPostRollText] = useState('Tripped Out Tim');
    const [postRollSeconds, setPostRollSeconds] = useState(4);
    const [postRollShowHeading, setPostRollShowHeading] = useState(true);
    const [postRollHeadingText, setPostRollHeadingText] = useState('');
    const [imgSrc, setImgSrc] = useState<string>('');
    const [hasDefaultLogo, setHasDefaultLogo] = useState(false);

    // Update video bitrate based on resolution
    useEffect(() => {
        const dims = ASPECT_RATIOS[aspectRatio];
        if (dims.width >= 1920 || dims.height >= 1920) {
            setVideoBitrate(8000000);
        } else {
            setVideoBitrate(5000000);
        }
    }, [aspectRatio]);

    // Style Customization State
    const [activeColor, setActiveColor] = useState('#e879f9');
    const [inactiveColor, setInactiveColor] = useState('#ffffff');
    const [inactiveOpacity, setInactiveOpacity] = useState(0.3);
    const [fontFamily, setFontFamily] = useState('Inter, sans-serif');
    const [smoothingFactor, setSmoothingFactor] = useState(0.1); 
    const [verticalOffset, setVerticalOffset] = useState(0); 
    
    // Color Events State
    const [colorEvents, setColorEvents] = useState<any[]>([]);

    const addColorEvent = (event: any) => {
        setColorEvents(prev => [...prev, event].sort((a: any, b: any) => a.time - b.time));
    };

    const removeColorEvent = (index: number) => {
        setColorEvents(prev => prev.filter((_, i) => i !== index));
    };

    const updateColorEvent = (index: number, updatedEvent: any) => {
        setColorEvents(prev => {
            const newEvents = [...prev];
            newEvents[index] = updatedEvent;
            return newEvents.sort((a: any, b: any) => a.time - b.time);
        });
    }; 

    // Qt6 Specific Settings
    const [qt6Style, setQt6Style] = useState<Qt6Style>('wave');
    const [qt6BarCount, setQt6BarCount] = useState(64);
    const [qt6Sensitivity, setQt6Sensitivity] = useState(1.0);
    const [qt6SpectrogramSpeed, setQt6SpectrogramSpeed] = useState(1);
    const [qt6ParticleDensity, setQt6ParticleDensity] = useState(1);
    const [qt6RingCount, setQt6RingCount] = useState(3);
    const [qt6LedSegments, setQt6LedSegments] = useState(14);
    const [qt6SpectrogramPalette, setQt6SpectrogramPalette] = useState<SpectrogramPalette>('neon');

    // Data State
    const [clipData, setClipData] = useState<SunoClip | null>(null);
    const [alignment, setAlignment] = useState<AlignedWord[] | null>(null);
    const [lines, setLines] = useState<AlignedWord[][]>([]);
    const [lyricSource, setLyricSource] = useState(''); 
    const [lyricDrafts, setLyricDrafts] = useState<Record<string, string>>({});
    const [lrcDraft, setLrcDraft] = useState('');
    const [lrcDrafts, setLrcDrafts] = useState<Record<string, string>>({});
    const [applyStatus, setApplyStatus] = useState<'idle' | 'applied'>('idle');
    const [lrcApplyStatus, setLrcApplyStatus] = useState<'idle' | 'applied' | 'error'>('idle');
    const [savedPresets, setSavedPresets] = useState<SavedVisualizerPreset[]>([]);
    
    // Audio/Canvas/Media References
    const canvasRef = useRef<HTMLCanvasElement>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const customVideoRef = useRef<HTMLVideoElement>(null);
    const requestRef = useRef<number | null>(null);
    
    // Audio Context & Analysis Refs
    const audioContextRef = useRef<AudioContext | null>(null);
    const analyserRef = useRef<AnalyserNode | null>(null);
    const leftAnalyserRef = useRef<AnalyserNode | null>(null);
    const rightAnalyserRef = useRef<AnalyserNode | null>(null);
    const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);
    const dataArrayRef = useRef<Uint8Array | null>(null);
    const timeDataArrayRef = useRef<Uint8Array | null>(null);
    const leftDataArrayRef = useRef<Uint8Array | null>(null);
    const rightDataArrayRef = useRef<Uint8Array | null>(null);
    const leftTimeDataArrayRef = useRef<Uint8Array | null>(null);
    const rightTimeDataArrayRef = useRef<Uint8Array | null>(null);

    // Smoothing Refs
    const smoothLineIdxRef = useRef(0);
    
    // Rendering State
    const [isRendering, setIsRendering] = useState(false);
    const [renderProgress, setRenderProgress] = useState(0);
    const [renderError, setRenderError] = useState<string | null>(null);
    const [renderSpeed, setRenderSpeed] = useState(0);
    const [isPreparing, setIsPreparing] = useState(false);
    const [isGrouping, setIsGrouping] = useState(false);
    const [progress, setProgress] = useState(0); 
    const [audioDuration, setAudioDuration] = useState(0);
    const [isPlaying, setIsPlaying] = useState(false);

    const renderStartTimeRef = useRef(0);
    const lastSpeedUpdateRef = useRef(0);
    const previewPhaseRef = useRef<'idle' | 'preroll' | 'audio' | 'postroll'>('idle');
    const previewPhaseStartMsRef = useRef(0);
    const previewPhaseStartVirtualRef = useRef(0);
    const hasRestoredSessionRef = useRef(false);
    const lyricDraftsRef = useRef<Record<string, string>>({});
    const lrcDraftsRef = useRef<Record<string, string>>({});
    const preferLegacyOnNextLoadRef = useRef(false);
    const historyRef = useRef<SunoClip[]>(history);

    const preRollDuration = preRollEnabled ? Math.max(0, Math.min(15, preRollSeconds)) : 0;
    const postRollDuration = postRollEnabled ? Math.max(0, Math.min(15, postRollSeconds)) : 0;
    const totalPreviewDuration = Math.max(0, audioDuration) + preRollDuration + postRollDuration;

    const rebuildLinesFromSources = useCallback((nextAlignment: AlignedWord[], preferredLrcOverride?: string) => {
        const candidateLrc = typeof preferredLrcOverride === 'string' ? preferredLrcOverride : lrcDraft;
        const parsed = parseLrc(candidateLrc);
        if (candidateLrc.trim() && parsed.entries.length > 0 && parsed.invalidLineNumbers.length === 0) {
            return groupWordsByLrcWithText(nextAlignment, candidateLrc);
        }
        if (lyricSource.trim()) {
            return matchWordsToPrompt(nextAlignment, lyricSource);
        }
        return groupWordsByTiming(nextAlignment);
    }, [lrcDraft, lyricSource]);

    useEffect(() => {
        try {
            const rawSession = localStorage.getItem(SESSION_KEY);
            if (rawSession) {
                const session = JSON.parse(rawSession) as Partial<{
                    selectedClipId: string;
                    manualId: string;
                    lyricDrafts: Record<string, string>;
                    lrcDrafts: Record<string, string>;
                    logoAsset: { url: string; name: string } | null;
                    config: Partial<VisualizerConfig>;
                }>;
                const urlClipId = getClipIdFromUrl();
                if (urlClipId) {
                    setSelectedClipId(urlClipId);
                    setManualId(urlClipId);
                } else {
                    if (session.selectedClipId) setSelectedClipId(session.selectedClipId);
                    if (session.manualId) setManualId(session.manualId);
                }
                if (session.lyricDrafts) setLyricDrafts(session.lyricDrafts);
                if (session.lrcDrafts) setLrcDrafts(session.lrcDrafts);
                if (session.logoAsset?.url) setLogoAsset(session.logoAsset);
                if (session.config) {
                    if (session.config.aspectRatio) setAspectRatio(session.config.aspectRatio);
                    if (typeof session.config.showBackgroundLayer === 'boolean') {
                        setShowBackgroundLayer(session.config.showBackgroundLayer);
                    }
                    if (typeof session.config.mainVisualizerEnabled === 'boolean') {
                        setMainVisualizerEnabled(session.config.mainVisualizerEnabled);
                    }
                    if ((session.config as any).visualMode && typeof session.config.showBackgroundLayer !== 'boolean' && typeof session.config.mainVisualizerEnabled !== 'boolean') {
                        const legacyMode = (session.config as any).visualMode as VisualMode;
                        setShowBackgroundLayer(legacyMode !== 'qt6');
                        setMainVisualizerEnabled(legacyMode !== 'cover');
                    }
                    if (session.config.templatePreset) setTemplatePreset(session.config.templatePreset);
                    if (session.config.activeColor) setActiveColor(session.config.activeColor);
                    if (session.config.inactiveColor) setInactiveColor(session.config.inactiveColor);
                    if (typeof session.config.inactiveOpacity === 'number') setInactiveOpacity(session.config.inactiveOpacity);
                    if (session.config.fontFamily) setFontFamily(session.config.fontFamily);
                    if (typeof session.config.smoothingFactor === 'number') setSmoothingFactor(session.config.smoothingFactor);
                    if (typeof session.config.verticalOffset === 'number') setVerticalOffset(session.config.verticalOffset);
                    if (session.config.qt6Style) setQt6Style(session.config.qt6Style);
                    if (typeof session.config.qt6BarCount === 'number') setQt6BarCount(session.config.qt6BarCount);
                    if (typeof session.config.qt6Sensitivity === 'number') setQt6Sensitivity(session.config.qt6Sensitivity);
                    if (typeof session.config.qt6SpectrogramSpeed === 'number') setQt6SpectrogramSpeed(session.config.qt6SpectrogramSpeed);
                    if (typeof session.config.qt6ParticleDensity === 'number') setQt6ParticleDensity(session.config.qt6ParticleDensity);
                    if (typeof session.config.qt6RingCount === 'number') setQt6RingCount(session.config.qt6RingCount);
                    if (typeof session.config.qt6LedSegments === 'number') setQt6LedSegments(session.config.qt6LedSegments);
                    if (session.config.qt6SpectrogramPalette) setQt6SpectrogramPalette(session.config.qt6SpectrogramPalette);
                    if (session.config.logoPosition) setLogoPosition(session.config.logoPosition);
                    if (typeof session.config.logoScale === 'number') setLogoScale(session.config.logoScale);
                    if (typeof session.config.logoOpacity === 'number') setLogoOpacity(session.config.logoOpacity);
                    if (typeof session.config.logoPulseEnabled === 'boolean') setLogoPulseEnabled(session.config.logoPulseEnabled);
                    if (session.config.logoPulseStyle) setLogoPulseStyle(session.config.logoPulseStyle);
                    if (typeof session.config.logoPulseGap === 'number') setLogoPulseGap(session.config.logoPulseGap);
                    if (typeof session.config.logoPulseScale === 'number') setLogoPulseScale(session.config.logoPulseScale);
                    if (typeof session.config.logoPulseSensitivity === 'number') setLogoPulseSensitivity(session.config.logoPulseSensitivity);
                    if (typeof session.config.showTitle === 'boolean') setShowTitle(session.config.showTitle);
                    if (typeof session.config.videoBitrate === 'number') setVideoBitrate(session.config.videoBitrate);
                    if (session.config.videoBitrateMode) setVideoBitrateMode(session.config.videoBitrateMode);
                    if (typeof session.config.audioBitrate === 'number') setAudioBitrate(session.config.audioBitrate);
                    if (typeof session.config.fps === 'number') setFps(session.config.fps);
                    if (session.config.outputAspectTarget) setOutputAspectTarget(session.config.outputAspectTarget);
                    if (typeof session.config.preRollEnabled === 'boolean') setPreRollEnabled(session.config.preRollEnabled);
                    if (session.config.preRollType) setPreRollType(session.config.preRollType);
                    if (typeof session.config.preRollText === 'string') setPreRollText(session.config.preRollText);
                    if (typeof session.config.preRollSeconds === 'number') setPreRollSeconds(session.config.preRollSeconds);
                    if (typeof session.config.preRollPreviewEnabled === 'boolean') setPreRollPreviewEnabled(session.config.preRollPreviewEnabled);
                    if (typeof session.config.preRollPreviewStartSeconds === 'number') setPreRollPreviewStartSeconds(session.config.preRollPreviewStartSeconds);
                    if (typeof session.config.preRollPreviewDurationSeconds === 'number') setPreRollPreviewDurationSeconds(session.config.preRollPreviewDurationSeconds);
                    if (typeof session.config.preRollPreviewShowTitle === 'boolean') setPreRollPreviewShowTitle(session.config.preRollPreviewShowTitle);
                    if (typeof session.config.preRollShowHeading === 'boolean') setPreRollShowHeading(session.config.preRollShowHeading);
                    if (typeof session.config.preRollHeadingText === 'string') setPreRollHeadingText(session.config.preRollHeadingText);
                    if (typeof session.config.preRollCardShowTitle === 'boolean') setPreRollCardShowTitle(session.config.preRollCardShowTitle);
                    if (typeof session.config.preRollCardTitleText === 'string') setPreRollCardTitleText(session.config.preRollCardTitleText);
                    if (session.config.preRollCardTheme === 'clean' || session.config.preRollCardTheme === 'bold') setPreRollCardTheme(session.config.preRollCardTheme);
                    if (typeof session.config.postRollEnabled === 'boolean') setPostRollEnabled(session.config.postRollEnabled);
                    if (session.config.postRollType) setPostRollType(session.config.postRollType);
                    if (typeof session.config.postRollText === 'string') setPostRollText(session.config.postRollText);
                    if (typeof session.config.postRollSeconds === 'number') setPostRollSeconds(session.config.postRollSeconds);
                    if (typeof session.config.postRollShowHeading === 'boolean') setPostRollShowHeading(session.config.postRollShowHeading);
                    if (typeof session.config.postRollHeadingText === 'string') setPostRollHeadingText(session.config.postRollHeadingText);
                }
            }
        } catch (err) {
            console.warn('Failed to restore visualizer session:', err);
        }

        try {
            const rawPresets = localStorage.getItem(PRESET_KEY);
            if (rawPresets) {
                const parsed = JSON.parse(rawPresets) as SavedVisualizerPreset[];
                if (Array.isArray(parsed)) {
                    setSavedPresets(parsed);
                }
            }
        } catch (err) {
            console.warn('Failed to restore saved presets:', err);
        }

        if (!localStorage.getItem(SESSION_KEY)) {
            const urlClipId = getClipIdFromUrl();
            if (urlClipId) {
                setSelectedClipId(urlClipId);
                setManualId(urlClipId);
            }
        }

        try {
            const rawDefaultLogo = localStorage.getItem(DEFAULT_LOGO_STORAGE_KEY);
            if (rawDefaultLogo) {
                const parsed = JSON.parse(rawDefaultLogo) as { name?: string; dataUrl?: string };
                if (typeof parsed?.dataUrl === 'string' && parsed.dataUrl.startsWith('data:image/')) {
                    setHasDefaultLogo(true);
                    setLogoAsset(prev => prev || {
                        url: parsed.dataUrl,
                        name: parsed.name || 'default-logo'
                    });
                }
            }
        } catch (err) {
            console.warn('Failed to restore default logo:', err);
        }
        const readyTimer = window.setTimeout(() => {
            hasRestoredSessionRef.current = true;
        }, 0);

        return () => window.clearTimeout(readyTimer);
    }, [getClipIdFromUrl]);

    useEffect(() => {
        const next = (selectedClipId || '').trim();
        const current = new URL(window.location.href);
        const existing = (current.searchParams.get(CLIP_QUERY_PARAM) || '').trim();
        if (next) {
            current.searchParams.set(CLIP_QUERY_PARAM, next);
        } else {
            current.searchParams.delete(CLIP_QUERY_PARAM);
        }
        const nextUrl = `${current.pathname}${current.search}${current.hash}`;
        const currentUrl = `${window.location.pathname}${window.location.search}${window.location.hash}`;
        if (next !== existing && nextUrl !== currentUrl) {
            window.history.replaceState(null, '', nextUrl);
        }
    }, [selectedClipId]);

    useEffect(() => {
        const handlePopState = () => {
            const next = getClipIdFromUrl();
            setSelectedClipId(prev => (prev === next ? prev : next));
            if (next) {
                setManualId(next);
            }
        };
        window.addEventListener('popstate', handlePopState);
        return () => window.removeEventListener('popstate', handlePopState);
    }, [getClipIdFromUrl]);

    const currentVisualMode: VisualMode = showBackgroundLayer
        ? (mainVisualizerEnabled ? 'hybrid' : 'cover')
        : 'qt6';

    // Setup Audio Analysis for Visualizer Modes
    useEffect(() => {
        const needsVisualizerData = mainVisualizerEnabled || logoPulseEnabled;
        if (needsVisualizerData && audioRef.current && !sourceNodeRef.current) {
            try {
                const AudioContextClass = window.AudioContext || (window as any).webkitAudioContext;
                if (!AudioContextClass) return;

                const ctx = new AudioContextClass();
                const analyser = ctx.createAnalyser();
                analyser.fftSize = 2048; // Standard size
                analyser.smoothingTimeConstant = 0.8;
                const splitter = ctx.createChannelSplitter(2);
                const leftAnalyser = ctx.createAnalyser();
                const rightAnalyser = ctx.createAnalyser();
                leftAnalyser.fftSize = 2048;
                rightAnalyser.fftSize = 2048;
                leftAnalyser.smoothingTimeConstant = 0.8;
                rightAnalyser.smoothingTimeConstant = 0.8;
                
                const source = ctx.createMediaElementSource(audioRef.current);
                source.connect(analyser);
                source.connect(splitter);
                splitter.connect(leftAnalyser, 0);
                splitter.connect(rightAnalyser, 1);
                analyser.connect(ctx.destination);
                
                audioContextRef.current = ctx;
                analyserRef.current = analyser;
                leftAnalyserRef.current = leftAnalyser;
                rightAnalyserRef.current = rightAnalyser;
                sourceNodeRef.current = source;
                dataArrayRef.current = new Uint8Array(analyser.frequencyBinCount);
                timeDataArrayRef.current = new Uint8Array(analyser.fftSize);
                leftDataArrayRef.current = new Uint8Array(leftAnalyser.frequencyBinCount);
                rightDataArrayRef.current = new Uint8Array(rightAnalyser.frequencyBinCount);
                leftTimeDataArrayRef.current = new Uint8Array(leftAnalyser.fftSize);
                rightTimeDataArrayRef.current = new Uint8Array(rightAnalyser.fftSize);
            } catch (e) {
                console.error("Audio Context Init Failed:", e);
            }
        }
    }, [mainVisualizerEnabled, logoPulseEnabled, selectedClipId, customAudio]);

    // Handle Image Source Logic
    useEffect(() => {
        if (!clipData) return;
        let url = clipData.imageLargeUrl || clipData.imageUrl || `https://cdn2.suno.ai/image_large_${clipData.id}.jpeg`;
        if (url.includes('suno.ai') && !url.includes('?')) {
            url += `?t=${Date.now()}`;
        }
        setImgSrc(url);
        if (!lyricSource) {
            const raw = clipData.metadata?.prompt || clipData.originalData?.lyricsAlone || "";
            setLyricSource(raw);
        }
    }, [clipData]);

    const handleImageError = useCallback(() => {
        setImgSrc('https://placehold.co/1080x1080/1e293b/475569?text=No+Cover');
    }, []);

    // Load Clip Data
    useEffect(() => {
        if (!selectedClipId) return;
        let cancelled = false;
        setLines([]);
        setAlignment(null);
        setClipData(null);
        setLyricSource('');
        setLrcDraft('');
        setApplyStatus('idle');
        setLrcApplyStatus('idle');
        setCustomAudio(null);
        setProgress(0);
        setAudioDuration(0);
        setIsPlaying(false);
        previewPhaseRef.current = 'idle';

        const loadData = async () => {
            let currentClip = historyRef.current.find(c => c.id === selectedClipId);
            let fetchedData: any = null;

            if (sunoCookie && !selectedClipId.startsWith('draft_')) {
                try {
                    setIsPreparing(true);
                    fetchedData = await getSunoClip(selectedClipId, sunoCookie);
                } catch (e) {
                    console.warn("Could not fetch clip details, using local/fallback", e);
                }
            }

            if (cancelled) return;

            if (fetchedData) {
                const meta = fetchedData.metadata || {};
                const prompt = meta.prompt || "";
                const tags = meta.tags || "";
                
                currentClip = {
                    id: fetchedData.id,
                    title: fetchedData.title || (currentClip?.title || 'Untitled'),
                    created_at: fetchedData.created_at || new Date().toISOString(),
                    model_name: fetchedData.model_name || 'Unknown',
                    imageUrl: fetchedData.image_url || fetchedData.image_large_url,
                    imageLargeUrl: fetchedData.image_large_url,
                    metadata: { tags: tags, prompt: prompt },
                    originalData: currentClip?.originalData || {
                        style: tags, title: fetchedData.title || '', excludeStyles: '', advancedParams: '', vocalGender: '', weirdness: 50, styleInfluence: 50, lyricsWithTags: prompt, lyricsAlone: prompt.replace(/\[[\s\S]*?\]/g, "").trim(), fullResponse: ''
                    },
                    alignmentData: currentClip?.alignmentData,
                    lrcContent: currentClip?.lrcContent,
                    srtContent: currentClip?.srtContent
                };
            } else if (!currentClip) {
                currentClip = {
                    id: selectedClipId,
                    title: '', 
                    created_at: new Date().toISOString(),
                    model_name: 'Unknown',
                    imageUrl: `https://cdn2.suno.ai/image_large_${selectedClipId}.jpeg`,
                    metadata: { tags: '', prompt: '' }
                };
            }

            if (cancelled) return;

            // Browsers cannot play Suno's encrypted progressive stream; fetch a presigned MP3
            // link for unlocked songs instead (cached ~1h, never spends download credits).
            if (sunoCookie && !selectedClipId.startsWith('draft_') && (!currentClip.audioUrl || isEncryptedSunoStream(currentClip.audioUrl))) {
                try {
                    const resolved = await resolveSunoAudioUrl(selectedClipId, sunoCookie);
                    currentClip = { ...currentClip, audioUrl: resolved.url, audioContentType: 'mp3' };
                } catch (e: any) {
                    console.warn('No playable audio link for clip', selectedClipId, e?.message || e);
                }
                if (cancelled) return;
            }
            setClipData(currentClip);

            let sourceText = currentClip.metadata?.prompt || "";
            if (!sourceText && currentClip.originalData?.lyricsAlone) {
                sourceText = currentClip.originalData.lyricsAlone;
            }
            const draftText = lyricDraftsRef.current[currentClip.id];
            if (draftText && draftText.trim()) {
                sourceText = draftText;
            }
            setLyricSource(sourceText);
            const clipLrcDraft = lrcDraftsRef.current[currentClip.id];
            setLrcDraft(typeof clipLrcDraft === 'string' ? clipLrcDraft : (currentClip.lrcContent || ''));
            setLrcApplyStatus('idle');

            let align = currentClip.alignmentData;
            if (!align && sunoCookie && !currentClip.id.startsWith('draft_')) {
                try {
                    setIsPreparing(true);
                    const res = await getLyricAlignment(currentClip.id, sunoCookie);
                    if (res && res.aligned_words) {
                        align = res.aligned_words;
                        if (historyRef.current.some(h => h.id === currentClip.id)) {
                            onUpdateClip(currentClip.id, { alignmentData: align });
                        }
                    }
                } catch (e) {
                    console.error("Alignment fetch failed", e);
                }
            }

            if (cancelled) return;
            setAlignment(align || null);

            if (align) {
                const shouldPreferLegacy = preferLegacyOnNextLoadRef.current;
                const preferredLrc = (typeof clipLrcDraft === 'string' && clipLrcDraft.trim())
                    ? clipLrcDraft
                    : (currentClip.lrcContent || '');

                const autoLines = shouldPreferLegacy
                    ? (sourceText.trim() ? matchWordsToPrompt(align, sourceText) : groupWordsByTiming(align))
                    : (() => {
                        const parsed = parseLrc(preferredLrc);
                        if (preferredLrc.trim() && parsed.entries.length > 0 && parsed.invalidLineNumbers.length === 0) {
                            return groupWordsByLrcWithText(align, preferredLrc);
                        }
                        if (sourceText.trim()) {
                            return matchWordsToPrompt(align, sourceText);
                        }
                        return groupWordsByTiming(align);
                    })();

                setLines(autoLines);
                if (!preferredLrc.trim() && autoLines.length > 0) {
                    setLrcDraft(generateLrc(autoLines));
                }
            }

            preferLegacyOnNextLoadRef.current = false;
            if (!cancelled) setIsPreparing(false);
        };

        loadData();
        return () => {
            cancelled = true;
        };
    }, [selectedClipId, manualLoadVersion, sunoCookie, onUpdateClip]);

    const handleManualLoad = useCallback(() => {
        const nextId = manualId.trim();
        if (!nextId) return;

        preferLegacyOnNextLoadRef.current = true;
        setLines([]);
        setAlignment(null);
        setClipData(null);
        setLyricSource('');
        setLrcDraft('');
        setApplyStatus('idle');
        setLrcApplyStatus('idle');
        setCustomAudio(null);
        setProgress(0);
        setAudioDuration(0);
        setIsPlaying(false);
        previewPhaseRef.current = 'idle';
        setSelectedClipId(nextId);
        setManualLoadVersion(prev => prev + 1);
    }, [manualId]);

    const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const url = URL.createObjectURL(file);
            let type: 'video' | 'image' = 'image';
            if (file.type.startsWith('video') || file.name.match(/\.(mp4|webm|mov|mkv)$/i)) {
                type = 'video';
            }
            setCustomBg({ url, type, name: file.name });
            setShowBackgroundLayer(true);
        }
    }, []);

    const handleLogoUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const reader = new FileReader();
            reader.onload = () => {
                if (typeof reader.result === 'string') {
                    setLogoAsset({ url: reader.result, name: file.name });
                }
            };
            reader.readAsDataURL(file);
        }
    }, []);

    const handleSetLogoAsDefault = useCallback(async () => {
        if (!logoAsset?.url) return;
        let dataUrl = logoAsset.url;
        if (!dataUrl.startsWith('data:image/')) {
            const res = await fetch(dataUrl);
            const blob = await res.blob();
            dataUrl = await new Promise<string>((resolve, reject) => {
                const reader = new FileReader();
                reader.onload = () => resolve(String(reader.result || ''));
                reader.onerror = () => reject(new Error('Failed to read logo file.'));
                reader.readAsDataURL(blob);
            });
        }
        localStorage.setItem(DEFAULT_LOGO_STORAGE_KEY, JSON.stringify({ name: logoAsset.name, dataUrl }));
        setHasDefaultLogo(true);
    }, [logoAsset]);

    const handleClearDefaultLogo = useCallback(() => {
        localStorage.removeItem(DEFAULT_LOGO_STORAGE_KEY);
        setHasDefaultLogo(false);
    }, []);

    const handleAudioUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file) {
            const url = URL.createObjectURL(file);
            setCustomAudio({ url, name: file.name });
            if (audioRef.current && !audioRef.current.paused) {
                audioRef.current.pause();
                setIsPlaying(false);
            }
        }
    }, []);

    const handleApplyLyrics = useCallback(() => {
        if(!alignment) return;
        const newLines = matchWordsToPrompt(alignment, lyricSource);
        setLines(newLines);
        setApplyStatus('applied');
        setTimeout(() => setApplyStatus('idle'), 2000);
    }, [alignment, lyricSource]);

    const handleApplyLrc = useCallback(() => {
        if (looksLikeTimedLyricsJson(lrcDraft)) {
            try {
                const imported = parseTimedLyricsJson(lrcDraft);
                setAlignment(imported.alignment);
                setLines(imported.lines);
                setLyricSource(imported.lyricSource);
                setLrcDraft(imported.lrcContent);
                setLrcApplyStatus('applied');
                if (clipData) {
                    onUpdateClip(clipData.id, { alignmentData: imported.alignment, lrcContent: imported.lrcContent });
                    setClipData(prev => prev ? ({
                        ...prev,
                        alignmentData: imported.alignment,
                        lrcContent: imported.lrcContent
                    }) : prev);
                }
                setTimeout(() => setLrcApplyStatus('idle'), 2000);
                return;
            } catch (error: any) {
                setLrcApplyStatus('error');
                setTimeout(() => setLrcApplyStatus('idle'), 2500);
                alert(error?.message || 'Failed to parse timed lyrics JSON.');
                return;
            }
        }
        if (!alignment) {
            setLrcApplyStatus('error');
            setTimeout(() => setLrcApplyStatus('idle'), 2500);
            alert('Load Suno alignment first, or paste timed JSON such as WhisperX output.');
            return;
        }
        const parsed = parseLrc(lrcDraft);
        if (parsed.invalidLineNumbers.length > 0) {
            setLrcApplyStatus('error');
            setTimeout(() => setLrcApplyStatus('idle'), 2500);
            alert(
                `LRC has non-empty lines without timestamps (line${parsed.invalidLineNumbers.length > 1 ? 's' : ''} ${parsed.invalidLineNumbers.slice(0, 10).join(', ')}${parsed.invalidLineNumbers.length > 10 ? '…' : ''}). ` +
                `Add [mm:ss.xx] to every lyric line before applying.`
            );
            return;
        }
        if (!lrcDraft.trim() || parsed.entries.length === 0) {
            setLrcApplyStatus('error');
            setTimeout(() => setLrcApplyStatus('idle'), 2000);
            alert('No valid LRC timestamps found to apply.');
            return;
        }
        const lrcLines = groupWordsByLrcWithText(alignment, lrcDraft);
        if (lrcLines.length === 0) {
            setLrcApplyStatus('error');
            setTimeout(() => setLrcApplyStatus('idle'), 2000);
            alert('LRC parsed, but no aligned words matched the timestamp ranges.');
            return;
        }
        setLines(lrcLines);
        const parsedTextLines = parsed.entries.map(e => e.text).filter(Boolean).join('\n');
        if (parsedTextLines.trim()) {
            setLyricSource(parsedTextLines);
        }
        setLrcApplyStatus('applied');
        if (clipData) {
            onUpdateClip(clipData.id, { lrcContent: lrcDraft });
            setClipData(prev => prev ? ({ ...prev, lrcContent: lrcDraft }) : prev);
        }
        setTimeout(() => setLrcApplyStatus('idle'), 2000);
    }, [alignment, lrcDraft, clipData, onUpdateClip]);

    const handleGenerateLrcFromCurrentLines = useCallback(() => {
        if (!lines.length) return;
        const nextLrc = generateLrc(lines);
        setLrcDraft(nextLrc);
        if (clipData) {
            onUpdateClip(clipData.id, { lrcContent: nextLrc });
            setClipData(prev => prev ? ({ ...prev, lrcContent: nextLrc }) : prev);
        }
        setLrcApplyStatus('applied');
        setTimeout(() => setLrcApplyStatus('idle'), 1500);
    }, [lines, clipData, onUpdateClip]);

    const handleReplaceAlignment = useCallback((nextAlignment: AlignedWord[]) => {
        const normalized = nextAlignment.map((w) => {
            const start_s = Number.isFinite(w.start_s) ? Math.max(0, w.start_s) : 0;
            const endRaw = Number.isFinite(w.end_s) ? w.end_s : (start_s + 0.05);
            const end_s = Math.max(start_s + 0.01, endRaw);
            return {
                ...w,
                word: String(w.word ?? ''),
                start_s,
                end_s
            };
        });

        setAlignment(normalized);
        setLines(rebuildLinesFromSources(normalized));

        if (clipData) {
            onUpdateClip(clipData.id, { alignmentData: normalized });
            setClipData(prev => prev ? ({ ...prev, alignmentData: normalized }) : prev);
        }
    }, [clipData, onUpdateClip, rebuildLinesFromSources]);

    const getCurrentConfig = useCallback((): VisualizerConfig => ({
        aspectRatio,
        showBackgroundLayer,
        mainVisualizerEnabled,
        templatePreset,
        activeColor,
        inactiveColor,
        inactiveOpacity,
        fontFamily,
        smoothingFactor,
        verticalOffset,
        qt6Style,
        qt6BarCount,
        qt6Sensitivity,
        qt6SpectrogramSpeed,
        qt6ParticleDensity,
        qt6RingCount,
        qt6LedSegments,
        qt6SpectrogramPalette,
        logoPosition,
        logoScale,
        logoOpacity,
        logoPulseEnabled,
        logoPulseStyle,
        logoPulseGap,
        logoPulseScale,
        logoPulseSensitivity,
        showTitle,
        videoBitrate,
        videoBitrateMode,
        audioBitrate,
        fps,
        outputAspectTarget,
        preRollEnabled,
        preRollType,
        preRollText,
        preRollSeconds,
        preRollPreviewEnabled,
        preRollPreviewStartSeconds,
        preRollPreviewDurationSeconds,
        preRollPreviewShowTitle,
        preRollShowHeading,
        preRollHeadingText,
        preRollCardShowTitle,
        preRollCardTitleText,
        preRollCardTheme,
        postRollEnabled,
        postRollType,
        postRollText,
        postRollSeconds,
        postRollShowHeading,
        postRollHeadingText
    }), [
        aspectRatio, showBackgroundLayer, mainVisualizerEnabled, templatePreset, activeColor, inactiveColor, inactiveOpacity, fontFamily,
        smoothingFactor, verticalOffset, qt6Style, qt6BarCount, qt6Sensitivity, qt6SpectrogramSpeed, qt6ParticleDensity, qt6RingCount, qt6LedSegments, qt6SpectrogramPalette,
        logoPosition, logoScale, logoOpacity, logoPulseEnabled, logoPulseStyle, logoPulseGap, logoPulseScale, logoPulseSensitivity, showTitle,
        videoBitrate, videoBitrateMode, audioBitrate, fps,
        outputAspectTarget, preRollEnabled, preRollType, preRollText, preRollSeconds, preRollPreviewEnabled, preRollPreviewStartSeconds, preRollPreviewDurationSeconds, preRollPreviewShowTitle, preRollShowHeading, preRollHeadingText, preRollCardShowTitle, preRollCardTitleText, preRollCardTheme, postRollEnabled, postRollType, postRollText, postRollSeconds, postRollShowHeading, postRollHeadingText
    ]);

    const applyConfig = useCallback((config: any) => {
        if (config.aspectRatio) setAspectRatio(config.aspectRatio);
        if (typeof config.showBackgroundLayer === 'boolean') setShowBackgroundLayer(config.showBackgroundLayer);
        if (typeof config.mainVisualizerEnabled === 'boolean') setMainVisualizerEnabled(config.mainVisualizerEnabled);
        if (config.visualMode && typeof config.showBackgroundLayer !== 'boolean' && typeof config.mainVisualizerEnabled !== 'boolean') {
            setShowBackgroundLayer(config.visualMode !== 'qt6');
            setMainVisualizerEnabled(config.visualMode !== 'cover');
        }
        if (config.templatePreset) setTemplatePreset(config.templatePreset);
        if (config.activeColor) setActiveColor(config.activeColor);
        if (config.inactiveColor) setInactiveColor(config.inactiveColor);
        if (typeof config.inactiveOpacity === 'number') setInactiveOpacity(config.inactiveOpacity);
        if (config.fontFamily) setFontFamily(config.fontFamily);
        if (typeof config.smoothingFactor === 'number') setSmoothingFactor(config.smoothingFactor);
        if (typeof config.verticalOffset === 'number') setVerticalOffset(config.verticalOffset);
        if (config.qt6Style) setQt6Style(config.qt6Style);
        if (typeof config.qt6BarCount === 'number') setQt6BarCount(config.qt6BarCount);
        if (typeof config.qt6Sensitivity === 'number') setQt6Sensitivity(config.qt6Sensitivity);
        if (typeof config.qt6SpectrogramSpeed === 'number') setQt6SpectrogramSpeed(config.qt6SpectrogramSpeed);
        if (typeof config.qt6ParticleDensity === 'number') setQt6ParticleDensity(config.qt6ParticleDensity);
        if (typeof config.qt6RingCount === 'number') setQt6RingCount(config.qt6RingCount);
        if (typeof config.qt6LedSegments === 'number') setQt6LedSegments(config.qt6LedSegments);
        if (config.qt6SpectrogramPalette) setQt6SpectrogramPalette(config.qt6SpectrogramPalette);
        if (config.logoPosition) setLogoPosition(config.logoPosition);
        if (typeof config.logoScale === 'number') setLogoScale(config.logoScale);
        if (typeof config.logoOpacity === 'number') setLogoOpacity(config.logoOpacity);
        if (typeof config.logoPulseEnabled === 'boolean') setLogoPulseEnabled(config.logoPulseEnabled);
        if (config.logoPulseStyle) setLogoPulseStyle(config.logoPulseStyle);
        if (typeof config.logoPulseGap === 'number') setLogoPulseGap(config.logoPulseGap);
        if (typeof config.logoPulseScale === 'number') setLogoPulseScale(config.logoPulseScale);
        if (typeof config.logoPulseSensitivity === 'number') setLogoPulseSensitivity(config.logoPulseSensitivity);
        if (typeof config.showTitle === 'boolean') setShowTitle(config.showTitle);
        if (typeof config.videoBitrate === 'number') setVideoBitrate(config.videoBitrate);
        if (config.videoBitrateMode) setVideoBitrateMode(config.videoBitrateMode);
        if (typeof config.audioBitrate === 'number') setAudioBitrate(config.audioBitrate);
        if (typeof config.fps === 'number') setFps(config.fps);
        if (config.outputAspectTarget) setOutputAspectTarget(config.outputAspectTarget);
        if (typeof config.preRollEnabled === 'boolean') setPreRollEnabled(config.preRollEnabled);
        if (config.preRollType) setPreRollType(config.preRollType);
        if (typeof config.preRollText === 'string') setPreRollText(config.preRollText);
        if (typeof config.preRollSeconds === 'number') setPreRollSeconds(config.preRollSeconds);
        if (typeof config.preRollPreviewEnabled === 'boolean') setPreRollPreviewEnabled(config.preRollPreviewEnabled);
        if (typeof config.preRollPreviewStartSeconds === 'number') setPreRollPreviewStartSeconds(config.preRollPreviewStartSeconds);
        if (typeof config.preRollPreviewDurationSeconds === 'number') setPreRollPreviewDurationSeconds(config.preRollPreviewDurationSeconds);
        if (typeof config.preRollPreviewShowTitle === 'boolean') setPreRollPreviewShowTitle(config.preRollPreviewShowTitle);
        if (typeof config.preRollShowHeading === 'boolean') setPreRollShowHeading(config.preRollShowHeading);
        if (typeof config.preRollHeadingText === 'string') setPreRollHeadingText(config.preRollHeadingText);
        if (typeof config.preRollCardShowTitle === 'boolean') setPreRollCardShowTitle(config.preRollCardShowTitle);
        if (typeof config.preRollCardTitleText === 'string') setPreRollCardTitleText(config.preRollCardTitleText);
        if (config.preRollCardTheme === 'clean' || config.preRollCardTheme === 'bold') setPreRollCardTheme(config.preRollCardTheme);
        if (typeof config.postRollEnabled === 'boolean') setPostRollEnabled(config.postRollEnabled);
        if (config.postRollType) setPostRollType(config.postRollType);
        if (typeof config.postRollText === 'string') setPostRollText(config.postRollText);
        if (typeof config.postRollSeconds === 'number') setPostRollSeconds(config.postRollSeconds);
        if (typeof config.postRollShowHeading === 'boolean') setPostRollShowHeading(config.postRollShowHeading);
        if (typeof config.postRollHeadingText === 'string') setPostRollHeadingText(config.postRollHeadingText);
    }, []);

    const saveCurrentPreset = useCallback((name: string) => {
        const cleanName = name.trim();
        if (!cleanName) return;
        const preset: SavedVisualizerPreset = {
            id: `${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
            name: cleanName,
            config: getCurrentConfig(),
            createdAt: new Date().toISOString()
        };
        setSavedPresets(prev => [preset, ...prev]);
    }, [getCurrentConfig]);

    const applySavedPreset = useCallback((id: string) => {
        const preset = savedPresets.find(p => p.id === id);
        if (!preset) return;
        applyConfig(preset.config);
    }, [savedPresets, applyConfig]);

    const deleteSavedPreset = useCallback((id: string) => {
        setSavedPresets(prev => prev.filter(p => p.id !== id));
    }, []);

    const applyTemplatePreset = useCallback((preset: VisualizerTemplate) => {
        setTemplatePreset(preset);
        if (preset === 'classic') {
            setShowBackgroundLayer(true);
            setMainVisualizerEnabled(false);
            setQt6Style('wave');
            setQt6BarCount(64);
            setQt6Sensitivity(1);
            setQt6SpectrogramSpeed(1);
            setQt6ParticleDensity(1);
            setQt6RingCount(3);
            setQt6LedSegments(14);
            setQt6SpectrogramPalette('neon');
            setVerticalOffset(0);
            setActiveColor('#e879f9');
            setInactiveColor('#ffffff');
            setInactiveOpacity(0.3);
            setShowTitle(true);
            setLogoPosition('bottom-right');
            setLogoScale(0.14);
            setLogoOpacity(0.9);
            setLogoPulseEnabled(false);
            setLogoPulseStyle('expanding-circle');
            setLogoPulseGap(0);
            setLogoPulseScale(1.35);
            setLogoPulseSensitivity(1.3);
        } else if (preset === 'clean-lyrics') {
            setShowBackgroundLayer(true);
            setMainVisualizerEnabled(true);
            setQt6Style('bars');
            setQt6BarCount(32);
            setQt6Sensitivity(1.2);
            setQt6SpectrogramSpeed(1);
            setQt6ParticleDensity(1);
            setQt6RingCount(3);
            setQt6LedSegments(14);
            setQt6SpectrogramPalette('neon');
            setVerticalOffset(0.12);
            setActiveColor('#f8fafc');
            setInactiveColor('#cbd5e1');
            setInactiveOpacity(0.28);
            setShowTitle(true);
            setLogoPosition('bottom-right');
            setLogoScale(0.12);
            setLogoOpacity(0.82);
            setLogoPulseEnabled(false);
            setLogoPulseStyle('expanding-circle');
            setLogoPulseGap(0);
            setLogoPulseScale(1.3);
            setLogoPulseSensitivity(1.15);
        } else if (preset === 'corner-pulse') {
            setShowBackgroundLayer(true);
            setMainVisualizerEnabled(true);
            setQt6Style('circle');
            setQt6BarCount(64);
            setQt6Sensitivity(1.4);
            setQt6SpectrogramSpeed(1);
            setQt6ParticleDensity(1);
            setQt6RingCount(3);
            setQt6LedSegments(14);
            setQt6SpectrogramPalette('neon');
            setVerticalOffset(0.1);
            setActiveColor('#22d3ee');
            setInactiveColor('#ffffff');
            setInactiveOpacity(0.32);
            setShowTitle(true);
            setLogoPosition('bottom-right');
            setLogoScale(0.14);
            setLogoOpacity(0.95);
            setLogoPulseEnabled(true);
            setLogoPulseStyle('radial-bars');
            setLogoPulseGap(0);
            setLogoPulseScale(1.45);
            setLogoPulseSensitivity(1.55);
        } else if (preset === 'cinematic-bars') {
            setShowBackgroundLayer(true);
            setMainVisualizerEnabled(true);
            setQt6Style('bars');
            setQt6BarCount(128);
            setQt6Sensitivity(1.5);
            setQt6SpectrogramSpeed(2);
            setQt6ParticleDensity(1.2);
            setQt6RingCount(3);
            setQt6LedSegments(16);
            setQt6SpectrogramPalette('fire');
            setVerticalOffset(0.06);
            setActiveColor('#f97316');
            setInactiveColor('#f8fafc');
            setInactiveOpacity(0.25);
            setShowTitle(true);
            setLogoPosition('bottom-left');
            setLogoScale(0.11);
            setLogoOpacity(0.84);
            setLogoPulseEnabled(true);
            setLogoPulseStyle('expanding-circle');
            setLogoPulseGap(0);
            setLogoPulseScale(1.25);
            setLogoPulseSensitivity(1.2);
        }
    }, []);

    const applyQt6LookPreset = useCallback((preset: Qt6LookPreset) => {
        setMainVisualizerEnabled(true);
        if (preset === 'retro-led') {
            setQt6Style('led-bars');
            setQt6BarCount(64);
            setQt6LedSegments(18);
            setQt6Sensitivity(1.35);
            setActiveColor('#22c55e');
            setQt6SpectrogramPalette('mono');
            return;
        }
        if (preset === 'broadcast-vu') {
            setQt6Style('vu-meter');
            setQt6Sensitivity(1.25);
            setActiveColor('#f59e0b');
            return;
        }
        if (preset === 'neon-spectrogram') {
            setQt6Style('spectrogram');
            setQt6SpectrogramSpeed(2);
            setQt6Sensitivity(1.4);
            setActiveColor('#22d3ee');
            setQt6SpectrogramPalette('neon');
            return;
        }
        if (preset === 'club-radial') {
            setQt6Style('radial-spectrum');
            setQt6BarCount(128);
            setQt6Sensitivity(1.65);
            setActiveColor('#f97316');
            return;
        }
        if (preset === 'organic-ambient') {
            setQt6Style('organic-blob');
            setQt6Sensitivity(1.1);
            setActiveColor('#a78bfa');
            return;
        }
        setQt6Style('wave-spectrum');
        setQt6BarCount(64);
        setQt6Sensitivity(1.2);
        setActiveColor('#38bdf8');
    }, []);

    const randomizeQt6Look = useCallback(() => {
        const styles: Qt6Style[] = [
            'stereo-wave', 'stereo-bars', 'log-bars', 'led-bars', 'radial-spectrum',
            'wave-spectrum', 'vu-meter', 'spectrogram', 'particle-pulse', 'organic-blob', 'multi-band-ring'
        ];
        const colors = ['#22d3ee', '#f97316', '#22c55e', '#e879f9', '#38bdf8', '#f43f5e', '#f59e0b', '#a78bfa'];
        const palettes: SpectrogramPalette[] = ['neon', 'fire', 'ice', 'mono'];
        const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];
        setMainVisualizerEnabled(true);
        setQt6Style(pick(styles));
        setQt6BarCount(pick([32, 64, 128]));
        setQt6Sensitivity(Number((0.9 + Math.random() * 1.3).toFixed(1)));
        setQt6LedSegments(pick([10, 14, 18, 22]));
        setQt6SpectrogramSpeed(pick([1, 2, 3, 4]));
        setQt6ParticleDensity(Number((0.8 + Math.random() * 1.6).toFixed(1)));
        setQt6RingCount(pick([2, 3, 4, 5]));
        setQt6SpectrogramPalette(pick(palettes));
        setActiveColor(pick(colors));
    }, []);

    useEffect(() => {
        if (!selectedClipId) return;
        setLyricDrafts(prev => {
            if (prev[selectedClipId] === lyricSource) return prev;
            return { ...prev, [selectedClipId]: lyricSource };
        });
    }, [selectedClipId, lyricSource]);

    useEffect(() => {
        lyricDraftsRef.current = lyricDrafts;
    }, [lyricDrafts]);

    useEffect(() => {
        historyRef.current = history;
    }, [history]);

    useEffect(() => {
        if (!selectedClipId) return;
        setLrcDrafts(prev => {
            if (prev[selectedClipId] === lrcDraft) return prev;
            return { ...prev, [selectedClipId]: lrcDraft };
        });
    }, [selectedClipId, lrcDraft]);

    useEffect(() => {
        const parsed = parseLrc(lrcDraft);
        if (parsed.entries.length === 0) return;
        const nextLyricSource = parsed.entries.map(entry => entry.text).join('\n').trim();
        if (!nextLyricSource) return;
        setLyricSource(prev => (prev === nextLyricSource ? prev : nextLyricSource));
    }, [lrcDraft]);

    useEffect(() => {
        lrcDraftsRef.current = lrcDrafts;
    }, [lrcDrafts]);

    useEffect(() => {
        if (!hasRestoredSessionRef.current) return;
        const session = {
            selectedClipId,
            manualId,
            lyricDrafts,
            lrcDrafts,
            logoAsset,
            config: getCurrentConfig()
        };
        try {
            localStorage.setItem(SESSION_KEY, JSON.stringify(session));
        } catch (err) {
            console.warn('Failed to persist visualizer session:', err);
        }
    }, [selectedClipId, manualId, lyricDrafts, lrcDrafts, logoAsset, getCurrentConfig]);

    useEffect(() => {
        if (!hasRestoredSessionRef.current) return;
        try {
            localStorage.setItem(PRESET_KEY, JSON.stringify(savedPresets));
        } catch (err) {
            console.warn('Failed to persist saved presets:', err);
        }
    }, [savedPresets]);

    const handleSmartGroup = async () => {
        if (!clipData || !alignment) return;
        const cleanLyrics = stripMetaTags(lyricSource);
        if (!cleanLyrics.trim()) {
            alert("No text lyrics found to group against.");
            return;
        }
        setIsGrouping(true);
        try {
            const cleanAligned = getCleanAlignedWords(alignment);
            const pseudoLines = matchWordsToPrompt(alignment, lyricSource);
            setLines(pseudoLines);
            let grouped: AlignedWord[][] = [];

            if (providerConfig && validateProviderConfig(providerConfig)) {
                const provider = createProvider(providerConfig);
                const model = providerConfig.model || getDefaultModelForProvider(providerConfig.type);
                const response = await provider.generateContent({
                    model,
                    temperature: 0.1,
                    responseMimeType: 'application/json',
                    systemInstruction: 'Return strict JSON only. Output an object: {"lines":[[{"word":"...","start":0,"end":0}]]}.',
                    contents: `
Task: Group a list of synchronized words into arrays that represent lyric lines.
Use the LYRICS as ground truth for line breaks. Preserve timing values from SYNCED WORDS.

LYRICS:
${cleanLyrics}

SYNCED WORDS (JSON):
${JSON.stringify(cleanAligned.map(w => ({ word: w.word, start: w.start_s, end: w.end_s })))}
                    `.trim(),
                    timeoutMs: 90000
                });

                const parsed = JSON.parse(response.text || '{}');
                const rawLines = Array.isArray(parsed) ? parsed : parsed?.lines;
                if (Array.isArray(rawLines)) {
                    grouped = rawLines.map((line: any[]) =>
                        Array.isArray(line)
                            ? line.map((item: any) => ({
                                word: String(item?.word ?? ''),
                                start_s: Number(item?.start ?? item?.start_s ?? 0),
                                end_s: Number(item?.end ?? item?.end_s ?? 0),
                                success: true,
                                p_align: 1
                            })).filter((w: AlignedWord) => w.word)
                            : []
                    ).filter((line: AlignedWord[]) => line.length > 0);
                }
            } else if (apiKey) {
                // Backward-compat Gemini-only path
                grouped = await groupLyricsByLines(cleanLyrics, cleanAligned, apiKey, geminiModel, pseudoLines);
            } else {
                alert('Refine Lines with AI requires a configured AI provider (e.g., OpenRouter/Gemini) with model + key.');
                return;
            }

            if (grouped && grouped.length > 0) {
                setLines(grouped);
            } else {
                alert("AI refine returned no usable line groups. Kept prompt-based grouping.");
            }
        } catch (e) {
            console.error(e);
            alert("Failed to group lines with AI. Kept prompt-based grouping.");
        } finally {
            setIsGrouping(false);
        }
    };

    const clampTimeline = useCallback((value: number) => {
        return Math.max(0, Math.min(totalPreviewDuration || 0, value));
    }, [totalPreviewDuration]);

    const mapPreviewToSongTime = useCallback((timelineTime: number) => {
        if (audioDuration <= 0) return 0;
        const songWindowStart = preRollDuration;
        const songWindowEnd = preRollDuration + audioDuration;
        if (timelineTime < songWindowStart) {
            if (preRollPreviewEnabled) {
                const previewStart = Math.max(0, preRollPreviewStartSeconds);
                const previewDur = Math.max(0.1, Math.min(10, preRollPreviewDurationSeconds));
                const offset = Math.max(0, timelineTime);
                const looped = previewStart + (offset % previewDur);
                return Math.min(audioDuration, looped);
            }
            return 0;
        }
        if (timelineTime > songWindowEnd) return audioDuration;
        return Math.max(0, Math.min(audioDuration, timelineTime - preRollDuration));
    }, [audioDuration, preRollDuration, preRollPreviewEnabled, preRollPreviewDurationSeconds, preRollPreviewStartSeconds]);

    const handleSeek = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
        const timelineTime = clampTimeline(parseFloat(e.target.value));
        setProgress(timelineTime);

        if (!audioRef.current) return;
        const songTime = mapPreviewToSongTime(timelineTime);
        audioRef.current.currentTime = songTime;
        if (timelineTime < preRollDuration || timelineTime > preRollDuration + audioDuration) {
            audioRef.current.pause();
            previewPhaseRef.current = 'idle';
        } else {
            previewPhaseRef.current = audioRef.current.paused ? 'idle' : 'audio';
        }
    }, [audioDuration, clampTimeline, mapPreviewToSongTime, preRollDuration]);

    const togglePlay = useCallback(() => {
        const audio = audioRef.current;
        if (!audio) return;

        const startPreRollPlayback = () => {
            previewPhaseRef.current = 'preroll';
            previewPhaseStartMsRef.current = performance.now();
            previewPhaseStartVirtualRef.current = progress;
            audio.pause();
            setIsPlaying(true);
        };

        const startPostRollPlayback = () => {
            previewPhaseRef.current = 'postroll';
            previewPhaseStartMsRef.current = performance.now();
            previewPhaseStartVirtualRef.current = progress;
            audio.pause();
            setIsPlaying(true);
        };

        if (isPlaying) {
            previewPhaseRef.current = 'idle';
            audio.pause();
            setIsPlaying(false);
            return;
        }

        if (audioContextRef.current && audioContextRef.current.state === 'suspended') {
            audioContextRef.current.resume().catch(console.error);
        }

        if (progress < preRollDuration && preRollDuration > 0) {
            startPreRollPlayback();
            return;
        }
        if (progress > preRollDuration + audioDuration && postRollDuration > 0) {
            startPostRollPlayback();
            return;
        }

        previewPhaseRef.current = 'audio';
        audio.currentTime = mapPreviewToSongTime(progress);
        const p = audio.play();
        if (p !== undefined) {
            p.catch(e => {
                console.error("Playback error:", e);
                setIsPlaying(false);
                previewPhaseRef.current = 'idle';
            });
        }
    }, [audioDuration, isPlaying, mapPreviewToSongTime, postRollDuration, preRollDuration, progress]);

    // --- DRAWING LOGIC ---
    const resolveVisualizerData = (data?: VisualizerFrameData): VisualizerFrameData | null => {
        if (data) return data;
        if (!analyserRef.current || !dataArrayRef.current) return null;

        if (qt6Style === 'wave') {
            const timeBuffer = timeDataArrayRef.current || dataArrayRef.current;
            analyserRef.current.getByteTimeDomainData(timeBuffer as any);
            return timeBuffer;
        }
        if (qt6Style === 'stereo-wave') {
            const monoTime = timeDataArrayRef.current || new Uint8Array(analyserRef.current.fftSize);
            analyserRef.current.getByteFrequencyData(dataArrayRef.current as any);
            analyserRef.current.getByteTimeDomainData(monoTime as any);
            timeDataArrayRef.current = monoTime;
            const leftAnalyser = leftAnalyserRef.current;
            const rightAnalyser = rightAnalyserRef.current;
            const leftTime = leftTimeDataArrayRef.current;
            const rightTime = rightTimeDataArrayRef.current;
            if (leftAnalyser && rightAnalyser && leftTime && rightTime) {
                leftAnalyser.getByteTimeDomainData(leftTime as any);
                rightAnalyser.getByteTimeDomainData(rightTime as any);
                return {
                    frequencyData: dataArrayRef.current,
                    timeData: monoTime,
                    leftTimeData: leftTime,
                    rightTimeData: rightTime
                };
            }
            return monoTime;
        }
        if (qt6Style === 'wave-spectrum') {
            const freqBuffer = dataArrayRef.current;
            const timeBuffer = timeDataArrayRef.current || new Uint8Array(analyserRef.current.fftSize);
            analyserRef.current.getByteFrequencyData(freqBuffer as any);
            analyserRef.current.getByteTimeDomainData(timeBuffer as any);
            timeDataArrayRef.current = timeBuffer;
            return { frequencyData: freqBuffer, timeData: timeBuffer };
        }
        if (qt6Style === 'stereo-bars' || qt6Style === 'vu-meter') {
            analyserRef.current.getByteFrequencyData(dataArrayRef.current as any);
            const leftAnalyser = leftAnalyserRef.current;
            const rightAnalyser = rightAnalyserRef.current;
            const leftBuffer = leftDataArrayRef.current;
            const rightBuffer = rightDataArrayRef.current;
            if (leftAnalyser && rightAnalyser && leftBuffer && rightBuffer) {
                leftAnalyser.getByteFrequencyData(leftBuffer as any);
                rightAnalyser.getByteFrequencyData(rightBuffer as any);
                return {
                    frequencyData: dataArrayRef.current,
                    leftFrequencyData: leftBuffer,
                    rightFrequencyData: rightBuffer
                };
            }
        }
        analyserRef.current.getByteFrequencyData(dataArrayRef.current as any);
        return dataArrayRef.current;
    };

    const getLogoAnchor = (width: number, height: number) => {
        const margin = Math.max(20, Math.round(Math.min(width, height) * 0.04));
        const logoSizePx = Math.max(40, Math.round(Math.min(width, height) * logoScale));
        if (logoPosition === 'bottom-left') {
            return { x: margin, y: height - margin - logoSizePx, size: logoSizePx };
        }
        if (logoPosition === 'top-left') {
            return { x: margin, y: margin, size: logoSizePx };
        }
        if (logoPosition === 'top-right') {
            return { x: width - margin - logoSizePx, y: margin, size: logoSizePx };
        }
        return { x: width - margin - logoSizePx, y: height - margin - logoSizePx, size: logoSizePx };
    };

    const drawRollPreviewCard = (
        ctx: CanvasRenderingContext2D,
        width: number,
        height: number,
        type: 'text' | 'qr',
        text: string,
        heading: string,
        includeTitle: boolean,
        titleText?: string,
        theme: 'clean' | 'bold' = 'clean'
    ) => {
        ctx.save();
        const isBold = theme === 'bold';
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

        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        const trimmedHeading = heading.trim();
        if (trimmedHeading) {
            ctx.fillStyle = '#f8fafc';
            ctx.font = `700 ${Math.max(22, Math.round(width * 0.035))}px Inter, Arial, sans-serif`;
            ctx.fillText(trimmedHeading, width / 2, panelY + Math.max(18, Math.round(panelHeight * 0.08)));
        }

        const effectiveTitle = (titleText || '').trim() || clipData?.title?.trim() || '';
        if (includeTitle && effectiveTitle) {
            ctx.fillStyle = 'rgba(186, 230, 253, 0.92)';
            ctx.font = `600 ${Math.max(18, Math.round(width * 0.026))}px Inter, Arial, sans-serif`;
            ctx.fillText(effectiveTitle, width / 2, panelY + Math.max(56, Math.round(panelHeight * 0.22)));
        }

        if (type === 'qr') {
            ctx.fillStyle = '#e2e8f0';
            ctx.font = `600 ${Math.max(18, Math.round(width * 0.025))}px Inter, Arial, sans-serif`;
            ctx.textBaseline = 'middle';
            ctx.fillText(text?.trim() || 'QR Link', width / 2, panelY + (panelHeight * 0.66));
        } else {
            const message = text?.trim() || ' ';
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
            let y = panelY + (panelHeight * 0.62) - totalHeight / 2 + lineHeight / 2;
            for (const line of lines.slice(0, 6)) {
                ctx.fillText(line, width / 2, y);
                y += lineHeight;
            }
        }

        ctx.restore();
    };

    const renderFrame = (ctx: CanvasRenderingContext2D, width: number, height: number, time: number, data?: VisualizerFrameData) => {
        let currentActiveColor = activeColor;
        const activeEvent = [...colorEvents].reverse().find((e: any) => e.time <= time);
        if (activeEvent) {
            currentActiveColor = activeEvent.activeColor;
        }
        // 1. Background Layer
        ctx.fillStyle = '#1e1e1e';
        ctx.fillRect(0, 0, width, height);

        const drawCoverLayer = showBackgroundLayer;
        const drawVisualizerLayer = mainVisualizerEnabled || logoPulseEnabled;
        const logoImg = document.getElementById('custom-logo-img') as HTMLImageElement | null;

        if (drawCoverLayer) {
            let drawn = false;
            if (customBg) {
                if (customBg.type === 'video' && customVideoRef.current) {
                    drawCover(ctx, customVideoRef.current, width, height);
                    drawn = true;
                } else if (customBg.type === 'image') {
                    const customImg = document.getElementById('custom-bg-img') as HTMLImageElement;
                    if (customImg && customImg.complete) {
                        drawCover(ctx, customImg, width, height);
                        drawn = true;
                    }
                }
            }
            if (!drawn) {
                const bgImg = document.getElementById('source-img') as HTMLImageElement;
                if (bgImg && bgImg.complete) {
                    drawCover(ctx, bgImg, width, height);
                }
            }
            ctx.fillStyle = drawVisualizerLayer ? 'rgba(0,0,0,0.45)' : 'rgba(0,0,0,0.7)';
            ctx.fillRect(0, 0, width, height);
        } else {
            const grad = ctx.createLinearGradient(0, 0, 0, height);
            grad.addColorStop(0, '#0f172a');
            grad.addColorStop(1, '#000000');
            ctx.fillStyle = grad;
            ctx.fillRect(0, 0, width, height);
        }

        if (drawVisualizerLayer) {
            const visualData = resolveVisualizerData(data);
            if (visualData) {
                if (mainVisualizerEnabled) {
                    drawQt6Visualizer(ctx, width, height, visualData, qt6Style, {
                        activeColor,
                        qt6Sensitivity,
                        qt6BarCount,
                        qt6SpectrogramSpeed,
                        qt6ParticleDensity,
                        qt6RingCount,
                        qt6LedSegments,
                        qt6SpectrogramPalette
                    });
                }
                if (logoPulseEnabled && logoAsset && logoImg?.complete) {
                    const logoVisualData = (visualData as any).frequencyData ? (visualData as any).frequencyData : visualData;
                    const anchor = getLogoAnchor(width, height);
                    const logoEdgeRadius = (anchor.size * Math.SQRT2) / 2;
                    const pulseRadius = Math.max(8, (logoEdgeRadius + logoPulseGap) * logoPulseScale);
                    const centerX = anchor.x + (anchor.size / 2);
                    const centerY = anchor.y + (anchor.size / 2);
                    if (logoPulseStyle === 'radial-bars') {
                        drawCornerPulseVisualizer(ctx, logoVisualData as any, {
                            activeColor,
                            qt6Sensitivity: logoPulseSensitivity,
                            centerX,
                            centerY,
                            radius: pulseRadius * 0.55
                        });
                    } else if (logoPulseStyle === 'circular-wave') {
                        drawLogoCircularWave(ctx, logoVisualData as any, {
                            activeColor,
                            sensitivity: logoPulseSensitivity,
                            centerX,
                            centerY,
                            radius: pulseRadius * 0.5
                        });
                    } else {
                        drawLogoExpandingCircle(ctx, logoVisualData as any, {
                            activeColor,
                            sensitivity: logoPulseSensitivity,
                            centerX,
                            centerY,
                            radius: pulseRadius * 0.5
                        });
                    }
                }
            }
        }

        // 2. Draw Text (Smooth Scroll)
        drawScrollingLyrics(ctx, width, height, time, lines, smoothLineIdxRef, {
            fontFamily,
            activeColor,
            inactiveColor,
            inactiveOpacity,
            smoothingFactor,
            verticalOffset,
            aspectRatio,
            colorEvents
        });

        if (showTitle && clipData?.title) {
            ctx.textAlign = 'center';
            ctx.textBaseline = 'top';
            ctx.font = `700 ${Math.max(20, Math.round(width * 0.022))}px ${fontFamily}`;
            ctx.fillStyle = 'rgba(255,255,255,0.95)';
            ctx.shadowColor = 'rgba(0,0,0,0.7)';
            ctx.shadowBlur = 10;
            ctx.fillText(clipData.title, width / 2, Math.max(18, Math.round(height * 0.05)));
            ctx.shadowBlur = 0;
        }

        if (logoAsset && logoImg && logoImg.complete) {
            const anchor = getLogoAnchor(width, height);
            drawLogoWatermark(ctx, logoImg, anchor.x, anchor.y, anchor.size, logoOpacity);
        }

        // Title & Progress Bar
        if (clipData && totalPreviewDuration) {
            const pct = time / totalPreviewDuration;
            ctx.fillStyle = currentActiveColor;
            ctx.fillRect(0, height - 8, width * pct, 8);
        }
    };

    // Preview Loop
    const animate = useCallback(() => {
        const canvas = canvasRef.current;
        const ctx = canvas?.getContext('2d');
        // Sync video playback during preview
        if (!isRendering && customBg?.type === 'video' && customVideoRef.current && audioRef.current) {
            if(!audioRef.current.paused && customVideoRef.current.paused) customVideoRef.current.play();
            if(audioRef.current.paused && !customVideoRef.current.paused) customVideoRef.current.pause();
        }

        if (!isRendering && audioRef.current && canvas && ctx) {
            const audio = audioRef.current;
            const now = performance.now();
            let virtualTime = progress;

            if (previewPhaseRef.current === 'preroll') {
                const elapsed = (now - previewPhaseStartMsRef.current) / 1000;
                virtualTime = clampTimeline(previewPhaseStartVirtualRef.current + elapsed);
                if (virtualTime >= preRollDuration) {
                    previewPhaseRef.current = 'audio';
                    virtualTime = preRollDuration;
                    audio.currentTime = 0;
                    const p = audio.play();
                    if (p !== undefined) {
                        p.catch(() => {
                            previewPhaseRef.current = 'idle';
                            setIsPlaying(false);
                        });
                    }
                }
            } else if (previewPhaseRef.current === 'postroll') {
                const elapsed = (now - previewPhaseStartMsRef.current) / 1000;
                virtualTime = clampTimeline(previewPhaseStartVirtualRef.current + elapsed);
                if (virtualTime >= totalPreviewDuration) {
                    virtualTime = totalPreviewDuration;
                    previewPhaseRef.current = 'idle';
                    setIsPlaying(false);
                    audio.pause();
                }
            } else {
                if (previewPhaseRef.current === 'audio' || (!audio.paused && !audio.ended && isPlaying)) {
                    virtualTime = clampTimeline(preRollDuration + audio.currentTime);
                } else {
                    // Keep the explicit timeline position while idle/paused.
                    virtualTime = clampTimeline(progress);
                }
                if (isPlaying && audio.ended) {
                    if (postRollDuration > 0) {
                        previewPhaseRef.current = 'postroll';
                        previewPhaseStartMsRef.current = now;
                        previewPhaseStartVirtualRef.current = preRollDuration + audioDuration;
                        virtualTime = previewPhaseStartVirtualRef.current;
                    } else {
                        previewPhaseRef.current = 'idle';
                        setIsPlaying(false);
                    }
                }
            }

            const songTime = mapPreviewToSongTime(virtualTime);
            const dims = ASPECT_RATIOS[aspectRatio];
            renderFrame(ctx, dims.width, dims.height, songTime);
            if (virtualTime < preRollDuration && preRollDuration > 0 && preRollEnabled) {
                drawRollPreviewCard(
                    ctx,
                    dims.width,
                    dims.height,
                    preRollType,
                    preRollText,
                    preRollShowHeading ? (preRollHeadingText.trim() || (preRollPreviewEnabled ? 'Preview Intro' : 'Pre-Roll')) : '',
                    preRollCardShowTitle || (preRollPreviewEnabled && preRollPreviewShowTitle),
                    preRollCardTitleText,
                    preRollCardTheme
                );
            } else if (virtualTime > preRollDuration + audioDuration && postRollDuration > 0 && postRollEnabled) {
                drawRollPreviewCard(
                    ctx,
                    dims.width,
                    dims.height,
                    postRollType,
                    postRollText,
                    postRollShowHeading ? (postRollHeadingText.trim() || 'Post-Roll') : '',
                    false
                );
            }

            setProgress(virtualTime);
            requestRef.current = requestAnimationFrame(animate);
        }
    }, [activeColor, aspectRatio, audioDuration, clipData, clampTimeline, customBg, fontFamily, inactiveColor, inactiveOpacity, isPlaying, isRendering, lines, logoAsset, logoOpacity, logoPosition, logoPulseEnabled, logoPulseGap, logoPulseScale, logoPulseSensitivity, logoPulseStyle, logoScale, mainVisualizerEnabled, mapPreviewToSongTime, postRollDuration, postRollEnabled, postRollHeadingText, postRollShowHeading, postRollText, postRollType, preRollCardShowTitle, preRollCardTheme, preRollCardTitleText, preRollDuration, preRollEnabled, preRollHeadingText, preRollPreviewEnabled, preRollPreviewShowTitle, preRollShowHeading, preRollText, preRollType, progress, qt6BarCount, qt6LedSegments, qt6ParticleDensity, qt6RingCount, qt6Sensitivity, qt6SpectrogramPalette, qt6SpectrogramSpeed, qt6Style, showBackgroundLayer, showTitle, smoothingFactor, totalPreviewDuration, verticalOffset]);

    useEffect(() => {
        if (selectedClipId && !isRendering) {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
            requestRef.current = requestAnimationFrame(animate);
        }
        return () => {
            if (requestRef.current) cancelAnimationFrame(requestRef.current);
        };
    }, [selectedClipId, animate, isRendering]);

    // --- OFFLINE RENDERING ---
    const startOfflineRender = async () => {
        if (!clipData || !audioRef.current || !canvasRef.current) return;
        
        audioRef.current.pause();
        if(customVideoRef.current) customVideoRef.current.pause();

        setRenderError(null);
        setIsRendering(true);
        setRenderProgress(0);
        setRenderSpeed(0);
        renderStartTimeRef.current = performance.now();
        lastSpeedUpdateRef.current = 0;

        const originalSmoothRef = smoothLineIdxRef.current;
        smoothLineIdxRef.current = 0; 

        try {
            await performOfflineRender(
                audioRef.current.src,
                canvasRef.current,
                {
                    width: ASPECT_RATIOS[aspectRatio].width,
                    height: ASPECT_RATIOS[aspectRatio].height,
                    bitrate: audioBitrate,
                    videoBitrate,
                    videoBitrateMode,
                    fps,
                    title: clipData.title || "video",
                    visualMode: currentVisualMode,
                    qt6Style,
                    customVideo: customVideoRef.current,
                    customBgType: customBg?.type,
                    outputAspectTarget,
                    preRoll: {
                        enabled: preRollEnabled,
                        type: preRollType,
                        text: preRollText,
                        seconds: preRollSeconds,
                        previewEnabled: preRollPreviewEnabled,
                        previewStartSeconds: preRollPreviewStartSeconds,
                        previewDurationSeconds: preRollPreviewDurationSeconds,
                        previewShowTitle: preRollPreviewShowTitle,
                        headingText: preRollShowHeading ? (preRollHeadingText.trim() || (preRollPreviewEnabled ? 'Preview Intro' : 'Pre-Roll')) : '',
                        showTitle: preRollCardShowTitle,
                        titleText: preRollCardTitleText,
                        theme: preRollCardTheme
                    },
                    postRoll: {
                        enabled: postRollEnabled,
                        type: postRollType,
                        text: postRollText,
                        seconds: postRollSeconds,
                        headingText: postRollShowHeading ? (postRollHeadingText.trim() || 'Post-Roll') : ''
                    }
                },
                setRenderProgress,
                (ctx, time, data) => {
                    renderFrame(ctx, ASPECT_RATIOS[aspectRatio].width, ASPECT_RATIOS[aspectRatio].height, time, data);
                    
                    // Calculate Speed
                    const now = performance.now();
                    if (now - lastSpeedUpdateRef.current > 500) {
                        const elapsed = (now - renderStartTimeRef.current) / 1000;
                        if (elapsed > 0.1) {
                            setRenderSpeed(time / elapsed);
                            lastSpeedUpdateRef.current = now;
                        }
                    }
                }
            );
        } catch (e: any) {
            if(e.message !== "Render Cancelled") {
                const message = e?.message || "Unknown rendering error.";
                console.error("Render failed:", e);
                setRenderError(message);
                alert(`Render Failed: ${message}`);
            }
        } finally {
            setIsRendering(false);
            setRenderProgress(0);
            smoothLineIdxRef.current = originalSmoothRef;
            requestRef.current = requestAnimationFrame(animate);
        }
    };

    const longLineIssues = detectLongLyricLines(lines);
    const lrcParseResult = parseLrc(lrcDraft);
    const longLrcGapIssues = detectLongLrcGaps(lrcDraft);

    return {
        state: {
            selectedClipId, manualId, aspectRatio, showBackgroundLayer, mainVisualizerEnabled, visualMode: currentVisualMode, customBg, customAudio,
            templatePreset, logoAsset, logoPosition, logoScale, logoOpacity, logoPulseEnabled, logoPulseStyle, logoPulseGap, logoPulseScale, logoPulseSensitivity, showTitle,
            audioBitrate, videoBitrate, videoBitrateMode, fps, outputAspectTarget, preRollEnabled, preRollType, preRollText, preRollSeconds, preRollPreviewEnabled, preRollPreviewStartSeconds, preRollPreviewDurationSeconds, preRollPreviewShowTitle, preRollShowHeading, preRollHeadingText, preRollCardShowTitle, preRollCardTitleText, preRollCardTheme, postRollEnabled, postRollType, postRollText, postRollSeconds, postRollShowHeading, postRollHeadingText, imgSrc, activeColor, inactiveColor, inactiveOpacity, fontFamily,
            smoothingFactor, verticalOffset, qt6Style, qt6BarCount, qt6Sensitivity, qt6SpectrogramSpeed, qt6ParticleDensity, qt6RingCount, qt6LedSegments, qt6SpectrogramPalette,
            clipData, alignment, lines, lyricSource, lrcDraft, applyStatus, lrcApplyStatus, savedPresets,
            longLineIssues, longLrcGapIssues, lrcInvalidLineNumbers: lrcParseResult.invalidLineNumbers, lrcParsedLineCount: lrcParseResult.entries.length,
            isRendering, renderProgress, renderError, renderSpeed, isPreparing, isGrouping, progress, duration: totalPreviewDuration, isPlaying, hasDefaultLogo,
            colorEvents
        },
        setters: {
            setSelectedClipId, setManualId, setAspectRatio, setShowBackgroundLayer, setMainVisualizerEnabled, setCustomBg, setCustomAudio,
            setTemplatePreset, setLogoAsset, setLogoPosition, setLogoScale, setLogoOpacity, setLogoPulseEnabled, setLogoPulseStyle, setLogoPulseGap, setLogoPulseScale, setLogoPulseSensitivity, setShowTitle,
            setAudioBitrate, setVideoBitrate, setVideoBitrateMode, setFps, setOutputAspectTarget, setPreRollEnabled, setPreRollType, setPreRollText, setPreRollSeconds, setPreRollPreviewEnabled, setPreRollPreviewStartSeconds, setPreRollPreviewDurationSeconds, setPreRollPreviewShowTitle, setPreRollShowHeading, setPreRollHeadingText, setPreRollCardShowTitle, setPreRollCardTitleText, setPreRollCardTheme, setPostRollEnabled, setPostRollType, setPostRollText, setPostRollSeconds, setPostRollShowHeading, setPostRollHeadingText, setImgSrc, setActiveColor, setInactiveColor, setInactiveOpacity, setFontFamily,
            setSmoothingFactor, setVerticalOffset, setQt6Style, setQt6BarCount, setQt6Sensitivity, setQt6SpectrogramSpeed, setQt6ParticleDensity, setQt6RingCount, setQt6LedSegments, setQt6SpectrogramPalette,
            setLyricSource, setLrcDraft, setIsPlaying
        },
        refs: {
            canvasRef, audioRef, customVideoRef
        },
        handlers: {
            handleManualLoad, handleFileUpload, handleAudioUpload, handleLogoUpload, handleSetLogoAsDefault, handleClearDefaultLogo, handleApplyLyrics, handleApplyLrc, handleGenerateLrcFromCurrentLines, applyTemplatePreset, applyQt6LookPreset, randomizeQt6Look,
            handleReplaceAlignment, handleSmartGroup, handleSeek, togglePlay, startOfflineRender, handleImageError, setDuration: setAudioDuration,
            saveCurrentPreset, applySavedPreset, deleteSavedPreset,
            addColorEvent, removeColorEvent, updateColorEvent
        }
    };
};
