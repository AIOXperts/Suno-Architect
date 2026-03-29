interface Env {
  ASSETS: { fetch: (request: Request) => Promise<Response> };
  DB?: {
    exec: (query: string) => Promise<unknown>;
    prepare: (query: string) => {
      bind: (...args: unknown[]) => {
        first: <T = unknown>() => Promise<T | null>;
        run: () => Promise<unknown>;
        all: <T = unknown>() => Promise<{ results: T[] }>;
      };
    };
  };
  suno_architect_auth?: {
    exec: (query: string) => Promise<unknown>;
    prepare: (query: string) => {
      bind: (...args: unknown[]) => {
        first: <T = unknown>() => Promise<T | null>;
        run: () => Promise<unknown>;
        all: <T = unknown>() => Promise<{ results: T[] }>;
      };
    };
  };
  ALLOW_REGISTRATION?: string;
  ALLOWED_ORIGINS?: string;
  KEY_ENCRYPTION_SECRET?: string;
  DISABLE_AUTH?: string;
}

type MemoryUser = {
  id: number;
  email: string;
  password_hash: string;
  salt: string;
  role: "user" | "admin";
  created_at: string;
};

type MemorySession = {
  token_hash: string;
  user_id: number;
  expires_at: string;
  created_at: string;
};

type ProviderType = "gemini" | "openrouter" | "openapi";

type MemoryApiKey = {
  user_id: number;
  provider_type: ProviderType;
  encrypted_key: string;
  iv: string;
  updated_at: string;
};

type MemoryAlbum = {
  id: number;
  user_id: number;
  name: string;
  description: string | null;
  created_at: string;
  updated_at: string;
};

type MemoryAlbumSong = {
  album_id: number;
  song_id: string;
  title: string | null;
  added_at: string;
  sort_order: number;
};

const memoryUsers = new Map<string, MemoryUser>();
const memorySessions = new Map<string, MemorySession>();
const memoryApiKeys = new Map<string, MemoryApiKey>();
const memoryAlbums = new Map<number, MemoryAlbum>();
const memoryAlbumSongs = new Map<string, MemoryAlbumSong>();
const memorySongTags = new Map<string, Set<string>>();
let memoryUserSeq = 1;
let memoryAlbumSeq = 1;
let schemaReady = false;

const SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 30;
const PBKDF2_ITERATIONS = 100_000;
type RateBucket = { count: number; resetAt: number };
const rateBuckets = new Map<string, RateBucket>();

const SESSION_COOKIE_NAME = "sa_session";
const AUTH_BYPASS_USER: MemoryUser = {
  id: -1,
  email: "auth-bypass@local",
  password_hash: "",
  salt: "",
  role: "admin",
  created_at: new Date(0).toISOString(),
};

function isAuthDisabled(env: Env): boolean {
  return String(env.DISABLE_AUTH || "").toLowerCase() === "true";
}

function buildCorsHeaders(request: Request, env: Env): Record<string, string> {
  const origin = request.headers.get("Origin");
  const url = new URL(request.url);
  const defaultAllowed = `${url.protocol}//${url.host}`;
  const allowedOrigins = (env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((v) => v.trim())
    .filter(Boolean);

  let allowOrigin = "*";
  if (origin) {
    if (allowedOrigins.length > 0) {
      allowOrigin = allowedOrigins.includes(origin) ? origin : "null";
    } else {
      allowOrigin = origin === defaultAllowed ? origin : "null";
    }
  }

  return {
    "Access-Control-Allow-Origin": allowOrigin,
    "Access-Control-Allow-Headers": "Content-Type, Authorization, X-Suno-Cookie, X-App-Auth",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin",
  };
}

const json = (request: Request, env: Env, data: unknown, status = 200, extraHeaders: Record<string, string> = {}) =>
  new Response(JSON.stringify(data), {
    status,
    headers: { "Content-Type": "application/json", ...buildCorsHeaders(request, env), ...extraHeaders },
  });

function normalizeEmail(email: string): string {
  return email.trim().toLowerCase();
}

function getClientIp(request: Request): string {
  return request.headers.get("CF-Connecting-IP") || "unknown";
}

function isRateLimited(request: Request, key: string, limit: number, windowMs: number): boolean {
  const ip = getClientIp(request);
  const k = `${key}:${ip}`;
  const now = Date.now();
  const bucket = rateBuckets.get(k);
  if (!bucket || now > bucket.resetAt) {
    rateBuckets.set(k, { count: 1, resetAt: now + windowMs });
    return false;
  }
  bucket.count += 1;
  rateBuckets.set(k, bucket);
  return bucket.count > limit;
}

function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}

function isValidPassword(password: string): boolean {
  return password.length >= 8;
}

function toHex(buffer: ArrayBuffer): string {
  return Array.from(new Uint8Array(buffer))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

function fromHex(hex: string): Uint8Array {
  const out = new Uint8Array(hex.length / 2);
  for (let i = 0; i < out.length; i++) {
    out[i] = parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

async function sha256Hex(input: string): Promise<string> {
  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(input));
  return toHex(digest);
}

function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function randomHex(bytes = 32): string {
  const arr = new Uint8Array(bytes);
  crypto.getRandomValues(arr);
  return toHex(arr.buffer);
}

async function pbkdf2Hash(password: string, saltHex: string): Promise<string> {
  const iterations = Math.min(PBKDF2_ITERATIONS, 100_000);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "PBKDF2" },
    false,
    ["deriveBits"]
  );
  const bits = await crypto.subtle.deriveBits(
    {
      name: "PBKDF2",
      hash: "SHA-256",
      salt: fromHex(saltHex),
      iterations,
    },
    key,
    256
  );
  return toHex(bits);
}

let encryptionKeyCache: CryptoKey | null = null;
let encryptionKeySecret: string | null = null;

