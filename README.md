# Suno Architect - Auto Generate Suno Prompts
- Uses Gemini Flash 2.5 or 3.0 flash (which supports free keys, see [https://aistudio.google.com/api-keys](https://aistudio.google.com/api-keys))

## Attribution
- Forked from / based on [xiliourt/Suno-Architect](https://github.com/xiliourt/Suno-Architect)
- Web mastering integration incorporates/adapts ideas and components from [entrepeneur4lyf/Web-Audio-Mastering](https://github.com/entrepeneur4lyf/Web-Audio-Mastering) (ISC licensed)

## Featues

### Generation
- Generates
  - Song title
  - Suno style settings (weirdness %, style %, exclude, and male/female/none)
  - Lyrics including Suno style tags
  - JavaScript pastable into console on Suno create page (autofills everything)
  - Lyrics without tags, copy pastable for elsewhere. Also used via the API below to remove tags in displayed lyrics.
- **OPTIONAL:** Utilises Suno API
  - Requires an easily obtainable token (which may expire at times)
  - Adds a button to send directly to the Suno API
  - Saves ID in 'history' tab to display image(s), links to suno tracks, download buttons, song metadata (BPM, explicit, prompt details), etc
  - Support for pulling the timed lyrics from Suno
  - Support for conversion of timed lyrics JSON to LRC or SRT
  - NOTE: _For some reason the main generation API is cors locked, requiring the worker. The rest is direct via browser)_
- **OPTIONAL:** Use of files for prompts
  - Audio files for style influencing
  - Image files to influence lyrics vibe
  - PDF or text files to influence lore (background)
 
### LRC and SRT File Generation
- Pulls JSON word-by-word lyrics from Suno API
- Pulls lyics from Suno API
- Times word-time lyrics line-by-line, exportable as SRT or LRC

### Lyric Video Generation
- Pulls JSON word-by-word lyrics from Suno API for highlighting active word
- Pulls lyrics (prompt) from Suni API for line generation
- Live preview available with various settings
- Exportable to webm

### Library management
- Archive / restore tracks from the offline library. Archiving is non-destructive: metadata stays in
  IndexedDB and nothing is ever hard-deleted; Restore brings a track back as-is.
- Archived tracks have their cached audio/cover images evicted from the offline asset cache
  (`suno-architect-assets-v1`) to free space; the record itself is kept.
- Archived tracks are hidden from the library picker (and from the Library view's Active tab).
- "No longer on Suno" badge: a library sync flags tracks that have disappeared from your Suno feed
  instead of removing them. An empty-feed safety gate skips flagging when the feed returns zero clips
  (treated as a partial fetch failure), and archived tracks are never resurrected by a sync.
- Dedicated Library view (`?view=library`) with title/tag search, a tag filter, status filter tabs
  (All / Active / Archived / No longer on Suno), per-card Archive/Restore, and a storage usage panel
  (`navigator.storage.estimate()` usage/quota plus cached-asset count).
- History quota guard: `localStorage` history writes are size-checked; on overflow the oldest
  non-draft entries are trimmed (drafts are always kept) and history is mirrored into the IndexedDB
  library so nothing is lost.

### Publishing (dry-run)
- The YouTube/Facebook publish workflow in the Visualizer's Export tab is a dry-run preview stub.
  It is labelled as such in the UI and no upload happens; the worker endpoints are placeholders.

## Suno v6 & Bulk Playlist Backup
- v6 model family (`chirp-hawk` = V6, `chirp-hawk-wild` = V6 Wild, `chirp-goose` = V6 Mini) is
  mapped in the model picker. Full endpoint/model notes: [docs/SunoApiV6.md](docs/SunoApiV6.md).
- Auth is broker-based: harvest the Suno cookies from your local Brave profile, mint a fresh
  session JWT from the long-lived Clerk `__client` cookie, and cache both in `.suno-session/`.
  ```bash
  bun run suno:auth          # harvest Brave -> verify -> .suno-session/session.json + .env
  bun run suno:auth --refresh  # later runs, no browser needed
  bun run suno:login         # fallback: opens a browser for a manual login
  bun run suno:login --seed-brave --headless --close-on-auth   # fallback, no manual login
  ```
- Bulk playlist backup captures, per song: title, Suno style (+ full style prompt), lyrics,
  generation options/sliders, play count, model/version, duration, media URLs.
  ```bash
  bun run suno:backup --list                         # playlist inventory
  bun run suno:backup                                # every owned playlist
  bun run suno:backup --playlist=<id|url> --out=./output/mine
  ```
  Output: `playlists.json` + `tracks.csv`.

### Local dev (`bun run dev`)
- Vite serves the frontend only; the Cloudflare worker (`/api/suno-proxy`) exists in production.
  In dev a Vite middleware forwards `/api/suno-proxy` to Suno's generate endpoint, falling back to
  `SUNO_TOKEN` / `SUNO_COOKIE` from `.env`.
- Every other Suno call (feed, credits, playlists, clips) goes straight from the browser, so the app
  needs a bearer token. `bun run dev:authed` (= `suno:auth` + `vite`) exposes it at `/__suno/session`
  and the app adopts it on boot — no more pasting a token into Settings.
- Tokens last ~1 hour. When it lapses the app warns in the console and falls back to a saved token:
  run `bun run suno:auth --refresh` (no browser needed) and reload.
- The dev bridge overrides any token previously pasted into Settings — a stale `suno_cookie` in
  `localStorage` used to shadow it and show "SUNO LOST" permanently. To clear one by hand:
  `localStorage.removeItem('suno_cookie')` then hard-reload.
- Library/auth endpoints (`/api/...`) need the Worker; run `bunx wrangler dev` (port 8787) alongside
  Vite if you want them locally, otherwise expect `ECONNREFUSED 127.0.0.1:8787` in the Vite log.
- Browse `http://localhost:<port>` — studio-api's CORS reflects `localhost` but **not** `127.0.0.1`.

## Testing
- `bun run test` — vitest unit tests (node environment, `fake-indexeddb`): `offlineDb`,
  `offlineSyncService`, `lyrics`, `visualizer`, `historyStorage`.
- `bun run test:e2e` — Playwright specs in `tests/e2e/`. Starts the Vite dev server on
  `127.0.0.1:4173` with `VITE_DISABLE_AUTH=true` automatically (reuses one if already running).

## Deploy with Cloudflare
[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/xiliourt/Suno-Architect/)
- Requires the worker to forward Suno generation requests and avoid cors issues, all other API end points seem to work fine.

## Authentication & Access Control
- The worker now protects `/api/suno-proxy` behind app authentication.
- Auth endpoints:
  - `POST /api/auth/register`
  - `POST /api/auth/login`
  - `POST /api/auth/logout`
  - `GET /api/auth/me`
- Sessions are persisted in SQLite when a D1 `DB` binding is present.
- If no `DB` binding exists, the worker uses in-memory user/session storage (non-persistent).

### Recommended production setup
1. Bind a D1 database as `DB` in Wrangler.
2. Serve the app behind HTTPS.
3. Keep `VITE_SUNO_PROXY_URL=/api/suno-proxy` so proxy calls stay on your protected domain.

## Credits
- [https://github.com/gcui-art/suno-api/](https://github.com/gcui-art/suno-api/) has reverse engineered most of the API already, so I didn't need to do it myself. Only took some tweaking, none of the code is directly use but it sure helped speeding up understanding the API. Also has interfaces and types to know what response to expect from the API - very helpful.
- [https://github.com/entrepeneur4lyf/Web-Audio-Mastering](https://github.com/entrepeneur4lyf/Web-Audio-Mastering) for the web mastering pipeline/DSP/UI foundation integrated into the native mastering workflow (ISC).
