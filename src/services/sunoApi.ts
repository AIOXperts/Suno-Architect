
import { ParsedSunoOutput, LyricAlignmentResponse } from "../types";
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

export const getSunoPlaylist = async (playlistIdOrUrl: string, cookie?: string): Promise<any> => {
    const playlistId = extractSunoPlaylistId(playlistIdOrUrl);
    if (!playlistId) throw new Error("Invalid playlist ID or URL");

    const ENDPOINT = `https://studio-api.prod.suno.com/api/playlist/${playlistId}`;
    const headers: Record<string, string> = {
        "Content-Type": "application/json",
    };

    if (cookie) {
        const auth = normalizeSunoAuth(cookie);
        if (auth.bearerToken) {
            headers["Authorization"] = `Bearer ${auth.bearerToken}`;
        } else if (auth.cookie) {
            headers["Cookie"] = auth.cookie;
        }
    }

    const response = await fetch(ENDPOINT, { method: "GET", headers });
    if (!response.ok) {
        throw new Error(`Failed to fetch playlist. Status: ${response.status}`);
    }
    return response.json();
};

export const getSunoCredits = async (cookie: string): Promise<number> => {
    if (!cookie) throw new Error("No cookie provided");
    
    // Direct Suno billing endpoint
    const BILLING_ENDPOINT = "https://studio-api.prod.suno.com/api/billing/info/";
    
    try {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };

        const auth = normalizeSunoAuth(cookie);
        if (auth.bearerToken) {
            headers["Authorization"] = `Bearer ${auth.bearerToken}`;
        } else if (auth.cookie) {
            headers["Cookie"] = auth.cookie;
        } else {
            throw new Error("Invalid Suno token/cookie format");
        }

        const response = await fetch(BILLING_ENDPOINT, {
            method: "GET",
            headers: headers
        });

        if (!response.ok) {
            throw new SunoApiError(`Failed to fetch credits. Status: ${response.status}`, response.status);
        }

        const data = await response.json();
        // Return total_credits_left or fallback to 0
        return typeof data.total_credits_left === 'number' ? data.total_credits_left : 0;
    } catch (error) {
        console.error("Failed to get credits:", error);
        throw error;
    }
};

export const getSunoFeed = async (
    cookie: string, 
    limit: number = 20, 
    cursor: string | null = null, 
    searchText?: string
): Promise<any> => {
    if (!cookie) throw new Error("No cookie provided");

    const FEED_ENDPOINT = `https://studio-api.prod.suno.com/api/feed/v3`;

    try {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };

        const auth = normalizeSunoAuth(cookie);
        if (auth.bearerToken) {
            headers["Authorization"] = `Bearer ${auth.bearerToken}`;
        } else if (auth.cookie) {
            headers["Cookie"] = auth.cookie;
        } else {
            throw new Error("Invalid Suno token/cookie format");
        }

        const body: any = {
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

        const response = await fetch(FEED_ENDPOINT, {
            method: "POST",
            headers: headers,
            body: JSON.stringify(body),
        });

        if (response.status === 429) {
            throw new SunoApiError("429", 429);
        }

        if (!response.ok) {
            throw new SunoApiError(`Failed to fetch feed. Status: ${response.status}`, response.status);
        }

        return await response.json();
    } catch (error) {
        // console.error("Failed to get suno feed:", error);
        throw error;
    }
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
        })),
    };
};

export const getLyricAlignment = async (songId: string, cookie: string): Promise<LyricAlignmentResponse> => {
    if (!cookie) throw new Error("No cookie provided");

    const ENDPOINT = `https://studio-api.prod.suno.com/api/gen/${songId}/aligned_lyrics/v2`;

    try {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };

        const auth = normalizeSunoAuth(cookie);
        if (auth.bearerToken) {
            headers["Authorization"] = `Bearer ${auth.bearerToken}`;
        } else if (auth.cookie) {
            headers["Cookie"] = auth.cookie;
        } else {
            throw new Error("Invalid Suno token/cookie format");
        }

        const response = await fetch(ENDPOINT, {
            method: "GET",
            headers: headers
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch alignment. Status: ${response.status}`);
        }

        const data = await response.json();
        return data; // Expected to match LyricAlignmentResponse structure
    } catch (error) {
        console.error("Failed to get lyric alignment:", error);
        throw error;
    }
};

export const getSunoClip = async (clipId: string, cookie: string): Promise<any> => {
    if (!cookie) throw new Error("No cookie provided");

    const ENDPOINT = `https://studio-api.prod.suno.com/api/clip/${clipId}`;

    try {
        const headers: Record<string, string> = {
            "Content-Type": "application/json",
        };

        const auth = normalizeSunoAuth(cookie);
        if (auth.bearerToken) {
            headers["Authorization"] = `Bearer ${auth.bearerToken}`;
        } else if (auth.cookie) {
            headers["Cookie"] = auth.cookie;
        } else {
            throw new Error("Invalid Suno token/cookie format");
        }

        const response = await fetch(ENDPOINT, {
            method: "GET",
            headers: headers
        });

        if (!response.ok) {
            throw new Error(`Failed to fetch clip. Status: ${response.status}`);
        }

        return await response.json();
    } catch (error) {
        console.error("Failed to get suno clip:", error);
        throw error;
    }
};

export const triggerSunoGeneration = async (
  data: ParsedSunoOutput, 
  cookie: string,
  model: string = "chirp-bluejay"
): Promise<any> => {
  if (!cookie) {
    throw new Error("Suno Cookie/Token is missing.");
  }

  // Use the proxy endpoint to avoid CORS issues and manage headers
  const API_ENDPOINT = import.meta.env.VITE_SUNO_PROXY_URL || "/api/suno-proxy";
  
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
        // The proxy converts X-Suno-Cookie to Cookie header server-side.
        headers["X-Suno-Cookie"] = auth.cookie;
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
          // Fallback if not JSON
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

export const updateSunoMetadata = async (clipId: string, data: ParsedSunoOutput, cookie: string): Promise<any> => {
    if (!cookie) throw new Error("No cookie provided");

    // Point to the metadata proxy
    const PROXY_ENDPOINT = `https://studio-api.prod.suno.com/api/gen/${clipId}/set_metadata/`;
    
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