async function getEncryptionKey(env: Env): Promise<CryptoKey> {
  const secret = (env.KEY_ENCRYPTION_SECRET || "").trim();
  if (!secret) {
    throw new Error("Server key vault unavailable: KEY_ENCRYPTION_SECRET is not configured.");
  }

  if (encryptionKeyCache && encryptionKeySecret === secret) return encryptionKeyCache;

  const enc = new TextEncoder();
  const digest = await crypto.subtle.digest("SHA-256", enc.encode(secret));
  encryptionKeyCache = await crypto.subtle.importKey(
    "raw",
    digest,
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"]
  );
  encryptionKeySecret = secret;
  return encryptionKeyCache;
}

async function encryptApiKey(env: Env, plainText: string): Promise<{ encrypted: string; iv: string }> {
  const key = await getEncryptionKey(env);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const enc = new TextEncoder();
  const cipherBuffer = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    enc.encode(plainText)
  );
  return {
    encrypted: bytesToBase64(new Uint8Array(cipherBuffer)),
    iv: bytesToBase64(iv),
  };
}

async function decryptApiKey(env: Env, encrypted: string, iv: string): Promise<string> {
  const key = await getEncryptionKey(env);
  const plainBuffer = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: base64ToBytes(iv) },
    key,
    base64ToBytes(encrypted)
  );
  return new TextDecoder().decode(plainBuffer);
}

function getDb(env: Env): NonNullable<Env["DB"]> | NonNullable<Env["suno_architect_auth"]> | undefined {
  return env.DB || env.suno_architect_auth;
}

async function ensureSchema(env: Env): Promise<void> {
  const db = getDb(env);
  if (!db || schemaReady) return;
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS users (id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL UNIQUE, password_hash TEXT NOT NULL, salt TEXT NOT NULL, role TEXT NOT NULL DEFAULT 'user', created_at TEXT NOT NULL)"
  ).bind().run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS sessions (token_hash TEXT PRIMARY KEY, user_id INTEGER NOT NULL, expires_at TEXT NOT NULL, created_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
  ).bind().run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_sessions_user_id ON sessions(user_id)"
  ).bind().run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_sessions_expires_at ON sessions(expires_at)"
  ).bind().run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS api_keys (user_id INTEGER NOT NULL, provider_type TEXT NOT NULL, encrypted_key TEXT NOT NULL, iv TEXT NOT NULL, updated_at TEXT NOT NULL, PRIMARY KEY(user_id, provider_type), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
  ).bind().run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_api_keys_user_id ON api_keys(user_id)"
  ).bind().run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS albums (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, name TEXT NOT NULL, description TEXT, created_at TEXT NOT NULL, updated_at TEXT NOT NULL, FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
  ).bind().run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_albums_user_id ON albums(user_id)"
  ).bind().run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS album_songs (album_id INTEGER NOT NULL, song_id TEXT NOT NULL, title TEXT, added_at TEXT NOT NULL, sort_order INTEGER NOT NULL DEFAULT 0, PRIMARY KEY(album_id, song_id), FOREIGN KEY(album_id) REFERENCES albums(id) ON DELETE CASCADE)"
  ).bind().run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_album_songs_album_id ON album_songs(album_id)"
  ).bind().run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_album_songs_song_id ON album_songs(song_id)"
  ).bind().run();
  await db.prepare(
    "CREATE TABLE IF NOT EXISTS song_tags (user_id INTEGER NOT NULL, song_id TEXT NOT NULL, tag TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(user_id, song_id, tag), FOREIGN KEY(user_id) REFERENCES users(id) ON DELETE CASCADE)"
  ).bind().run();
  await db.prepare(
    "CREATE INDEX IF NOT EXISTS idx_song_tags_user_song ON song_tags(user_id, song_id)"
  ).bind().run();
  schemaReady = true;
}

async function findUserByEmail(env: Env, email: string): Promise<MemoryUser | null> {
  const db = getDb(env);
  if (db) {
    await ensureSchema(env);
    const row = await db.prepare(
      "SELECT id, email, password_hash, salt, role, created_at FROM users WHERE email = ?"
    )
      .bind(email)
      .first<MemoryUser>();
    return row ?? null;
  }
  return memoryUsers.get(email) ?? null;
}

async function findUserById(env: Env, id: number): Promise<MemoryUser | null> {
  const db = getDb(env);
  if (db) {
    await ensureSchema(env);
    const row = await db.prepare(
      "SELECT id, email, password_hash, salt, role, created_at FROM users WHERE id = ?"
    )
      .bind(id)
      .first<MemoryUser>();
    return row ?? null;
  }
  for (const user of memoryUsers.values()) {
    if (user.id === id) return user;
  }
  return null;
}

async function createUser(env: Env, email: string, password: string): Promise<MemoryUser> {
  const createdAt = new Date().toISOString();
  const salt = randomHex(16);
  const passwordHash = await pbkdf2Hash(password, salt);

  const db = getDb(env);
  if (db) {
    await ensureSchema(env);
    await db.prepare(
      "INSERT INTO users (email, password_hash, salt, role, created_at) VALUES (?, ?, ?, 'user', ?)"
    )
      .bind(email, passwordHash, salt, createdAt)
      .run();
    const user = await findUserByEmail(env, email);
    if (!user) throw new Error("Failed to create user.");
    return user;
  }

  const user: MemoryUser = {
    id: memoryUserSeq++,
    email,
    password_hash: passwordHash,
    salt,
    role: "user",
    created_at: createdAt,
  };
  memoryUsers.set(email, user);
  return user;
}

async function createSession(env: Env, userId: number): Promise<string> {
  const token = randomHex(32);
  const tokenHash = await sha256Hex(token);
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();

  const db = getDb(env);
  if (db) {
    await ensureSchema(env);
    await db.prepare(
      "INSERT INTO sessions (token_hash, user_id, expires_at, created_at) VALUES (?, ?, ?, ?)"
    )
      .bind(tokenHash, userId, expiresAt, createdAt)
      .run();
    return token;
  }

  memorySessions.set(tokenHash, {
    token_hash: tokenHash,
    user_id: userId,
    expires_at: expiresAt,
    created_at: createdAt,
  });
  return token;
}

