import { closeSync, existsSync, mkdirSync, openSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { buildSunoAuthHeaders, mintSunoSessionToken, SUNO_API_BASE } from "../../src/services/sunoApi";
import type { Cookie } from "@playwright/test";
import { readBraveSunoCookies, type BraveCookieRecord, type BraveSunoCookies } from "./braveCookies";

/**
 * Token broker for Suno.
 *
 * Suno's studio-api takes a Clerk session JWT (~1h). That JWT can be re-minted at
 * any time from the long-lived (~1y) `__client` cookie with Clerk's FAPI, so a
 * harvested client token keeps backups running without a live browser.
 */

export interface SunoSessionRecord {
    token: string;
    cookieHeader: string;
    extractedAt: string;
    credits?: number;
    userHandle?: string;
    userId?: string;
    email?: string;
    clientToken?: string;
    sessionId?: string;
    sessionExpiresAt?: number;
    source: 'brave' | 'playwright' | 'manual';
    profileDir?: string;
}

export interface SunoIdentity {
    credits?: number;
    handle?: string;
    userId?: string;
    email?: string;
}

export interface ResolveSunoTokenOptions {
    /** Allow reading cookies from the local Brave profile when the stored token is stale. */
    allowBraveHarvest?: boolean;
    profileDir?: string;
    /** Skip verification round-trips (still used by the CLI to print status). */
    verbose?: boolean;
}

const SESSION_DIR = resolve(process.cwd(), ".suno-session");
const SESSION_FILE = join(SESSION_DIR, "session.json");
const ENV_FILE = resolve(process.cwd(), ".env");

export const getSunoSessionPaths = () => ({ dir: SESSION_DIR, file: SESSION_FILE, envFile: ENV_FILE });

/**
 * Maps a Brave cookie jar onto Playwright's cookie shape so a browser can be
 * bootstrapped into an already-authenticated Suno session (no manual login).
 */
export const toPlaywrightCookies = (cookies: BraveCookieRecord[]): Cookie[] =>
    cookies.map((cookie) => ({
        name: cookie.name,
        value: cookie.value,
        domain: cookie.host,
        path: cookie.path,
        secure: cookie.secure,
        httpOnly: cookie.httpOnly,
        sameSite: cookie.sameSite,
        expires: cookie.expiresAt ?? -1,
    }));

export const readSunoSession = (): SunoSessionRecord | null => {
    if (!existsSync(SESSION_FILE)) return null;
    try {
        const parsed: unknown = JSON.parse(readFileSync(SESSION_FILE, "utf8"));
        if (!parsed || typeof parsed !== "object") return null;
        const record = parsed as Partial<SunoSessionRecord>;
        if (typeof record.token !== "string") return null;
        return {
            token: record.token,
            cookieHeader: typeof record.cookieHeader === "string" ? record.cookieHeader : "",
            extractedAt: typeof record.extractedAt === "string" ? record.extractedAt : new Date().toISOString(),
            credits: record.credits,
            userHandle: record.userHandle,
            userId: record.userId,
            email: record.email,
            clientToken: record.clientToken,
            sessionId: record.sessionId,
            sessionExpiresAt: record.sessionExpiresAt,
            source: record.source ?? "manual",
            profileDir: record.profileDir,
        };
    } catch {
        return null;
    }
};

/** Writes the session file plus .env (SUNO_TOKEN / SUNO_COOKIE) with owner-only permissions. */
export const writeSunoSession = (record: SunoSessionRecord, envFile: string = ENV_FILE): void => {
    mkdirSync(SESSION_DIR, { recursive: true });
    writeFileSync(SESSION_FILE, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });

    const entries: Record<string, string> = { SUNO_TOKEN: record.token };
    if (record.cookieHeader) entries.SUNO_COOKIE = `"${record.cookieHeader.replace(/"/g, '\\"')}"`;
    if (record.clientToken) entries.SUNO_CLIENT_TOKEN = record.clientToken;

    updateEnvFile(envFile, entries);
};

/** surgically updates KEY=VALUE lines in .env, preserving every other line. */
export const updateEnvFile = (envFile: string, entries: Record<string, string>): void => {
    let content = existsSync(envFile) ? readFileSync(envFile, "utf8") : "";
    for (const [key, value] of Object.entries(entries)) {
        const line = `${key}=${value}`;
        const pattern = new RegExp(`^${key}=.*$`, "m");
        content = pattern.test(content) ? content.replace(pattern, line) : `${content.trimEnd()}\n${line}\n`;
    }
    if (!content.endsWith("\n")) content += "\n";
    if (!existsSync(envFile)) closeSync(openSync(envFile, "a", 0o600));
    writeFileSync(envFile, content, { mode: 0o600 });
};

export const decodeJwtClaims = (token: string): Record<string, unknown> | null => {
    const parts = token.split(".");
    if (parts.length !== 3) return null;
    try {
        const json = Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString("utf8");
        const parsed: unknown = JSON.parse(json);
        return parsed && typeof parsed === "object" ? (parsed as Record<string, unknown>) : null;
    } catch {
        return null;
    }
};

export const isSunoTokenExpired = (token: string, skewSeconds: number = 60): boolean => {
    const claims = decodeJwtClaims(token);
    const exp = claims?.exp;
    if (typeof exp !== "number") return false; // Opaque token: let the API decide.
    return Date.now() / 1000 + skewSeconds >= exp;
};

