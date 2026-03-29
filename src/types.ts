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
  imageUrl?: string;
  imageLargeUrl?: string;
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

export type ViewMode = 'generator' | 'history' | 'activity-history' | 'albums' | 'album-builder' | 'visualizer' | 'web-audio-master';

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