async function deleteSession(env: Env, token: string): Promise<void> {
  const tokenHash = await sha256Hex(token);
  const db = getDb(env);
  if (db) {
    await ensureSchema(env);
    await db.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(tokenHash).run();
    return;
  }
  memorySessions.delete(tokenHash);
}

async function getSessionRecord(env: Env, token: string): Promise<MemorySession | null> {
  const tokenHash = await sha256Hex(token);
  const db = getDb(env);
  if (db) {
    await ensureSchema(env);
    const row = await db.prepare(
      "SELECT token_hash, user_id, expires_at, created_at FROM sessions WHERE token_hash = ?"
    )
      .bind(tokenHash)
      .first<MemorySession>();
    return row ?? null;
  }
  return memorySessions.get(tokenHash) ?? null;
}

function extractAppToken(request: Request): string | null {
  const cookie = request.headers.get("Cookie");
  if (cookie) {
    const match = cookie.match(/(?:^|;\s*)sa_session=([^;]+)/);
    if (match?.[1]) return decodeURIComponent(match[1]);
  }

  const header = request.headers.get("X-App-Auth");
  if (header && header.trim()) return header.trim();

  const auth = request.headers.get("Authorization");
  if (auth?.startsWith("Bearer ")) return auth.slice(7).trim();

  return null;
}

