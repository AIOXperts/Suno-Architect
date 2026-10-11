import { AlignedWord } from '../types';
import { Type, GoogleGenAI } from "@google/genai";

export const STOP_WORDS = new Set(['the', 'and', 'a', 'to', 'of', 'in', 'it', 'is', 'that', 'you', 'he', 'she', 'was', 'for', 'on', 'are', 'as', 'with', 'his', 'they', 'at', 'be', 'this', 'have', 'from', 'or', 'one', 'had', 'by', 'word', 'but', 'not', 'what', 'all', 'were', 'we', 'when', 'your', 'can', 'said', 'there', 'use', 'an', 'each', 'which', 'she', 'do', 'how', 'their', 'if', 'will', 'up', 'other', 'about', 'out', 'many', 'then', 'them', 'these', 'so', 'some', 'her', 'would', 'make', 'like', 'him', 'into', 'time', 'has', 'look', 'two', 'more', 'write', 'go', 'see', 'number', 'no', 'way', 'could', 'people', 'my', 'than', 'first', 'water', 'been', 'call', 'who', 'oil', 'its', 'now', 'find']);

export const stripMetaTags = (text: string): string => {
    if (!text) return "";
    // Regex to match [ ... ] and { ... } including newlines
    return text
        .replace(/\[[^\]]*\]/g, "")
        .replace(/\{[^}]*\}/g, "")
        .replace(/\n{3,}/g, "\n\n") // Normalize excessive newlines
        .trim();
};

