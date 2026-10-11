import path from 'path';
import { execSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { defineConfig, loadEnv, type Plugin } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite'

function sunoDevProxyPlugin(env: Record<string, string>): Plugin {
  const sessionFile = path.resolve(process.cwd(), '.suno-session/session.json');

  /** Reads the CLI-managed session so `bun run dev` can authenticate without pasting a token. */
  const readDevSession = () => {
    try {
      if (!existsSync(sessionFile)) return null;
      const parsed = JSON.parse(readFileSync(sessionFile, 'utf8')) as {
        token?: string;
        userHandle?: string;
        credits?: number;
        source?: string;
      };
      if (!parsed?.token) return null;

      const payload = parsed.token.split('.')[1];
      const claims = payload
        ? (JSON.parse(Buffer.from(payload.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8')) as { exp?: number })
        : {};
      const expiresAt = typeof claims.exp === 'number' ? claims.exp : undefined;

      return {
        token: parsed.token,
        handle: parsed.userHandle ?? null,
        credits: parsed.credits ?? null,
        source: parsed.source ?? 'unknown',
        expiresAt: expiresAt ?? null,
        expired: expiresAt !== undefined && Date.now() / 1000 >= expiresAt,
      };
    } catch {
      return null;
    }
  };

  return {
    name: 'suno-dev-proxy',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url?.startsWith('/__suno/session') && req.method === 'GET') {
          const remote = req.socket.remoteAddress ?? '';
          const isLoopback = remote === '' || remote === '::1' || remote.startsWith('127.') || remote === '::ffff:127.0.0.1';
          res.setHeader('Content-Type', 'application/json');
          res.setHeader('Cache-Control', 'no-store');

          // This endpoint hands out a live credential, so never serve it off-machine
          // (relevant when running `vite --host`).
          if (!isLoopback) {
            res.statusCode = 403;
            res.end(JSON.stringify({ error: 'Dev session endpoint is loopback-only.' }));
            return;
          }

          const session = readDevSession();
          if (!session) {
            res.statusCode = 404;
            res.end(JSON.stringify({ error: 'No .suno-session/session.json - run `bun run suno:auth` first.' }));
            return;
          }
          res.statusCode = 200;
          res.end(JSON.stringify(session));
          return;
        }

        if (req.url === '/api/suno-proxy' && req.method === 'POST') {
          const chunks: Buffer[] = [];
          req.on('data', (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          req.on('end', async () => {
            try {
              const bodyBuffer = Buffer.concat(chunks);
              let authHeader = req.headers['authorization'] as string | undefined;
              let customCookie = req.headers['x-suno-cookie'] as string | undefined;

              if (!authHeader && env.SUNO_TOKEN) {
                authHeader = `Bearer ${env.SUNO_TOKEN}`;
              }
              if (!customCookie && env.SUNO_COOKIE) {
                customCookie = env.SUNO_COOKIE;
              }

              const browserToken = JSON.stringify({
                token: Buffer.from(JSON.stringify({ timestamp: Date.now() })).toString('base64'),
              });

              const headers: Record<string, string> = {
                'accept': '*/*',
                'accept-language': 'en',
                'content-type': 'application/json',
                'browser-token': browserToken,
                'device-id': 'bf11e528-6a7b-4697-98aa-5f2d7ceeb194',
                'origin': 'https://suno.com',
                'referer': 'https://suno.com/',
                'sec-ch-ua': '"Chromium";v="130", "Not?A_Brand";v="24"',
                'sec-ch-ua-mobile': '?0',
                'sec-ch-ua-platform': '"Linux"',
                'sec-fetch-dest': 'empty',
                'sec-fetch-mode': 'cors',
                'sec-fetch-site': 'same-site',
                'user-agent':
                  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36',
              };

              if (authHeader) {
                headers['authorization'] = authHeader;
              }
              if (customCookie) {
                headers['cookie'] = customCookie;
              } else if (authHeader && authHeader.startsWith('Bearer ey')) {
                headers['cookie'] = `__session=${authHeader.slice(7).trim()}`;
              }

              const sunoRes = await fetch('https://studio-api-prod.suno.com/api/generate/v2-web/', {
                method: 'POST',
                headers,
                body: bodyBuffer,
              });

              const resText = await sunoRes.text();
              res.statusCode = sunoRes.status;
              res.setHeader('Content-Type', sunoRes.headers.get('content-type') || 'application/json');
              res.end(resText);
            } catch (err: any) {
              console.error('[suno-dev-proxy] Error proxying to Suno:', err);
              res.statusCode = 502;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: err?.message || 'Failed to proxy request to Suno' }));
            }
          });
        } else {
          next();
        }
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const apiProxyTarget = env.VITE_API_PROXY_TARGET || 'http://127.0.0.1:8787';
  const appVersion = JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')).version || '0.0.0';

  const ciCommit =
    process.env.VITE_APP_COMMIT ||
    process.env.CF_PAGES_COMMIT_SHA ||
    process.env.GITHUB_SHA ||
    process.env.COMMIT_SHA;

  let appCommit = ciCommit ? String(ciCommit).trim().slice(0, 7) : 'local';
  if (!appCommit || appCommit === 'local') {
    try {
      appCommit = execSync('git rev-parse --short HEAD', { stdio: ['ignore', 'pipe', 'ignore'] })
        .toString()
        .trim();
    } catch {
      appCommit = 'local';
    }
  }

  return {
    plugins: [
        react(),
        tailwindcss(),
        sunoDevProxyPlugin(env),
    ], 
    define: {
      'process.env.API_KEY': JSON.stringify(process.env.GEMINI_API_KEY),
      'process.env.GEMINI_API_KEY': JSON.stringify(process.env.GEMINI_API_KEY),
      'import.meta.env.VITE_GEMINI_API_KEY': JSON.stringify(process.env.GEMINI_API_KEY),
      'import.meta.env.VITE_OPENROUTER_API_KEY': JSON.stringify(process.env.OPENROUTER_API_KEY),
      'import.meta.env.VITE_OPENAPI_API_KEY': JSON.stringify(process.env.OPENAPI_API_KEY),
      'import.meta.env.VITE_OPENAPI_BASE_URL': JSON.stringify(process.env.OPENAPI_BASE_URL),
      'import.meta.env.VITE_AI_PROVIDER_TYPE': JSON.stringify(process.env.AI_PROVIDER_TYPE),
      'import.meta.env.VITE_AI_PROVIDER_MODEL': JSON.stringify(process.env.AI_PROVIDER_MODEL),
      'import.meta.env.VITE_APP_VERSION': JSON.stringify(appVersion),
      'import.meta.env.VITE_APP_COMMIT': JSON.stringify(appCommit),
    },
    server: {
      proxy: {
        '/api': {
          target: apiProxyTarget,
          changeOrigin: true,
          secure: false,
        },
      },
    },
    resolve: {
      alias: {
        '@': path.resolve(__dirname, '.'),
      }
    }
  };
});
