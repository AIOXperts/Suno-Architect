
import { ParsedSunoOutput, LyricAlignmentResponse, SunoCoverGenerationOptions, CoverSliderMatrixConfig, CoverSliderMatrixItem, VarietyLevel } from "../types";
import { listAllTracks, listTracksByUpdatedAtDesc } from './offlineDb';

export class SunoApiError extends Error {
    status?: number;

    constructor(message: string, status?: number) {
        super(message);
        this.name = 'SunoApiError';
        this.status = status;
    }
}

export const isSunoUnauthorizedError = (error: unknown): boolean =>
    error instanceof SunoApiError && error.status === 401;

export const extractSunoPlaylistId = (input: string): string | null => {
    const trimmed = (input || "").trim();
    if (!trimmed) return null;

    const direct = trimmed.match(/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i);
    if (direct) return direct[0];

    const url = trimmed.match(/suno\.com\/playlist\/([0-9a-f-]{36})/i);
    if (url?.[1]) return url[1];

    const prefixed = trimmed.match(/^playlist:([0-9a-f-]{36})$/i);
    if (prefixed?.[1]) return prefixed[1];

    return null;
};

const normalizeSunoAuth = (raw: string): { bearerToken?: string; cookie?: string } => {
    const trimmed = (raw || "").trim();
    if (!trimmed) return {};

    // Support users pasting "Bearer <token>" directly.
    const bearerMatch = trimmed.match(/^Bearer\s+(.+)$/i);
    if (bearerMatch?.[1]) {
        return { bearerToken: bearerMatch[1].trim() };
    }

    // Cookie-like payloads usually contain key=value pairs.
    const looksLikeCookie = /[=;]/.test(trimmed) || trimmed.includes("__session=");
    if (looksLikeCookie) {
        return { cookie: trimmed };
    }

    // JWTs typically start with "ey", but fallback to treating any opaque token as bearer.
    return { bearerToken: trimmed };
};

export const SUNO_API_BASE = "https://studio-api.prod.suno.com";
export const SUNO_AUTH_BASE = "https://auth.suno.com";

const isBrowser = typeof window !== "undefined" && typeof document !== "undefined";

/**
 * studio-api only emits CORS headers for https://suno.com, so browser callers must go
 * through the same-origin passthrough (`/api/suno/*`, served by the Worker in production
 * and by the Vite dev plugin locally). Node scripts talk to studio-api directly.
 */
export const resolveSunoApiBase = (): string => {
    if (!isBrowser) return SUNO_API_BASE;
    const configured = (import.meta.env?.VITE_SUNO_API_PROXY_URL as string | undefined)?.trim();
    return (configured || "/api/suno").replace(/\/+$/, "");
};
/** Clerk JS version shim required by Suno's auth host (FAPI rejects requests without it). */
export const SUNO_CLERK_JS_VERSION = "5.100.0";

/**
 * Builds request headers for studio-api endpoints from either a bearer token
 * ("Bearer ey..." / raw JWT) or a raw cookie string ("__session=...").
 */
export const buildSunoAuthHeaders = (cookie?: string): Record<string, string> => {
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
        "accept": "*/*",
        "origin": "https://suno.com",
        "referer": "https://suno.com/",
    };

    if (!cookie?.trim()) return headers;

    const auth = normalizeSunoAuth(cookie);
    if (auth.bearerToken) {
        headers["Authorization"] = `Bearer ${auth.bearerToken}`;
    } else if (auth.cookie) {
        // Browsers forbid setting `Cookie`; the passthrough maps X-Suno-Cookie back to Cookie.
        headers[isBrowser ? "X-Suno-Cookie" : "Cookie"] = auth.cookie;
    } else {
        throw new SunoApiError("Invalid Suno token/cookie format");
    }
    return headers;
};

/**
 * Authenticated JSON call against studio-api. Throws SunoApiError carrying the
 * HTTP status so callers can distinguish 401 (stale token) from other failures.
 */
const sunoFetch = async <T = unknown>(
    path: string,
    cookie: string,
    init?: { method?: "GET" | "POST"; body?: unknown }
): Promise<T> => {
    if (!cookie?.trim()) throw new SunoApiError("No Suno token/cookie provided");

    const response = await fetch(`${resolveSunoApiBase()}${path}`, {
        method: init?.method ?? "GET",
        headers: buildSunoAuthHeaders(cookie),
        body: init?.body === undefined ? undefined : JSON.stringify(init.body),
    });

    if (response.status === 429) {
        throw new SunoApiError("Suno API rate limit (429)", 429);
    }
    if (!response.ok) {
        throw new SunoApiError(`Suno API ${path} failed. Status: ${response.status}`, response.status);
    }
    return (await response.json()) as T;
};

