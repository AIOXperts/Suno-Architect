import {
    extractSunoPlaylistId,
    getAllSunoMyPlaylists,
    getAllSunoPlaylistClips,
    getSunoPlaylistPage,
    SunoPlaylistClipRecord,
    SunoPlaylistDetail,
    SunoPlaylistSummary,
} from './sunoApi';

/**
 * Bulk playlist backup for Suno v6 libraries.
 *
 * Captures, per song: title, style (display + full style prompt), lyrics,
 * generation options/sliders and play count - plus the identifiers needed to
 * re-link the song later (clip id, playlist id, cover/remix parents).
 */

export interface SunoBackupOptions {
    /** Restrict the backup to these playlist ids/URLs. Defaults to every owned playlist. */
    playlistIds?: string[];
    includeTrashed?: boolean;
    onProgress?: (event: SunoBackupProgress) => void;
}

export interface SunoBackupProgress {
    phase: 'playlists' | 'clips' | 'done';
    message: string;
    playlistIndex?: number;
    playlistCount?: number;
    clipCount?: number;
}

export interface SunoBackupOptionsSnapshot {
    makeInstrumental: boolean | null;
    task: string | null;
    type: string | null;
    sliders: Record<string, number>;
    weirdness: number | null;
    styleWeight: number | null;
    audioWeight: number | null;
    augCreativity: number | null;
    voxRenderMode: string | null;
    isMumble: boolean | null;
    usesLatestModel: boolean | null;
    isRemix: boolean | null;
    coverClipId: string | null;
    editedClipId: string | null;
    hasVocal: boolean | null;
}

export interface SunoBackupMedia {
    url: string;
    contentType: string | null;
    delivery: string | null;
    encoding: string | null;
}

export interface SunoBackupTrack {
    playlistId: string;
    playlistName: string;
    playlistIndex: number;
    position: number;
    clipId: string;
    title: string;
    createdAt: string;
    modelName: string | null;
    modelVersion: string | null;
    playCount: number;
    upvoteCount: number;
    style: string;
    stylePrompt: string;
    lyrics: string;
    durationSec: number | null;
    options: SunoBackupOptionsSnapshot;
    audioUrl: string | null;
    videoUrl: string | null;
    imageUrl: string | null;
    mediaUrls: SunoBackupMedia[];
    isPublic: boolean;
    isTrashed: boolean;
    explicit: boolean;
    status: string | null;
}

export interface SunoBackupPlaylist {
    id: string;
    name: string;
    description: string | null;
    imageUrl: string | null;
    handle: string | null;
    songCount: number;
    totalDurationSec: number | null;
    playCount: number;
    isPublic: boolean;
    isTrashed: boolean;
    tracks: SunoBackupTrack[];
}

export interface SunoBackupBundle {
    generatedAt: string;
    source: 'suno-studio-api';
    totals: {
        playlists: number;
        tracks: number;
        playCount: number;
        durationSec: number;
    };
    playlists: SunoBackupPlaylist[];
}

type SliderSource = Record<string, number> | undefined;

const asString = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null);
const asNumber = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null);
const asBoolean = (value: unknown): boolean | null => (typeof value === 'boolean' ? value : null);

const readSlider = (sliders: SliderSource, key: string): number | null => asNumber(sliders?.[key]);

export const extractBackupOptions = (clip: SunoPlaylistClipRecord): SunoBackupOptionsSnapshot => {
    const metadata = clip.metadata ?? {};
    const sliders: Record<string, number> = {};
    for (const [key, value] of Object.entries(metadata.control_sliders ?? {})) {
        if (typeof value === 'number' && Number.isFinite(value)) sliders[key] = value;
    }

    return {
        makeInstrumental: asBoolean(metadata.make_instrumental),
        task: asString(metadata.task),
        type: asString(metadata.type),
        sliders,
        weirdness: readSlider(sliders, 'weirdness_constraint'),
        styleWeight: readSlider(sliders, 'style_weight'),
        audioWeight: readSlider(sliders, 'audio_weight'),
        augCreativity: readSlider(sliders, 'aug_creativity'),
        voxRenderMode: asString(metadata.vox_render_mode),
        isMumble: asBoolean(metadata.is_mumble),
        usesLatestModel: asBoolean(metadata.uses_latest_model),
        isRemix: asBoolean(metadata.is_remix),
        coverClipId: asString(metadata.cover_clip_id),
        editedClipId: asString(metadata.edited_clip_id),
        hasVocal: asBoolean(metadata.has_vocal),
    };
};