function buildSessionCookie(token: string, maxAgeSec: number): string {
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=${maxAgeSec}`;
}

function clearSessionCookie(): string {
  return `${SESSION_COOKIE_NAME}=; Path=/; HttpOnly; Secure; SameSite=Lax; Max-Age=0`;
}

async function requireAuth(request: Request, env: Env): Promise<MemoryUser | Response> {
  if (isAuthDisabled(env)) {
    return AUTH_BYPASS_USER;
  }
  const token = extractAppToken(request);
  if (!token) return json(request, env, { error: "Authentication required" }, 401);

  const session = await getSessionRecord(env, token);
  if (!session) return json(request, env, { error: "Invalid session" }, 401);

  if (new Date(session.expires_at).getTime() <= Date.now()) {
    await deleteSession(env, token);
    return json(request, env, { error: "Session expired" }, 401, { "Set-Cookie": clearSessionCookie() });
  }

  const user = await findUserById(env, session.user_id);
  if (!user) return json(request, env, { error: "Session user missing" }, 401, { "Set-Cookie": clearSessionCookie() });
  return user;
}

function parseProviderType(value: string): ProviderType | null {
  if (value === "gemini" || value === "openrouter" || value === "openapi") return value;
  return null;
}

async function getStoredApiKey(env: Env, userId: number, providerType: ProviderType): Promise<string | null> {
  const db = getDb(env);
  if (db) {
    await ensureSchema(env);
    const row = await db.prepare(
      "SELECT encrypted_key, iv FROM api_keys WHERE user_id = ? AND provider_type = ?"
    ).bind(userId, providerType).first<{ encrypted_key: string; iv: string }>();
    if (!row) return null;
    try {
      return await decryptApiKey(env, row.encrypted_key, row.iv);
    } catch {
      throw new Error("Failed to decrypt API key. Check KEY_ENCRYPTION_SECRET.");
    }
  }

  const record = memoryApiKeys.get(`${userId}:${providerType}`);
  if (!record) return null;
  return decryptApiKey(env, record.encrypted_key, record.iv);
}

async function setStoredApiKey(env: Env, userId: number, providerType: ProviderType, apiKey: string): Promise<void> {
  const encrypted = await encryptApiKey(env, apiKey);
  const updatedAt = new Date().toISOString();
  const db = getDb(env);

  if (db) {
    await ensureSchema(env);
    await db.prepare(
      "INSERT INTO api_keys (user_id, provider_type, encrypted_key, iv, updated_at) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, provider_type) DO UPDATE SET encrypted_key = excluded.encrypted_key, iv = excluded.iv, updated_at = excluded.updated_at"
    ).bind(userId, providerType, encrypted.encrypted, encrypted.iv, updatedAt).run();
    return;
  }

  memoryApiKeys.set(`${userId}:${providerType}`, {
    user_id: userId,
    provider_type: providerType,
    encrypted_key: encrypted.encrypted,
    iv: encrypted.iv,
    updated_at: updatedAt,
  });
}

async function deleteStoredApiKey(env: Env, userId: number, providerType: ProviderType): Promise<void> {
  const db = getDb(env);
  if (db) {
    await ensureSchema(env);
    await db.prepare("DELETE FROM api_keys WHERE user_id = ? AND provider_type = ?").bind(userId, providerType).run();
    return;
  }
  memoryApiKeys.delete(`${userId}:${providerType}`);
}

async function parseJsonBody(request: Request): Promise<any | null> {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

async function handleRegister(request: Request, env: Env): Promise<Response> {
  if (isRateLimited(request, "register", 8, 10 * 60 * 1000)) {
    return json(request, env, { error: "Too many registration attempts. Please try again later." }, 429);
  }
  if ((env.ALLOW_REGISTRATION || "true").toLowerCase() !== "true") {
    return json(request, env, { error: "Registration disabled" }, 403);
  }

  const body = await parseJsonBody(request);
  if (!body) return json(request, env, { error: "Invalid JSON body" }, 400);
  const email = normalizeEmail(body.email || "");
  const password = String(body.password || "");

  if (!isValidEmail(email)) return json(request, env, { error: "Invalid email" }, 400);
  if (!isValidPassword(password)) return json(request, env, { error: "Password must be at least 8 characters" }, 400);

  const existing = await findUserByEmail(env, email);
  if (existing) return json(request, env, { error: "Email already registered" }, 409);

  const user = await createUser(env, email, password);
  const token = await createSession(env, user.id);
  return json(
    request,
    env,
    { user: { id: user.id, email: user.email, role: user.role, createdAt: user.created_at } },
    200,
    { "Set-Cookie": buildSessionCookie(token, Math.floor(SESSION_TTL_MS / 1000)) }
  );
}

async function handleLogin(request: Request, env: Env): Promise<Response> {
  if (isRateLimited(request, "login", 20, 10 * 60 * 1000)) {
    return json(request, env, { error: "Too many login attempts. Please try again later." }, 429);
  }
  const body = await parseJsonBody(request);
  if (!body) return json(request, env, { error: "Invalid JSON body" }, 400);
  const email = normalizeEmail(body.email || "");
  const password = String(body.password || "");

  const user = await findUserByEmail(env, email);
  if (!user) return json(request, env, { error: "Invalid credentials" }, 401);

  const computed = await pbkdf2Hash(password, user.salt);
  if (computed !== user.password_hash) return json(request, env, { error: "Invalid credentials" }, 401);

  const token = await createSession(env, user.id);
  return json(
    request,
    env,
    { user: { id: user.id, email: user.email, role: user.role, createdAt: user.created_at } },
    200,
    { "Set-Cookie": buildSessionCookie(token, Math.floor(SESSION_TTL_MS / 1000)) }
  );
}

async function handleLogout(request: Request, env: Env): Promise<Response> {
  const token = extractAppToken(request);
  if (token) await deleteSession(env, token);
  return json(request, env, { success: true }, 200, { "Set-Cookie": clearSessionCookie() });
}

async function handleMe(request: Request, env: Env): Promise<Response> {
  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) return authResult;
  return json(request, env, {
    user: {
      id: authResult.id,
      email: authResult.email,
      role: authResult.role,
      createdAt: authResult.created_at,
    },
  });
}

async function handleApiKeyGet(request: Request, env: Env, providerType: ProviderType): Promise<Response> {
  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) return authResult;

  try {
    const apiKey = await getStoredApiKey(env, authResult.id, providerType);
    return json(request, env, { apiKey: apiKey || undefined });
  } catch (error: any) {
    return json(request, env, { error: error?.message || "Failed to load stored API key" }, 500);
  }
}

async function handleApiKeyPut(request: Request, env: Env, providerType: ProviderType): Promise<Response> {
  if (isRateLimited(request, "api-keys-put", 60, 60 * 1000)) {
    return json(request, env, { error: "Rate limit exceeded. Slow down and retry." }, 429);
  }

  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) return authResult;

  const body = await parseJsonBody(request);
  if (!body) return json(request, env, { error: "Invalid JSON body" }, 400);
  const apiKey = String(body.apiKey || "").trim();
  if (!apiKey) return json(request, env, { error: "API key is required" }, 400);
  if (apiKey.length > 4096) return json(request, env, { error: "API key is too long" }, 400);

  try {
    await setStoredApiKey(env, authResult.id, providerType, apiKey);
    return json(request, env, { success: true });
  } catch (error: any) {
    return json(request, env, { error: error?.message || "Failed to store API key" }, 500);
  }
}

async function handleApiKeyDelete(request: Request, env: Env, providerType: ProviderType): Promise<Response> {
  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) return authResult;

  try {
    await deleteStoredApiKey(env, authResult.id, providerType);
    return json(request, env, { success: true });
  } catch (error: any) {
    return json(request, env, { error: error?.message || "Failed to delete API key" }, 500);
  }
}

async function handleAlbumsList(request: Request, env: Env): Promise<Response> {
  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) return authResult;

  const db = getDb(env);
  if (db) {
    await ensureSchema(env);
    const albumsRes = await db.prepare(
      "SELECT id, user_id, name, description, created_at, updated_at FROM albums WHERE user_id = ? ORDER BY updated_at DESC"
    ).bind(authResult.id).all<MemoryAlbum>();
    const songsRes = await db.prepare(
      "SELECT s.album_id, s.song_id, s.title, s.added_at, s.sort_order FROM album_songs s INNER JOIN albums a ON a.id = s.album_id WHERE a.user_id = ? ORDER BY s.sort_order ASC, s.added_at ASC"
    ).bind(authResult.id).all<MemoryAlbumSong>();

    const songsByAlbum = new Map<number, MemoryAlbumSong[]>();
    for (const song of songsRes.results || []) {
      const arr = songsByAlbum.get(song.album_id) || [];
      arr.push(song);
      songsByAlbum.set(song.album_id, arr);
    }

    return json(request, env, {
      albums: (albumsRes.results || []).map((album) => ({
        id: album.id,
        name: album.name,
        description: album.description,
        createdAt: album.created_at,
        updatedAt: album.updated_at,
        songs: (songsByAlbum.get(album.id) || []).map((song) => ({
          songId: song.song_id,
          title: song.title,
          addedAt: song.added_at,
          sortOrder: song.sort_order,
        })),
      })),
    });
  }

  const albums = Array.from(memoryAlbums.values())
    .filter((a) => a.user_id === authResult.id)
    .sort((a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime())
    .map((album) => ({
      id: album.id,
      name: album.name,
      description: album.description,
      createdAt: album.created_at,
      updatedAt: album.updated_at,
      songs: Array.from(memoryAlbumSongs.values())
        .filter((s) => s.album_id === album.id)
        .sort((a, b) => a.sort_order - b.sort_order || new Date(a.added_at).getTime() - new Date(b.added_at).getTime())
        .map((song) => ({
          songId: song.song_id,
          title: song.title,
          addedAt: song.added_at,
          sortOrder: song.sort_order,
        })),
    }));

  return json(request, env, { albums });
}

async function handleAlbumCreate(request: Request, env: Env): Promise<Response> {
  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) return authResult;
  const body = await parseJsonBody(request);
  if (!body) return json(request, env, { error: "Invalid JSON body" }, 400);

  const name = String(body.name || "").trim();
  const descriptionRaw = String(body.description || "").trim();
  const description = descriptionRaw || null;
  if (!name) return json(request, env, { error: "Album name is required" }, 400);
  if (name.length > 120) return json(request, env, { error: "Album name is too long" }, 400);

  const now = new Date().toISOString();
  const db = getDb(env);
  if (db) {
    await ensureSchema(env);
    await db.prepare(
      "INSERT INTO albums (user_id, name, description, created_at, updated_at) VALUES (?, ?, ?, ?, ?)"
    ).bind(authResult.id, name, description, now, now).run();
    const row = await db.prepare(
      "SELECT id, name, description, created_at, updated_at FROM albums WHERE user_id = ? ORDER BY id DESC LIMIT 1"
    ).bind(authResult.id).first<{ id: number; name: string; description: string | null; created_at: string; updated_at: string }>();
    return json(request, env, {
      album: {
        id: row?.id,
        name: row?.name,
        description: row?.description,
        createdAt: row?.created_at,
        updatedAt: row?.updated_at,
      },
    });
  }

  const album: MemoryAlbum = {
    id: memoryAlbumSeq++,
    user_id: authResult.id,
    name,
    description,
    created_at: now,
    updated_at: now,
  };
  memoryAlbums.set(album.id, album);
  return json(request, env, {
    album: {
      id: album.id,
      name: album.name,
      description: album.description,
      createdAt: album.created_at,
      updatedAt: album.updated_at,
    },
  });
}

async function handleAlbumUpdate(request: Request, env: Env, albumId: number): Promise<Response> {
  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) return authResult;
  const body = await parseJsonBody(request);
  if (!body) return json(request, env, { error: "Invalid JSON body" }, 400);

  const name = String(body.name || "").trim();
  const descriptionRaw = String(body.description || "").trim();
  const description = descriptionRaw || null;
  if (!name) return json(request, env, { error: "Album name is required" }, 400);
  const now = new Date().toISOString();

  const db = getDb(env);
  if (db) {
    await ensureSchema(env);
    const ownership = await db.prepare("SELECT id FROM albums WHERE id = ? AND user_id = ?").bind(albumId, authResult.id).first();
    if (!ownership) return json(request, env, { error: "Album not found" }, 404);
    await db.prepare("UPDATE albums SET name = ?, description = ?, updated_at = ? WHERE id = ? AND user_id = ?")
      .bind(name, description, now, albumId, authResult.id)
      .run();
    return json(request, env, { success: true });
  }

  const album = memoryAlbums.get(albumId);
  if (!album || album.user_id !== authResult.id) return json(request, env, { error: "Album not found" }, 404);
  album.name = name;
  album.description = description;
  album.updated_at = now;
  memoryAlbums.set(albumId, album);
  return json(request, env, { success: true });
}

async function handleAlbumDelete(request: Request, env: Env, albumId: number): Promise<Response> {
  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) return authResult;
  const db = getDb(env);
  if (db) {
    await ensureSchema(env);
    const ownership = await db.prepare("SELECT id FROM albums WHERE id = ? AND user_id = ?").bind(albumId, authResult.id).first();
    if (!ownership) return json(request, env, { error: "Album not found" }, 404);
    await db.prepare("DELETE FROM albums WHERE id = ? AND user_id = ?").bind(albumId, authResult.id).run();
    return json(request, env, { success: true });
  }

  const album = memoryAlbums.get(albumId);
  if (!album || album.user_id !== authResult.id) return json(request, env, { error: "Album not found" }, 404);
  memoryAlbums.delete(albumId);
  for (const key of Array.from(memoryAlbumSongs.keys())) {
    if (key.startsWith(`${albumId}:`)) memoryAlbumSongs.delete(key);
  }
  return json(request, env, { success: true });
}

async function handleAlbumAddSong(request: Request, env: Env, albumId: number): Promise<Response> {
  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) return authResult;
  const body = await parseJsonBody(request);
  if (!body) return json(request, env, { error: "Invalid JSON body" }, 400);
  const songId = String(body.songId || "").trim();
  const title = String(body.title || "").trim() || null;
  if (!songId) return json(request, env, { error: "songId is required" }, 400);

  const db = getDb(env);
  if (db) {
    await ensureSchema(env);
    const ownership = await db.prepare("SELECT id FROM albums WHERE id = ? AND user_id = ?").bind(albumId, authResult.id).first();
    if (!ownership) return json(request, env, { error: "Album not found" }, 404);
    const sortRow = await db.prepare("SELECT COALESCE(MAX(sort_order), -1) AS max_sort FROM album_songs WHERE album_id = ?")
      .bind(albumId)
      .first<{ max_sort: number }>();
    const sortOrder = (sortRow?.max_sort ?? -1) + 1;
    const now = new Date().toISOString();
    await db.prepare(
      "INSERT INTO album_songs (album_id, song_id, title, added_at, sort_order) VALUES (?, ?, ?, ?, ?) ON CONFLICT(album_id, song_id) DO UPDATE SET title = excluded.title"
    ).bind(albumId, songId, title, now, sortOrder).run();
    await db.prepare("UPDATE albums SET updated_at = ? WHERE id = ?").bind(now, albumId).run();
    return json(request, env, { success: true });
  }

  const album = memoryAlbums.get(albumId);
  if (!album || album.user_id !== authResult.id) return json(request, env, { error: "Album not found" }, 404);
  const currentSongs = Array.from(memoryAlbumSongs.values()).filter((s) => s.album_id === albumId);
  const sortOrder = currentSongs.length > 0 ? Math.max(...currentSongs.map((s) => s.sort_order)) + 1 : 0;
  const key = `${albumId}:${songId}`;
  const existing = memoryAlbumSongs.get(key);
  if (existing) {
    existing.title = title;
    memoryAlbumSongs.set(key, existing);
  } else {
    memoryAlbumSongs.set(key, {
      album_id: albumId,
      song_id: songId,
      title,
      added_at: new Date().toISOString(),
      sort_order: sortOrder,
    });
  }
  album.updated_at = new Date().toISOString();
  memoryAlbums.set(albumId, album);
  return json(request, env, { success: true });
}

async function handleAlbumRemoveSong(request: Request, env: Env, albumId: number, songId: string): Promise<Response> {
  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) return authResult;
  const db = getDb(env);
  if (db) {
    await ensureSchema(env);
    const ownership = await db.prepare("SELECT id FROM albums WHERE id = ? AND user_id = ?").bind(albumId, authResult.id).first();
    if (!ownership) return json(request, env, { error: "Album not found" }, 404);
    await db.prepare("DELETE FROM album_songs WHERE album_id = ? AND song_id = ?").bind(albumId, songId).run();
    await db.prepare("UPDATE albums SET updated_at = ? WHERE id = ?").bind(new Date().toISOString(), albumId).run();
    return json(request, env, { success: true });
  }

  const album = memoryAlbums.get(albumId);
  if (!album || album.user_id !== authResult.id) return json(request, env, { error: "Album not found" }, 404);
  memoryAlbumSongs.delete(`${albumId}:${songId}`);
  album.updated_at = new Date().toISOString();
  memoryAlbums.set(albumId, album);
  return json(request, env, { success: true });
}

async function handleAlbumReorderSongs(request: Request, env: Env, albumId: number): Promise<Response> {
  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) return authResult;
  const body = await parseJsonBody(request);
  if (!body) return json(request, env, { error: "Invalid JSON body" }, 400);

  const songIds = Array.isArray(body.songIds)
    ? body.songIds.map((s: unknown) => String(s || "").trim()).filter(Boolean)
    : [];
  const uniqueSongIds = Array.from(new Set(songIds)) as string[];

  const db = getDb(env);
  if (db) {
    await ensureSchema(env);
    const ownership = await db.prepare("SELECT id FROM albums WHERE id = ? AND user_id = ?").bind(albumId, authResult.id).first();
    if (!ownership) return json(request, env, { error: "Album not found" }, 404);

    const currentSongsRes = await db.prepare("SELECT song_id FROM album_songs WHERE album_id = ?")
      .bind(albumId)
      .all<{ song_id: string }>();
    const currentSongIds = (currentSongsRes.results || []).map((r) => r.song_id);
    const currentSet = new Set(currentSongIds);
    if (uniqueSongIds.length !== currentSongIds.length || uniqueSongIds.some((id) => !currentSet.has(id))) {
      return json(request, env, { error: "songIds must include every song in the album exactly once" }, 400);
    }

    for (let idx = 0; idx < uniqueSongIds.length; idx += 1) {
      await db.prepare("UPDATE album_songs SET sort_order = ? WHERE album_id = ? AND song_id = ?")
        .bind(idx, albumId, uniqueSongIds[idx])
        .run();
    }

    await db.prepare("UPDATE albums SET updated_at = ? WHERE id = ?").bind(new Date().toISOString(), albumId).run();
    return json(request, env, { success: true });
  }

  const album = memoryAlbums.get(albumId);
  if (!album || album.user_id !== authResult.id) return json(request, env, { error: "Album not found" }, 404);

  const currentSongs = Array.from(memoryAlbumSongs.values()).filter((s) => s.album_id === albumId);
  const currentSet = new Set(currentSongs.map((s) => s.song_id));
  if (uniqueSongIds.length !== currentSongs.length || uniqueSongIds.some((id) => !currentSet.has(id))) {
    return json(request, env, { error: "songIds must include every song in the album exactly once" }, 400);
  }

  uniqueSongIds.forEach((songId, index) => {
    const key = `${albumId}:${songId}`;
    const song = memoryAlbumSongs.get(key);
    if (!song) return;
    song.sort_order = index;
    memoryAlbumSongs.set(key, song);
  });

  album.updated_at = new Date().toISOString();
  memoryAlbums.set(albumId, album);
  return json(request, env, { success: true });
}

async function handleSongMetaGet(request: Request, env: Env, songId: string): Promise<Response> {
  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) return authResult;
  const db = getDb(env);
  if (db) {
    await ensureSchema(env);
    const tagsRes = await db.prepare("SELECT tag FROM song_tags WHERE user_id = ? AND song_id = ? ORDER BY tag ASC")
      .bind(authResult.id, songId)
      .all<{ tag: string }>();
    const albumsRes = await db.prepare(
      "SELECT a.id, a.name FROM albums a INNER JOIN album_songs s ON s.album_id = a.id WHERE a.user_id = ? AND s.song_id = ? ORDER BY a.updated_at DESC"
    ).bind(authResult.id, songId).all<{ id: number; name: string }>();
    return json(request, env, {
      songId,
      tags: (tagsRes.results || []).map((r) => r.tag),
      albums: albumsRes.results || [],
    });
  }

  const tagSet = memorySongTags.get(`${authResult.id}:${songId}`) || new Set<string>();
  const albums = Array.from(memoryAlbums.values())
    .filter((album) => album.user_id === authResult.id)
    .filter((album) => memoryAlbumSongs.has(`${album.id}:${songId}`))
    .map((album) => ({ id: album.id, name: album.name }));
  return json(request, env, { songId, tags: Array.from(tagSet).sort(), albums });
}

async function handleSongMetaPut(request: Request, env: Env, songId: string): Promise<Response> {
  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) return authResult;
  const body = await parseJsonBody(request);
  if (!body) return json(request, env, { error: "Invalid JSON body" }, 400);
  const tags: string[] = Array.isArray(body.tags)
    ? Array.from(new Set(body.tags.map((t: unknown) => String(t || "").trim()).filter(Boolean)))
    : [];

  const db = getDb(env);
  if (db) {
    await ensureSchema(env);
    await db.prepare("DELETE FROM song_tags WHERE user_id = ? AND song_id = ?").bind(authResult.id, songId).run();
    const now = new Date().toISOString();
    for (const tag of tags) {
      await db.prepare("INSERT INTO song_tags (user_id, song_id, tag, created_at) VALUES (?, ?, ?, ?)")
        .bind(authResult.id, songId, tag, now)
        .run();
    }
    return json(request, env, { success: true, tags });
  }

  memorySongTags.set(`${authResult.id}:${songId}`, new Set(tags));
  return json(request, env, { success: true, tags });
}

async function handlePublishYouTube(request: Request, env: Env): Promise<Response> {
  if (isRateLimited(request, "publish-youtube", 30, 60 * 1000)) {
    return json(request, env, { error: "Rate limit exceeded. Slow down and retry." }, 429);
  }
  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) return authResult;

  const body = await parseJsonBody(request);
  if (!body) return json(request, env, { error: "Invalid JSON body" }, 400);

  const title = String(body.title || "Untitled").trim();
  const description = String(body.description || "").trim();
  const clipId = String(body.clipId || "").trim();
  const aspect = String(body.aspect || "landscape").trim();
  if (!clipId) return json(request, env, { error: "Missing clipId" }, 400);
  if (aspect !== "landscape") {
    return json(request, env, { error: "YouTube publishing requires landscape (16:9)." }, 400);
  }

  const uploadPayload = {
    snippet: {
      title,
      description,
      categoryId: "10",
    },
    status: {
      privacyStatus: "public",
    },
    media: {
      clipId,
      aspect,
    },
    crossPost: body.crossPost || null,
  };

  // OAuth/upload stub: structure intentionally mirrors real outbound call.
  const upstreamRequest = new Request("https://www.googleapis.com/upload/youtube/v3/videos?part=snippet,status", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer STUB_YOUTUBE_TOKEN",
    },
    body: JSON.stringify(uploadPayload),
  });

  return json(request, env, {
    success: true,
    provider: "youtube",
    jobId: `yt_${Date.now()}`,
    dryRun: true,
    upstream: {
      method: upstreamRequest.method,
      url: upstreamRequest.url,
      headers: {
        "Content-Type": "application/json",
      },
    },
    stub: {
      videoId: `stub-yt-${clipId.slice(0, 8) || "video"}`,
      watchUrl: `https://youtube.com/watch?v=stub-yt-${clipId.slice(0, 8) || "video"}`,
    },
  });
}

