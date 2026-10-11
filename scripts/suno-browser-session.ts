import { chromium, type BrowserContext, type Cookie, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { readBraveSunoCookies } from './lib/braveCookies';
import { decodeJwtClaims, toPlaywrightCookies, writeSunoSession } from './lib/sunoSession';

const SESSION_DIR = path.resolve(process.cwd(), '.suno-session');
const USER_DATA_DIR = path.join(SESSION_DIR, 'chromium_profile');

interface CapturedAuth {
  token: string | null;
  cookieHeader: string;
  clientToken?: string;
  sessionId?: string;
}

async function verifyToken(token: string, cookieHeader: string): Promise<{ credits?: number; handle?: string }> {
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
    };
    if (token) {
      headers['Authorization'] = `Bearer ${token}`;
    }
    if (cookieHeader) {
      headers['Cookie'] = cookieHeader;
    }

    const res = await fetch('https://studio-api.prod.suno.com/api/billing/info/', { headers });
    if (!res.ok) {
      return {};
    }
    const data = (await res.json()) as { credits?: number; total_credits_left?: number };
    return {
      credits: typeof data?.credits === 'number' ? data.credits : data?.total_credits_left,
    };
  } catch {
    return {};
  }
}

/**
 * Suno's Clerk integration does not expose `window.Clerk` (verified in Chromium),
 * so the token is read from cookies. `__session` is deliberately NOT httpOnly,
 * which also makes it readable from the page console.
 */
async function extractAuthFromPage(context: BrowserContext): Promise<CapturedAuth> {
  const cookies = await context.cookies(['https://suno.com', 'https://auth.suno.com', 'https://studio-api.prod.suno.com']);
  const cookieHeader = cookies.map((c) => `${c.name}=${c.value}`).join('; ');

  // Several __session variants can coexist (host-only + .suno.com, suffixed Clerk
  // instances) and stale copies shadow fresh ones, so pick the latest expiry.
  const sessionCandidates = cookies
    .filter((c) => /^__session(_[\w-]+)?$/.test(c.name) && c.value.startsWith('ey'))
    .map((c) => {
      const exp = decodeJwtClaims(c.value)?.exp;
      return { value: c.value, exp: typeof exp === 'number' ? exp : 0 };
    })
    .sort((a, b) => b.exp - a.exp);

  const token = sessionCandidates[0]?.value ?? null;

  // Long-lived Clerk client token lets later runs mint fresh JWTs without a browser.
  const clientCookie = cookies.find((c) => /^__client(_[\w-]+)?$/.test(c.name) && c.value.startsWith('ey'));
  const claims = token ? decodeJwtClaims(token) : null;

  return {
    token,
    cookieHeader,
    clientToken: clientCookie?.value,
    sessionId: typeof claims?.sid === 'string' ? claims.sid : undefined,
  };
}