/** Hits studio-api to confirm the token is accepted, returning account details. */
export const verifySunoToken = async (token: string): Promise<SunoIdentity> => {
    const headers = buildSunoAuthHeaders(token);

    const billing = await fetch(`${SUNO_API_BASE}/api/billing/info/`, { headers });
    if (!billing.ok) {
        throw new Error(`Suno rejected the token (HTTP ${billing.status} on /api/billing/info/).`);
    }
    const billingBody: unknown = await billing.json();
    const credits = billingBody && typeof billingBody === "object" && typeof (billingBody as Record<string, unknown>).credits === "number"
        ? ((billingBody as Record<string, unknown>).credits as number)
        : undefined;

    const identity: SunoIdentity = { credits };

    const claims = decodeJwtClaims(token);
    const handle = claims?.["suno/handle"];
    const email = claims?.["suno.com/claims/email"] ?? claims?.["https://suno.ai/claims/email"];
    if (typeof handle === "string") identity.handle = handle;
    if (typeof email === "string") identity.email = email;

    if (!identity.handle) {
        const me = await fetch(`${SUNO_API_BASE}/api/user/me`, { headers });
        if (me.ok) {
            const meBody: unknown = await me.json();
            if (meBody && typeof meBody === "object") {
                const record = meBody as Record<string, unknown>;
                if (typeof record.handle === "string") identity.handle = record.handle;
                if (typeof record.user_id === "string") identity.userId = record.user_id;
            }
        }
    }

    return identity;
};

export const sessionFromBrave = (harvest: BraveSunoCookies): SunoSessionRecord => ({
    token: harvest.sessionToken ?? "",
    cookieHeader: harvest.cookieHeader,
    extractedAt: new Date().toISOString(),
    userHandle: harvest.handle,
    email: harvest.email,
    userId: harvest.userId,
    clientToken: harvest.clientToken,
    sessionId: harvest.sessionId,
    sessionExpiresAt: harvest.sessionExpiresAt,
    source: "brave",
    profileDir: harvest.profileDir,
});

/** Mints a fresh session JWT from a stored Clerk client token and verifies it. */
export const refreshSunoSession = async (session: SunoSessionRecord): Promise<SunoSessionRecord> => {
    if (!session.clientToken) {
        throw new Error(
            "Stored session has no Clerk client token, so it cannot be refreshed. " +
            "Re-harvest from Brave (default) or pass --token=<jwt>."
        );
    }

    const minted = await mintSunoSessionToken(session.clientToken, session.sessionId);
    const identity = await verifySunoToken(minted.token);

    const record: SunoSessionRecord = {
        ...session,
        token: minted.token,
        sessionId: minted.sessionId,
        extractedAt: new Date().toISOString(),
        credits: identity.credits,
        userHandle: identity.handle ?? session.userHandle,
        email: identity.email ?? session.email,
        userId: identity.userId ?? session.userId,
    };
    writeSunoSession(record);
    return record;
};

/**
 * Returns a token that studio-api accepts, preferring (in order):
 * stored Clerk client token -> fresh Brave harvest -> still-valid stored JWT.
 */
export const resolveSunoToken = async (options?: ResolveSunoTokenOptions): Promise<{ token: string; session: SunoSessionRecord }> => {
    const stored = readSunoSession();

    if (stored?.clientToken) {
        try {
            const refreshed = await refreshSunoSession(stored);
            return { token: refreshed.token, session: refreshed };
        } catch (error) {
            if (options?.verbose) console.warn(`Client-token refresh failed: ${(error as Error).message}`);
        }
    }

    if (options?.allowBraveHarvest !== false) {
        try {
            const harvest = readBraveSunoCookies({ profileDir: options?.profileDir });
            const record = sessionFromBrave(harvest);
            if (!record.token && record.clientToken) {
                const minted = await mintSunoSessionToken(record.clientToken, record.sessionId);
                record.token = minted.token;
                record.sessionId = minted.sessionId;
            }
            if (record.token) {
                const identity = await verifySunoToken(record.token);
                record.credits = identity.credits;
                record.userHandle = identity.handle ?? record.userHandle;
                record.userId = identity.userId ?? record.userId;
                writeSunoSession(record);
                return { token: record.token, session: record };
            }
        } catch (error) {
            if (options?.verbose) console.warn(`Brave harvest failed: ${(error as Error).message}`);
        }
    }

    if (stored?.token && !isSunoTokenExpired(stored.token)) {
        const identity = await verifySunoToken(stored.token);
        const record = { ...stored, credits: identity.credits };
        writeSunoSession(record);
        return { token: stored.token, session: record };
    }

    throw new Error(
        "No usable Suno credential found.\n" +
        `  - Session file: ${SESSION_FILE}\n` +
        "  - Fix: run `bun run suno:auth` with Brave logged into suno.com, or pass --token=<jwt>.\n" +
        `  - Brave profiles searched: ${join(homedir(), ".var/app/com.brave.Browser/...")}, ${join(homedir(), ".config/BraveSoftware/...")}`
    );
};

export const describeSession = (session: SunoSessionRecord): string => {
    const claims = decodeJwtClaims(session.token);
    const exp = typeof claims?.exp === "number" ? new Date(claims.exp * 1000).toISOString() : "unknown";
    const plan = typeof claims?.plan === "string" ? claims.plan : "unknown";
    return [
        `user      : ${session.userHandle ?? "unknown"} <${session.email ?? "unknown"}>`,
        `plan      : ${plan}`,
        `credits   : ${session.credits ?? "unknown"}`,
        `source    : ${session.source}${session.profileDir ? ` (${session.profileDir})` : ""}`,
        `token exp : ${exp}`,
        `refresh   : ${session.clientToken ? "clerk client token stored" : "not available"}`,
    ].join("\n");
};