export const getSunoPlaylist = async (playlistIdOrUrl: string, cookie?: string): Promise<any> => {
    const playlistId = extractSunoPlaylistId(playlistIdOrUrl);
    if (!playlistId) throw new Error("Invalid playlist ID or URL");

    const path = `/api/playlist/${playlistId}`;

    // Public playlists are readable without auth; only build auth headers when a credential exists.
    if (!cookie?.trim()) {
        const response = await fetch(`${resolveSunoApiBase()}${path}`, {
            method: "GET",
            headers: { "Content-Type": "application/json", "accept": "*/*" },
        });
        if (!response.ok) {
            throw new SunoApiError(`Failed to fetch playlist. Status: ${response.status}`, response.status);
        }
        return response.json();
    }

    return sunoFetch(path, cookie);
};

export const getSunoCredits = async (cookie: string): Promise<number> => {
    if (!cookie) throw new Error("No cookie provided");

    try {
        const data = await sunoFetch<unknown>("/api/billing/info/", cookie);
        const record: Record<string, unknown> = data && typeof data === 'object' ? (data as Record<string, unknown>) : {};
        // v6 billing payload exposes `credits`; older payloads used `total_credits_left`.
        if (typeof record.credits === 'number') return record.credits;
        if (typeof record.total_credits_left === 'number') return record.total_credits_left;
        return 0;
    } catch (error) {
        console.error("Failed to get credits:", error);
        throw error;
    }
};

export interface SunoFeedRequestBody {
    cursor: string | null;
    limit: number;
    filters: {
        disliked: string;
        fullSong: string;
        trashed: string;
        fromStudioProject: { presence: string };
        stem: { presence: string };
        searchText?: string;
    };
}

export const getSunoFeed = async (
    cookie: string, 
    limit: number = 20, 
    cursor: string | null = null, 
    searchText?: string
): Promise<any> => {
    if (!cookie) throw new Error("No cookie provided");

    const body: SunoFeedRequestBody = {
        "cursor": cursor,
        "limit": limit,
        "filters": {
            "disliked": "False",
            "fullSong": "True",
            "trashed": "False",
            "fromStudioProject": { "presence": "False" },
            "stem": { "presence": "False" }
        }
    };

    if (searchText && searchText.trim()) {
        body.filters.searchText = searchText.trim();
    }

    return sunoFetch("/api/feed/v3", cookie, { method: "POST", body });
};

const extractFeedClips = (feed: any): any[] => (Array.isArray(feed?.clips) ? feed.clips : []);

const extractNextFeedCursor = (feed: any): string | null => {
    const candidate =
        feed?.next_cursor ??
        feed?.nextCursor ??
        feed?.cursor ??
        feed?.pagination?.next_cursor ??
        feed?.pagination?.nextCursor ??
        null;
    return typeof candidate === 'string' && candidate.trim() ? candidate : null;
};

export const getSunoFeedAll = async (
    cookie: string,
    pageSize: number = 100,
    searchText?: string,
    options?: { maxPages?: number; maxClips?: number }
): Promise<any> => {
    const maxPages = Math.max(1, options?.maxPages ?? 30);
    const maxClips = Math.max(1, options?.maxClips ?? 5000);
    const safePageSize = Math.max(1, Math.min(pageSize, 200));

    const allClips: any[] = [];
    let cursor: string | null = null;
    let page = 0;
    const seenCursors = new Set<string>();

    while (page < maxPages && allClips.length < maxClips) {
        const feed = await getSunoFeed(cookie, safePageSize, cursor, searchText);
        const clips = extractFeedClips(feed);
        allClips.push(...clips);
        page += 1;

        const nextCursor = extractNextFeedCursor(feed);
        if (!nextCursor || nextCursor === cursor || seenCursors.has(nextCursor) || clips.length === 0) {
            break;
        }
        seenCursors.add(nextCursor);
        cursor = nextCursor;
    }

    return { clips: allClips };
};