const readMediaUrls = (clip: SunoPlaylistClipRecord): SunoBackupMedia[] => {
    const entries = Array.isArray(clip.media_urls) ? clip.media_urls : [];
    return entries.flatMap((entry): SunoBackupMedia[] => {
        const url = asString(entry?.url);
        if (!url) return [];
        return [{
            url,
            contentType: asString(entry.content_type),
            delivery: asString(entry.delivery),
            encoding: asString(entry.encoding),
        }];
    });
};

export const buildBackupTrack = (
    playlist: { id: string; name: string },
    clip: SunoPlaylistClipRecord,
    position: number
): SunoBackupTrack => {
    const stylePrompt = asString(clip.metadata?.tags) ?? '';

    return {
        playlistId: playlist.id,
        playlistName: playlist.name,
        playlistIndex: -1,
        position,
        clipId: clip.id,
        title: clip.title ?? '',
        createdAt: clip.created_at ?? '',
        modelName: asString(clip.model_name),
        modelVersion: asString(clip.major_model_version),
        playCount: asNumber(clip.play_count) ?? 0,
        upvoteCount: asNumber(clip.upvote_count) ?? 0,
        style: asString(clip.display_tags) ?? stylePrompt,
        stylePrompt,
        lyrics: asString(clip.metadata?.prompt) ?? '',
        durationSec: asNumber(clip.metadata?.duration),
        options: extractBackupOptions(clip),
        audioUrl: asString(clip.audio_url),
        videoUrl: asString(clip.video_url),
        imageUrl: asString(clip.image_large_url ?? clip.image_url),
        mediaUrls: readMediaUrls(clip),
        isPublic: clip.is_public === true,
        isTrashed: clip.is_trashed === true,
        explicit: clip.explicit === true,
        status: asString(clip.status),
    };
};

export const buildPlaylistBackup = (detail: SunoPlaylistDetail, clips: SunoPlaylistClipRecord[]): SunoBackupPlaylist => {
    const meta = { id: detail.id, name: detail.name ?? detail.id };
    const tracks = clips.map((clip, index) => {
        const track = buildBackupTrack(meta, clip, index + 1);
        return track;
    });

    // studio-api reports playlist-level play_count as 0, so sum the clips when it is unset.
    const reportedPlayCount = asNumber(detail.play_count) ?? 0;
    const summedPlayCount = tracks.reduce((sum, track) => sum + track.playCount, 0);
    const reportedDuration = asNumber(detail.total_duration) ?? 0;
    const summedDuration = tracks.reduce((sum, track) => sum + (track.durationSec ?? 0), 0);

    return {
        id: detail.id,
        name: detail.name ?? detail.id,
        description: asString(detail.description),
        imageUrl: asString(detail.image_url),
        handle: asString(detail.user_handle),
        songCount: asNumber(detail.song_count) ?? tracks.length,
        totalDurationSec: reportedDuration > 0 ? reportedDuration : summedDuration,
        playCount: reportedPlayCount > 0 ? reportedPlayCount : summedPlayCount,
        isPublic: detail.is_public === true,
        isTrashed: detail.is_trashed === true,
        tracks,
    };
};

const summarize = (playlists: SunoBackupPlaylist[]): SunoBackupBundle['totals'] => {
    const totals = { playlists: playlists.length, tracks: 0, playCount: 0, durationSec: 0 };
    for (const playlist of playlists) {
        totals.tracks += playlist.tracks.length;
        for (const track of playlist.tracks) {
            totals.playCount += track.playCount;
            totals.durationSec += track.durationSec ?? 0;
        }
    }
    return totals;
};

