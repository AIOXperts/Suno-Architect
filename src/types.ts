export interface ColorEvent {
  time: number;
  activeColor: string;
  inactiveColor: string;
}

export interface ParsedSunoOutput {
  style: string;
  title: string;
  excludeStyles: string;
  advancedParams: string;
  vocalGender: string;
  weirdness: number;
  styleInfluence: number;
  lyricsWithTags: string;
  lyricsAlone: string;
  fullResponse: string;
}

export interface GenerationState {
  isLoading: boolean;
  error: string | null;
  result: ParsedSunoOutput[] | null;
}

export interface SunoClip {
  id: string;
  title: string;
  created_at: string;
  model_name: string;
  /** e.g. "v6" from the feed's major_model_version */
  majorModelVersion?: string;
  imageUrl?: string;
  imageLargeUrl?: string;
  /** Playable/downloadable audio URL from the feed's media_urls (CloudFront m4a since late 2025). */
  audioUrl?: string;
  /** media_urls content_type, e.g. "m4a-opus" or "mp3". */
  audioContentType?: string;
  explicit?: boolean;
  metadata: {
    tags: string;
    prompt: string;
    negative_tags?: string;
    duration?: number;
    max_bpm?: number;
    min_bpm?: number;
    avg_bpm?: number;
    key?: string;
    // Generation parameters reported by the feed (all optional; absent on older clips)
    is_max_mode?: boolean;
    /** control_sliders.aug_creativity: 0=Off, 1=Normal, 2=High, 3=Extra, 4=Max */
    variety?: VarietyLevel;
    /** control_sliders.weirdness_constraint 0..1 */
    weirdness_constraint?: number;
    /** control_sliders.style_weight 0..1 */
    style_weight?: number;
    /** control_sliders.audio_weight 0..1 (covers/extensions) */
    audio_weight?: number;
    make_instrumental?: boolean;
    has_vocal?: boolean;
    vox_render_mode?: string;
    task?: string;
    cover_clip_id?: string;
    is_remix?: boolean;
    uses_latest_model?: boolean;
  };
  originalData?: ParsedSunoOutput;
  alignmentData?: AlignedWord[];
  lrcContent?: string;
  srtContent?: string;
}

export interface AlignedWord {
  word: string;
  start_s: number;
  end_s: number;
  success: boolean;
  p_align: number;
}

export interface LyricAlignmentResponse {
  aligned_words: AlignedWord[];
}

export interface SunoLibrary {
  genres: string[];
  structures: string[];
  vocalStyles: string[];
  production: string[];
  theory: string[];
}

export interface LyricalConstraints {
  forbidden: string[];
  forbiddenAdjectives: string[];
  forbiddenPhrases: string[];
  forbiddenRhymes: string; // Keep as string for simple editing
}

export interface PromptSettings {
  version: 'v1' | 'v2' | 'v3' | 'v4' | 'custom';
  customSystemPrompt: string;
  library: SunoLibrary;
  constraints: LyricalConstraints;
}

export type AppTheme = 'midnight' | 'neon-synth' | 'dawn-studio' | 'forest-night';
export type AppLayout = 'topbar' | 'sidebar' | 'studio';

export interface FileContext {
  mimeType: string;
  data: string; // Base64 data URL
  name: string;
}

export interface ReferenceSongInput {
  id: string;
  weight?: number;
}

export type AlbumObjectivePreset = 'standard' | 'append';

export interface GenerationOptions {
  references?: ReferenceSongInput[];
  referencePlaylistIds?: string[];
  preserveMotifs?: string[];
  avoidMotifs?: string[];
  objectivePreset?: AlbumObjectivePreset;
}

export type ViewMode = 'generator' | 'cover-matrix' | 'history' | 'library' | 'activity-history' | 'albums' | 'album-builder' | 'visualizer' | 'web-audio-master';

export type Qt6Style =
  | 'wave'
  | 'bars'
  | 'circle'
  | 'circular-wave'
  | 'stereo-wave'
  | 'stereo-bars'
  | 'log-bars'
  | 'led-bars'
  | 'radial-spectrum'
  | 'wave-spectrum'
  | 'vu-meter'
  | 'spectrogram'
  | 'particle-pulse'
  | 'organic-blob'
  | 'multi-band-ring';

export type ProviderType = 'gemini' | 'openrouter' | 'openapi';

export interface AIProviderConfig {
  type: ProviderType;
  apiKey?: string;
  baseUrl?: string;
  model?: string;
  headers?: Record<string, string>;
  authHeader?: string;
  authPrefix?: string;
}

export interface GenerateContentRequest {
  model: string;
  contents: string | unknown;
  systemInstruction?: string;
  temperature?: number;
  responseMimeType?: string;
  timeoutMs?: number;
}

export interface GenerateContentResponse {
  text: string;
}

export interface AIProvider {
  generateContent(request: GenerateContentRequest): Promise<GenerateContentResponse>;
  validateConfig(): boolean;
  getAvailableModels(): Promise<string[]>;
}

export interface AlbumSongRef {
  songId: string;
  title?: string | null;
  addedAt: string;
  sortOrder: number;
}

export interface LibraryAlbum {
  id: number;
  name: string;
  description?: string | null;
  createdAt: string;
  updatedAt: string;
  songs: AlbumSongRef[];
}

export type VarietyLevel = 0 | 1 | 2 | 3 | 4;

export interface SunoCoverGenerationOptions {
  songId: string;
  title: string;
  prompt?: string;
  tags?: string;
  negativeTags?: string;
  model?: string;
  audioWeight?: number; // 0.0 - 1.0 (Audio Influence / ai)
  styleWeight?: number; // 0.0 - 1.0 (Style Influence / si)
  weirdness?: number; // 0.0 - 1.0 (Weirdness / w)
  variety?: VarietyLevel; // 0=Off, 1=Normal, 2=High, 3=Extra, 4=Max (v)
  isMaxMode?: boolean; // false=maxoff, true=maxon
  makeInstrumental?: boolean;
}

export interface CoverSliderMatrixConfig {
  baseSongId: string;
  titlePrefix: string;
  model: string;
  tags?: string;
  lyrics?: string;
  varieties: VarietyLevel[]; // e.g. [0, 1, 2, 3, 4]
  audioInfluences: number[]; // 0 - 100, e.g. [0, 25, 50, 75, 100]
  styleInfluences: number[]; // 0 - 100, e.g. [50]
  weirdnessValues: number[]; // 0 - 100, e.g. [50]
  maxModes: boolean[]; // e.g. [false] or [false, true]
  delayBetweenMs?: number; // delay between API requests to avoid rate limit
}

export interface CoverSliderMatrixItem {
  id: string;
  title: string;
  variety: VarietyLevel;
  audioInfluence: number; // 0 - 100
  styleInfluence: number; // 0 - 100
  weirdness: number; // 0 - 100
  isMaxMode: boolean;
  status: 'pending' | 'running' | 'completed' | 'failed' | 'skipped';
  clipIds?: string[];
  error?: string;
}