export const getSunoFeedOfflineAware = async (
    cookie: string,
    limit: number | 'all' = 20,
    cursor: string | null = null,
    searchText?: string,
    options?: { useCachedData?: boolean }
): Promise<any> => {
    const useCachedData = !!options?.useCachedData;
    if (!useCachedData) {
        if (limit === 'all') {
            return getSunoFeedAll(cookie, 100, searchText);
        }
        return getSunoFeed(cookie, limit, cursor, searchText);
    }

    const tracks = limit === 'all' ? await listAllTracks() : await listTracksByUpdatedAtDesc(limit);
    const filtered = searchText?.trim()
        ? tracks.filter((t) => {
            const q = searchText.toLowerCase();
            return t.title.toLowerCase().includes(q) || t.metadata.prompt.toLowerCase().includes(q);
        })
        : tracks;

    return {
        clips: filtered.map((t) => ({
            id: t.id,
            title: t.title,
            created_at: new Date(t.createdAt).toISOString(),
            model_name: t.raw?.model_name || 'offline',
            image_url: t.imageUrl,
            image_large_url: t.imageUrl,
            metadata: {
                ...(t.raw?.metadata || {}),
                prompt: t.metadata.prompt,
                tags: t.metadata.tags.join(', '),
                duration: t.metadata.durationMs / 1000,
            },
            audio_url: t.audioUrl,
            media_urls: t.audioUrl
                ? [{ url: t.audioUrl, content_type: t.audioUrl.endsWith('.m4a') ? 'm4a-opus' : 'mp3', delivery: 'progressive' }]
                : [],
        })),
    };
};

export const getLyricAlignment = async (songId: string, cookie: string): Promise<LyricAlignmentResponse> => {
    if (!cookie) throw new Error("No cookie provided");

    try {
        return await sunoFetch<LyricAlignmentResponse>(`/api/gen/${songId}/aligned_lyrics/v2`, cookie);
    } catch (error) {
        console.error("Failed to get lyric alignment:", error);
        throw error;
    }
};

export const getSunoClip = async (clipId: string, cookie: string): Promise<any> => {
    if (!cookie) throw new Error("No cookie provided");

    try {
        return await sunoFetch(`/api/clip/${clipId}`, cookie);
    } catch (error) {
        console.error("Failed to get suno clip:", error);
        throw error;
    }
};

export interface SunoPlaylistSummary {
    id: string;
    name: string;
    song_count: number;
    play_count: number;
    is_public: boolean;
    is_owned: boolean;
    is_trashed?: boolean;
    is_hidden?: boolean;
    image_url?: string;
    description?: string;
    user_handle?: string;
    user_display_name?: string;
    total_duration?: number;
    num_total_results?: number;
}

export interface SunoMyPlaylistsPage {
    playlists: SunoPlaylistSummary[];
    total: number;
    currentPage: number;
}

/** Raw clip metadata as returned by studio-api; slider keys vary by task/generation version. */
export interface SunoClipMetadata {
    tags?: string;
    prompt?: string;
    duration?: number;
    make_instrumental?: boolean;
    task?: string;
    type?: string;
    control_sliders?: Record<string, number>;
    has_vocal?: boolean;
    is_mumble?: boolean;
    uses_latest_model?: boolean;
    is_remix?: boolean;
    cover_clip_id?: string;
    edited_clip_id?: string;
    vox_render_mode?: string;
    model_badges?: Record<string, unknown>;
    [key: string]: unknown;
}

export interface SunoMediaUrl {
    url?: string;
    content_type?: string;
    delivery?: string;
    encoding?: string;
}

/** studio-api returns this placeholder in `audio_url`; real links live in `media_urls[]`. */
export const SUNO_FORBIDDEN_AUDIO_URL = `${SUNO_API_BASE}/api/forbidden`;

/** Legacy public MP3 path. cdn1 now requires CloudFront signed cookies, so this is a last resort only. */
export const legacySunoAudioUrl = (clipId: string): string => `https://cdn1.suno.ai/${clipId}.mp3`;

/** File extension for a media_urls content_type ("m4a-opus" → "m4a", "mp3" → "mp3"). */
export const audioExtensionForContentType = (contentType?: string): string => {
    const base = (contentType || '').toLowerCase().split('-')[0];
    return base === 'mp3' || base === 'm4a' || base === 'wav' || base === 'ogg' ? base : 'm4a';
};

/**
 * Picks the best playable audio URL from a raw feed/playlist clip:
 * media_urls (mp3 preferred, then m4a, then anything with a url), falling back to
 * audio_url/song_path only when they are not the forbidden placeholder.
 */
