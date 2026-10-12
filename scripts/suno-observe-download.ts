import { chromium } from '@playwright/test';
import { readBraveSunoCookies } from './lib/braveCookies';
import { toPlaywrightCookies } from './lib/sunoSession';

const clipId = process.argv[2] || 'b1886fa5-7c47-4dc7-a751-c5d0c8a3f79b';
const harvest = readBraveSunoCookies();
const context = await chromium.launchPersistentContext('.suno-session/observe', {
  headless: true,
  executablePath: '/usr/bin/chromium-browser',
  args: ['--no-sandbox', '--disable-blink-features=AutomationControlled'],
  viewport: { width: 1280, height: 900 },
  acceptDownloads: true,
});
await context.addCookies(toPlaywrightCookies(harvest.cookies));
const page = context.pages()[0] || (await context.newPage());
const log: string[] = [];
const jsUrls = new Set<string>();
page.on('response', (res) => { const u = res.url(); if (/\.js(\?|$)/.test(u)) jsUrls.add(u); });
page.on('request', (req) => {
  const u = req.url();
  if (/studio-api|cdn1|cloudfront|download|Key-Pair/i.test(u) && !/\.(png|jpe?g|svg|woff2?|css)(\?|$)/i.test(u)) {
    log.push(`REQ ${req.method()} ${u.slice(0, 220)}`);
  }
});
page.on('response', async (res) => {
  const u = res.url();
  if (/studio-api/i.test(u) && res.request().method() !== 'OPTIONS' && (res.request().method() !== 'GET' || /download|unlock|clips\//i.test(u))) {
    let body = '';
    try { body = (await res.text()).slice(0, 400); } catch {}
    log.push(`RES ${res.status()} ${u.slice(0, 160)} :: ${body.replace(/\s+/g, ' ')}`);
  }
});
page.on('download', (d) => log.push(`DOWNLOAD url=${d.url().slice(0, 300)} name=${d.suggestedFilename()}`));

await page.goto(`https://suno.com/song/${clipId}`, { waitUntil: 'domcontentloaded' });
await page.waitForTimeout(6000);
log.push('--- page loaded; buttons: ' + (await page.locator('button').allInnerTexts()).filter(Boolean).slice(0, 40).join(' | '));
const aria = await page.locator('button[aria-label]').evaluateAll((els) => els.map((e) => e.getAttribute('aria-label')));
log.push('--- aria-labels: ' + aria.join(' | '));

// Song page main menu
const more = page.locator('button[aria-label="More options"]').first();
log.push('More actions count=' + (await more.count()));
await more.click({ timeout: 5000 }).catch((e) => log.push('click failed ' + e.message.split('\n')[0]));
await page.waitForTimeout(1200);
let items = await page.locator('[role="menuitem"]').allInnerTexts();
log.push('menu items: ' + items.filter(Boolean).join(' | '));
const popups = await page.locator('[role="menu"], [role="dialog"], [data-popup-open], [data-side]').allInnerTexts();
log.push('popups: ' + popups.map((t) => t.replace(/\s+/g, ' ').slice(0, 300)).join(' || '));
await page.screenshot({ path: '.suno-session/observe/menu.png' });
const dl = page.locator('[role="menuitem"]:has-text("Download")').first();
await dl.click({ timeout: 3000 }).catch((e) => log.push('dl click failed ' + e.message.split('\n')[0]));
await page.waitForTimeout(2500);
await page.screenshot({ path: '.suno-session/observe/dialog.png' });
const dialogs = await page.locator('[role="dialog"], [role="menu"]').allInnerTexts();
log.push('after Download click: ' + dialogs.map((t) => t.replace(/\s+/g, ' ').slice(0, 400)).join(' || '));
const opts = await page.locator('button, [role="menuitem"], [role="option"], a').evaluateAll((els) =>
  els.filter((e) => /mp3|audio|wav|download/i.test(e.textContent || '')).map((e) => `${e.tagName}:${(e.textContent || '').trim().slice(0, 60)}`));
log.push('candidates: ' + opts.join(' | '));
page.on('request', (req) => { if (/studio-api|cdn1|s3\.amazonaws|cloudfront/i.test(req.url()) && !/\.(png|jpe?g|webp|svg|woff2?|css)(\?|$)/i.test(req.url())) log.push(`REQ2 ${req.method()} ${req.url().slice(0, 300)} body=${(req.postData() || '').slice(0, 400)}`); });
page.on('response', async (res) => { const u = res.url(); if (/studio-api.*(download|unlock|authorize|billing)/i.test(u) && res.request().method() !== 'OPTIONS') { let b=''; try { b=(await res.text()).slice(0,700);} catch {} log.push(`RES2 ${res.status()} ${u.slice(0,200)} :: ${b.replace(/\s+/g,' ')}`); } });
const fmt = page.locator('[role="dialog"] button:has-text("MP3")').first();
await fmt.click({ timeout: 3000 }).catch((e) => log.push('fmt click failed ' + e.message.split('\n')[0]));
await page.waitForTimeout(1500);
await page.screenshot({ path: '.suno-session/observe/after-fmt.png' });
log.push('dialog after fmt: ' + (await page.locator('[role="dialog"]').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').slice(0, 300)).join(' || '));
const unlock = page.locator('[role="dialog"] button:has-text("Unlock")').first();
log.push('unlock disabled=' + (await unlock.getAttribute('disabled')));
const [download] = await Promise.all([
  page.waitForEvent('download', { timeout: 30000 }).catch(() => null),
  unlock.click({ timeout: 5000 }).catch((e) => log.push('unlock click failed ' + e.message.split('\n')[0])),
]);
if (download) { log.push('DOWNLOAD url=' + download.url().slice(0, 700) + ' name=' + download.suggestedFilename()); await download.cancel().catch(() => {}); }
await page.waitForTimeout(8000);
await page.screenshot({ path: '.suno-session/observe/after-unlock.png' });
log.push('dialog after unlock: ' + (await page.locator('[role="dialog"]').allInnerTexts()).map((t) => t.replace(/\s+/g, ' ').slice(0, 400)).join(' || '));
log.push('js chunks: ' + jsUrls.size);
const hits: string[] = [];
for (const u of jsUrls) {
  let text = '';
  try { text = await (await fetch(u)).text(); } catch { continue; }
  const re = /["'`][^"'`]{0,80}(download|unlock)[^"'`]{0,120}["'`]/gi;
  let m: RegExpExecArray | null;
  const local = new Set<string>();
  while ((m = re.exec(text))) { const frag = m[0]; if (/api|\/|url|key-pair|policy|signature|cdn/i.test(frag)) local.add(frag.slice(0, 200)); }
  if (local.size) hits.push(`## ${u.split('/').pop()?.slice(0, 60)}\n` + [...local].slice(0, 40).join('\n'));
}
require('node:fs').writeFileSync('.suno-session/observe/download-strings.txt', hits.join('\n\n'));
log.push('string hits written: ' + hits.length);
await page.screenshot({ path: '.suno-session/observe/shot.png' });
console.log(log.join('\n'));
await context.close();
