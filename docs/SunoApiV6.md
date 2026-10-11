# Suno v6 API notes

Investigated 2026-09-27 against the live `studio-api.prod.suno.com` endpoints, the
Suno web bundle, and a real account. Sources are noted so the claims can be
re-checked after a Suno deploy.

## 1. v6 model family

[Release notes, 2026-09-09](https://suno.com/release-notes/introducing-v6) introduced
three models: `v6` (flagship), `v6-wild` (experimental), `v6-mini` (fast/free).

Model ids live in Suno's own web bundle (`/_next/static/immutable/chunks/*.js`,
array `["chirp-goose","chirp-hawk","chirp-hawk-wild"]` for the custom-model bases)
and are echoed back on clips as `model_name` / `major_model_version`:

| Display | `model_name` (`mv`) | Clip `major_model_version` |
| --- | --- | --- |
| V6 | `chirp-hawk` | `v6` |
| V6 Wild | `chirp-hawk-wild` | `v6` |
| V6 Mini | `chirp-goose` | `v6` |
| V5.5 / V5.5 Remaster | `chirp-fenix` / `chirp-flounder` | `v5.5` |
| V5 / V5 Remaster | `chirp-crow` / `chirp-carp` | `v5` |
| V4.5+ / V4.5 / V4.5 Turbo | `chirp-bluejay` / `chirp-auk` / `chirp-auk-turbo` | `v4.5` |

`src/constants.ts` (`SUNO_MODEL_MAPPINGS`) carries this list.

### What did *not* change

- Generation is still `POST /api/generate/v2-web/` with `mv` for the model and
  `metadata.control_sliders` + `can_control_sliders` for weirdness/style/audio weights.
  v6 adds tasks (`mashup_condition`, `sample_condition`, `vox`, `midi_condition`,
  `infill` variants) and `metadata.is_max_mode`, `metadata.is_mumble`,
  `metadata.create_session_token`, `metadata.user_tier`.
- Cover/remix clips still carry `task: "cover"`, `cover_clip_id`, `metadata.is_remix`.
- `mv` values below v6 are still accepted by the API for older library items, but
  only v6 models are offered in the create form.

## 2. Endpoints used by this project

| Method | Path | Auth | Notes |
| --- | --- | --- | --- |
| GET | `/api/billing/info/` | required | credits live in `credits` (`total_credits_left` is gone) |
| GET | `/api/session/` | required | user profile blob |
| GET | `/api/user/me` | required | `handle`, `display_name`, `user_id` |
| POST | `/api/feed/v3` | required | library feed, `filters` object unchanged |
| GET | `/api/playlist/me?page=N` | required | owned playlists, 12 per page, `num_total_results` is the total |
| GET | `/api/playlist/{id}?page=N` | optional | works for public playlists without auth; page size is at least 100 |
| GET | `/api/clip/{id}` | required | single clip |
| GET | `/api/gen/{id}/aligned_lyrics/v2` | required | word-level alignment |

`play_count` is a first-class numeric field on clips (and on the playlist envelope,
where Suno currently always reports `0`, so totals must be summed from clips).

Style and lyrics are **not** top-level clip fields:

- `display_tags` – short public style string (e.g. `art pop, minimalist`)
- `metadata.tags` – full style prompt
- `metadata.prompt` – lyrics (with `[Section]` tags)
- `metadata.control_sliders` – `weirdness_constraint`, `style_weight`, `audio_weight`, `aug_creativity`
- `metadata.make_instrumental`, `metadata.task`, `metadata.vox_render_mode`, `metadata.is_mumble`
- `audio_url` returns `https://studio-api.prod.suno.com/api/forbidden`; playable/downloadable
  links are in `media_urls[]` (`url`, `content_type`, e.g. `m4a-opus`)

## 3. Authentication

Three credentials, in increasing lifetime:

| Credential | Where | Lifetime |
| --- | --- | --- |
| Clerk session JWT (`__session`) | `.suno.com`, `suno.com` | 1 hour — this is the studio-api bearer token |
| Clerk client JWT (`__client`) | `auth.suno.com` | ~1 year |
| Brave cookie database | local profile | as long as the profile lives |

`studio-api` requires `Authorization: Bearer <session JWT>`; a bare
`Cookie: __session=...` header is rejected (401).

`POST https://auth.suno.com/v1/client/sessions/{session_id}/tokens?_clerk_js_version=5.x`
with `Cookie: __client=<client JWT>` returns a fresh `{"jwt": "..."}`.
`GET https://auth.suno.com/v1/client` returns the client's sessions and the
last-active token, which is how the session id is discovered without parsing `__session`.

### Brave cookie harvesting (`scripts/lib/braveCookies.ts`)

Flatpak Brave stores cookies in
`~/.var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser/Default/Cookies`.
Values are OSCrypt `v11` envelopes: `"v11" || header(16) || iv(16) || AES-128-CBC(...)`,
where the key is `PBKDF2-HMAC-SHA1(secret, "saltysalt", 1, 16)` and `secret` is the
login-keyring entry `secret-tool lookup application brave` (Brave Safe Storage).
Legacy fixed-IV layouts are probed as fallbacks.

