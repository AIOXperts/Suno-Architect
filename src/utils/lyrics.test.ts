import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { AlignedWord } from '../types';
import {
    cleanStringForMatch,
    detectLongLrcGaps,
    detectLongLyricLines,
    formatLrcTimestamp,
    formatSrtTimestamp,
    generateLrc,
    generateSrt,
    getCleanAlignedWords,
    groupLyricsByLines,
    groupWordsByLrc,
    groupWordsByLrcWithText,
    groupWordsByTiming,
    looksLikeTimedLyricsJson,
    matchWordsToPrompt,
    parseLrc,
    parseTimedLyricsJson,
    stripMetaTags,
} from './lyrics';

const w = (word: string, start_s: number, end_s: number): AlignedWord => ({
    word,
    start_s,
    end_s,
    success: true,
    p_align: 1,
});

const words = (line: AlignedWord[]) => line.map((x) => x.word);

describe('stripMetaTags', () => {
    it('removes [..] and {..} tags and trims', () => {
        expect(stripMetaTags('[Verse 1]\nHello\n{soft}\nWorld')).toBe('Hello\n\nWorld');
    });

    it('collapses runs of 3+ newlines to a blank line', () => {
        expect(stripMetaTags('A\n[x]\n\n\nB')).toBe('A\n\nB');
    });

    it('returns empty string for empty / falsy input', () => {
        expect(stripMetaTags('')).toBe('');
        expect(stripMetaTags(undefined as unknown as string)).toBe('');
    });
});

describe('cleanStringForMatch', () => {
    it('lowercases and strips punctuation and apostrophes', () => {
        expect(cleanStringForMatch("Don't, Stop!")).toBe('dontstop');
        expect(cleanStringForMatch('')).toBe('');
    });
});

describe('getCleanAlignedWords', () => {
    it('drops bracketed meta words and merges trailing punctuation into the previous word', () => {
        const out = getCleanAlignedWords([
            w('[Verse]', 0, 0.2),
            w('hello', 0.3, 0.6),
            w(',', 0.6, 0.7),
            w('world', 0.8, 1.2),
        ]);
        expect(words(out)).toEqual(['hello,', 'world']);
        expect(out[0].end_s).toBe(0.7);
    });

    it('returns [] for empty input', () => {
        expect(getCleanAlignedWords([])).toEqual([]);
    });
});

describe('parseLrc', () => {
    it('parses valid lines with 2-digit, 1-digit and 3-digit fractions and sorts by time', () => {
        const res = parseLrc('[01:05.5]World\n[00:12.34]Hello\n[00:01.234]First\n[00:02:50]Colon');
        expect(res.invalidLineNumbers).toEqual([]);
        expect(res.entries.map((e) => e.start_s)).toEqual([1.234, 2.5, 12.34, 65.5]);
        expect(res.entries.map((e) => e.text)).toEqual(['First', 'Colon', 'Hello', 'World']);
        expect(res.entries[2]).toMatchObject({ lineNumber: 2, raw: '[00:12.34]Hello' });
    });

    it('reports non-empty lines without a timestamp as invalid and ignores blank lines', () => {
        const res = parseLrc('[00:00.00]ok\n\nno timestamp here\n   \n[00:01.00]fine');
        expect(res.invalidLineNumbers).toEqual([3]);
        expect(res.entries).toHaveLength(2);
    });

    it('returns empty result for empty or whitespace-only input', () => {
        expect(parseLrc('')).toEqual({ entries: [], invalidLineNumbers: [] });
        expect(parseLrc('  \n\t')).toEqual({ entries: [], invalidLineNumbers: [] });
    });

    it('creates one entry per timestamp when a line has multiple timestamps', () => {
        const res = parseLrc('[00:01.00][00:03.00]Chorus');
        expect(res.entries).toHaveLength(2);
        expect(res.entries.every((e) => e.text === 'Chorus')).toBe(true);
        expect(res.entries.map((e) => e.start_s)).toEqual([1, 3]);
    });

    it('does not throw on known-bad seconds [00:99.99] (lenient numeric parse)', () => {
        let res: ReturnType<typeof parseLrc> | undefined;
        expect(() => { res = parseLrc('[00:99.99]Bad seconds'); }).not.toThrow();
        expect(res!.invalidLineNumbers).toEqual([]);
        expect(res!.entries).toHaveLength(1);
        expect(res!.entries[0].start_s).toBeCloseTo(99.99, 5);
        expect(res!.entries[0].text).toBe('Bad seconds');
    });
});