export const getCleanAlignedWords = (aligned: AlignedWord[]): AlignedWord[] => {
    // 1. Stateful Strip of Square Brackets [] and Curly Braces {}
    const stripped: AlignedWord[] = [];
    let inSquare = false;
    let inCurly = false;

    for (const w of aligned) {
        let cleanedWord = "";
        for (const char of w.word) {
            if (char === '[') { inSquare = true; continue; }
            if (char === ']') { inSquare = false; continue; }
            if (char === '{') { inCurly = true; continue; }
            if (char === '}') { inCurly = false; continue; }

            if (!inSquare && !inCurly) {
                cleanedWord += char;
            }
        }
        
        const trimmed = cleanedWord.trim();
        if (trimmed.length > 0) {
            // Check for trailing opener (e.g. "days (") and split it
            const splitMatch = trimmed.match(/^(.*?)(\s*)([\(\"\'\u201C\u2018\u00AB\<]+)$/);
            if (splitMatch && splitMatch[1].trim().length > 0) {
                const wordPart = splitMatch[1].trim();
                const spacePart = splitMatch[2];
                const openerPart = splitMatch[3];
                
                // Only split if there is space OR if the opener is unambiguous (brackets)
                // We treat quotes as ambiguous - they stick to the word if no space (e.g. end")
                const isAmbiguous = /^[\"\'\u201C\u2018]+$/.test(openerPart);
                
                if (isAmbiguous && spacePart.length === 0) {
                     stripped.push({ ...w, word: trimmed });
                } else {
                    // Split duration: give most to word, last 0.1s to opener
                    const splitTime = Math.max(w.start_s, w.end_s - 0.1);
                    
                    stripped.push({ ...w, word: wordPart, end_s: splitTime });
                    stripped.push({ ...w, word: openerPart, start_s: splitTime });
                }
            } else {
                stripped.push({ ...w, word: trimmed });
            }
        }
    }

    if (stripped.length === 0) return [];

    // 2. Smart Merge of Punctuation & Split Contractions
    const merged: AlignedWord[] = [];
    
    const isOpener = (s: string) => /^[\(\"\'\u201C\u2018\u00AB\<]+$/.test(s); 
    const isCloser = (s: string) => /^[\)\"\'\u201D\u2019\u00BB\>\,\.\!\?\:\;]+$/.test(s);
    const isSuffix = (s: string) => /^['’][a-z]+$/i.test(s);
    const isContractionPart = (s: string) => /^(s|m|t|re|ve|ll|d)$/i.test(s);

    for (let i = 0; i < stripped.length; i++) {
        let current = { ...stripped[i] };
        
        // A. Forward Merge (Openers)
        if (isOpener(current.word) && i + 1 < stripped.length) {
            const next = stripped[i+1];
            // Increased threshold to 5.0s to ensure brackets always join the next word
            if (next.start_s - current.end_s < 5.0) {
                stripped[i+1] = {
                    ...next,
                    word: current.word + next.word,
                    start_s: current.start_s
                };
                continue;
            }
        }

        // B. Backward Merge (Closers & Suffixes & Split Contractions)
        if (merged.length > 0) {
            const prev = merged[merged.length - 1];
            const timeGap = current.start_s - prev.end_s;
            
            const standardMerge = (isCloser(current.word) || isSuffix(current.word));
            const splitContractionMerge = /['’]$/.test(prev.word) && isContractionPart(current.word);

            if ((standardMerge || splitContractionMerge) && timeGap < 1.5) {
                merged[merged.length - 1] = {
                    ...prev,
                    word: prev.word + current.word,
                    end_s: current.end_s
                };
                continue;
            }
        }

        merged.push(current);
    }

    return merged;
};

export const cleanStringForMatch = (s: string) => {
    if (!s) return "";
    try {
        return s.toLowerCase().replace(/['’]/g, '').replace(/[^\p{L}\p{N}]/gu, '');
    } catch (e) {
        return s.toLowerCase().replace(/['".,/#!$%^&*;:{}=\-_`~()]/g, "");
    }
};

export const groupWordsByTiming = (aligned: AlignedWord[]): AlignedWord[][] => {
    const cleanAligned = getCleanAlignedWords(aligned); 
    if (cleanAligned.length === 0) return [];
    const groups: AlignedWord[][] = [];
    let currentLine: AlignedWord[] = [];
    const GAP_THRESHOLD = 0.5;
    const MAX_CHARS = 40; 
    cleanAligned.forEach((word, idx) => {
        if (idx === 0) { currentLine.push(word); return; }
        const prevWord = cleanAligned[idx - 1];
        const timeGap = word.start_s - prevWord.end_s;
        const currentLen = currentLine.reduce((sum, w) => sum + w.word.length + 1, 0);
        const isGapBig = timeGap > GAP_THRESHOLD;
        const isLineLong = currentLen > MAX_CHARS;
        const endsClause = /[.,;!?\)]$/.test(prevWord.word);
        if (isGapBig || ((isLineLong || endsClause) && timeGap > 0.15)) {
            groups.push(currentLine);
            currentLine = [word];
        } else {
            currentLine.push(word);
        }
    });
    if (currentLine.length > 0) groups.push(currentLine);
    return groups;
};

export const matchWordsToPrompt = (aligned: AlignedWord[], promptText: string): AlignedWord[][] => {
    const cleanAligned = getCleanAlignedWords(aligned);
    if (cleanAligned.length === 0) return [];
    const promptLines = stripMetaTags(promptText).split('\n').map(l => l.trim()).filter(l => l.length > 0);
    if (promptLines.length === 0) return groupWordsByTiming(cleanAligned);
    
    type PromptToken = { text: string; lineIndex: number; isLineStart: boolean };
    const tokens: PromptToken[] = [];
    promptLines.forEach((line, idx) => {
        const words = line.split(/\s+/).map(cleanStringForMatch).filter(w => w.length > 0);
        words.forEach((w, wIdx) => tokens.push({ text: w, lineIndex: idx, isLineStart: wIdx === 0 }));
    });
    
    const groups: AlignedWord[][] = [];
    let currentGroup: AlignedWord[] = [];
    let currentLineIndex = 0;
    let tokenPtr = 0;
    let wordsSinceLastMatch = 0; 
    
    for (let i = 0; i < cleanAligned.length; i++) {
        const wordObj = cleanAligned[i];
        const cleanWord = cleanStringForMatch(wordObj.word);
        
        if (!cleanWord) { 
            // Punctuation Handling with Lookahead
            // Check if this punctuation likely belongs to the NEXT line (e.g. leading quote)
            const isAmbiguousOpener = /^['"“‘\(\[\{<]/.test(wordObj.word);
            
            if (isAmbiguousOpener && i + 1 < cleanAligned.length) {
                const nextObj = cleanAligned[i+1];
                const nextClean = cleanStringForMatch(nextObj.word);
                
                if (nextClean) {
                     // Lookahead search to see if next word triggers a line break
                     let nextLineIndex = -1;
                     const searchLimit = 20; 
                     for (let la = 0; la < searchLimit; la++) {
                         if (tokenPtr + la >= tokens.length) break;
                         const t = tokens[tokenPtr + la];
                         if (t.text === nextClean) {
                             nextLineIndex = t.lineIndex;
                             break;
                         }
                     }
                     
                     if (nextLineIndex > currentLineIndex) {
                         // Force switch for openers if next word is on a new line
                         if (currentGroup.length > 0) groups.push(currentGroup);
                         currentGroup = [];
                         currentLineIndex = nextLineIndex;
                     }
                }
            }

            currentGroup.push(wordObj); 
            continue; 
        }

        let bestMatchOffset = -1;
        const isLost = wordsSinceLastMatch > 3; 
        const searchLimit = isLost ? 500 : 50; 

        for (let lookahead = 0; lookahead < searchLimit; lookahead++) {
            if (tokenPtr + lookahead >= tokens.length) break;
            const target = tokens[tokenPtr + lookahead];
            
            const isExact = target.text === cleanWord;
            const isSub = !isExact && (target.text.includes(cleanWord) || cleanWord.includes(target.text));
            const isMatch = isExact || (isLost && isSub);

            if (isMatch) {
                let contextScore = 0;
                
                if (i + 1 < cleanAligned.length) {
                    const nextAudio = cleanStringForMatch(cleanAligned[i+1].word);
                    if (tokenPtr + lookahead + 1 < tokens.length) {
                        const nextToken = tokens[tokenPtr + lookahead + 1].text;
                        if (nextToken === nextAudio) contextScore += 2;
                        else if (nextAudio && nextToken.includes(nextAudio)) contextScore += 1;
                    }
                    if (i + 2 < cleanAligned.length && tokenPtr + lookahead + 2 < tokens.length) {
                         const nextNextAudio = cleanStringForMatch(cleanAligned[i+2].word);
                         const nextNextToken = tokens[tokenPtr + lookahead + 2].text;
                         if (nextNextAudio === nextNextToken) contextScore += 1;
                    }
                }

                const isStrongMatch = (isExact && lookahead === 0) || contextScore > 0;
                
                if (target.isLineStart && (isStrongMatch || (isExact && !STOP_WORDS.has(cleanWord)))) {
                    bestMatchOffset = lookahead;
                    break;
                }

                if (isStrongMatch) {
                    bestMatchOffset = lookahead;
                    break;
                }
                
                if (isLost && isExact && !STOP_WORDS.has(cleanWord)) {
                     if (bestMatchOffset === -1) bestMatchOffset = lookahead;
                }
            }
        }

        if (bestMatchOffset !== -1) {
            const target = tokens[tokenPtr + bestMatchOffset];
            
            if (target.lineIndex > currentLineIndex) {
                if (currentGroup.length > 0) groups.push(currentGroup);
                currentGroup = [];
                currentLineIndex = target.lineIndex;
            } 

            tokenPtr += bestMatchOffset + 1;
            wordsSinceLastMatch = 0; 
        } else {
            wordsSinceLastMatch++;
            
            if (currentGroup.length > 0) {
                const prev = currentGroup[currentGroup.length - 1];
                if (wordObj.start_s - prev.end_s > 2.0) { 
                     groups.push(currentGroup);
                     currentGroup = [];
                }
            }
        }
        
        currentGroup.push(wordObj);
    }
    
    if (currentGroup.length > 0) groups.push(currentGroup);
    return groups;
};

export const groupLyricsByLines = async (
  lyrics: string,
  aligned: AlignedWord[],
  apiKey?: string,
  modelName: string = "gemini-3-flash-preview",
  fallback?: AlignedWord[][]
): Promise<AlignedWord[][]> => {
  const key = apiKey || process.env.API_KEY;
  if (!key) return fallback || [];

  const ai = new GoogleGenAI({ apiKey: key });

  try {
    const response = await ai.models.generateContent({
      model: modelName,
      contents: `
        Task: Group a list of synchronized words into arrays that represent lines of a song.
        Use the LYRICS provided as the ground truth for line breaks.
        
        LYRICS:
        ${lyrics}

        SYNCED WORDS (JSON):
        ${JSON.stringify(aligned.map(w => ({ word: w.word, start: w.start_s, end: w.end_s })))}
      `,
      config: {
        responseMimeType: "application/json",
        responseSchema: {
          type: Type.ARRAY,
          items: {
            type: Type.ARRAY,
            items: {
              type: Type.OBJECT,
              properties: {
                word: { type: Type.STRING, description: "The word text" },
                start: { type: Type.NUMBER, description: "Start time in seconds" },
                end: { type: Type.NUMBER, description: "End time in seconds" }
              },
              required: ["word", "start", "end"]
            }
          }
        }
      }
    });

    const data = JSON.parse(response.text || "[]");
    return data.map((line: any[]) => line.map((item: any) => ({
      word: item.word,
      start_s: item.start,
      end_s: item.end,
      success: true,
      p_align: 1.0
    })));
  } catch (error) {
    console.error("Gemini Grouping Error:", error);
    return fallback || [];
  }
};

// --- FILE GENERATION UTILS ---

export type ParsedLrcLine = {
    lineNumber: number;
    start_s: number;
    text: string;
    raw: string;
};

export type LrcParseResult = {
    entries: ParsedLrcLine[];
    invalidLineNumbers: number[];
};

export type LyricLineTimingIssue = {
    lineIndex: number;
    start_s: number;
    end_s: number;
    duration_s: number;
    text: string;
    severity: 'warning' | 'critical';
};

const parseLrcFraction = (fractionRaw: string | undefined): number => {
    if (!fractionRaw) return 0;
    const digits = fractionRaw.trim();
    if (!digits) return 0;
    if (digits.length === 1) return Number(digits) / 10;
    if (digits.length === 2) return Number(digits) / 100;
    return Number(digits.slice(0, 3)) / 1000;
};

export const parseLrc = (lrcContent: string): LrcParseResult => {
    const entries: ParsedLrcLine[] = [];
    const invalidLineNumbers: number[] = [];
    if (!lrcContent.trim()) return { entries, invalidLineNumbers };

    const lines = lrcContent.split(/\r?\n/);
    const tsRegex = /\[(\d{1,3}):(\d{2})(?:[.:](\d{1,3}))?\]/g;

    lines.forEach((rawLine, idx) => {
        const matches = [...rawLine.matchAll(tsRegex)];
        const text = rawLine.replace(tsRegex, '').trim();
        if (matches.length === 0) {
            if (rawLine.trim()) invalidLineNumbers.push(idx + 1);
            return;
        }

        for (const match of matches) {
            const minutes = Number(match[1]);
            const seconds = Number(match[2]);
            const fraction = parseLrcFraction(match[3]);
            if (!Number.isFinite(minutes) || !Number.isFinite(seconds)) {
                invalidLineNumbers.push(idx + 1);
                continue;
            }
            entries.push({
                lineNumber: idx + 1,
                start_s: (minutes * 60) + seconds + fraction,
                text,
                raw: rawLine
            });
        }
    });

    entries.sort((a, b) => a.start_s - b.start_s);
    return { entries, invalidLineNumbers };
};

const isRecord = (value: unknown): value is Record<string, any> => (
    typeof value === 'object' && value !== null && !Array.isArray(value)
);

const toFiniteNumber = (value: unknown): number | null => {
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string' && value.trim()) {
        const parsed = Number(value);
        return Number.isFinite(parsed) ? parsed : null;
    }
    return null;
};

const readWordText = (value: unknown): string => {
    if (!isRecord(value)) return '';
    const raw = value.word ?? value.text ?? value.token ?? value.value ?? value.label;
    return typeof raw === 'string' ? raw.replace(/\s+/g, ' ').trim() : '';
};

type LooseAlignedWord = {
    word: string;
    start_s: number | null;
    end_s: number | null;
    success: boolean;
    p_align: number;
};

const normalizeWordTimings = (
    words: LooseAlignedWord[],
    fallbackStart?: number | null,
    fallbackEnd?: number | null
): AlignedWord[] => {
    if (words.length === 0) return [];

    const knownStarts = words.map((word) => word.start_s).filter((value): value is number => value !== null);
    const knownEnds = words.map((word) => word.end_s).filter((value): value is number => value !== null);
    const defaultStart = fallbackStart ?? knownStarts[0] ?? 0;
    const inferredEnd = fallbackEnd ?? knownEnds[knownEnds.length - 1] ?? (defaultStart + Math.max(0.2, words.length * 0.2));
    const safeEnd = Math.max(defaultStart + 0.05, inferredEnd);

    return words.map((word, index) => {
        const prev = index > 0 ? words[index - 1] : null;
        const next = index < words.length - 1 ? words[index + 1] : null;
        const nextKnownStart = words.slice(index + 1).find((item) => item.start_s !== null)?.start_s ?? null;

        const start_s = Math.max(
            0,
            word.start_s
                ?? prev?.end_s
                ?? prev?.start_s
                ?? fallbackStart
                ?? defaultStart
        );
        const endSeed =
            word.end_s
            ?? next?.start_s
            ?? nextKnownStart
            ?? fallbackEnd
            ?? safeEnd;
        const end_s = Math.max(start_s + 0.02, endSeed ?? (start_s + 0.2));

        return {
            word: word.word,
            start_s,
            end_s,
            success: word.success,
            p_align: word.p_align
        };
    });
};

const normalizeWordArray = (
    rawWords: unknown[],
    fallbackStart?: number | null,
    fallbackEnd?: number | null
): AlignedWord[] => {
    const looseWords: LooseAlignedWord[] = rawWords
        .map((item) => {
            const word = readWordText(item);
            if (!word) return null;
            const record = isRecord(item) ? item : {};
            return {
                word,
                start_s: toFiniteNumber(record.start_s ?? record.start ?? record.startTime ?? record.begin),
                end_s: toFiniteNumber(record.end_s ?? record.end ?? record.endTime ?? record.stop),
                success: record.success !== false,
                p_align: toFiniteNumber(record.p_align ?? record.score ?? record.confidence ?? record.probability) ?? 1
            } satisfies LooseAlignedWord;
        })
        .filter((item): item is LooseAlignedWord => item !== null);

    return normalizeWordTimings(looseWords, fallbackStart, fallbackEnd);
};

type ImportedTimedLyrics = {
    alignment: AlignedWord[];
    lines: AlignedWord[][];
    lrcContent: string;
    lyricSource: string;
};

export const looksLikeTimedLyricsJson = (content: string): boolean => {
    const trimmed = content.trim();
    if (!trimmed) return false;
    if (trimmed.startsWith('{')) return true;
    return /^\[\s*[\{\[]/.test(trimmed);
};

export const parseTimedLyricsJson = (jsonContent: string): ImportedTimedLyrics => {
    const raw = JSON.parse(jsonContent) as unknown;
    const root = isRecord(raw) ? raw : null;
    const arrayRoot = Array.isArray(raw) ? raw : null;
    const segmentsSource = root?.segments
        ?? (
            arrayRoot?.some((item) => isRecord(item) && (Array.isArray(item.words) || Array.isArray(item.word_segments)))
                ? arrayRoot
                : null
        );
    const alignedWordsSource = root?.aligned_words ?? root?.word_segments ?? root?.words;

    const linesFromSegments: AlignedWord[][] = Array.isArray(segmentsSource)
        ? segmentsSource
            .flatMap((segment) => {
                if (!isRecord(segment)) return [];
                const segmentStart = toFiniteNumber(segment.start_s ?? segment.start ?? segment.startTime ?? segment.begin);
                const segmentEnd = toFiniteNumber(segment.end_s ?? segment.end ?? segment.endTime ?? segment.stop);
                const nestedWords = Array.isArray(segment.words)
                    ? segment.words
                    : Array.isArray(segment.word_segments)
                        ? segment.word_segments
                        : [];

                if (nestedWords.length > 0) {
                    const segmentWords = normalizeWordArray(nestedWords, segmentStart, segmentEnd);
                    return groupWordsByTiming(segmentWords);
                }

                const segmentText = readWordText(segment);
                if (!segmentText) return [];

                const syntheticWords = segmentText.split(/\s+/).filter(Boolean).map((word) => ({ word }));
                return [normalizeWordArray(syntheticWords, segmentStart, segmentEnd)];
            })
            .filter((line) => line.length > 0)
        : [];

    const alignment = linesFromSegments.length > 0
        ? linesFromSegments.flat()
        : Array.isArray(alignedWordsSource)
            ? normalizeWordArray(alignedWordsSource)
            : Array.isArray(arrayRoot)
                ? normalizeWordArray(arrayRoot)
                : [];

    if (alignment.length === 0) {
        throw new Error('JSON did not contain any timed words.');
    }

    const lines = linesFromSegments.length > 0 ? linesFromSegments : groupWordsByTiming(alignment);
    const lyricSource = lines.map((line) => line.map((word) => word.word).join(' ').trim()).filter(Boolean).join('\n');

    return {
        alignment,
        lines,
        lrcContent: generateLrc(lines),
        lyricSource
    };
};

export const groupWordsByLrc = (aligned: AlignedWord[], lrcContent: string): AlignedWord[][] => {
    const cleanAligned = getCleanAlignedWords(aligned);
    const { entries } = parseLrc(lrcContent);
    if (cleanAligned.length === 0 || entries.length === 0) return [];

    const groups: AlignedWord[][] = [];
    let wordPtr = 0;

    for (let i = 0; i < entries.length; i++) {
        const start = entries[i].start_s;
        const nextStart = entries[i + 1]?.start_s ?? Number.POSITIVE_INFINITY;

        while (wordPtr < cleanAligned.length && cleanAligned[wordPtr].end_s <= start) {
            wordPtr++;
        }

        const group: AlignedWord[] = [];
        let scanPtr = wordPtr;
        while (scanPtr < cleanAligned.length && cleanAligned[scanPtr].start_s < nextStart) {
            group.push(cleanAligned[scanPtr]);
            scanPtr++;
        }

        if (group.length > 0) {
            groups.push(group);
            wordPtr = scanPtr;
        }
    }

    return groups;
};

export const groupWordsByLrcWithText = (aligned: AlignedWord[], lrcContent: string): AlignedWord[][] => {
    const cleanAligned = getCleanAlignedWords(aligned);
    const { entries } = parseLrc(lrcContent);
    if (entries.length === 0) return [];
    if (cleanAligned.length === 0) return [];

    const baseGroups = groupWordsByLrc(cleanAligned, lrcContent);
    const result: AlignedWord[][] = [];
    const fallbackEnd = cleanAligned[cleanAligned.length - 1]?.end_s ?? 0;

    for (let i = 0; i < entries.length; i++) {
        const entry = entries[i];
        const base = baseGroups[i] || [];
        const nextStart = entries[i + 1]?.start_s;

        if (!entry.text.trim()) {
            if (base.length > 0) result.push(base);
            continue;
        }

        const tokens = entry.text.split(/\s+/).map(t => t.trim()).filter(Boolean);
        if (tokens.length === 0) {
            if (base.length > 0) result.push(base);
            continue;
        }

        const baseTokens = base.map((word) => word.word.trim()).filter(Boolean);
        const sameTokenCount = baseTokens.length === tokens.length;
        const sameNormalizedTokens = sameTokenCount && baseTokens.every((token, idx) => (
            cleanStringForMatch(token) === cleanStringForMatch(tokens[idx])
        ));

        if (sameNormalizedTokens) {
            result.push(base.map((word, idx) => ({
                ...word,
                word: tokens[idx]
            })));
            continue;
        }

        const baseStart = base[0]?.start_s ?? entry.start_s;
        const baseEnd = base[base.length - 1]?.end_s ?? nextStart ?? fallbackEnd;
        const start_s = Math.max(0, Math.min(entry.start_s, baseStart));
        const endCandidate = nextStart ?? baseEnd ?? (start_s + Math.max(1, tokens.length * 0.2));
        const end_s = Math.max(start_s + 0.05, endCandidate);
        const slice = Math.max(0.03, (end_s - start_s) / tokens.length);

        const syntheticLine: AlignedWord[] = tokens.map((token, idx) => {
            const tokenStart = start_s + (slice * idx);
            const tokenEnd = idx === tokens.length - 1 ? end_s : (start_s + (slice * (idx + 1)));
            return {
                word: token,
                start_s: tokenStart,
                end_s: Math.max(tokenStart + 0.02, tokenEnd),
                success: true,
                p_align: 1
            };
        });

        result.push(syntheticLine);
    }

    return result;
};

export const detectLongLyricLines = (
    lines: AlignedWord[][],
    warningThresholdSec = 12,
    criticalThresholdSec = 30
): LyricLineTimingIssue[] => {
    const issues: LyricLineTimingIssue[] = [];

    lines.forEach((line, idx) => {
        if (!line.length) return;
        const start_s = line[0].start_s;
        const end_s = line[line.length - 1].end_s;
        const duration_s = Math.max(0, end_s - start_s);
        if (duration_s < warningThresholdSec) return;

        issues.push({
            lineIndex: idx,
            start_s,
            end_s,
            duration_s,
            text: line.map(w => w.word).join(' ').trim(),
            severity: duration_s >= criticalThresholdSec ? 'critical' : 'warning'
        });
    });

    return issues.sort((a, b) => b.duration_s - a.duration_s);
};

export const detectLongLrcGaps = (
    lrcContent: string,
    warningThresholdSec = 12,
    criticalThresholdSec = 30
): Array<{ fromLineNumber: number; toLineNumber: number; gap_s: number; severity: 'warning' | 'critical' }> => {
    const { entries } = parseLrc(lrcContent);
    const issues: Array<{ fromLineNumber: number; toLineNumber: number; gap_s: number; severity: 'warning' | 'critical' }> = [];

    for (let i = 0; i < entries.length - 1; i++) {
        const gap_s = entries[i + 1].start_s - entries[i].start_s;
        if (gap_s < warningThresholdSec) continue;
        issues.push({
            fromLineNumber: entries[i].lineNumber,
            toLineNumber: entries[i + 1].lineNumber,
            gap_s,
            severity: gap_s >= criticalThresholdSec ? 'critical' : 'warning'
        });
    }

    return issues.sort((a, b) => b.gap_s - a.gap_s);
};

export const formatLrcTimestamp = (seconds: number) => {
    const date = new Date(0);
    date.setMilliseconds(seconds * 1000);
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const secs = String(date.getUTCSeconds()).padStart(2, '0');
    const hundredths = String(Math.floor(date.getUTCMilliseconds() / 10)).padStart(2, '0');
    return `[${minutes}:${secs}.${hundredths}]`;
};

export const formatSrtTimestamp = (seconds: number) => {
    const date = new Date(0);
    date.setMilliseconds(seconds * 1000);
    const hours = String(date.getUTCHours()).padStart(2, '0');
    const minutes = String(date.getUTCMinutes()).padStart(2, '0');
    const secs = String(date.getUTCSeconds()).padStart(2, '0');
    const milliseconds = String(date.getUTCMilliseconds()).padStart(3, '0');
    return `${hours}:${minutes}:${secs},${milliseconds}`;
};

export const generateLrc = (lines: AlignedWord[][]): string => {
    let lrcContent = '';
    lines.forEach(line => {
        if (line.length === 0) return;
        const time = formatLrcTimestamp(line[0].start_s);
        const lineText = line.map(w => w.word).join(' ');
        lrcContent += `${time}${lineText}\n`;
    });
    return lrcContent;
};

export const generateSrt = (lines: AlignedWord[][]): string => {
    let srtContent = '';
    lines.forEach((line, index) => {
        if (line.length === 0) return;
        const startTime = formatSrtTimestamp(line[0].start_s);
        const endTime = formatSrtTimestamp(line[line.length - 1].end_s);
        const lineText = line.map(w => w.word).join(' ');
        srtContent += `${index + 1}\n${startTime} --> ${endTime}\n${lineText}\n\n`;
    });
    return srtContent;
};
