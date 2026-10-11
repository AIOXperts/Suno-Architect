import type { SunoClip } from '../types';

/** localStorage key used for the Suno history list. */
export const HISTORY_STORAGE_KEY = 'suno_history';

/** Soft size budget for the serialized history (most browsers cap localStorage at ~5MB per origin). */
export const HISTORY_SOFT_LIMIT_BYTES = 4.5 * 1024 * 1024;

const isDraft = (clip: SunoClip): boolean => typeof clip.id === 'string' && clip.id.startsWith('draft_');

/**
 * Converts a clip's `created_at` into a sortable number. `created_at` is an ISO string in
 * practice; unparseable values sort as oldest (NaN -> -Infinity) so junk gets trimmed first.
 */
const createdAtMs = (clip: SunoClip): number => {
  const raw: unknown = clip.created_at;
  if (typeof raw === 'number') return Number.isFinite(raw) ? raw : Number.NEGATIVE_INFINITY;
  if (typeof raw !== 'string' || raw.length === 0) return Number.NEGATIVE_INFINITY;
  const parsed = Date.parse(raw);
  if (!Number.isNaN(parsed)) return parsed;
  const numeric = Number(raw);
  return Number.isFinite(numeric) ? numeric : Number.NEGATIVE_INFINITY;
};

const serializedSize = (history: SunoClip[]): number => JSON.stringify(history).length;

/**
 * Pure helper: shrinks `history` until its JSON serialization fits in `maxBytes`.
 *
 * Rules:
 * - Every clip whose id starts with `draft_` is ALWAYS kept (generated prompts are irreplaceable).
 * - Non-draft clips are removed oldest-first (ascending `created_at`; ties resolved by original index).
 * - If only drafts remain and the payload is still too large, trimming stops — drafts are never trimmed,
 *   so the result may exceed `maxBytes` in that case.
 * - Relative order of the kept items matches the input order.
 * - `trimmed` never exceeds the number of non-draft clips in the input.
 */
export function trimHistoryForQuota(
  history: SunoClip[],
  maxBytes: number,
): { kept: SunoClip[]; trimmed: number } {
  if (serializedSize(history) <= maxBytes) {
    return { kept: [...history], trimmed: 0 };
  }

  // Non-draft indices ordered oldest -> newest.
  const removalOrder = history
    .map((clip, index) => ({ clip, index }))
    .filter(({ clip }) => !isDraft(clip))
    .sort((a, b) => {
      const diff = createdAtMs(a.clip) - createdAtMs(b.clip);
      return diff !== 0 ? diff : a.index - b.index;
    })
    .map(({ index }) => index);

  const removed = new Set<number>();
  let kept = [...history];

  for (const index of removalOrder) {
    removed.add(index);
    kept = history.filter((_, i) => !removed.has(i));
    if (serializedSize(kept) <= maxBytes) break;
  }

  return { kept, trimmed: removed.size };
}

/** Rough midpoint cut used for the post-exception retry. */
const halveNonDrafts = (history: SunoClip[]): { kept: SunoClip[]; trimmed: number } => {
  const currentSize = serializedSize(history);
  return trimHistoryForQuota(history, Math.floor(currentSize / 2));
};

export interface SaveHistoryResult {
  /** The array that is actually persisted (or the input, untouched, if nothing could be saved). */
  saved: SunoClip[];
  /** Number of non-draft clips dropped to fit storage. */
  trimmed: number;
  /** One-line, user-facing message when trimming happened or saving failed. */
  warning?: string;
}

const trimmedWarning = (count: number): string =>
  `Trimmed ${count} older history item${count === 1 ? '' : 's'} to stay within browser storage limits.`;

/**
 * Persists `history` under HISTORY_STORAGE_KEY without ever throwing.
 *
 * 1. If the serialized payload exceeds `maxBytes`, pre-trim with trimHistoryForQuota.
 * 2. Try `setItem`. If it throws (QuotaExceededError / any DOMException / anything else),
 *    trim to roughly half of the current size and retry exactly once.
 * 3. If the retry also fails, leave storage untouched and return a warning.
 *
 * Returns the array that was actually written so the caller can mirror it into React state.
 */
export function saveHistorySafely(
  history: SunoClip[],
  storage: Pick<Storage, 'setItem' | 'removeItem'> = localStorage,
  maxBytes: number = HISTORY_SOFT_LIMIT_BYTES,
): SaveHistoryResult {
  let current = history;
  let trimmed = 0;

  if (serializedSize(current) > maxBytes) {
    const pre = trimHistoryForQuota(current, maxBytes);
    current = pre.kept;
    trimmed += pre.trimmed;
  }

  try {
    storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(current));
    return trimmed > 0
      ? { saved: current, trimmed, warning: trimmedWarning(trimmed) }
      : { saved: current, trimmed };
  } catch {
    // fall through to the single retry below
  }

  const retry = halveNonDrafts(current);
  current = retry.kept;
  trimmed += retry.trimmed;

  try {
    storage.setItem(HISTORY_STORAGE_KEY, JSON.stringify(current));
    return { saved: current, trimmed, warning: trimmedWarning(trimmed) };
  } catch {
    return {
      saved: history,
      trimmed: 0,
      warning:
        'Could not save history: browser storage is full. Delete some older history items to free up space.',
    };
  }
}