describe('formatLrcTimestamp / formatSrtTimestamp', () => {
    it('formats LRC as [mm:ss.hh] truncating to hundredths', () => {
        expect(formatLrcTimestamp(0)).toBe('[00:00.00]');
        expect(formatLrcTimestamp(65.5)).toBe('[01:05.50]');
        expect(formatLrcTimestamp(1.239)).toBe('[00:01.23]');
        expect(formatLrcTimestamp(0.999)).toBe('[00:00.99]');
    });

    it('formats SRT as hh:mm:ss,mmm truncating sub-millisecond', () => {
        expect(formatSrtTimestamp(0)).toBe('00:00:00,000');
        expect(formatSrtTimestamp(3661.5)).toBe('01:01:01,500');
        expect(formatSrtTimestamp(1.2345)).toBe('00:00:01,234');
    });
});

describe('generateLrc / generateSrt', () => {
    const lines: AlignedWord[][] = [
        [w('a', 0, 0.5), w('b', 0.6, 1)],
        [],
        [w('c', 65.5, 66)],
    ];

    it('generateLrc emits one [mm:ss.hh]text line per non-empty group', () => {
        expect(generateLrc(lines)).toBe('[00:00.00]a b\n[01:05.50]c\n');
        expect(generateLrc([])).toBe('');
    });

    it('generateSrt emits numbered cues with start --> end and blank separators', () => {
        expect(generateSrt(lines)).toBe(
            '1\n00:00:00,000 --> 00:00:01,000\na b\n\n' +
            '3\n00:01:05,500 --> 00:01:06,000\nc\n\n'
        );
    });
});

describe('detectLongLrcGaps', () => {
    const lrc = '[00:00.00]a\n[00:15.00]b\n[00:50.00]c\n[00:52.00]d';

    it('flags gaps >= 12s as warning and >= 30s as critical, sorted by gap desc', () => {
        const issues = detectLongLrcGaps(lrc);
        expect(issues).toEqual([
            { fromLineNumber: 2, toLineNumber: 3, gap_s: 35, severity: 'critical' },
            { fromLineNumber: 1, toLineNumber: 2, gap_s: 15, severity: 'warning' },
        ]);
    });

    it('honours custom thresholds', () => {
        expect(detectLongLrcGaps(lrc, 40, 60)).toEqual([]);
        const low = detectLongLrcGaps(lrc, 1, 10);
        expect(low.map((i) => i.severity)).toEqual(['critical', 'critical', 'warning']);
        expect(low[2].gap_s).toBe(2);
    });

    it('returns [] for empty / single-entry LRC', () => {
        expect(detectLongLrcGaps('')).toEqual([]);
        expect(detectLongLrcGaps('[00:00.00]solo')).toEqual([]);
    });
});

describe('detectLongLyricLines', () => {
    it('reports lines >= 12s as warning and >= 30s as critical, longest first', () => {
        const issues = detectLongLyricLines([
            [w('short', 0, 2)],
            [w('warn', 10, 11), w('line', 20, 23)],
            [],
            [w('crit', 30, 31), w('line', 60, 61)],
        ]);
        expect(issues.map((i) => [i.lineIndex, i.duration_s, i.severity, i.text])).toEqual([
            [3, 31, 'critical', 'crit line'],
            [1, 13, 'warning', 'warn line'],
        ]);
    });

    it('honours custom thresholds', () => {
        expect(detectLongLyricLines([[w('x', 0, 5)]], 4, 10)[0].severity).toBe('warning');
        expect(detectLongLyricLines([[w('x', 0, 5)]], 6, 10)).toEqual([]);
    });
});