export const createSunoPlaylistBackup = async (
    cookie: string,
    options?: SunoBackupOptions
): Promise<SunoBackupBundle> => {
    const report = options?.onProgress;

    let targets: SunoPlaylistSummary[] | { id: string; name: string }[];
    if (options?.playlistIds?.length) {
        targets = options.playlistIds.map((input) => {
            const id = extractSunoPlaylistId(input) ?? input;
            return { id, name: id };
        });
    } else {
        report?.({ phase: 'playlists', message: 'Fetching playlist list' });
        targets = await getAllSunoMyPlaylists(cookie, { includeTrashed: options?.includeTrashed });
    }

    const playlists: SunoBackupPlaylist[] = [];
    let index = 0;

    for (const target of targets) {
        index += 1;
        report?.({
            phase: 'clips',
            message: `Fetching ${target.name}`,
            playlistIndex: index,
            playlistCount: targets.length,
        });

        const detail = await getSunoPlaylistPage(target.id, cookie);
        const clips = await getAllSunoPlaylistClips(target.id, cookie);
        const backup = buildPlaylistBackup(
            { ...detail, id: target.id, name: detail.name ?? target.name },
            clips
        );
        backup.tracks.forEach((track) => { track.playlistIndex = index; });
        playlists.push(backup);

        report?.({
            phase: 'clips',
            message: `${backup.name}: ${backup.tracks.length} songs`,
            playlistIndex: index,
            playlistCount: targets.length,
            clipCount: backup.tracks.length,
        });
    }

    report?.({ phase: 'done', message: `Backed up ${playlists.length} playlists` });

    return {
        generatedAt: new Date().toISOString(),
        source: 'suno-studio-api',
        totals: summarize(playlists),
        playlists,
    };
};

export const SUNO_BACKUP_CSV_COLUMNS = [
    'playlist_id',
    'playlist_name',
    'playlist_index',
    'position',
    'clip_id',
    'title',
    'created_at',
    'model_name',
    'model_version',
    'play_count',
    'upvote_count',
    'style',
    'style_prompt',
    'lyrics',
    'duration_sec',
    'make_instrumental',
    'task',
    'weirdness',
    'style_weight',
    'audio_weight',
    'aug_creativity',
    'sliders_json',
    'vox_render_mode',
    'is_mumble',
    'uses_latest_model',
    'is_remix',
    'cover_clip_id',
    'edited_clip_id',
    'has_vocal',
    'audio_url',
    'audio_download_url',
    'video_url',
    'image_url',
    'is_public',
    'is_trashed',
    'explicit',
    'status',
] as const;

const csvCell = (value: unknown): string => {
    if (value === null || value === undefined) return '';
    const text = typeof value === 'string' ? value : String(value);
    return /[",\r\n]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
};

const csvRow = (track: SunoBackupTrack): string => {
    const options = track.options;
    return [
        track.playlistId,
        track.playlistName,
        track.playlistIndex,
        track.position,
        track.clipId,
        track.title,
        track.createdAt,
        track.modelName,
        track.modelVersion,
        track.playCount,
        track.upvoteCount,
        track.style,
        track.stylePrompt,
        track.lyrics,
        track.durationSec,
        options.makeInstrumental,
        options.task,
        options.weirdness,
        options.styleWeight,
        options.audioWeight,
        options.augCreativity,
        JSON.stringify(options.sliders),
        options.voxRenderMode,
        options.isMumble,
        options.usesLatestModel,
        options.isRemix,
        options.coverClipId,
        options.editedClipId,
        options.hasVocal,
        track.audioUrl,
        track.mediaUrls[0]?.url ?? null,
        track.videoUrl,
        track.imageUrl,
        track.isPublic,
        track.isTrashed,
        track.explicit,
        track.status,
    ].map(csvCell).join(',');
};

/** RFC 4180 CSV of every backed-up track; lyrics keep their line breaks inside quotes. */
export const backupTracksToCsv = (bundle: SunoBackupBundle): string => {
    const header = SUNO_BACKUP_CSV_COLUMNS.join(',');
    const rows: string[] = [header];
    for (const playlist of bundle.playlists) {
        for (const track of playlist.tracks) rows.push(csvRow(track));
    }
    return `${rows.join('\n')}\n`;
};