### CLI

```bash
bun run suno:auth                 # harvest Brave -> mint -> verify -> .suno-session/session.json + .env
bun run suno:auth --refresh       # re-mint from the stored Clerk client token (no browser needed)
bun run suno:auth --token=<jwt>   # paste a token (see the console snippet below)
bun run suno:auth --print-token   # piped output
bun run suno:login                # Playwright: manual login (opens a browser window)
bun run suno:login --seed-brave --headless --close-on-auth
                                  # Playwright seeded from Brave cookies, no manual login
```

### Browser-side fallback

`window.Clerk` is **not exposed** on suno.com - the Clerk Next.js integration keeps it
internal, so `await window.Clerk.session.getToken()` returns `undefined`
(verified in Chromium: `typeof window.Clerk === "undefined"`).

The `__session` cookie, however, is deliberately *not* httpOnly
(`is_httponly = 0` in Brave's cookie DB), so the page can read the token directly.
Verified from inside suno.com: the value returned below is accepted as a bearer token
by `/api/billing/info/` (200) and `/api/playlist/me` (200):

```js
(async () => {
  const jwt = /(?:^|; )__session=([^;]+)/.exec(document.cookie)?.[1];
  if (!jwt) return console.error("No __session cookie - log in at suno.com first.");
  console.log(jwt);
  const check = await fetch("https://studio-api.prod.suno.com/api/billing/info/", {
    headers: { Authorization: `Bearer ${jwt}` },
  });
  console.log(check.status, await check.json());  // 200 {"credits": ...}
  await navigator.clipboard?.writeText(jwt);
})();
```

The `__client` cookie (the long-lived refresh token) stays httpOnly on `auth.suno.com`
and is not reachable from the page - only from the profile on disk, which is what
`bun run suno:auth` automates.

### Dev server integration

`bun run dev` (Vite) serves the frontend only — the Worker's `/api/suno-proxy` route does not
exist locally. The dev config compensates in two places:

1. `sunoDevProxyPlugin` forwards `POST /api/suno-proxy` to Suno's generate endpoint, falling back to
   `SUNO_TOKEN` / `SUNO_COOKIE` loaded from `.env` (non-`VITE_` vars are read by `loadEnv(mode, cwd, '')`,
   so `bun run suno:auth` keeps that path working).
2. `GET /__suno/session` returns the CLI-managed session from `.suno-session/session.json`
   (token, handle, credits, `expiresAt`, `expired`). It is **serve-only** (`apply: 'serve'`, so it is
   absent from production builds) and **loopback-only**, because it hands out a live credential.
   `src/App.tsx` fetches it on boot whenever `import.meta.env.DEV` is set, and treats it as
   authoritative: the bridge token is written over any previously pasted `suno_cookie`, so a stale
   token left in `localStorage` can no longer shadow it and pin the header to "SUNO LOST". The
   verify interval (60 s) re-reads the bridge too, so a token that lapses mid-session self-heals
   instead of staying lost. If the bridge is unavailable (404, expired, or `vite preview`), the app
   falls back to the saved token.

All other Suno calls (feed, credits, playlists, clips) go directly from the browser, which is why a
bearer token is required in the app at all. Two dev caveats:

- Tokens expire after an hour; the app logs `[suno] dev session missing or expired` and falls back to
  a saved token. Rerun `bun run suno:auth --refresh` and reload.
- studio-api's CORS reflects `http://localhost:<port>` but not `http://127.0.0.1:<port>`
  (verified via preflight), so use the `localhost` URL Vite prints.

## 4. Bulk playlist backup

```bash
bun run suno:backup                              # every owned playlist
bun run suno:backup --list                       # inventory only
bun run suno:backup --playlist=<id|url>          # one or more playlists
bun run suno:backup --out=./output/suno-backups  # destination
```

Writes `playlists.json` (full fidelity) and `tracks.csv` (one row per song) with:
title, style + full style prompt, lyrics, generation options/sliders, play count,
upvote count, model + version, duration, media/download URLs, visibility flags and
the ids needed to re-link songs (`clip_id`, `cover_clip_id`, `edited_clip_id`).

## 5. Known gaps

- Playlist **cover art, ordering metadata and the "liked songs" pseudo-playlist**
  are not backed up; ordering is preserved via the `position` column only.
- Exclude-styles / negative tags are not exposed on existing clips by studio-api,
  so they cannot be recovered from a library; only `metadata.tags` (positive style) is.
- The app's generation payload does not model v6-only tasks (mashup, infill, vox,
  sample) — v6 works, but only for the `TEXT` + `cover` paths the UI exposes.
- `chirp-dorado`, `chirp-haddock`, `chirp-halibut` and `chirp-ibis` appear in the
  bundle but are not selectable in the create form, so they are not mapped.