describe('groupWordsByTiming', () => {
    it('splits on gaps > 0.5s and keeps words with small gaps together', () => {
        const groups = groupWordsByTiming([
            w('hello', 0, 0.4),
            w('world', 0.5, 0.9),
            w('again', 1.5, 2.0),
        ]);
        expect(groups.map(words)).toEqual([['hello', 'world'], ['again']]);
    });

    it('splits when the line exceeds 40 chars and the gap is > 0.15s', () => {
        const aligned = Array.from({ length: 6 }, (_, i) => w('abcdefgh', i * 0.4, i * 0.4 + 0.2));
        const groups = groupWordsByTiming(aligned);
        expect(groups.map((g) => g.length)).toEqual([5, 1]);
    });

    it('splits after clause-ending punctuation only when the gap is > 0.15s', () => {
        expect(groupWordsByTiming([w('hello,', 0, 0.4), w('world', 0.6, 1)]).map(words))
            .toEqual([['hello,'], ['world']]);
        expect(groupWordsByTiming([w('hello,', 0, 0.4), w('world', 0.5, 1)]).map(words))
            .toEqual([['hello,', 'world']]);
    });

    it('returns [] for empty input or meta-only words', () => {
        expect(groupWordsByTiming([])).toEqual([]);
        expect(groupWordsByTiming([w('[Chorus]', 0, 1)])).toEqual([]);
    });
});

describe('matchWordsToPrompt', () => {
    const aligned = [
        w('hello', 0, 0.3),
        w('world', 0.4, 0.7),
        w('how', 0.8, 1.0),
        w('are', 1.1, 1.3),
        w('you', 1.4, 1.6),
    ];

    it('breaks lines according to the prompt text', () => {
        expect(matchWordsToPrompt(aligned, 'Hello world\nHow are you').map(words))
            .toEqual([['hello', 'world'], ['how', 'are', 'you']]);
    });

    it('ignores meta tags in the prompt', () => {
        expect(matchWordsToPrompt(aligned, '[Verse 1]\nHello world\n[Chorus]\nHow are you').map(words))
            .toEqual([['hello', 'world'], ['how', 'are', 'you']]);
    });

    it('falls back to timing grouping when the prompt has no usable lines', () => {
        expect(matchWordsToPrompt(aligned, '[Instrumental]').map(words))
            .toEqual([['hello', 'world', 'how', 'are', 'you']]);
        expect(matchWordsToPrompt([], 'Hello')).toEqual([]);
    });
});

describe('looksLikeTimedLyricsJson', () => {
    it('accepts object roots and arrays of objects/arrays', () => {
        expect(looksLikeTimedLyricsJson('{"segments":[]}')).toBe(true);
        expect(looksLikeTimedLyricsJson('  [ {"word":"a"} ]')).toBe(true);
        expect(looksLikeTimedLyricsJson('[[1,2]]')).toBe(true);
    });

    it('rejects LRC content, plain text and empty input', () => {
        expect(looksLikeTimedLyricsJson('[00:12.34]Hello')).toBe(false);
        expect(looksLikeTimedLyricsJson('Hello world')).toBe(false);
        expect(looksLikeTimedLyricsJson('')).toBe(false);
        expect(looksLikeTimedLyricsJson('   ')).toBe(false);
    });
});

