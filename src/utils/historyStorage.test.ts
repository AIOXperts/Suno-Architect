import { describe, expect, it, vi } from 'vitest';
import type { SunoClip } from '../types';
import {
  HISTORY_SOFT_LIMIT_BYTES,
  HISTORY_STORAGE_KEY,
  saveHistorySafely,
  trimHistoryForQuota,
} from './historyStorage';

const makeClip = (id: string, createdAt: string, padding = 0): SunoClip => ({
  id,
  title: `Title ${id}`,
  created_at: createdAt,
  model_name: 'chirp-v4',
  metadata: {
    tags: 'pop',
    prompt: 'x'.repeat(padding),
  },
});

const size = (clips: SunoClip[]) => JSON.stringify(clips).length;

// Oldest -> newest, deliberately NOT in chronological order to prove sorting is by created_at.
const buildHistory = (): SunoClip[] => [
  makeClip('c', '2024-03-01T00:00:00Z', 200),
  makeClip('a', '2024-01-01T00:00:00Z', 200),
  makeClip('draft_1', '2023-01-01T00:00:00Z', 200),
  makeClip('b', '2024-02-01T00:00:00Z', 200),
  makeClip('d', '2024-04-01T00:00:00Z', 200),
];

class FakeDomException extends Error {
  constructor(name: string) {
    super(name);
    this.name = name;
  }
}

const makeStorage = (failTimes: number) => {
  const store = new Map<string, string>();
  let calls = 0;
  const setItem = vi.fn((key: string, value: string) => {
    calls += 1;
    if (calls <= failTimes) throw new FakeDomException('QuotaExceededError');
    store.set(key, value);
  });
  const removeItem = vi.fn((key: string) => {
    store.delete(key);
  });
  return { storage: { setItem, removeItem }, store, setItem };
};

describe('trimHistoryForQuota', () => {
  it('leaves a small history untouched', () => {
    const history = buildHistory();
    const { kept, trimmed } = trimHistoryForQuota(history, size(history) + 10);
    expect(trimmed).toBe(0);
    expect(kept).toEqual(history);
    expect(kept).not.toBe(history);
  });

  it('trims the oldest non-draft clips first (by created_at, not array order)', () => {
    const history = buildHistory();
    const oneClip = size([history[0]]);
    // Budget for roughly 3 clips (of 5) -> expect 'a' (Jan) and 'b' (Feb) removed; draft from 2023 kept.
    const { kept, trimmed } = trimHistoryForQuota(history, oneClip * 3 + 10);
    expect(trimmed).toBe(2);
    expect(kept.map((c) => c.id)).toEqual(['c', 'draft_1', 'd']);
  });

  it('preserves original relative order of kept items', () => {
    const history = buildHistory();
    const { kept } = trimHistoryForQuota(history, size([history[0]]) * 4 + 10);
    const keptIds = kept.map((c) => c.id);
    const expectedOrder = history.map((c) => c.id).filter((id) => keptIds.includes(id));
    expect(keptIds).toEqual(expectedOrder);
  });

  it('always keeps drafts even if alone they exceed the budget', () => {
    const history = [
      makeClip('draft_1', '2024-01-01T00:00:00Z', 500),
      makeClip('x', '2024-02-01T00:00:00Z', 50),
      makeClip('draft_2', '2024-03-01T00:00:00Z', 500),
    ];
    const { kept, trimmed } = trimHistoryForQuota(history, 100);
    expect(kept.map((c) => c.id)).toEqual(['draft_1', 'draft_2']);
    expect(trimmed).toBe(1);
    expect(size(kept)).toBeGreaterThan(100);
  });

  it('never trims more than the non-draft count', () => {
    const history = buildHistory();
    const nonDrafts = history.filter((c) => !c.id.startsWith('draft_')).length;
    const { trimmed } = trimHistoryForQuota(history, 1);
    expect(trimmed).toBe(nonDrafts);
  });

  it('reports a correct trimmed count and kept size <= maxBytes when achievable', () => {
    const history = buildHistory();
    for (const budget of [size(history) - 1, size([history[0]]) * 2, size([history[0]]) * 3]) {
      const { kept, trimmed } = trimHistoryForQuota(history, budget);
      expect(kept.length + trimmed).toBe(history.length);
      expect(size(kept)).toBeLessThanOrEqual(budget);
    }
  });

  it('handles unparseable created_at by treating it as oldest', () => {
    const history = [
      makeClip('good', '2024-01-01T00:00:00Z', 100),
      makeClip('junk', 'not-a-date', 100),
    ];
    const { kept, trimmed } = trimHistoryForQuota(history, size([history[0]]) + 5);
    expect(trimmed).toBe(1);
    expect(kept.map((c) => c.id)).toEqual(['good']);
  });
});

describe('saveHistorySafely', () => {
  it('writes untouched payload when under budget and no error', () => {
    const history = buildHistory();
    const { storage, store } = makeStorage(0);
    const result = saveHistorySafely(history, storage, HISTORY_SOFT_LIMIT_BYTES);
    expect(result.trimmed).toBe(0);
    expect(result.warning).toBeUndefined();
    expect(result.saved).toEqual(history);
    expect(store.get(HISTORY_STORAGE_KEY)).toBe(JSON.stringify(history));
  });

  it('pre-trims when serialized size exceeds maxBytes', () => {
    const history = buildHistory();
    const { storage, store } = makeStorage(0);
    const budget = size([history[0]]) * 3 + 10;
    const result = saveHistorySafely(history, storage, budget);
    expect(result.trimmed).toBe(2);
    expect(result.warning).toBe('Trimmed 2 older history items to stay within browser storage limits.');
    expect(result.saved.map((c) => c.id)).toEqual(['c', 'draft_1', 'd']);
    expect(store.get(HISTORY_STORAGE_KEY)).toBe(JSON.stringify(result.saved));
  });

  it('retries once with a trimmed payload after QuotaExceededError and returns a warning', () => {
    const history = buildHistory();
    const { storage, store, setItem } = makeStorage(1);
    const result = saveHistorySafely(history, storage, HISTORY_SOFT_LIMIT_BYTES);
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(result.trimmed).toBeGreaterThan(0);
    expect(result.saved.length).toBeLessThan(history.length);
    expect(result.saved.some((c) => c.id === 'draft_1')).toBe(true);
    expect(result.warning).toMatch(/^Trimmed \d+ older history items? to stay within browser storage limits\.$/);
    expect(store.get(HISTORY_STORAGE_KEY)).toBe(JSON.stringify(result.saved));
    expect(size(result.saved)).toBeLessThanOrEqual(Math.floor(size(history) / 2));
  });

  it('returns a warning without throwing when storage always fails, leaving storage untouched', () => {
    const history = buildHistory();
    const { storage, store, setItem } = makeStorage(Number.POSITIVE_INFINITY);
    let result: ReturnType<typeof saveHistorySafely> | undefined;
    expect(() => {
      result = saveHistorySafely(history, storage, HISTORY_SOFT_LIMIT_BYTES);
    }).not.toThrow();
    expect(setItem).toHaveBeenCalledTimes(2);
    expect(result?.warning).toMatch(/Could not save history/);
    expect(result?.saved).toBe(history);
    expect(result?.trimmed).toBe(0);
    expect(store.has(HISTORY_STORAGE_KEY)).toBe(false);
  });
});