export const pickSunoAudioUrl = (clip: any): { url: string; contentType?: string } | undefined => {
    const media: SunoMediaUrl[] = Array.isArray(clip?.media_urls) ? clip.media_urls : [];
    const withUrl = media.filter((m) => typeof m?.url === 'string' && m.url.length > 0);
    const rank = (m: SunoMediaUrl) => {
        const ct = (m.content_type || '').toLowerCase();
        if (ct.startsWith('mp3')) return 0;
        if (ct.startsWith('m4a')) return 1;
        return 2;
    };
    const best = [...withUrl].sort((a, b) => rank(a) - rank(b))[0];
    if (best?.url) return { url: best.url, contentType: best.content_type };

    for (const candidate of [clip?.audio_url, clip?.song_path, clip?.audioUrl]) {
        if (typeof candidate === 'string' && candidate && !candidate.startsWith(SUNO_FORBIDDEN_AUDIO_URL)) {
            return { url: candidate, contentType: candidate.endsWith('.m4a') ? 'm4a' : 'mp3' };
        }
    }
    return undefined;
};

export interface SunoPlaylistClipRecord {
    id: string;
    title: string;
    created_at: string;
    model_name?: string;
    major_model_version?: string;
    play_count?: number;
    upvote_count?: number;
    status?: string;
    display_tags?: string;
    is_public?: boolean;
    is_trashed?: boolean;
    explicit?: boolean;
    audio_url?: string;
    video_url?: string;
    image_url?: string;
    image_large_url?: string;
    user_id?: string;
    media_urls?: SunoMediaUrl[];
    metadata?: SunoClipMetadata;
    [key: string]: unknown;
}

export interface SunoPlaylistEntry {
    clip: SunoPlaylistClipRecord;
    relative_index?: number;
    created_at?: string;
}

export interface SunoPlaylistDetail {
    id: string;
    name: string;
    image_url?: string;
    description?: string;
    playlist_clips: SunoPlaylistEntry[];
    num_total_results?: number;
    current_page?: number;
    song_count?: number;
    total_duration?: number;
    play_count?: number;
    upvote_count?: number;
    is_public?: boolean;
    is_owned?: boolean;
    is_trashed?: boolean;
    is_hidden?: boolean;
    user_handle?: string;
    user_display_name?: string;
}

export interface SunoClientSessionSummary {
    id: string;
    status: string;
    lastActiveToken?: string;
    expiresAt?: number;
}

const MAX_PAGINATION_PAGES = 100;

export const getSunoMyPlaylists = async (cookie: string, page: number = 1): Promise<SunoMyPlaylistsPage> => {
    const raw = await sunoFetch<{ playlists?: SunoPlaylistSummary[]; num_total_results?: number; current_page?: number }>(
        `/api/playlist/me?page=${Math.max(1, Math.floor(page))}`,
        cookie
    );

    const playlists = Array.isArray(raw?.playlists) ? raw.playlists : [];
    const total = typeof raw?.num_total_results === 'number' ? raw.num_total_results : playlists.length;
    const currentPage = typeof raw?.current_page === 'number' ? raw.current_page : 1;
    return { playlists, total, currentPage };
};

/**
 * Walks every page of `/api/playlist/me`. Suno caps the page size server-side
 * (12 at time of writing), so the loop is driven by `num_total_results`.
 */
export const getAllSunoMyPlaylists = async (
    cookie: string,
    options?: { includeTrashed?: boolean }
): Promise<SunoPlaylistSummary[]> => {
    const includeTrashed = !!options?.includeTrashed;
    const collected: SunoPlaylistSummary[] = [];
    const seen = new Set<string>();
    let total = Infinity;

    for (let page = 1; page <= MAX_PAGINATION_PAGES && collected.length < total; page += 1) {
        const result = await getSunoMyPlaylists(cookie, page);
        total = result.total;

        const before = collected.length;
        for (const playlist of result.playlists) {
            if (!playlist?.id || seen.has(playlist.id)) continue;
            seen.add(playlist.id);
            if (!includeTrashed && playlist.is_trashed) continue;
            collected.push(playlist);
        }

        if (result.playlists.length === 0 || collected.length === before) break;
    }

    return collected;
};

export const getSunoPlaylistPage = async (
    playlistIdOrUrl: string,
    cookie: string,
    page: number = 1
): Promise<SunoPlaylistDetail> => {
    const playlistId = extractSunoPlaylistId(playlistIdOrUrl);
    if (!playlistId) throw new Error("Invalid playlist ID or URL");
    return sunoFetch<SunoPlaylistDetail>(`/api/playlist/${playlistId}?page=${Math.max(1, Math.floor(page))}`, cookie);
};

/**
 * Returns every clip in a playlist. Playlists are served in large pages, so this
 * normally costs a single request; the loop only continues for playlists that
 * exceed the server page size.
 */