async function handlePublishFacebook(request: Request, env: Env): Promise<Response> {
  if (isRateLimited(request, "publish-facebook", 30, 60 * 1000)) {
    return json(request, env, { error: "Rate limit exceeded. Slow down and retry." }, 429);
  }
  const authResult = await requireAuth(request, env);
  if (authResult instanceof Response) return authResult;

  const body = await parseJsonBody(request);
  if (!body) return json(request, env, { error: "Invalid JSON body" }, 400);

  const title = String(body.title || "Untitled").trim();
  const description = String(body.description || "").trim();
  const clipId = String(body.clipId || "").trim();
  const aspect = String(body.aspect || "landscape").trim();
  if (!clipId) return json(request, env, { error: "Missing clipId" }, 400);
  if (aspect !== "landscape" && aspect !== "portrait") {
    return json(request, env, { error: "Facebook aspect must be landscape or portrait." }, 400);
  }

  const uploadPayload = {
    title,
    description,
    sourceClip: clipId,
    aspect,
  };

  // OAuth/upload stub: structure intentionally mirrors real outbound call.
  const upstreamRequest = new Request("https://graph.facebook.com/v22.0/me/videos", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "Authorization": "Bearer STUB_FACEBOOK_TOKEN",
    },
    body: JSON.stringify(uploadPayload),
  });

  const short = clipId.slice(0, 8) || "video";
  return json(request, env, {
    success: true,
    provider: "facebook",
    jobId: `fb_${Date.now()}`,
    dryRun: true,
    upstream: {
      method: upstreamRequest.method,
      url: upstreamRequest.url,
      headers: {
        "Content-Type": "application/json",
      },
    },
    stub: {
      videoId: `stub-fb-${short}`,
      publishedUrl: `https://www.facebook.com/watch/?v=stub-fb-${short}`,
    },
  });
}

