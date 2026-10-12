import { describe, expect, it } from 'vitest';
import { afterEach, vi } from 'vitest';
import { audioExtensionForContentType, authorizeSunoDownload, clearSunoDownloadCache, getSunoDownloadQuota, getSunoDownloadUrl, isEncryptedSunoStream, legacySunoAudioUrl, pickSunoAudioUrl, resolveSunoAudioUrl, SunoDownloadError, SUNO_FORBIDDEN_AUDIO_URL } from './sunoApi';
import { computeSyncDiff } from './offlineSyncService';

describe('pickSunoAudioUrl', () => {
  it('skips the encrypted m4a-opus stream and the forbidden audio_url placeholder', () => {
    const clip = {
      id: 'a',
      audio_url: SUNO_FORBIDDEN_AUDIO_URL,
      media_urls: [{ url: 'https://d2.cloudfront.net/1/clip/a.m4a', content_type: 'm4a-opus', delivery: 'progressive' }],
    };
    expect(pickSunoAudioUrl(clip)).toBeUndefined();
    expect(isEncryptedSunoStream('https://d2lwuy8qc234o3.cloudfront.net/1/clip/a.m4a')).toBe(true);
    expect(isEncryptedSunoStream('https://suno-data-uploads.s3.amazonaws.com/studio/uploads/a_paid_wm.mp3?Expires=1')).toBe(false);
  });

  it('uses a plain mp3 media_urls entry when Suno offers one', () => {
    const clip = { media_urls: [{ url: 'https://x/a.mp3', content_type: 'mp3' }] };
    expect(pickSunoAudioUrl(clip)).toEqual({ url: 'https://x/a.mp3', contentType: 'mp3' });
  });

  it('prefers mp3 over m4a when both are offered', () => {
    const clip = {
      media_urls: [
        { url: 'https://x/a.m4a', content_type: 'm4a-opus' },
        { url: 'https://x/a.mp3', content_type: 'mp3' },
      ],
    };
    expect(pickSunoAudioUrl(clip)?.url).toBe('https://x/a.mp3');
  });

  it('falls back to a non-forbidden audio_url and ignores the placeholder', () => {
    expect(pickSunoAudioUrl({ audio_url: 'https://cdn1.suno.ai/a.mp3' })?.url).toBe('https://cdn1.suno.ai/a.mp3');
    expect(pickSunoAudioUrl({ audio_url: SUNO_FORBIDDEN_AUDIO_URL })).toBeUndefined();
    expect(pickSunoAudioUrl({ media_urls: [{ content_type: 'mp3' }] })).toBeUndefined();
    expect(pickSunoAudioUrl(undefined)).toBeUndefined();
  });

  it('maps content types to file extensions', () => {
    expect(audioExtensionForContentType('m4a-opus')).toBe('m4a');
    expect(audioExtensionForContentType('mp3')).toBe('mp3');
    expect(audioExtensionForContentType(undefined)).toBe('m4a');
    expect(legacySunoAudioUrl('abc')).toBe('https://cdn1.suno.ai/abc.mp3');
  });
});

describe('computeSyncDiff audio URLs', () => {
  it('never persists the forbidden placeholder or the encrypted stream as audioUrl', () => {
    const remote = [{
      id: 'a', title: 'A', created_at: '2026-01-01', audio_url: SUNO_FORBIDDEN_AUDIO_URL,
      media_urls: [{ url: 'https://d2.cloudfront.net/1/clip/a.m4a', content_type: 'm4a-opus' }],
      image_url: 'https://cdn2.suno.ai/image_a.jpeg', metadata: { tags: 'x', prompt: 'p', duration: 10 },
    }];
    const diff = computeSyncDiff([], remote, 1000);
    expect(diff.toWrite[0]?.audioUrl).toBe('');
  });
});

