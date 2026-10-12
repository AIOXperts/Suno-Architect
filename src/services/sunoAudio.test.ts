import { describe, expect, it } from 'vitest';
import { audioExtensionForContentType, legacySunoAudioUrl, pickSunoAudioUrl, SUNO_FORBIDDEN_AUDIO_URL } from './sunoApi';
import { computeSyncDiff } from './offlineSyncService';

describe('pickSunoAudioUrl', () => {
  it('prefers media_urls over the forbidden audio_url placeholder', () => {
    const clip = {
      id: 'a',
      audio_url: SUNO_FORBIDDEN_AUDIO_URL,
      media_urls: [{ url: 'https://d2.cloudfront.net/1/clip/a.m4a', content_type: 'm4a-opus', delivery: 'progressive' }],
    };
    expect(pickSunoAudioUrl(clip)).toEqual({ url: 'https://d2.cloudfront.net/1/clip/a.m4a', contentType: 'm4a-opus' });
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
  it('writes the media_urls link instead of the forbidden placeholder', () => {
    const remote = [{
      id: 'a', title: 'A', created_at: '2026-01-01', audio_url: SUNO_FORBIDDEN_AUDIO_URL,
      media_urls: [{ url: 'https://d2.cloudfront.net/1/clip/a.m4a', content_type: 'm4a-opus' }],
      image_url: 'https://cdn2.suno.ai/image_a.jpeg', metadata: { tags: 'x', prompt: 'p', duration: 10 },
    }];
    const diff = computeSyncDiff([], remote, 1000);
    expect(diff.toWrite[0]?.audioUrl).toBe('https://d2.cloudfront.net/1/clip/a.m4a');
  });
});