export const getAllSunoPlaylistClips = async (
    playlistIdOrUrl: string,
    cookie: string,
    options?: { maxPages?: number }
): Promise<SunoPlaylistClipRecord[]> => {
    const maxPages = Math.max(1, options?.maxPages ?? MAX_PAGINATION_PAGES);
    const clips: SunoPlaylistClipRecord[] = [];
    const seen = new Set<string>();
    let expected = Infinity;

    for (let page = 1; page <= maxPages && clips.length < expected; page += 1) {
        const detail = await getSunoPlaylistPage(playlistIdOrUrl, cookie, page);
        const entries = Array.isArray(detail?.playlist_clips) ? detail.playlist_clips : [];
        if (typeof detail?.num_total_results === 'number') expected = detail.num_total_results;

        let added = 0;
        for (const entry of entries) {
            const clip = entry?.clip;
            if (!clip?.id || seen.has(clip.id)) continue;
            seen.add(clip.id);
            clips.push(clip);
            added += 1;
        }

        if (entries.length === 0 || added === 0) break;
    }

    return clips;
};

const clerkFetch = async <T = unknown>(
    path: string,
    clientToken: string,
    init?: { method?: "GET" | "POST"; body?: string }
): Promise<T> => {
    const trimmed = (clientToken || "").trim();
    if (!trimmed) throw new SunoApiError("No Clerk client token provided");

    const url = `${SUNO_AUTH_BASE}/v1/${path}${path.includes("?") ? "&" : "?"}__clerk_js_version=${SUNO_CLERK_JS_VERSION}`;
    const response = await fetch(url, {
        method: init?.method ?? "GET",
        headers: {
            "accept": "*/*",
            "content-type": "application/json",
            "cookie": `__client=${trimmed}`,
            "origin": "https://suno.com",
            "referer": "https://suno.com/",
        },
        body: init?.body,
    });

    if (!response.ok) {
        throw new SunoApiError(`Clerk ${path} failed. Status: ${response.status}`, response.status);
    }
    return (await response.json()) as T;
};

/**
 * Clerk's long-lived `__client` cookie can be exchanged for short-lived (1h)
 * session JWTs, so backups do not need a live browser session.
 */
export const getSunoClientSessions = async (clientToken: string): Promise<SunoClientSessionSummary[]> => {
    const payload = await clerkFetch<{ response?: { sessions?: unknown[] } }>("client", clientToken);
    const sessions = Array.isArray(payload?.response?.sessions) ? payload.response.sessions : [];

    return sessions.flatMap((entry): SunoClientSessionSummary[] => {
        if (!entry || typeof entry !== "object") return [];
        const record = entry as Record<string, unknown>;
        const id = typeof record.id === "string" ? record.id : null;
        if (!id) return [];

        const lastToken = record.last_active_token;
        const lastActiveToken =
            lastToken && typeof lastToken === "object" && typeof (lastToken as Record<string, unknown>).jwt === "string"
                ? ((lastToken as Record<string, unknown>).jwt as string)
                : undefined;

        return [{
            id,
            status: typeof record.status === "string" ? record.status : "unknown",
            lastActiveToken,
            expiresAt: typeof record.expire_at === "number" ? record.expire_at : undefined,
        }];
    });
};

export const mintSunoSessionToken = async (
    clientToken: string,
    sessionId?: string
): Promise<{ token: string; sessionId: string }> => {
    const sessions = await getSunoClientSessions(clientToken);
    const active = sessions.find((s) => s.status === "active") ?? sessions[0];
    const targetSession = sessionId || active?.id;
    if (!targetSession) throw new SunoApiError("No active Clerk session found for this client token");

    try {
        const payload = await clerkFetch<{ jwt?: unknown }>(
            `client/sessions/${targetSession}/tokens`,
            clientToken,
            { method: "POST", body: "{}" }
        );
        if (typeof payload?.jwt === "string" && payload.jwt.startsWith("ey")) {
            return { token: payload.jwt, sessionId: targetSession };
        }
    } catch (error) {
        // Fall through to the cached session token when minting is rejected.
        if (!active?.lastActiveToken) throw error;
    }

    if (active?.lastActiveToken) {
        return { token: active.lastActiveToken, sessionId: targetSession };
    }
    throw new SunoApiError("Clerk session token could not be minted");
};

export const formatVarietyName = (v: VarietyLevel): string => {
  switch (v) {
    case 0: return 'Off';
    case 1: return 'Normal';
    case 2: return 'High';
    case 3: return 'Extra';
    case 4: return 'Max';
    default: return 'Normal';
  }
};

