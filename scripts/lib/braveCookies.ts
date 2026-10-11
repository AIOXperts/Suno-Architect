import { Database } from "bun:sqlite";
import { createDecipheriv, pbkdf2Sync } from "node:crypto";
import { copyFileSync, existsSync, mkdtempSync, readdirSync, rmSync, statSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { dirname, join } from "node:path";

/**
 * Reads Suno's cookies straight out of a local Brave profile.
 *
 * Brave 1xx on Linux writes cookies with the OSCrypt "v11" envelope:
 *   "v11" || header(16) || iv(16) || AES-128-CBC(PBKDF2-SHA1(keyringSecret, "saltysalt", 1, 16))
 * Older builds used the legacy fixed-space-IV form, so both layouts are probed.
 */

export interface BraveCookieRecord {
    host: string;
    name: string;
    value: string;
    path: string;
    secure: boolean;
    httpOnly: boolean;
    sameSite: 'Strict' | 'Lax' | 'None';
    /** Unix seconds; undefined for session cookies. */
    expiresAt?: number;
}

export interface BraveSunoCookies {
    profileDir: string;
    cookieHeader: string;
    /** Session JWT (1h lifetime) copied from `__session`. */
    sessionToken?: string;
    /** Clerk client JWT (~1 year) from `auth.suno.com`; used to mint fresh session tokens. */
    clientToken?: string;
    sessionId?: string;
    sessionExpiresAt?: number;
    handle?: string;
    email?: string;
    userId?: string;
    cookies: BraveCookieRecord[];
}

const SUNO_PROFILE_CANDIDATES = [
    process.env.SUNO_BRAVE_PROFILE,
    join(homedir(), ".var/app/com.brave.Browser/config/BraveSoftware/Brave-Browser"),
    join(homedir(), ".config/BraveSoftware/Brave-Browser"),
    join(homedir(), "snap/brave/current/.config/BraveSoftware/Brave-Browser"),
].filter((path): path is string => !!path);

const hostApplies = (cookieHost: string, targetHost: string): boolean => {
    const host = cookieHost.startsWith(".") ? cookieHost.slice(1) : cookieHost;
    return targetHost === host || targetHost.endsWith(`.${host}`);
};

export const resolveBraveProfileDir = (explicitDir?: string): string => {
    const candidates = [explicitDir, ...SUNO_PROFILE_CANDIDATES].filter((path): path is string => !!path);

    let best: { dir: string; mtime: number } | null = null;
    for (const candidate of candidates) {
        const cookiePath = join(candidate, "Default", "Cookies");
        if (!existsSync(cookiePath)) continue;
        const mtime = statSync(cookiePath).mtimeMs;
        if (!best || mtime > best.mtime) best = { dir: cookiePath, mtime };
    }

    if (!best) {
        throw new Error(
            `No Brave cookie database found. Looked in:\n  ${candidates.map((c) => join(c, "Default", "Cookies")).join("\n  ")}\n` +
            `Set SUNO_BRAVE_PROFILE to the Brave "Brave-Browser" directory if Brave lives elsewhere.`
        );
    }
    return dirname(dirname(best.dir));
};

export const readKeyringSecret = (): string => {
    const override = process.env.SUNO_BRAVE_KEY?.trim();
    if (override) return override;

    const lookup = Bun.spawnSync({
        cmd: ["secret-tool", "lookup", "application", "brave"],
        stdout: "pipe",
        stderr: "pipe",
    });

    const secret = lookup.stdout.toString().trim();
    if (lookup.exitCode !== 0 || !secret) {
        throw new Error(
            "Could not read the Brave Safe Storage key from the login keyring " +
            "(secret-tool lookup application brave failed). Unlock your keyring, or pass SUNO_BRAVE_KEY=<secret>."
        );
    }
    return secret;
};

const COOKIE_LEGEND_LAYOUTS = [
    // Brave 1xx: two 16-byte header blocks, then the CBC ciphertext.
    { name: "v11-headered", ivOffset: 16, ctOffset: 32 },
    // Legacy "v11": 16-byte IV prefix then ciphertext.
    { name: "v11-iv-prefixed", ivOffset: 0, ctOffset: 16 },
    // Legacy "v10": no IV, fixed 16-space IV.
    { name: "v10-fixed-iv", ivOffset: null, ctOffset: 0 },
] as const;

const FIXED_IV = Buffer.alloc(16, 0x20);

const looksLikeCookieValue = (text: string): boolean => {
    if (text.length === 0) return false;
    let printable = 0;
    for (const char of text) {
        const code = char.codePointAt(0) ?? 0;
        if (code === 9 || (code >= 32 && code !== 127)) printable += 1;
    }
    return printable / text.length >= 0.9;
};

export const decryptBraveCookie = (encrypted: Buffer, secret: string): string => {
    const prefix = encrypted.subarray(0, 3).toString("latin1");
    const prefixed = prefix === "v10" || prefix === "v11";
    const body = prefixed ? encrypted.subarray(3) : encrypted;
    const key = pbkdf2Sync(secret, "saltysalt", 1, 16, "sha1");

    for (const layout of COOKIE_LEGEND_LAYOUTS) {
        const ctOffset = layout.ctOffset;
        if (body.length <= ctOffset || (body.length - ctOffset) % 16 !== 0) continue;

        const iv = layout.ivOffset === null
            ? FIXED_IV
            : body.subarray(layout.ivOffset, layout.ivOffset + 16);
        if (iv.length !== 16) continue;

        try {
            // Node strips PKCS#7 padding during final(); a wrong layout fails that check and throws.
            const decipher = createDecipheriv("aes-128-cbc", key, iv);
            const decrypted = Buffer.concat([decipher.update(body.subarray(ctOffset)), decipher.final()]);
            const text = decrypted.toString("utf8");
            if (looksLikeCookieValue(text)) return text;
        } catch {
            // Wrong layout for this cookie/version; try the next one.
        }
    }

    throw new Error(
        `Unable to decrypt a Brave cookie (${body.length} bytes, prefix "${prefix}"). ` +
        `Brave may have changed its cookie format - pass a token with --token= instead.`
    );
};

interface CookieRow {
    host_key: string;
    name: string;
    value: string;
    encrypted_value: Uint8Array | null;
    path: string;
    is_secure: number;
    is_httponly: number;
    samesite: number;
    expires_utc: number;
}

/** Chromium serialises SameSite as 0=None, 1=Lax, 2=Strict. */
const SAME_SITE_BY_CODE: Record<number, BraveCookieRecord['sameSite']> = { 0: 'None', 1: 'Lax', 2: 'Strict' };

/** Brave stores expiry as microseconds since 1601-01-01; 0 means a session cookie. */
const chromeEpochToUnixSeconds = (expiresUtc: number): number | undefined => {
    if (!expiresUtc || expiresUtc <= 0) return undefined;
    return Math.floor(expiresUtc / 1_000_000 - 11_644_473_600);
};

const decodeJwtPayload = (token: string): Record<string, unknown> | null => {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    try {
        const payload = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
        const parsed: unknown = JSON.parse(payload);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
};

const readJwtString = (payload: Record<string, unknown> | null, ...keys: string[]): string | undefined => {
    for (const key of keys) {
        const value = payload?.[key];
        if (typeof value === "string" && value) return value;
    }
    return undefined;
};

export const readBraveSunoCookies = (options?: { profileDir?: string; secret?: string }): BraveSunoCookies => {
    const profileDir = resolveBraveProfileDir(options?.profileDir);
    const secret = options?.secret ?? readKeyringSecret();
    const source = join(profileDir, "Default", "Cookies");

    // Copy first: Brave holds the live DB, and a torn page would corrupt a row.
    const scratch = mkdtempSync(join(tmpdir(), "suno-brave-cookies-"));
    const copyPath = join(scratch, "Cookies");
    try {
        copyFileSync(source, copyPath);
        // Brave keeps its ciphertext in the same file; copy sidecars when present so SQLite can recover.
        for (const sidecar of readdirSync(join(profileDir, "Default"))) {
            if (sidecar.startsWith("Cookies-")) {
                copyFileSync(join(profileDir, "Default", sidecar), join(scratch, sidecar));
            }
        }

        const db = new Database(copyPath, { readonly: true });
        const rows = db
            .query<CookieRow, []>(
                "select host_key, name, value, encrypted_value, path, is_secure, is_httponly, samesite, expires_utc " +
                "from cookies where host_key like '%suno.com'"
            )
            .all();
        db.close();

        const records: BraveCookieRecord[] = [];
        const headerParts: string[] = [];

        for (const row of rows) {
            if (!row.host_key.endsWith("suno.com")) continue;

            let value = row.value ?? "";
            if (!value && row.encrypted_value) {
                try {
                    value = decryptBraveCookie(Buffer.from(row.encrypted_value), secret);
                } catch {
                    continue;
                }
            }
            if (!value) continue;

            records.push({
                host: row.host_key,
                name: row.name,
                value,
                path: row.path || "/",
                secure: row.is_secure === 1,
                httpOnly: row.is_httponly === 1,
                sameSite: SAME_SITE_BY_CODE[row.samesite] ?? 'Lax',
                expiresAt: chromeEpochToUnixSeconds(row.expires_utc),
            });

            // Only cookies that actually apply to both suno.com and studio-api.prod.suno.com.
            if (hostApplies(row.host_key, "studio-api.prod.suno.com")) {
                headerParts.push(`${row.name}=${value}`);
            }
        }

        const valueOf = (key: string): string | undefined => records.find((c) => `${c.host}|${c.name}` === key)?.value;
        const sessionToken = valueOf(".suno.com|__session") ?? valueOf("suno.com|__session") ?? valueOf("suno.com|__session_Jnxw-muT");
        const clientToken = valueOf("auth.suno.com|__client") ?? valueOf(".suno.com|__client") ?? valueOf("suno.com|__client");
        const claims = sessionToken ? decodeJwtPayload(sessionToken) : null;
        const sessionId = readJwtString(claims, "sid");
        const expiresAt = typeof claims?.exp === "number" ? claims.exp : undefined;

        return {
            profileDir,
            cookieHeader: headerParts.join("; "),
            sessionToken,
            clientToken,
            sessionId,
            sessionExpiresAt: expiresAt,
            handle: readJwtString(claims, "suno/handle"),
            email: readJwtString(claims, "suno.com/claims/email", "https://suno.ai/claims/email"),
            userId: readJwtString(claims, "suno/user_id", "suno.com/claims/user_id"),
            cookies: records,
        };
    } finally {
        rmSync(scratch, { recursive: true, force: true });
    }
};