describe('parseTimedLyricsJson', () => {
    it('parses WhisperX segments/words shape into alignment, lines, lrc and lyricSource', () => {
        const json = JSON.stringify({
            segments: [{
                start: 0.5,
                end: 2.0,
                text: 'hello world',
                words: [
                    { word: 'hello', start: 0.5, end: 1.0, score: 0.9 },
                    { word: 'world', start: 1.2, end: 2.0, score: 0.8 },
                ],
            }],
        });
        const res = parseTimedLyricsJson(json);
        expect(res.alignment).toEqual([
            { word: 'hello', start_s: 0.5, end_s: 1.0, success: true, p_align: 0.9 },
            { word: 'world', start_s: 1.2, end_s: 2.0, success: true, p_align: 0.8 },
        ]);
        expect(res.lines).toHaveLength(1);
        expect(res.lrcContent).toBe('[00:00.50]hello world\n');
        expect(res.lyricSource).toBe('hello world');
    });

    it('does not throw on WhisperX words missing start/end/score and infers finite timings', () => {
        const json = JSON.stringify({
            segments: [{
                start: 1,
                end: 3,
                words: [{ word: 'one' }, { word: '2' }, { word: 'three', start: 2.5, end: 3 }],
            }],
        });
        let res: ReturnType<typeof parseTimedLyricsJson> | undefined;
        expect(() => { res = parseTimedLyricsJson(json); }).not.toThrow();
        expect(words(res!.alignment)).toEqual(['one', '2', 'three']);
        for (const word of res!.alignment) {
            expect(Number.isFinite(word.start_s)).toBe(true);
            expect(Number.isFinite(word.end_s)).toBe(true);
            expect(word.end_s).toBeGreaterThan(word.start_s);
            expect(word.p_align).toBe(1);
        }
        expect(res!.alignment[0]).toMatchObject({ start_s: 1, end_s: 2.5 });
        expect(res!.alignment[2]).toMatchObject({ start_s: 2.5, end_s: 3 });
    });

    it('synthesises words from segment text when a segment has no words and no timings', () => {
        const res = parseTimedLyricsJson(JSON.stringify({ segments: [{ text: 'la la' }] }));
        expect(words(res.alignment)).toEqual(['la', 'la']);
        expect(res.alignment.every((x) => Number.isFinite(x.start_s) && x.end_s > x.start_s)).toBe(true);
        expect(res.lrcContent).toBe('[00:00.00]la la\n');
    });

    it('accepts a flat word array root and an aligned_words root', () => {
        const flat = parseTimedLyricsJson('[{"word":"a","start":0,"end":0.5},{"word":"b","start":0.6,"end":1}]');
        expect(words(flat.alignment)).toEqual(['a', 'b']);
        expect(flat.lines).toHaveLength(1);

        const suno = parseTimedLyricsJson(JSON.stringify({
            aligned_words: [{ word: 'x', start_s: 0, end_s: 0.3, success: true, p_align: 0.7 }],
        }));
        expect(suno.alignment).toEqual([{ word: 'x', start_s: 0, end_s: 0.3, success: true, p_align: 0.7 }]);
    });

    it('throws a descriptive error when no timed words are found', () => {
        expect(() => parseTimedLyricsJson('{}')).toThrow('JSON did not contain any timed words.');
        expect(() => parseTimedLyricsJson('{"segments":[{"words":[]}]}')).toThrow('JSON did not contain any timed words.');
    });
});

describe('groupWordsByLrc / groupWordsByLrcWithText', () => {
    const aligned = [w('a', 0, 0.5), w('b', 1, 1.5), w('c', 5, 5.5)];

    it('groupWordsByLrc buckets words by LRC entry start times', () => {
        expect(groupWordsByLrc(aligned, '[00:00.00]x\n[00:04.00]y').map(words)).toEqual([['a', 'b'], ['c']]);
        expect(groupWordsByLrc(aligned, '')).toEqual([]);
        expect(groupWordsByLrc([], '[00:00.00]x')).toEqual([]);
    });

    it('groupWordsByLrcWithText keeps timings and adopts LRC text when tokens match', () => {
        const res = groupWordsByLrcWithText(aligned, '[00:00.00]A B\n[00:04.00]C');
        expect(res.map(words)).toEqual([['A', 'B'], ['C']]);
        expect(res[0][0]).toMatchObject({ start_s: 0, end_s: 0.5 });
    });

    it('groupWordsByLrcWithText synthesises evenly spaced words when tokens differ', () => {
        const res = groupWordsByLrcWithText(aligned, '[00:00.00]Alpha Beta\n[00:04.00]Gamma');
        expect(res.map(words)).toEqual([['Alpha', 'Beta'], ['Gamma']]);
        expect(res[0][0]).toMatchObject({ start_s: 0, end_s: 2 });
        expect(res[0][1]).toMatchObject({ start_s: 2, end_s: 4 });
        expect(res[1][0]).toMatchObject({ start_s: 4, end_s: 5.5 });
    });
});

describe('groupLyricsByLines (no API key path)', () => {
    const savedKey = process.env.API_KEY;
    beforeEach(() => { delete process.env.API_KEY; });
    afterEach(() => {
        if (savedKey === undefined) delete process.env.API_KEY;
        else process.env.API_KEY = savedKey;
    });

    it('returns the fallback without calling the API when no key is configured', async () => {
        const fallback = [[w('a', 0, 1)]];
        await expect(groupLyricsByLines('a', fallback[0], undefined, 'any-model', fallback)).resolves.toBe(fallback);
    });

    it('returns [] when no key and no fallback', async () => {
        await expect(groupLyricsByLines('a', [w('a', 0, 1)])).resolves.toEqual([]);
    });
});
