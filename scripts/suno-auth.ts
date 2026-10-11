#!/usr/bin/env bun
/**
 * Suno auth broker.
 *
 *   bun run suno:auth                 # harvest cookies from local Brave, mint + verify a token
 *   bun run suno:auth --refresh       # re-mint from the stored Clerk client token
 *   bun run suno:auth --token=<jwt>   # use a token pasted from the browser
 *   bun run suno:auth --print-token   # emit only the bearer token (pipe-friendly)
 *
 * Results land in .suno-session/session.json (0600) and .env (SUNO_TOKEN/SUNO_COOKIE).
 */
import { mintSunoSessionToken } from "../src/services/sunoApi";
import { readBraveSunoCookies } from "./lib/braveCookies";
import {
    decodeJwtClaims,
    describeSession,
    readSunoSession,
    refreshSunoSession,
    resolveSunoToken,
    sessionFromBrave,
    verifySunoToken,
    writeSunoSession,
    type SunoSessionRecord,
} from "./lib/sunoSession";

interface CliArgs {
    token?: string;
    cookie?: string;
    profileDir?: string;
    noBrave: boolean;
    refresh: boolean;
    printToken: boolean;
    json: boolean;
    help: boolean;
}

const parseArgs = (argv: string[]): CliArgs => {
    const args: CliArgs = {
        noBrave: false,
        refresh: false,
        printToken: false,
        json: false,
        help: false,
    };

    for (const arg of argv) {
        if (arg === "--no-brave") args.noBrave = true;
        else if (arg === "--refresh") args.refresh = true;
        else if (arg === "--print-token") args.printToken = true;
        else if (arg === "--json") args.json = true;
        else if (arg === "--help" || arg === "-h") args.help = true;
        else if (arg.startsWith("--token=")) args.token = arg.slice("--token=".length);
        else if (arg.startsWith("--cookie=")) args.cookie = arg.slice("--cookie=".length);
        else if (arg.startsWith("--profile=")) args.profileDir = arg.slice("--profile=".length);
    }

    return args;
};

const USAGE = `Usage: bun run suno:auth [options]

Options:
  --token=<jwt>          Store an explicit Clerk session JWT (from window.Clerk.session.getToken())
  --cookie=<string>      Store an explicit cookie string (__client=... gives the longest-lived refresh)
  --profile=<dir>        Brave profile "Brave-Browser" directory (default: auto-detect)
  --no-brave             Never read cookies from Brave
  --refresh              Re-mint from the stored Clerk client token
  --print-token          Print only the bearer token (for piping into another command)
  --json                 Print the stored session record as JSON
  -h, --help             Show this help
`;

const main = async (): Promise<number> => {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
        process.stdout.write(USAGE);
        return 0;
    }

    let session: SunoSessionRecord | undefined;

    if (args.token) {
        const identity = await verifySunoToken(args.token);
        const claims = decodeJwtClaims(args.token);
        const sid = typeof claims?.sid === "string" ? claims.sid : undefined;
        session = {
            token: args.token,
            cookieHeader: args.cookie ?? "",
            extractedAt: new Date().toISOString(),
            credits: identity.credits,
            userHandle: identity.handle,
            userId: identity.userId,
            email: identity.email,
            sessionId: sid,
            source: "manual",
        };
    } else if (args.cookie) {
        const clientToken = /__client(?:_[\w-]+)?=([^;]+)/.exec(args.cookie)?.[1];
        const sessionToken = /__session(?:_[\w-]+)?=([^;]+)/.exec(args.cookie)?.[1];
        const claims = sessionToken ? decodeJwtClaims(sessionToken) : null;
        session = {
            token: sessionToken ?? "",
            cookieHeader: args.cookie,
            extractedAt: new Date().toISOString(),
            clientToken,
            sessionId: typeof claims?.sid === "string" ? claims.sid : undefined,
            source: "manual",
        };
        if (clientToken) {
            const minted = await mintSunoSessionToken(clientToken, session.sessionId);
            session.token = minted.token;
            session.sessionId = minted.sessionId;
        }
        const identity = await verifySunoToken(session.token);
        session.credits = identity.credits;
        session.userHandle = identity.handle ?? session.userHandle;
        session.userId = identity.userId ?? session.userId;
        session.email = identity.email ?? session.email;
    } else if (args.refresh) {
        const stored = readSunoSession();
        if (!stored) throw new Error("No stored session to refresh. Run without --refresh first.");
        session = await refreshSunoSession(stored);
    } else if (!args.noBrave) {
        const harvest = readBraveSunoCookies({ profileDir: args.profileDir });
        session = sessionFromBrave(harvest);
        if (session.clientToken) {
            const minted = await mintSunoSessionToken(session.clientToken, session.sessionId);
            session.token = minted.token;
            session.sessionId = minted.sessionId;
        }
        if (!session.token) throw new Error("Brave has a Suno client token but no session cookie; run without --no-brave after visiting suno.com in Brave.");
        const identity = await verifySunoToken(session.token);
        session.credits = identity.credits;
        session.userHandle = identity.handle ?? session.userHandle;
        session.userId = identity.userId ?? session.userId;
        session.email = identity.email ?? session.email;
    } else {
        const resolved = await resolveSunoToken({ allowBraveHarvest: false, verbose: true });
        session = resolved.session;
    }

    writeSunoSession(session);

    if (args.printToken) {
        process.stdout.write(`${session.token}\n`);
        return 0;
    }

    if (args.json) {
        process.stdout.write(`${JSON.stringify(session, null, 2)}\n`);
        return 0;
    }

    process.stdout.write(`Suno session ready\n${describeSession(session)}\n`);
    process.stdout.write(`Saved to .suno-session/session.json and .env (SUNO_TOKEN)\n`);
    return 0;
};

main()
    .then((code) => process.exit(code))
    .catch((error: unknown) => {
        console.error(`suno:auth failed: ${error instanceof Error ? error.message : String(error)}`);
        process.exit(1);
    });