export const formatCoverTitle = (
  prefix: string,
  variety: VarietyLevel,
  audioInfluence: number,
  styleInfluence: number,
  weirdness: number,
  isMaxMode: boolean
): string => {
  const vStr = formatVarietyName(variety);
  const maxStr = isMaxMode ? 'maxon' : 'maxoff';
  return `${prefix}-v${vStr}-ai${audioInfluence}-si${styleInfluence}-w${weirdness}-${maxStr}`;
};

export const generateCoverMatrix = (config: CoverSliderMatrixConfig): CoverSliderMatrixItem[] => {
  const items: CoverSliderMatrixItem[] = [];
  const varieties = config.varieties?.length ? config.varieties : [0, 1, 2, 3, 4];
  const audioInfluences = config.audioInfluences?.length ? config.audioInfluences : [0, 25, 50, 75, 100];
  const styleInfluences = config.styleInfluences?.length ? config.styleInfluences : [50];
  const weirdnessValues = config.weirdnessValues?.length ? config.weirdnessValues : [50];
  const maxModes = config.maxModes?.length ? config.maxModes : [false];

  for (const v of varieties) {
    for (const ai of audioInfluences) {
      for (const si of styleInfluences) {
        for (const w of weirdnessValues) {
          for (const maxMode of maxModes) {
            const title = formatCoverTitle(config.titlePrefix, v, ai, si, w, maxMode);
            const id = `cover_${v}_${ai}_${si}_${w}_${maxMode ? '1' : '0'}`;
            items.push({
              id,
              title,
              variety: v,
              audioInfluence: ai,
              styleInfluence: si,
              weirdness: w,
              isMaxMode: maxMode,
              status: 'pending'
            });
          }
        }
      }
    }
  }

  return items;
};

export const triggerSunoGeneration = async (
  data: ParsedSunoOutput, 
  cookie: string,
  model: string = "chirp-hawk"
): Promise<any> => {
  if (!cookie) {
    throw new Error("Suno Cookie/Token is missing.");
  }

  // Use the proxy endpoint to avoid CORS issues and manage headers
  const API_ENDPOINT = (typeof window !== 'undefined' && (import.meta.env?.VITE_SUNO_PROXY_URL || "/api/suno-proxy")) || "https://studio-api-prod.suno.com/api/generate/v2-web/";
  
  // Normalize 0-100 to 0.0-1.0
  const weirdness = typeof data.weirdness === 'number' ? data.weirdness / 100 : 0.5;
  const styleWeight = typeof data.styleInfluence === 'number' ? data.styleInfluence / 100 : 0.5;

  // Construct payload for Custom Mode
  const payload = {
    prompt: data.lyricsWithTags || "",
    tags: data.style || "",
    negative_tags: data.excludeStyles || "",
    title: data.title || "Suno Architect Generation",
    make_instrumental: !data.lyricsWithTags && !!data.style,
    mv: model, // Dynamic Model selection
    continue_clip_id: null,
    continue_at: null,
    generation_type: "TEXT",
    metadata: {
        create_mode: "custom",
        control_sliders: {
            weirdness_constraint: weirdness,
            style_weight: styleWeight
        },
        can_control_sliders: [
            "weirdness_constraint",
            "style_weight"
        ]
    }
  };

  try {
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };

    // Handle Authentication
    const auth = normalizeSunoAuth(cookie);
    if (auth.bearerToken) {
        headers["Authorization"] = `Bearer ${auth.bearerToken}`;
    } else if (auth.cookie) {
        headers["X-Suno-Cookie"] = auth.cookie;
        if (typeof window === 'undefined') {
          headers["Cookie"] = auth.cookie;
        }
    } else {
        throw new Error("Invalid Suno token/cookie format");
    }

    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Status ${response.status}`;
      
      try {
          const jsonErr = JSON.parse(errorText);
          if (jsonErr.detail) errorMessage = jsonErr.detail;
          if (jsonErr.message) errorMessage = jsonErr.message;
          if (jsonErr.error) errorMessage = jsonErr.error;
      } catch (e) {
          const cleanText = errorText.replace(/<[^>]*>?/gm, '').substring(0, 200);
          if (cleanText) errorMessage = cleanText;
      }
      throw new Error(`Suno API Failed: ${errorMessage}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error("Suno Proxy API Error:", error);
    throw error;
  }
};

