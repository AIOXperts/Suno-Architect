import { chromium } from '@playwright/test';
import fs from 'node:fs';

const token: string = JSON.parse(fs.readFileSync('.suno-session/session.json', 'utf8')).token;
const BASE = 'http://127.0.0.1:4173';
const out: string[] = [];
const say = (s: string) => { out.push(s); console.log(s); };

// Pick an unlocked and a locked song from the live feed.
const feed = await (await fetch('https://studio-api.prod.suno.com/api/feed/v2?page=0', { headers: { Authorization: `Bearer ${token}`, Origin: 'https://suno.com' } })).json() as any;
const unlocked = feed.clips.find((c: any) => c.is_download_unlocked);
const locked = feed.clips.find((c: any) => !c.is_download_unlocked && c.title !== unlocked.title);
say(`unlocked song: "${unlocked.title}" (${unlocked.id.slice(0, 8)}) | locked song: "${locked.title}" (${locked.id.slice(0, 8)})`);

const browser = await chromium.launch();
const ctx = await browser.newContext({ acceptDownloads: true });
const page = await ctx.newPage();
const authorizeCalls: string[] = [];
page.on('request', (r) => { if (/download\/authorize/.test(r.url())) authorizeCalls.push(r.url()); });
const consoleErrors: string[] = [];
page.on('console', (m) => { if (m.type() === 'error') consoleErrors.push(m.text().slice(0, 160)); });

for (let i = 0; i < 30; i++) { try { await page.goto(BASE, { waitUntil: 'domcontentloaded' }); break; } catch { await new Promise((r) => setTimeout(r, 1000)); } }
await page.evaluate((t) => { localStorage.setItem('suno_cookie', t); localStorage.setItem('suno_history', '[]'); }, token);
await page.reload({ waitUntil: 'domcontentloaded' });
await page.getByText('Suno Connected').waitFor({ timeout: 30000 });
say('✓ app connected to Suno with the stored token');

// ---- History: fetch and open the unlocked song ----
await page.locator('[data-view-tab="history"]').click();
await page.getByRole('button', { name: /Fetch/ }).first().click();
const unlockedCard = page.getByRole('heading', { name: unlocked.title, exact: true }).first();
await unlockedCard.waitFor({ timeout: 60000 });
say('✓ history fetched from Suno; cards rendered');
await unlockedCard.click();
await page.getByRole('button', { name: 'Download', exact: true }).waitFor({ timeout: 10000 });
await page.screenshot({ path: '.suno-session/observe/live-1-details.png' });
const paramsPanel = page.getByTestId('generation-params');
say(`generation params panel visible: ${await paramsPanel.isVisible()} :: ${(await paramsPanel.innerText().catch(() => '')).replace(/\s+/g, ' ').slice(0, 200)}`);

const [dl] = await Promise.all([
  page.waitForEvent('download', { timeout: 60000 }),
  page.getByRole('button', { name: 'Download', exact: true }).click(),
]);
const dlPath = await dl.path();
const size = dlPath ? fs.statSync(dlPath).size : 0;
const head = dlPath ? fs.readFileSync(dlPath).subarray(0, 3).toString('latin1') : '';
say(`✓ unlocked song downloaded: name=${dl.suggestedFilename()} size=${(size / 1e6).toFixed(2)} MB magic=${head === 'ID3' ? 'ID3 (valid MP3)' : JSON.stringify(head)}`);
await page.getByRole('button', { name: 'Close', exact: true }).click();

// ---- History: locked song shows the unlock prompt, nothing is spent ----
const lockedCard = page.getByRole('heading', { name: locked.title, exact: true }).first();
await lockedCard.scrollIntoViewIfNeeded();
await lockedCard.click();
await page.getByRole('button', { name: 'Download', exact: true }).click();
await page.getByTestId('unlock-prompt').waitFor({ timeout: 30000 });
const promptText = (await page.getByTestId('unlock-prompt').innerText()).replace(/\s+/g, ' ');
await page.screenshot({ path: '.suno-session/observe/live-2-unlock-prompt.png' });
say(`✓ locked song shows unlock prompt: "${promptText}"`);
await page.getByRole('button', { name: 'Cancel', exact: true }).click();
say(`authorize calls made so far: ${authorizeCalls.length} (expected 0)`);
await page.getByRole('button', { name: 'Close', exact: true }).click();

// ---- Visualizer: unlocked song loads and plays ----
await page.locator('[data-view-tab="visualizer"]').click();
await page.locator('select').first().selectOption(unlocked.id);
const audio = page.locator('audio');
await page.waitForFunction(() => { const a = document.querySelector('audio'); return !!a && a.readyState >= 1 && a.duration > 0; }, null, { timeout: 60000 });
const dur = await audio.evaluate((a: HTMLAudioElement) => a.duration);
const src = await audio.evaluate((a: HTMLAudioElement) => a.currentSrc);
say(`✓ visualizer audio loaded: duration=${dur.toFixed(1)}s src-host=${new URL(src).host}`);
await page.getByRole('button', { name: 'Play', exact: true }).click();
await page.waitForTimeout(3000);
const playState = await audio.evaluate((a: HTMLAudioElement) => ({ paused: a.paused, t: a.currentTime, err: a.error?.message || null }));
await page.screenshot({ path: '.suno-session/observe/live-3-visualizer-playing.png' });
say(`${!playState.paused && playState.t > 0 ? '✓' : '✗'} visualizer playback: paused=${playState.paused} currentTime=${playState.t.toFixed(2)}s error=${playState.err}`);
say(`visualizer audio-issue notice present: ${await page.getByTestId('visualizer-audio-issue').isVisible().catch(() => false)} (expected false)`);

// ---- Visualizer: locked song shows the unlock notice ----
await page.getByRole('button', { name: 'Pause', exact: true }).click().catch(() => {});
await page.reload({ waitUntil: 'domcontentloaded' });
await page.locator('[data-view-tab="visualizer"]').click();
await page.locator('select').first().selectOption(locked.id);
await page.getByTestId('visualizer-audio-issue').waitFor({ timeout: 30000 });
const notice = (await page.getByTestId('visualizer-audio-issue').innerText()).replace(/\s+/g, ' ');
await page.screenshot({ path: '.suno-session/observe/live-4-visualizer-locked.png' });
say(`✓ locked song in visualizer shows notice: "${notice}"`);
say(`authorize calls total: ${authorizeCalls.length} (expected 0)`);
say(`console errors (filtered): ${consoleErrors.filter((e) => !/429|Failed to load resource|library\/albums/.test(e)).join(' | ') || 'none'}`);
await browser.close();
fs.writeFileSync('.suno-session/observe/live-verify.log', out.join('\n'));
