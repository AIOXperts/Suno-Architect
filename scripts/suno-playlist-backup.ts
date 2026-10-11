#!/usr/bin/env bun
/**
 * Bulk Suno playlist backup.
 *
 *   bun run suno:backup                        # every owned playlist
 *   bun run suno:backup --list                 # just list playlists
 *   bun run suno:backup --playlist=<id|url>    # one playlist (repeatable / comma separated)
 *   bun run suno:backup --out=./output/mine    # destination directory
 *
 * Per song it captures title, style (+ full style prompt), lyrics, generation
 * options/sliders and play count. Writes playlists.json and tracks.csv.
 */
import { createSunoPlaylistBackup, backupTracksToCsv, type SunoBackupBundle } from "../src/services/sunoBackup";
import { getAllSunoMyPlaylists } from "../src/services/sunoApi";
import { resolveSunoToken } from "./lib/sunoSession";
import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

interface CliArgs {
    playlistIds: string[];
    outDir?: string;
    includeTrashed: boolean;
    listOnly: boolean;
    help: boolean;
}

const USAGE = `Usage: bun run suno:backup [options]

Options:
  --playlist=<id|url>   Back up only these playlists (repeatable or comma separated)
  --out=<dir>           Output directory (default: ./output/suno-backups/<timestamp>)
  --include-trashed     Include trashed playlists
  --list                Print the playlist inventory and exit
  -h, --help            Show this help
`;

const parseArgs = (argv: string[]): CliArgs => {
    const args: CliArgs = { playlistIds: [], includeTrashed: false, listOnly: false, help: false };

    for (const arg of argv) {
        if (arg === "--include-trashed") args.includeTrashed = true;
        else if (arg === "--list") args.listOnly = true;
        else if (arg === "--help" || arg === "-h") args.help = true;
        else if (arg.startsWith("--out=")) args.outDir = arg.slice("--out=".length);
        else if (arg.startsWith("--playlist=")) {
            for (const id of arg.slice("--playlist=".length).split(",")) {
                const trimmed = id.trim();
                if (trimmed) args.playlistIds.push(trimmed);
            }
        }
    }

    return args;
};

const formatSeconds = (seconds: number): string => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    return hours > 0 ? `${hours}h${String(minutes).padStart(2, "0")}m` : `${minutes}m`;
};

const printInventory = (playlists: { id: string; name: string; song_count: number; play_count: number; is_public: boolean }[]): void => {
    const nameWidth = Math.max(...playlists.map((p) => p.name.length), 4);
    for (const playlist of playlists) {
        const visibility = playlist.is_public ? "public" : "private";
        process.stdout.write(
            `  ${playlist.name.padEnd(nameWidth)}  ${String(playlist.song_count).padStart(3)} songs  ` +
            `${String(playlist.play_count).padStart(6)} plays  ${visibility}  ${playlist.id}\n`
        );
    }
    process.stdout.write(`  ${playlists.length} playlists\n`);
};

const printSummary = (bundle: SunoBackupBundle): void => {
    process.stdout.write("\nBackup summary\n");
    for (const playlist of bundle.playlists) {
        const duration = playlist.totalDurationSec ?? 0;
        process.stdout.write(
            `  ${playlist.name}: ${playlist.tracks.length} songs, ${playlist.playCount} plays, ${formatSeconds(duration)}\n`
        );
    }
    process.stdout.write(
        `  TOTAL: ${bundle.totals.playlists} playlists, ${bundle.totals.tracks} songs, ` +
        `${bundle.totals.playCount} plays, ${formatSeconds(bundle.totals.durationSec)}\n`
    );
};

const main = async (): Promise<number> => {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        process.stdout.write(USAGE);
        return 0;
    }

    const { token, session } = await resolveSunoToken({ verbose: true });
    process.stdout.write(`Suno account: ${session.userHandle ?? "unknown"} (${session.credits ?? "?"} credits)\n`);

    if (args.listOnly) {
        const playlists = await getAllSunoMyPlaylists(token, { includeTrashed: args.includeTrashed });
        printInventory(playlists);
        return 0;
    }

    const bundle = await createSunoPlaylistBackup(token, {
        playlistIds: args.playlistIds.length ? args.playlistIds : undefined,
        includeTrashed: args.includeTrashed,
        onProgress: (event) => {
            if (event.phase === "clips" && event.playlistIndex && event.playlistCount) {
                process.stdout.write(`  [${event.playlistIndex}/${event.playlistCount}] ${event.message}\n`);
            }
        },
    });

    const stamp = bundle.generatedAt.replace(/[:.]/g, "-");
    const outDir = resolve(args.outDir ?? `output/suno-backups/${stamp}`);
    mkdirSync(outDir, { recursive: true });

    const jsonPath = resolve(outDir, "playlists.json");
    const csvPath = resolve(outDir, "tracks.csv");
    writeFileSync(jsonPath, `${JSON.stringify(bundle, null, 2)}\n`, "utf8");
    writeFileSync(csvPath, backupTracksToCsv(bundle), "utf8");

    printSummary(bundle);
    process.stdout.write(`\nWrote ${jsonPath}\nWrote ${csvPath}\n`);
    return 0;
};

main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
        console.error(`suno:backup failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    });