export default {
  async fetch(request: Request, env: Env) {
    const url = new URL(request.url);

    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: buildCorsHeaders(request, env) });
    }

    if (url.pathname === "/api/auth/register" && request.method === "POST") {
      return handleRegister(request, env);
    }
    if (url.pathname === "/api/auth/login" && request.method === "POST") {
      return handleLogin(request, env);
    }
    if (url.pathname === "/api/auth/logout" && request.method === "POST") {
      return handleLogout(request, env);
    }
    if (url.pathname === "/api/auth/me" && request.method === "GET") {
      return handleMe(request, env);
    }

    if (url.pathname.startsWith("/api/keys/")) {
      const provider = parseProviderType(url.pathname.split("/").pop() || "");
      if (!provider) return json(request, env, { error: "Invalid provider type" }, 404);

      if (request.method === "GET") {
        return handleApiKeyGet(request, env, provider);
      }
      if (request.method === "PUT") {
        return handleApiKeyPut(request, env, provider);
      }
      if (request.method === "DELETE") {
        return handleApiKeyDelete(request, env, provider);
      }
      return json(request, env, { error: "Method not allowed" }, 405);
    }

    if (url.pathname === "/api/library/albums" && request.method === "GET") {
      return handleAlbumsList(request, env);
    }
    if (url.pathname === "/api/library/albums" && request.method === "POST") {
      return handleAlbumCreate(request, env);
    }

    const albumSongsReorderMatch = url.pathname.match(/^\/api\/library\/albums\/(\d+)\/songs\/reorder$/);
    if (albumSongsReorderMatch) {
      const albumId = Number(albumSongsReorderMatch[1]);
      if (!Number.isFinite(albumId)) return json(request, env, { error: "Invalid album id" }, 400);
      if (request.method === "PATCH") {
        return handleAlbumReorderSongs(request, env, albumId);
      }
      return json(request, env, { error: "Method not allowed" }, 405);
    }

    const albumSongMatch = url.pathname.match(/^\/api\/library\/albums\/(\d+)\/songs\/([^/]+)$/);
    if (albumSongMatch) {
      const albumId = Number(albumSongMatch[1]);
      const songId = decodeURIComponent(albumSongMatch[2]);
      if (!Number.isFinite(albumId)) return json(request, env, { error: "Invalid album id" }, 400);
      if (request.method === "DELETE") {
        return handleAlbumRemoveSong(request, env, albumId, songId);
      }
      return json(request, env, { error: "Method not allowed" }, 405);
    }

    const albumSongsCollectionMatch = url.pathname.match(/^\/api\/library\/albums\/(\d+)\/songs$/);
    if (albumSongsCollectionMatch) {
      const albumId = Number(albumSongsCollectionMatch[1]);
      if (!Number.isFinite(albumId)) return json(request, env, { error: "Invalid album id" }, 400);
      if (request.method === "POST") {
        return handleAlbumAddSong(request, env, albumId);
      }
      return json(request, env, { error: "Method not allowed" }, 405);
    }

    const albumMatch = url.pathname.match(/^\/api\/library\/albums\/(\d+)$/);
    if (albumMatch) {
      const albumId = Number(albumMatch[1]);
      if (!Number.isFinite(albumId)) return json(request, env, { error: "Invalid album id" }, 400);
      if (request.method === "PATCH") {
        return handleAlbumUpdate(request, env, albumId);
      }
      if (request.method === "DELETE") {
        return handleAlbumDelete(request, env, albumId);
      }
      return json(request, env, { error: "Method not allowed" }, 405);
    }

    const songMetaMatch = url.pathname.match(/^\/api\/library\/songs\/([^/]+)\/meta$/);
    if (songMetaMatch) {
      const songId = decodeURIComponent(songMetaMatch[1]);
      if (request.method === "GET") {
        return handleSongMetaGet(request, env, songId);
      }
      if (request.method === "PUT") {
        return handleSongMetaPut(request, env, songId);
      }
      return json(request, env, { error: "Method not allowed" }, 405);
    }

    if (url.pathname === "/api/suno-proxy" && request.method === "POST") {
      if (isRateLimited(request, "suno-proxy", 120, 60 * 1000)) {
        return json(request, env, { error: "Rate limit exceeded. Slow down and retry." }, 429);
      }
      const authResult = await requireAuth(request, env);
      if (authResult instanceof Response) return authResult;
      return handleSunoRequest(request, env, "https://studio-api.prod.suno.com/api/generate/v2/");
    }

    if (url.pathname === "/api/publish/youtube" && request.method === "POST") {
      return handlePublishYouTube(request, env);
    }

    if (url.pathname === "/api/publish/facebook" && request.method === "POST") {
      return handlePublishFacebook(request, env);
    }

    return env.ASSETS.fetch(request);
  },
};

