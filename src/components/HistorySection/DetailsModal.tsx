import React, { useState, useEffect } from 'react';
import { SunoClip } from '../../types';
import CopyButton from '../CopyButton';
import { getLyricAlignment } from '../../services/sunoApi';
import { matchWordsToPrompt, stripMetaTags, generateLrc, generateSrt } from '../../utils/lyrics';
import { addSongToAlbum, createAlbum, getSongMeta, listAlbums, removeSongFromAlbum, setSongTags } from '../../services/libraryService';
import { audioExtensionForContentType, authorizeSunoDownload, formatVarietyName, getSunoDownloadQuota, resolveSunoAudioUrl, SunoDownloadError, SunoDownloadFormat, SunoDownloadQuota } from '../../services/sunoApi';

interface DetailsModalProps {
  clip: SunoClip;
  onClose: () => void;
  onUpdateClip: (id: string, updates: Partial<SunoClip>) => void;
  sunoCookie?: string;
  isDraft: boolean;
}

const DetailsModal: React.FC<DetailsModalProps> = ({ clip, onClose, onUpdateClip, sunoCookie, isDraft }) => {
  const [manualIdInput, setManualIdInput] = useState('');
  const [editedLyrics, setEditedLyrics] = useState('');
  
  // Loading States
  const [loadingAlignment, setLoadingAlignment] = useState(false);
  const [alignmentError, setAlignmentError] = useState<string | null>(null);
  const [libraryLoading, setLibraryLoading] = useState(false);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [libraryAlbums, setLibraryAlbums] = useState<Array<{ id: number; name: string }>>([]);
  const [songAlbumIds, setSongAlbumIds] = useState<number[]>([]);
  const [tagsInput, setTagsInput] = useState('');
  const [selectedAlbumId, setSelectedAlbumId] = useState<number | ''>('');
  const [newAlbumName, setNewAlbumName] = useState('');
  const [savingLibrary, setSavingLibrary] = useState(false);

  useEffect(() => {
      const orig = clip.originalData;
      const text = orig?.lyricsAlone || orig?.lyricsWithTags || clip.metadata?.prompt || "";
      setEditedLyrics(text);
  }, [clip.id]);

  useEffect(() => {
    let cancelled = false;
    const loadLibraryData = async () => {
      if (isDraft) return;
      setLibraryLoading(true);
      setLibraryError(null);
      try {
        const [albums, songMeta] = await Promise.all([listAlbums(), getSongMeta(clip.id)]);
        if (cancelled) return;
        setLibraryAlbums(albums.map((a) => ({ id: a.id, name: a.name })));
        setSongAlbumIds((songMeta.albums || []).map((a) => a.id));
        setTagsInput((songMeta.tags || []).join(', '));
      } catch (error: any) {
        if (!cancelled) {
          setLibraryError(error?.message || 'Failed to load library metadata');
        }
      } finally {
        if (!cancelled) {
          setLibraryLoading(false);
        }
      }
    };

    loadLibraryData();
    return () => {
      cancelled = true;
    };
  }, [clip.id, isDraft]);

  const parseTags = (raw: string): string[] =>
    Array.from(
      new Set(
        raw
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
      )
    );

  const handleSaveTags = async () => {
    if (isDraft) return;
    setSavingLibrary(true);
    setLibraryError(null);
    try {
      await setSongTags(clip.id, parseTags(tagsInput));
    } catch (error: any) {
      setLibraryError(error?.message || 'Failed to save tags');
    } finally {
      setSavingLibrary(false);
    }
  };

  const handleAddCurrentSongToAlbum = async () => {
    if (isDraft || selectedAlbumId === '') return;
    setSavingLibrary(true);
    setLibraryError(null);
    try {
      await addSongToAlbum(Number(selectedAlbumId), clip.id, clip.title || clip.originalData?.title || 'Untitled');
      if (!songAlbumIds.includes(Number(selectedAlbumId))) {
        setSongAlbumIds((prev) => [...prev, Number(selectedAlbumId)]);
      }
    } catch (error: any) {
      setLibraryError(error?.message || 'Failed to add song to album');
    } finally {
      setSavingLibrary(false);
    }
  };

  const handleRemoveCurrentSongFromAlbum = async (albumId: number) => {
    if (isDraft) return;
    setSavingLibrary(true);
    setLibraryError(null);
    try {
      await removeSongFromAlbum(albumId, clip.id);
      setSongAlbumIds((prev) => prev.filter((id) => id !== albumId));
    } catch (error: any) {
      setLibraryError(error?.message || 'Failed to remove song from album');
    } finally {
      setSavingLibrary(false);
    }
  };

  const handleCreateAlbumAndAddSong = async () => {
    const name = newAlbumName.trim();
    if (!name || isDraft) return;
    setSavingLibrary(true);
    setLibraryError(null);
    try {
      await createAlbum(name);
      const albums = await listAlbums();
      const mapped = albums.map((a) => ({ id: a.id, name: a.name }));
      setLibraryAlbums(mapped);
      const created = mapped.find((a) => a.name === name);
      if (created) {
        await addSongToAlbum(created.id, clip.id, clip.title || clip.originalData?.title || 'Untitled');
        if (!songAlbumIds.includes(created.id)) {
          setSongAlbumIds((prev) => [...prev, created.id]);
        }
        setSelectedAlbumId(created.id);
      }
      setNewAlbumName('');
    } catch (error: any) {
      setLibraryError(error?.message || 'Failed to create album');
    } finally {
      setSavingLibrary(false);
    }
  };

  const handleLinkSunoId = () => {
    if (!manualIdInput.trim()) return;
    const newId = manualIdInput.trim();
    
    onUpdateClip(clip.id, { 
        id: newId, 
        model_name: clip.model_name.includes('Draft') ? 'Linked via ID' : clip.model_name
    });
    setManualIdInput('');
    onClose(); 
  };

  const handleSaveLyrics = () => {
      const clean = stripMetaTags(editedLyrics);
      const baseOriginal = clip.originalData || {
         style: '', title: '', excludeStyles: '', advancedParams: '', vocalGender: '', weirdness: 0, styleInfluence: 0, lyricsWithTags: '', lyricsAlone: '', fullResponse: ''
      };
      const updates: Partial<SunoClip> = {
          originalData: { ...baseOriginal, lyricsAlone: clean }
      };
      onUpdateClip(clip.id, updates);
  };

  const handleGetAlignment = async () => {
      if (!sunoCookie || isDraft) return;
      setLoadingAlignment(true);
      setAlignmentError(null);
      try {
          const result = await getLyricAlignment(clip.id, sunoCookie);
          if (result && result.aligned_words) {
              const newData = result.aligned_words;
              
              // Automatically generate LRC and SRT if we have lyrics available
              let lrc = undefined;
              let srt = undefined;
              
              if (editedLyrics) {
                  const lines = matchWordsToPrompt(newData, editedLyrics);
                  if (lines && lines.length > 0) {
                      lrc = generateLrc(lines);
                      srt = generateSrt(lines);
                  }
              }

              onUpdateClip(clip.id, { 
                  alignmentData: newData,
                  lrcContent: lrc,
                  srtContent: srt
              });
          } else {
              setAlignmentError("No alignment data found.");
          }
      } catch (e: any) {
          setAlignmentError(e.message || "Failed to fetch alignment.");
      } finally {
          setLoadingAlignment(false);
      }
  };

  const handleDownloadTextFile = (content: string, filename: string) => {
    const blob = new Blob([content], { type: 'text/plain' });
    const blobUrl = window.URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = blobUrl;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    window.URL.revokeObjectURL(blobUrl);
  };

  const handleGenerateLRC = () => {
      if (!clip.alignmentData) return;
      const lines = matchWordsToPrompt(clip.alignmentData, editedLyrics);
      if (!lines || lines.length === 0) return;

      const lrcContent = generateLrc(lines);

      const clean = stripMetaTags(editedLyrics);
      const baseOriginal = clip.originalData || {
            style: '', title: '', excludeStyles: '', advancedParams: '', vocalGender: '', weirdness: 0, styleInfluence: 0, lyricsWithTags: '', lyricsAlone: '', fullResponse: ''
      };
      
      onUpdateClip(clip.id, { 
          lrcContent, 
          originalData: { ...baseOriginal, lyricsAlone: clean } 
      });
  };

  const handleGenerateSRT = () => {
      if (!clip.alignmentData) return;
      const lines = matchWordsToPrompt(clip.alignmentData, editedLyrics);
      if (!lines || lines.length === 0) return;

      const srtContent = generateSrt(lines);
      
      const clean = stripMetaTags(editedLyrics);
      const baseOriginal = clip.originalData || {
            style: '', title: '', excludeStyles: '', advancedParams: '', vocalGender: '', weirdness: 0, styleInfluence: 0, lyricsWithTags: '', lyricsAlone: '', fullResponse: ''
      };
      
      onUpdateClip(clip.id, { 
          srtContent, 
          originalData: { ...baseOriginal, lyricsAlone: clean } 
      });
  };

  const formatDisplayTime = (seconds: number) => {
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      const ms = Math.floor((seconds % 1) * 100);
      return `${mins}:${secs.toString().padStart(2, '0')}.${ms.toString().padStart(2, '0')}`;
  };

  const formatDuration = (seconds?: number) => {
      if (typeof seconds !== 'number') return 'N/A';
      const mins = Math.floor(seconds / 60);
      const secs = Math.floor(seconds % 60);
      return `${mins}:${secs.toString().padStart(2, '0')}`;
  };

  const clipData = {
      title: clip.title || clip.originalData?.title || 'Untitled',
      style: clip.metadata?.tags || clip.originalData?.style || '',
      excludeStyles: clip.metadata?.negative_tags || clip.originalData?.excludeStyles || '',
      advancedParams: clip.originalData?.advancedParams || '',
      prompt: clip.metadata?.prompt || clip.originalData?.lyricsWithTags || '',
      weirdness: clip.originalData?.weirdness ?? 50,
      styleInfluence: clip.originalData?.styleInfluence ?? 50,
      
      // New fields
      maxBpm: clip.metadata?.max_bpm,
      minBpm: clip.metadata?.min_bpm,
      avgBpm: clip.metadata?.avg_bpm,
      key: clip.metadata?.key,
      explicit: clip.explicit,
      duration: clip.metadata?.duration,

      // Generation parameters (from the feed; absent on older/draft clips)
      isMaxMode: clip.metadata?.is_max_mode,
      variety: clip.metadata?.variety,
      audioInfluence: typeof clip.metadata?.audio_weight === 'number' ? Math.round(clip.metadata.audio_weight * 100) : undefined,
      instrumental: clip.metadata?.make_instrumental,
      voxRenderMode: clip.metadata?.vox_render_mode,
      task: clip.metadata?.task,
      coverClipId: clip.metadata?.cover_clip_id,
      isRemix: clip.metadata?.is_remix,
      modelVersion: clip.majorModelVersion,
  };

  const [downloadFormat, setDownloadFormat] = useState<SunoDownloadFormat>('mp3');
  const [isDownloadingAudio, setIsDownloadingAudio] = useState(false);
  const [audioDownloadError, setAudioDownloadError] = useState<string | null>(null);
  const [unlockPrompt, setUnlockPrompt] = useState<{ quota?: SunoDownloadQuota } | null>(null);
  const [isUnlocking, setIsUnlocking] = useState(false);

  const saveBlob = (blob: Blob, ext: string) => {
      const blobUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = blobUrl;
      link.download = `${(clip.title || 'song').replace(/[\\/:*?"<>|]+/g, '_')}.${ext}`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(blobUrl);
  };

  /** Resolves a presigned link (songs must be unlocked on the account) and saves the file. */
  const downloadResolved = async (format: SunoDownloadFormat) => {
      let url = format === 'mp3' ? clip.audioUrl : undefined; // rare direct mp3 media URL
      let ext: string = format;
      if (!url) {
          if (!sunoCookie) throw new Error('Connect your Suno account in Settings to download audio.');
          url = (await resolveSunoAudioUrl(clip.id, sunoCookie, format)).url;
      } else {
          ext = audioExtensionForContentType(clip.audioContentType);
      }
      const response = await fetch(url);
      if (!response.ok) throw new Error(`Audio request failed (${response.status})`);
      saveBlob(await response.blob(), ext);
  };

  const handleDownloadAudio = async (format: SunoDownloadFormat = downloadFormat) => {
      setAudioDownloadError(null);
      setUnlockPrompt(null);
      setIsDownloadingAudio(true);
      try {
          await downloadResolved(format);
      } catch (err: any) {
          console.warn('Audio download failed', err);
          if (err instanceof SunoDownloadError && err.needsUnlock && sunoCookie) {
              // Ask before spending a monthly download; show how many are left.
              const quota = await getSunoDownloadQuota(sunoCookie).catch(() => undefined);
              setUnlockPrompt({ quota });
          } else if (err instanceof SunoDownloadError) {
              setAudioDownloadError(err.message);
          } else {
              setAudioDownloadError(`Download failed: ${err?.message || 'unknown error'}`);
          }
      } finally {
          setIsDownloadingAudio(false);
      }
  };

  const handleUnlockAndDownload = async () => {
      if (!sunoCookie) return;
      setIsUnlocking(true);
      setAudioDownloadError(null);
      try {
          await authorizeSunoDownload(clip.id, sunoCookie);
          setUnlockPrompt(null);
          await downloadResolved(downloadFormat);
      } catch (err: any) {
          console.warn('Unlock failed', err);
          setAudioDownloadError(err instanceof SunoDownloadError ? err.message : `Unlock failed: ${err?.message || 'unknown error'}`);
      } finally {
          setIsUnlocking(false);
      }
  };

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200" onClick={onClose}>
        <div 
            className="bg-slate-900 border border-[var(--app-panel-border)] rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh] overflow-hidden" 
            onClick={(e) => e.stopPropagation()}
        >
            {/* Modal Header */}
            <div className="p-4 border-b border-[var(--app-panel-border)] flex justify-between items-start bg-[var(--app-panel)]">
                <div>
                    <h2 className="text-xl font-bold text-white leading-tight pr-4 flex items-center gap-2">
                        {clipData.title}
                        {clipData.explicit && (
                            <div className="group relative">
                                <svg className="w-5 h-5 text-red-500 fill-current" viewBox="0 0 24 24">
                                    <title>Explicit Content</title>
                                    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-4 6h-4v2h4v2h-4v2h4v2H9V7h6v2z" />
                                </svg>
                                <span className="absolute left-full ml-2 top-0 px-2 py-1 bg-[var(--app-panel)] text-xs text-red-400 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap border border-[var(--app-panel-border)] pointer-events-none">
                                    Explicit
                                </span>
                            </div>
                        )}
                    </h2>
                    <div className="flex items-center gap-2 mt-1 text-xs text-slate-400">
                            <span className="font-mono bg-[var(--app-panel)] px-1.5 py-0.5 rounded border border-[var(--app-panel-border)]">{clip.model_name}</span>
                            <span>•</span>
                            <span>{new Date(clip.created_at).toLocaleString()}</span>
                            {isDraft && (
                                <span className="bg-yellow-900/50 text-yellow-500 px-1.5 py-0.5 rounded border border-yellow-900">Draft</span>
                            )}
                    </div>
                </div>
                <button onClick={onClose} className="text-slate-400 hover:text-white bg-[var(--app-panel)] p-1.5 rounded-lg hover:bg-[var(--app-tab-hover)] transition-colors">
                    <svg xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24" strokeWidth={2} stroke="currentColor" className="w-5 h-5">
                        <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            </div>

            {/* Modal Content */}
            <div className="p-6 overflow-y-auto custom-scrollbar space-y-6 bg-slate-950/30">
                
                {/* Top Grid: Style & Details */}
                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    {/* Style Tags */}
                    {clipData.style && (
                        <div className="space-y-2">
                                <div className="flex justify-between items-center">
                                <h3 className="text-xs font-bold text-[var(--app-accent)] uppercase tracking-wider">Style Tags</h3>
                                <CopyButton text={clipData.style} label="Copy" />
                                </div>
                                <div className="p-3 bg-[var(--app-panel)] border border-[var(--app-panel-border)]/50 rounded-lg">
                                <p className="text-sm text-slate-200 font-mono break-words">{clipData.style}</p>
                                </div>
                        </div>
                    )}

                    {/* Negative Tags */}
                    {clipData.excludeStyles && (
                        <div className="space-y-2">
                            <h3 className="text-xs font-bold text-red-400 uppercase tracking-wider">Negative Tags</h3>
                            <div className="p-3 bg-[var(--app-panel)] border border-[var(--app-panel-border)]/50 rounded-lg h-full">
                                <p className="text-sm text-red-200 font-mono break-words">{clipData.excludeStyles}</p>
                            </div>
                        </div>
                    )}
                </div>

                {/* Song Stats & Parameters */}
                <div className="bg-[var(--app-panel)] border border-[var(--app-panel-border)] rounded-lg p-4 grid grid-cols-2 sm:grid-cols-4 gap-4">
                    <div>
                        <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Key</span>
                        <span className="text-sm font-mono text-white">{clipData.key ? clipData.key.replace('_', ' ') : 'N/A'}</span>
                    </div>
                    <div>
                        <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">BPM (Avg)</span>
                        <span className="text-sm font-mono text-white">{clipData.avgBpm ? clipData.avgBpm.toFixed(1) : 'N/A'}</span>
                    </div>
                    <div>
                        <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Duration</span>
                        <span className="text-sm font-mono text-white">{formatDuration(clipData.duration)}</span>
                    </div>
                    <div>
                        <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Explicit</span>
                        <span className={`text-sm font-mono ${clipData.explicit ? 'text-red-400' : 'text-slate-400'}`}>
                            {clipData.explicit ? 'Yes' : 'No'}
                        </span>
                    </div>
                    
                    {/* Control Sliders */}
                    <div className="col-span-2 sm:col-span-2 pt-2 border-t border-[var(--app-panel-border)] mt-2">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] text-[var(--app-accent)] font-bold uppercase">Weirdness</span>
                            <span className="text-[10px] text-[var(--app-accent)] font-mono">{clipData.weirdness}%</span>
                        </div>
                        <div className="w-full bg-[var(--app-panel)] rounded-full h-1.5 overflow-hidden">
                            <div className="bg-gradient-to-r from-purple-900 to-purple-500 h-1.5 rounded-full" style={{ width: `${clipData.weirdness}%` }}></div>
                        </div>
                    </div>
                    <div className="col-span-2 sm:col-span-2 pt-2 border-t border-[var(--app-panel-border)] mt-2">
                        <div className="flex justify-between items-center mb-1">
                            <span className="text-[10px] text-[var(--app-accent)] font-bold uppercase">Style Influence</span>
                            <span className="text-[10px] text-[var(--app-accent)] font-mono">{clipData.styleInfluence}%</span>
                        </div>
                        <div className="w-full bg-[var(--app-panel)] rounded-full h-1.5 overflow-hidden">
                            <div className="bg-gradient-to-r from-blue-900 to-blue-500 h-1.5 rounded-full" style={{ width: `${clipData.styleInfluence}%` }}></div>
                        </div>
                    </div>
                </div>

                {/* Generation parameters */}
                {(clipData.isMaxMode !== undefined || clipData.variety !== undefined || clipData.instrumental !== undefined || clipData.modelVersion || clipData.task) && (
                    <div className="bg-[var(--app-panel)] border border-[var(--app-panel-border)] rounded-lg p-4 grid grid-cols-2 sm:grid-cols-4 gap-4" data-testid="generation-params">
                        <div>
                            <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Model</span>
                            <span className="text-sm font-mono text-white">{clipData.modelVersion ? clipData.modelVersion.toUpperCase() : clip.model_name}</span>
                        </div>
                        <div>
                            <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Max Mode</span>
                            <span className={`text-sm font-mono ${clipData.isMaxMode ? 'text-pink-300' : 'text-slate-400'}`}>
                                {clipData.isMaxMode === undefined ? 'N/A' : clipData.isMaxMode ? 'On' : 'Off'}
                            </span>
                        </div>
                        <div>
                            <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Variety</span>
                            <span className="text-sm font-mono text-white">{clipData.variety === undefined ? 'N/A' : formatVarietyName(clipData.variety)}</span>
                        </div>
                        <div>
                            <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Vocals</span>
                            <span className="text-sm font-mono text-white">
                                {clipData.instrumental ? 'Instrumental' : clipData.voxRenderMode ? `Vocal (${clipData.voxRenderMode})` : clipData.instrumental === false ? 'Vocal' : 'N/A'}
                            </span>
                        </div>
                        {clipData.audioInfluence !== undefined && (
                            <div>
                                <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Audio Influence</span>
                                <span className="text-sm font-mono text-white">{clipData.audioInfluence}%</span>
                            </div>
                        )}
                        {(clipData.task || clipData.isRemix) && (
                            <div className="col-span-2">
                                <span className="text-[10px] text-slate-500 font-bold uppercase block mb-1">Type</span>
                                <span className="text-sm font-mono text-white break-all">
                                    {clipData.task === 'cover' ? 'Cover' : clipData.isRemix ? 'Remix' : clipData.task}
                                    {clipData.coverClipId && (
                                        <>
                                            {' of '}
                                            <a href={`https://suno.com/song/${clipData.coverClipId}`} target="_blank" rel="noopener noreferrer" className="text-[var(--app-accent)] hover:underline">
                                                {clipData.coverClipId.slice(0, 8)}…
                                            </a>
                                        </>
                                    )}
                                </span>
                            </div>
                        )}
                    </div>
                )}

                {/* Additional BPM Stats if available */}
                {(clipData.maxBpm || clipData.minBpm) && (
                    <div className="flex gap-4 text-xs text-slate-500 font-mono bg-slate-900/30 p-2 rounded border border-[var(--app-panel-border)]/50">
                        {clipData.maxBpm && <span>Max BPM: <span className="text-slate-300">{clipData.maxBpm.toFixed(1)}</span></span>}
                        {clipData.minBpm && <span>Min BPM: <span className="text-slate-300">{clipData.minBpm.toFixed(1)}</span></span>}
                    </div>
                )}

                {/* Lyrics Alignment Section */}
                {!isDraft && (
                    <div className="space-y-3 pt-2 border-t border-[var(--app-panel-border)]">
                            <div className="flex justify-between items-center flex-wrap gap-2">
                            <h3 className="text-xs font-bold text-cyan-400 uppercase tracking-wider">Timing & Lyrics</h3>
                            <div className="flex flex-wrap items-center gap-2">
                                    {clip.alignmentData && (
                                        <CopyButton text={JSON.stringify(clip.alignmentData, null, 2)} label="JSON" />
                                    )}

                                    {!clip.alignmentData ? (
                                    sunoCookie ? (
                                        <button
                                            onClick={handleGetAlignment}
                                            disabled={loadingAlignment}
                                            className="px-3 py-1 bg-cyan-900/50 hover:bg-cyan-800 text-cyan-200 text-xs font-medium rounded-lg transition-colors border border-cyan-700/50 flex items-center gap-2"
                                        >
                                            {loadingAlignment ? (
                                                <span className="animate-spin h-3 w-3 border-2 border-cyan-400 rounded-full border-t-transparent"></span>
                                            ) : (
                                                <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                                                    <circle cx="12" cy="12" r="10" />
                                                    <polyline points="12 6 12 12 16 14" />
                                                </svg>
                                            )}
                                            {loadingAlignment ? 'Fetching...' : 'Get Alignment'}
                                        </button>
                                    ) : (
                                        <span className="text-[10px] text-slate-500 italic">Login to fetch timing</span>
                                    )
                                    ) : (
                                        <div className="flex gap-2">
                                            {!clip.lrcContent ? (
                                            <button
                                                onClick={handleGenerateLRC}
                                                className="px-3 py-1 bg-[var(--app-accent)] hover:bg-[var(--app-accent)] text-white text-xs font-medium rounded-lg transition-colors shadow-sm"
                                            >
                                                Gen LRC
                                            </button>
                                            ) : (
                                            <div className="flex gap-1">
                                                <CopyButton text={clip.lrcContent} label="LRC" />
                                                <button
                                                    onClick={() => handleDownloadTextFile(clip.lrcContent!, `${clip.title || 'song'}.lrc`)}
                                                    className="px-2 py-1 bg-purple-700/50 hover:bg-[var(--app-accent)] text-purple-100 text-xs font-medium rounded-lg border border-purple-600/50"
                                                    title="Download LRC"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                        <polyline points="7 10 12 15 17 10" />
                                                        <line x1="12" y1="15" x2="12" y2="3" />
                                                    </svg>
                                                </button>
                                                <button
                                                    onClick={handleGenerateLRC}
                                                    className="px-2 py-1 bg-purple-800 hover:bg-[var(--app-accent)]/80 text-purple-200 text-xs font-medium rounded-lg border border-purple-600/30"
                                                    title="Redo LRC with current lyrics"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                                                        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                                                        <path d="M3 3v5h5" />
                                                        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                                                        <path d="M16 16h5v5" />
                                                    </svg>
                                                </button>
                                            </div>
                                            )}

                                            {!clip.srtContent ? (
                                            <button
                                                onClick={handleGenerateSRT}
                                                className="px-3 py-1 bg-[var(--app-accent)] hover:bg-[var(--app-accent)] text-white text-xs font-medium rounded-lg transition-colors shadow-sm"
                                            >
                                                Gen SRT
                                            </button>
                                            ) : (
                                            <div className="flex gap-1">
                                                <CopyButton text={clip.srtContent} label="SRT" />
                                                <button
                                                    onClick={() => handleDownloadTextFile(clip.srtContent!, `${clip.title || 'song'}.srt`)}
                                                    className="px-2 py-1 bg-blue-700/50 hover:bg-[var(--app-accent)] text-blue-100 text-xs font-medium rounded-lg border border-blue-600/50"
                                                    title="Download SRT"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                                                        <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                                        <polyline points="7 10 12 15 17 10" />
                                                        <line x1="12" y1="15" x2="12" y2="3" />
                                                    </svg>
                                                </button>
                                                <button
                                                    onClick={handleGenerateSRT}
                                                    className="px-2 py-1 bg-blue-800 hover:bg-[var(--app-accent)]/80 text-blue-200 text-xs font-medium rounded-lg border border-blue-600/30"
                                                    title="Redo SRT with current lyrics"
                                                >
                                                    <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-3 h-3">
                                                        <path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
                                                        <path d="M3 3v5h5" />
                                                        <path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16" />
                                                        <path d="M16 16h5v5" />
                                                    </svg>
                                                </button>
                                            </div>
                                            )}
                                        </div>
                                    )}
                            </div>
                            </div>

                            {alignmentError && (
                                <div className="text-xs text-red-400 bg-red-900/20 p-2 rounded border border-red-900/30">
                                    {alignmentError}
                                </div>
                            )}

                            {clip.alignmentData && (
                                <div className="bg-slate-950 border border-[var(--app-panel-border)] rounded-lg overflow-hidden flex flex-col h-[300px]">
                                    <div className="bg-[var(--app-panel)] px-4 py-2 flex justify-between text-xs font-semibold text-slate-400 border-b border-[var(--app-panel-border)]">
                                        <span>Timestamp</span>
                                        <span>Word</span>
                                    </div>
                                    <div className="overflow-y-auto custom-scrollbar p-2 space-y-1">
                                        {clip.alignmentData.map((item, idx) => (
                                            <div key={idx} className="flex hover:bg-[var(--app-panel)] rounded px-2 py-1 transition-colors group">
                                                <span className="text-xs font-mono text-cyan-500 w-24 shrink-0 group-hover:text-cyan-400">
                                                    {formatDisplayTime(item.start_s)}
                                                </span>
                                                <span className="text-sm text-slate-300 font-medium group-hover:text-white">
                                                    {item.word.replace(/\n/g, ' ')}
                                                </span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                    </div>
                )}

                {/* Key Prompt (Lyrics with Tags) */}
                {clipData.prompt && (
                        <div className="space-y-2 pt-2 border-t border-[var(--app-panel-border)]">
                            <div className="flex justify-between items-center">
                            <h3 className="text-xs font-bold text-pink-400 uppercase tracking-wider">Key Prompt (Lyrics with Tags)</h3>
                            <CopyButton text={clipData.prompt} label="Copy" />
                            </div>
                            <div className="p-4 bg-slate-900 border border-[var(--app-panel-border)] rounded-lg max-h-[300px] overflow-y-auto custom-scrollbar">
                            <pre className="text-sm text-slate-300 font-mono whitespace-pre-wrap leading-relaxed">{clipData.prompt}</pre>
                            </div>
                    </div>
                )}

                    {/* Clean Lyrics (Editable) */}
                    <div className="space-y-2">
                        <div className="flex justify-between items-center">
                        <h3 className="text-xs font-bold text-[var(--app-accent)] uppercase tracking-wider">
                            Clean Lyrics (Editable)
                        </h3>
                        <div className="flex gap-2">
                            <button 
                                onClick={handleSaveLyrics}
                                className="text-xs text-[var(--app-accent)] hover:text-emerald-300 px-2 py-1 hover:bg-emerald-900/30 rounded transition-colors border border-transparent hover:border-emerald-800"
                            >
                                Save Edits
                            </button>
                            <CopyButton text={editedLyrics} label="Copy" />
                        </div>
                        </div>
                        <div className="bg-slate-900 border border-[var(--app-panel-border)] rounded-lg overflow-hidden">
                        <textarea 
                            value={editedLyrics}
                            onChange={(e) => setEditedLyrics(e.target.value)}
                            className="w-full h-[200px] bg-slate-900 p-4 text-sm text-slate-400 font-mono resize-none focus:outline-none focus:bg-[var(--app-panel)] transition-colors custom-scrollbar leading-relaxed"
                            placeholder="Edit lyrics structure here to improve synchronization..."
                        />
                        </div>
                </div>

                {/* ID Linking Section */}
                <div className="pt-4 border-t border-[var(--app-panel-border)]">
                    <label className="text-xs font-bold text-slate-500 uppercase tracking-wider mb-2 block">
                        Link Suno Generation
                    </label>
                    <div className="flex gap-2">
                        <input 
                            type="text"
                            value={manualIdInput}
                            onChange={(e) => setManualIdInput(e.target.value)}
                            placeholder="Paste Suno Clip ID (UUID) here..."
                            className="flex-1 bg-slate-950 border border-[var(--app-panel-border)] rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-[var(--app-accent)]/50 outline-none"
                        />
                        <button 
                            onClick={handleLinkSunoId}
                            disabled={!manualIdInput.trim()}
                            className="px-4 py-2 bg-[var(--app-panel)] hover:bg-[var(--app-tab-hover)] disabled:opacity-50 text-white text-sm font-medium rounded-lg transition-colors whitespace-nowrap"
                        >
                            Link ID
                        </button>
                    </div>
                    <p className="text-[10px] text-slate-500 mt-1">
                        If you generated this song on Suno, paste the UUID from the URL to see the cover art and link.
                    </p>
                </div>

                {!isDraft && (
                  <div className="pt-4 border-t border-[var(--app-panel-border)] space-y-3">
                    <h3 className="text-xs font-bold text-amber-400 uppercase tracking-wider">Album Builder</h3>
                    {libraryLoading ? (
                      <p className="text-xs text-slate-500">Loading album metadata...</p>
                    ) : (
                      <>
                        <div className="space-y-2">
                          <label className="text-[11px] text-slate-400 font-semibold">Song Tags (comma-separated)</label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={tagsInput}
                              onChange={(e) => setTagsInput(e.target.value)}
                              placeholder="anthemic, dark-pop, synthwave"
                              className="flex-1 bg-slate-950 border border-[var(--app-panel-border)] rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-amber-500 outline-none"
                            />
                            <button
                              onClick={handleSaveTags}
                              disabled={savingLibrary}
                              className="px-3 py-2 bg-amber-600 hover:bg-amber-500 text-white text-xs font-bold rounded-lg disabled:opacity-60"
                            >
                              Save Tags
                            </button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-[11px] text-slate-400 font-semibold">Add Song To Existing Album</label>
                          <div className="flex gap-2">
                            <select
                              value={selectedAlbumId}
                              onChange={(e) => setSelectedAlbumId(e.target.value ? Number(e.target.value) : '')}
                              className="flex-1 bg-slate-950 border border-[var(--app-panel-border)] rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-amber-500 outline-none"
                            >
                              <option value="">Select album</option>
                              {libraryAlbums.map((album) => (
                                <option key={album.id} value={album.id}>
                                  {album.name}
                                </option>
                              ))}
                            </select>
                            <button
                              onClick={handleAddCurrentSongToAlbum}
                              disabled={savingLibrary || selectedAlbumId === ''}
                              className="px-3 py-2 bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold rounded-lg disabled:opacity-60"
                            >
                              Add
                            </button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-[11px] text-slate-400 font-semibold">Create New Album And Add Song</label>
                          <div className="flex gap-2">
                            <input
                              type="text"
                              value={newAlbumName}
                              onChange={(e) => setNewAlbumName(e.target.value)}
                              placeholder="Neon Tides Act II"
                              className="flex-1 bg-slate-950 border border-[var(--app-panel-border)] rounded-lg px-3 py-2 text-sm text-white focus:ring-1 focus:ring-amber-500 outline-none"
                            />
                            <button
                              onClick={handleCreateAlbumAndAddSong}
                              disabled={savingLibrary || !newAlbumName.trim()}
                              className="px-3 py-2 bg-[var(--app-accent)] hover:bg-[var(--app-accent)] text-white text-xs font-bold rounded-lg disabled:opacity-60"
                            >
                              Create + Add
                            </button>
                          </div>
                        </div>

                        <div className="space-y-2">
                          <label className="text-[11px] text-slate-400 font-semibold">Current Album Membership</label>
                          {songAlbumIds.length === 0 ? (
                            <p className="text-xs text-slate-500">Not assigned to any album yet.</p>
                          ) : (
                            <div className="flex flex-wrap gap-2">
                              {songAlbumIds.map((albumId) => {
                                const album = libraryAlbums.find((a) => a.id === albumId);
                                if (!album) return null;
                                return (
                                  <button
                                    key={albumId}
                                    onClick={() => handleRemoveCurrentSongFromAlbum(albumId)}
                                    disabled={savingLibrary}
                                    className="text-xs px-2 py-1 rounded-md bg-[var(--app-panel)] border border-[var(--app-panel-border)] text-slate-200 hover:bg-red-900/30 hover:border-red-800 hover:text-red-300 disabled:opacity-60"
                                    title="Click to remove from album"
                                  >
                                    {album.name} x
                                  </button>
                                );
                              })}
                            </div>
                          )}
                        </div>
                      </>
                    )}
                    {libraryError && (
                      <p className="text-xs text-red-400 bg-red-900/20 border border-red-900/30 rounded p-2">{libraryError}</p>
                    )}
                  </div>
                )}

            </div>

            {/* Modal Footer */}
            <div className="p-4 border-t border-[var(--app-panel-border)] bg-[var(--app-panel)] flex justify-end gap-3">
                    {!isDraft && (
                        <>
                            {audioDownloadError && (
                                <span className="text-xs text-red-400 self-center mr-auto" role="alert">{audioDownloadError}</span>
                            )}
                            {unlockPrompt && (
                                <div className="mr-auto flex items-center gap-3 text-xs text-amber-200 bg-amber-500/10 border border-amber-500/30 rounded-lg px-3 py-2" role="alertdialog" data-testid="unlock-prompt">
                                    <span>
                                        This song isn\u2019t unlocked for download yet. Unlocking uses 1 of your monthly Suno downloads
                                        {unlockPrompt.quota ? ` (${unlockPrompt.quota.remaining} left${unlockPrompt.quota.periodEnd ? `, refreshes ${new Date(unlockPrompt.quota.periodEnd).toLocaleDateString()}` : ''})` : ''}.
                                    </span>
                                    <button type="button" onClick={handleUnlockAndDownload} disabled={isUnlocking} className="px-3 py-1 rounded bg-amber-500/80 hover:bg-amber-400 text-black font-bold disabled:opacity-60 whitespace-nowrap">
                                        {isUnlocking ? 'Unlocking\u2026' : 'Unlock & Download'}
                                    </button>
                                    <button type="button" onClick={() => setUnlockPrompt(null)} className="text-slate-300 hover:text-white">Cancel</button>
                                </div>
                            )}
                            <select
                            value={downloadFormat}
                            onChange={(e) => setDownloadFormat(e.target.value as SunoDownloadFormat)}
                            aria-label="Download format"
                            className="px-2 py-2 bg-[var(--app-panel)] border border-slate-600 text-white text-sm rounded-lg"
                            >
                                <option value="mp3">MP3</option>
                                <option value="wav">WAV</option>
                            </select>
                            <button
                            type="button"
                            onClick={() => handleDownloadAudio()}
                            disabled={isDownloadingAudio || isUnlocking}
                            className="px-4 py-2 bg-[var(--app-panel)] hover:bg-[var(--app-tab-hover)] border border-slate-600 text-white text-sm font-bold rounded-lg transition-colors flex items-center gap-2 disabled:opacity-60"
                            title={`Download ${downloadFormat.toUpperCase()}`}
                            >
                            <svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" className="w-4 h-4">
                                <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
                                <polyline points="7 10 12 15 17 10" />
                                <line x1="12" y1="15" x2="12" y2="3" />
                            </svg>
                            {isDownloadingAudio ? 'Downloading…' : 'Download'}
                            </button>

                            <a 
                            href={`https://suno.com/song/${clip.id}`}
                            target="_blank" 
                            rel="noopener noreferrer"
                            className="px-4 py-2 bg-[var(--app-accent)] hover:bg-[var(--app-accent)] text-white text-sm font-bold rounded-lg transition-colors shadow-lg shadow-purple-900/20"
                            >
                            Open in Suno
                            </a>
                        </>
                    )}
                    <button 
                    onClick={onClose}
                    className="px-4 py-2 bg-[var(--app-panel)] hover:bg-[var(--app-tab-hover)] text-white text-sm font-medium rounded-lg transition-colors"
                    >
                    Close
                    </button>
            </div>
        </div>
    </div>
  );
};

export default DetailsModal;