export const triggerSunoCoverGeneration = async (
  options: SunoCoverGenerationOptions,
  cookie: string
): Promise<any> => {
  if (!cookie) {
    throw new Error("Suno Cookie/Token is missing.");
  }
  if (!options.songId) {
    throw new Error("Cover source songId is required.");
  }

  const API_ENDPOINT = (typeof window !== 'undefined' && (import.meta.env?.VITE_SUNO_PROXY_URL || "/api/suno-proxy")) || "https://studio-api-prod.suno.com/api/generate/v2-web/";

  const controlSliders: Record<string, number> = {};
  if (typeof options.weirdness === 'number') {
    controlSliders.weirdness_constraint = Math.max(0, Math.min(1, options.weirdness));
  }
  if (typeof options.styleWeight === 'number') {
    controlSliders.style_weight = Math.max(0, Math.min(1, options.styleWeight));
  }
  if (typeof options.audioWeight === 'number') {
    controlSliders.audio_weight = Math.max(0, Math.min(1, options.audioWeight));
  }
  if (typeof options.variety === 'number') {
    controlSliders.aug_creativity = Math.max(0, Math.min(4, Math.round(options.variety)));
  }

  const txnId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `txn_${Date.now()}`;
  const sessId = typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `sess_${Date.now()}`;

  const payload = {
    token: null,
    prompt: options.prompt || "",
    tags: options.tags || "",
    negative_tags: options.negativeTags || "",
    title: options.title || "Cover Generation",
    make_instrumental: !!options.makeInstrumental,
    mv: options.model || "chirp-hawk",
    task: "cover",
    cover_clip_id: options.songId,
    generation_type: "TEXT",
    transaction_uuid: txnId,
    metadata: {
      web_client_pathname: "/create",
      create_surface: "desktop_create_form",
      create_mode: "custom",
      create_session_token: sessId,
      is_max_mode: !!options.isMaxMode,
      is_mumble: false,
      control_sliders: controlSliders,
      can_control_sliders: [
        "weirdness_constraint",
        "style_weight",
        "audio_weight"
      ]
    }
  };

  try {
    const browserTimestamp = Date.now();
    const browserTokenB64 = typeof btoa !== 'undefined'
      ? btoa(JSON.stringify({ timestamp: browserTimestamp }))
      : Buffer.from(JSON.stringify({ timestamp: browserTimestamp })).toString('base64');

    const headers: Record<string, string> = {
      "Content-Type": "application/json",
      "browser-token": JSON.stringify({ token: browserTokenB64 }),
      "device-id": "bf11e528-6a7b-4697-98aa-5f2d7ceeb194",
      "origin": "https://suno.com",
      "referer": "https://suno.com/",
    };

    const auth = normalizeSunoAuth(cookie);
    if (auth.bearerToken) {
      headers["Authorization"] = `Bearer ${auth.bearerToken}`;
      if (typeof window === 'undefined') {
        headers["Cookie"] = `__session=${auth.bearerToken}`;
      }
    } else if (auth.cookie) {
      headers["X-Suno-Cookie"] = auth.cookie;
      if (typeof window === 'undefined') {
        headers["Cookie"] = auth.cookie;
      }
    } else {
      throw new Error("Invalid Suno token/cookie format");
    }

    const response = await fetch(API_ENDPOINT, {
      method: "POST",
      headers: headers,
      body: JSON.stringify(payload),
    });

    if (!response.ok) {
      const errorText = await response.text();
      let errorMessage = `Status ${response.status}`;
      
      try {
        const jsonErr = JSON.parse(errorText);
        if (jsonErr.detail) errorMessage = jsonErr.detail;
        else if (jsonErr.message) errorMessage = jsonErr.message;
        else if (jsonErr.error) errorMessage = jsonErr.error;
      } catch (e) {
        const cleanText = errorText.replace(/<[^>]*>?/gm, '').substring(0, 200);
        if (cleanText) errorMessage = cleanText;
      }
      if (response.status === 401) {
        errorMessage = `Unauthorized (401). Please check/refresh your Suno Token in Settings.`;
      }
      throw new Error(`Suno API Cover Generation Failed: ${errorMessage}`);
    }

    return await response.json();
  } catch (error: any) {
    console.error("Suno Cover Generation Error:", error);
    throw error;
  }
};

export const updateSunoMetadata = async (clipId: string, data: ParsedSunoOutput, cookie: string): Promise<any> => {
    if (!cookie) throw new Error("No cookie provided");

    // Point to the metadata proxy
    const PROXY_ENDPOINT = `${resolveSunoApiBase()}/api/gen/${clipId}/set_metadata/`;
    
    // Construct payload
    const payload = {
      "title": data.title || "Untitled",
      "lyrics": data.lyricsAlone || "", // Use clean lyrics
      "caption": "",
      "caption_mentions": {
        "user_mentions": []
      },
      "remove_image_cover": false,
      "remove_video_cover": false
    };

    try {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };

        const auth = normalizeSunoAuth(cookie);
        if (auth.bearerToken) {
             headers["Authorization"] = `Bearer ${auth.bearerToken}`;
        } else if (auth.cookie) {
             headers["X-Suno-Cookie"] = auth.cookie;
        } else {
             throw new Error("Invalid Suno token/cookie format");
        }

        const response = await fetch(PROXY_ENDPOINT, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(payload)
        });

        if (!response.ok) {
             const errorText = await response.text();
             console.warn("Metadata update failed for " + clipId, errorText);
             return null;
        }
        
        return await response.json();
    } catch (e) {
        console.error("Failed to update metadata", e);
        return null; 
    }
};