describe('getSunoDownloadUrl / resolveSunoAudioUrl', () => {
  const jsonResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
  afterEach(() => { vi.unstubAllGlobals(); clearSunoDownloadCache(); });

  it('returns the presigned link and parses its expiry', async () => {
    const url = 'https://suno-data-uploads.s3.amazonaws.com/studio/uploads/a_paid_wm.mp3?AWSAccessKeyId=k&Signature=s&Expires=1791769840';
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, status: 'ready', download_url: url }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await getSunoDownloadUrl('a', 'Bearer tok');
    expect(res).toEqual({ url, expiresAt: 1791769840 * 1000, format: 'mp3' });
    expect(String((fetchMock.mock.calls as unknown[][])[0][0])).toContain('/api/download/clip/a');
  });

  it('polls while pending, then resolves', async () => {
    const url = 'https://x/a.mp3?Expires=1';
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: 'pending' }))
      .mockResolvedValueOnce(jsonResponse({ ok: true, status: 'ready', download_url: url }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await getSunoDownloadUrl('a', 'tok', { pollDelayMs: 1 });
    expect(res.url).toBe(url);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('throws a typed error with the server reason (rate_limited / locked) and never calls authorize', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: false, reason: 'rate_limited', message: 'Woah, too many downloads at once.' }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(getSunoDownloadUrl('a', 'tok')).rejects.toMatchObject({ name: 'SunoDownloadError', reason: 'rate_limited' });
    for (const call of fetchMock.mock.calls as unknown[][]) expect(String(call[0])).not.toMatch(/authorize|unlock/);
    const err = await getSunoDownloadUrl('a', 'tok').catch((e) => e);
    expect(err).toBeInstanceOf(SunoDownloadError);
  });

  it('caches resolved links per clip and de-duplicates concurrent calls', async () => {
    const url = 'https://x/a.mp3?Expires=' + Math.floor(Date.now() / 1000 + 3600);
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, status: 'ready', download_url: url }));
    vi.stubGlobal('fetch', fetchMock);
    const [r1, r2] = await Promise.all([resolveSunoAudioUrl('a', 'tok'), resolveSunoAudioUrl('a', 'tok')]);
    const r3 = await resolveSunoAudioUrl('a', 'tok');
    expect(r1.url).toBe(url); expect(r2.url).toBe(url); expect(r3.url).toBe(url);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});

describe('authorizeSunoDownload / getSunoDownloadQuota / formats', () => {
  const jsonResponse = (body: unknown) => ({ ok: true, status: 200, json: async () => body }) as unknown as Response;
  afterEach(() => { vi.unstubAllGlobals(); clearSunoDownloadCache(); });

  it('POSTs item_id/item_type to /api/download/authorize and reports credit deduction', async () => {
    const fetchMock = vi.fn(async () => jsonResponse({ ok: true, already_unlocked: false, credit_deducted: true }));
    vi.stubGlobal('fetch', fetchMock);
    const res = await authorizeSunoDownload('abc', 'tok');
    expect(res).toEqual({ ok: true, alreadyUnlocked: false, creditDeducted: true });
    const [url, init] = (fetchMock.mock.calls as unknown[][])[0] as [string, RequestInit];
    expect(url).toContain('/api/download/authorize');
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({ item_id: 'abc', item_type: 'clip' });
  });

  it('throws a typed error when authorization is refused', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false, reason: 'quota_exceeded', message: 'No downloads left.' })));
    await expect(authorizeSunoDownload('abc', 'tok')).rejects.toMatchObject({ reason: 'quota_exceeded', message: 'No downloads left.' });
  });

  it('not_authorized download errors expose needsUnlock', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ ok: false, reason: 'not_authorized', message: "Seems like you don't have permission to download this one." })));
    const err = await getSunoDownloadUrl('abc', 'tok').catch((e) => e);
    expect(err).toBeInstanceOf(SunoDownloadError);
    expect((err as SunoDownloadError).needsUnlock).toBe(true);
    expect((err as SunoDownloadError).isRateLimited).toBe(false);
  });

  it('passes the requested format as a query parameter and caches per format', async () => {
    const fetchMock = vi.fn(async (u: string) => jsonResponse({ ok: true, status: 'ready', download_url: `https://x/a.${/format=wav/.test(u) ? 'wav' : 'mp3'}?Expires=${Math.floor(Date.now() / 1000) + 3600}` }));
    vi.stubGlobal('fetch', fetchMock);
    const mp3 = await resolveSunoAudioUrl('a', 'tok');
    const wav = await resolveSunoAudioUrl('a', 'tok', 'wav');
    expect(mp3.url).toContain('a.mp3'); expect(mp3.format).toBe('mp3');
    expect(wav.url).toContain('a.wav'); expect(wav.format).toBe('wav');
    expect(String((fetchMock.mock.calls as unknown[][])[1][0])).toContain('format=wav');
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('derives the remaining download allowance from billing info', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({
      period_end: '2026-10-16T02:19:24Z',
      download_usage: { current_period_downloads_used: 16, current_period_downloads_limit: 60, additional_download_remaining: 7 },
    })));
    expect(await getSunoDownloadQuota('tok')).toEqual({ used: 16, limit: 60, additional: 7, remaining: 51, periodEnd: '2026-10-16T02:19:24Z' });
    vi.stubGlobal('fetch', vi.fn(async () => jsonResponse({ credits: 1 })));
    expect(await getSunoDownloadQuota('tok')).toBeUndefined();
  });
});