async function handleSunoRequest(request: Request, env: Env, targetUrl: string) {
  const body = await parseJsonBody(request);
  if (!body) return json(request, env, { error: "Invalid JSON body" }, 400);

  const authHeader = request.headers.get("Authorization");
  const customCookieHeader = request.headers.get("X-Suno-Cookie");

  let deviceId: string = crypto.randomUUID();
  if (customCookieHeader) {
    try {
      const parts = customCookieHeader.split(";");
      for (const part of parts) {
        const [key, value] = part.split("=");
        if (key && key.trim() === "ajs_anonymous_id") {
          let val = (value || "").trim();
          try {
            val = decodeURIComponent(val);
          } catch {}
          deviceId = val.replace(/^"+|"+$/g, "");
          break;
        }
      }
    } catch {}
  }

  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/123.0.0.0 Safari/537.36",
    "Affiliate-Id": "undefined",
    "Device-Id": `"${deviceId}"`,
    "x-suno-client": "Android prerelease-4nt180t 1.0.42",
    "X-Requested-With": "com.suno.android",
    "sec-ch-ua": '"Chromium";v="130", "Android WebView";v="130", "Not?A_Brand";v="99"',
    "sec-ch-ua-mobile": "?1",
    "sec-ch-ua-platform": '"Android"',
  };

  if (authHeader) headers["Authorization"] = authHeader;
  if (customCookieHeader) headers["Cookie"] = customCookieHeader;

  try {
    const checkResponse = await fetch("https://studio-api.prod.suno.com/api/c/check", {
      method: "POST",
      headers,
      body: JSON.stringify({ ctype: "generation" }),
    });

    if (checkResponse.ok) {
      const checkData = (await checkResponse.json()) as any;
      if (checkData?.required !== false) {
        return json(
          request,
          env,
          {
            error:
              "Suno CAPTCHA verification required. Please login to Suno.com, solve verification if prompted, and update your token in Settings.",
            detail: "Verification Required",
          },
          403
        );
      }
    }
  } catch (e) {
    console.warn("Suno captcha check failed, proceeding anyway", e);
  }

  try {
    const sunoResponse = await fetch(targetUrl, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
    });

    const responseText = await sunoResponse.text();
    return new Response(responseText, {
      status: sunoResponse.status,
      headers: { "Content-Type": "application/json", ...buildCorsHeaders(request, env) },
    });
  } catch (err: any) {
    return json(request, env, { error: err?.message || "Proxy Error" }, 500);
  }
}