export interface WavConversionTask {
    taskId: string;
    musicId: string;
    musicIndex: number;
    status: 'PENDING' | 'SUCCESS' | 'CREATE_TASK_FAILED' | 'GENERATE_WAV_FAILED' | 'CALLBACK_EXCEPTION';
    audioWavUrl?: string;
    errorMessage?: string;
    createTime?: string;
    completeTime?: string;
}

const normalizeWavStatus = (value: unknown, audioWavUrl?: string): WavConversionTask['status'] => {
    if (value === true && audioWavUrl) return 'SUCCESS';
    if (typeof value === 'string') {
        const upper = value.toUpperCase();
        if (upper === 'SUCCESS' || upper === 'PENDING' || upper === 'CREATE_TASK_FAILED' || upper === 'GENERATE_WAV_FAILED' || upper === 'CALLBACK_EXCEPTION') {
            return upper as WavConversionTask['status'];
        }
    }
    return audioWavUrl ? 'SUCCESS' : 'PENDING';
};

export const convertToWav = async (musicId: string, musicIndex: number = 0, apiKey: string): Promise<{ taskId: string }> => {
    if (!apiKey) throw new Error("No API key provided");
    if (!musicId) throw new Error("No music ID provided");

    const ENDPOINT = "https://api.sunoapi.org/api/v1/wav/create";

    const response = await fetch(ENDPOINT, {
        method: "POST",
        headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${apiKey}`,
        },
        body: JSON.stringify({
            musicId,
            musicIndex,
        }),
    });

    if (!response.ok) {
        const error = await response.json().catch(() => ({ msg: "Failed to create WAV conversion" }));
        throw new Error(error.msg || `Failed to create WAV conversion. Status: ${response.status}`);
    }

    const data = await response.json();
    const taskId = data?.data?.taskId || data?.taskId || data?.data?.id || data?.id;
    if (!taskId || typeof taskId !== 'string') {
        throw new Error("WAV conversion task was created but no taskId was returned");
    }
    return { taskId };
};

export const getWavConversionStatus = async (taskId: string, apiKey: string): Promise<WavConversionTask> => {
    if (!apiKey) throw new Error("No API key provided");
    if (!taskId) throw new Error("No task ID provided");

    const ENDPOINT = `https://api.sunoapi.org/api/v1/wav/record-info?taskId=${encodeURIComponent(taskId)}`;

    const response = await fetch(ENDPOINT, {
        method: "GET",
        headers: {
            "Authorization": `Bearer ${apiKey}`,
        },
    });

    if (!response.ok) {
        throw new Error(`Failed to get WAV conversion status. Status: ${response.status}`);
    }

    const data = await response.json();
    const payload = data?.data || data || {};
    const responsePayload = payload?.response || {};
    const audioWavUrl = responsePayload?.audioWavUrl || payload?.audioWavUrl;
    const status = normalizeWavStatus(
        payload?.successFlag ?? payload?.status ?? payload?.state ?? data?.status,
        audioWavUrl
    );
    return {
        taskId: payload?.taskId || taskId,
        musicId: payload?.musicId || "",
        musicIndex: payload?.musicIndex || 0,
        status,
        audioWavUrl,
        errorMessage: payload?.errorMessage || payload?.message || data?.msg,
        createTime: payload?.createTime,
        completeTime: payload?.completeTime,
    };
};

export const waitForWavConversion = async (taskId: string, apiKey: string, maxAttempts: number = 60, intervalMs: number = 5000): Promise<WavConversionTask> => {
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
        const result = await getWavConversionStatus(taskId, apiKey);
        
        if (result.status === 'SUCCESS') {
            return result;
        }
        
        if (result.status === 'CREATE_TASK_FAILED' || result.status === 'GENERATE_WAV_FAILED' || result.status === 'CALLBACK_EXCEPTION') {
            throw new Error(result.errorMessage || `WAV conversion failed: ${result.status}`);
        }
        
        // Still PENDING, wait and retry
        await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
    
    throw new Error("WAV conversion timed out");
};