async function main() {
  const args = process.argv.slice(2);
  const keepAlive = !args.includes('--close-on-auth');
  const customToken = args.find((a) => a.startsWith('--token='))?.split('=')[1];
  const seedBrave = args.includes('--seed-brave');
  const headless = args.includes('--headless');

  if (customToken) {
    console.log('Using provided custom token from argument...');
    const authInfo = await verifyToken(customToken, '');
    writeSunoSession({
      token: customToken,
      cookieHeader: '',
      extractedAt: new Date().toISOString(),
      credits: authInfo.credits,
      userHandle: authInfo.handle,
      source: 'manual',
    });
    console.log(`✓ Token verified! Credits remaining: ${authInfo.credits ?? 'unknown'}`);
    console.log('✓ Saved to .suno-session/session.json and .env');
    return;
  }

  fs.mkdirSync(SESSION_DIR, { recursive: true });
  fs.mkdirSync(USER_DATA_DIR, { recursive: true });

  console.log('====================================================');
  console.log('  Suno Browser Session Manager');
  console.log('====================================================');

  let seedCookies: Cookie[] = [];
  if (seedBrave) {
    const harvest = readBraveSunoCookies();
    seedCookies = toPlaywrightCookies(harvest.cookies);
    console.log(`Seeding ${seedCookies.length} cookies from ${harvest.profileDir}`);
  }

  console.log(`Launching browser window${headless ? ' (headless)' : ''} (persistent profile)...`);

  const context = await chromium.launchPersistentContext(USER_DATA_DIR, {
    headless,
    executablePath: '/usr/bin/chromium-browser',
    args: [
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-blink-features=AutomationControlled',
    ],
    viewport: { width: 1280, height: 800 },
  });

  if (seedCookies.length) await context.addCookies(seedCookies);

  const page = context.pages()[0] || (await context.newPage());

  let capturedToken: string | null = null;

  // Intercept studio-api requests to capture auth headers in real time
  page.on('request', async (req) => {
    const url = req.url();
    if (url.includes('suno.com') || url.includes('studio-api')) {
      const headers = req.headers();
      const auth = headers['authorization'];
      if (auth && auth.startsWith('Bearer ey') && !capturedToken) {
        capturedToken = auth.slice(7).trim();
      }
    }
  });

  console.log('Navigating to https://suno.com...');
  try {
    await page.goto('https://suno.com', { timeout: 45000, waitUntil: 'domcontentloaded' });
  } catch (e: any) {
    console.log('Note on page load:', e.message);
  }

  console.log('\n[!] Waiting for login. If not logged in, please log in inside the opened browser window.');
  console.log('    (Use --seed-brave to reuse the Brave session instead of logging in.)');
  console.log('Checking for active session every 3 seconds...\n');

  let verified = false;
  const maxAttempts = 60; // ~3 minutes
  let attempts = 0;
  let lastRejection: string | null = null;

  while (!verified && attempts < maxAttempts) {
    attempts += 1;
    const { promise: waitTick, resolve: resolveTick } = Promise.withResolvers<void>();
    setTimeout(resolveTick, 3000);
    await waitTick;

    try {
      const { token, cookieHeader, clientToken, sessionId } = await extractAuthFromPage(context);
      const activeToken = token || capturedToken;

      if (activeToken) {
        const verifyRes = await verifyToken(activeToken, cookieHeader);
        const claims = decodeJwtClaims(activeToken);
        const exp = typeof claims?.exp === 'number' ? new Date(claims.exp * 1000).toISOString() : 'unknown';

        if (verifyRes.credits !== undefined) {
          console.log(`\n====================================================`);
          console.log(`✓ LOGIN SUCCESSFUL!`);
          console.log(`✓ Total Credits Remaining: ${verifyRes.credits}`);
          console.log(`====================================================\n`);

          writeSunoSession({
            token: activeToken,
            cookieHeader,
            extractedAt: new Date().toISOString(),
            credits: verifyRes.credits,
            userHandle: verifyRes.handle,
            clientToken,
            sessionId,
            source: 'playwright',
          });

          console.log('✓ Session saved to .suno-session/session.json');
          console.log('✓ Updated .env with SUNO_TOKEN and SUNO_COOKIE');
          if (!clientToken) {
            console.log('! No Clerk __client cookie captured - refreshes will need a browser login again.');
          }
          verified = true;
          break;
        }

        lastRejection = `token exp ${exp} was rejected by studio-api`;
        if (attempts % 5 === 0) console.log(`  still waiting (${attempts}/${maxAttempts}): ${lastRejection}`);
      } else if (attempts % 5 === 0) {
        console.log(`  still waiting (${attempts}/${maxAttempts}): no __session cookie yet`);
      }
    } catch {}
  }

  if (!verified) {
    console.error(`\nNo usable Suno session after ${maxAttempts} checks.${lastRejection ? ` Last error: ${lastRejection}` : ''}`);
    console.error('Log in inside the browser window (or rerun with --seed-brave while Brave is logged in), then retry.');
    await context.close();
    process.exit(1);
  }

  if (keepAlive) {
    console.log('Keeping browser window open as requested.');
    console.log('You can continue using this browser window or press Ctrl+C in terminal to stop.\n');
    const { promise: keepAlivePromise } = Promise.withResolvers<void>();
    await keepAlivePromise; // Keep alive indefinitely
  } else {
    await context.close();
    console.log('Browser session closed.');
  }
}

main().catch((err) => {
  console.error('Browser session failed:', err);
  process.exit(1);
});
