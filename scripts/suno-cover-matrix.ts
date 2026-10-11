import * as fs from 'fs';
import * as path from 'path';
import {
  getSunoClip,
  triggerSunoCoverGeneration,
  formatCoverTitle,
  formatVarietyName,
} from '../src/services/sunoApi';
import { VarietyLevel, CoverSliderMatrixItem } from '../src/types';

interface MatrixCliArgs {
  songId?: string;
  prefix?: string;
  model: string;
  varieties: VarietyLevel[];
  audioInfluences: number[];
  styleInfluences: number[];
  weirdnessValues: number[];
  maxModes: boolean[];
  tags?: string;
  lyrics?: string;
  token?: string;
  delayMs: number;
  dryRun: boolean;
  yes: boolean;
  outputPath?: string;
}

function loadAuthToken(): string {
  if (process.env.SUNO_TOKEN) return process.env.SUNO_TOKEN.trim();
  if (process.env.SUNO_COOKIE) return process.env.SUNO_COOKIE.trim();

  // Try reading .suno-session/session.json
  const sessionPath = path.resolve(process.cwd(), '.suno-session/session.json');
  if (fs.existsSync(sessionPath)) {
    try {
      const data = JSON.parse(fs.readFileSync(sessionPath, 'utf-8'));
      if (data?.token) return data.token;
    } catch {}
  }

  // Try reading .env
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf-8').split('\n');
    for (const line of lines) {
      const match = line.match(/^SUNO_TOKEN=["']?([^"'\r\n]+)["']?/);
      if (match?.[1]) return match[1].trim();
      const cookieMatch = line.match(/^SUNO_COOKIE=["']?([^"'\r\n]+)["']?/);
      if (cookieMatch?.[1]) return cookieMatch[1].trim();
    }
  }

  return '';
}

function parseArgs(): MatrixCliArgs {
  const raw = process.argv.slice(2);
  const getArg = (key: string): string | undefined => {
    const prefix = `--${key}=`;
    const matched = raw.find((a) => a.startsWith(prefix));
    if (matched) return matched.slice(prefix.length);
    const idx = raw.indexOf(`--${key}`);
    if (idx !== -1 && raw[idx + 1] && !raw[idx + 1].startsWith('--')) {
      return raw[idx + 1];
    }
    return undefined;
  };
  const hasFlag = (key: string): boolean => raw.includes(`--${key}`);

  const songInput = getArg('song') || getArg('clip') || '91fb180d-5cfe-48d9-91aa-e4099ae0e2f1';
  // Extract UUID if URL was passed
  const uuidMatch = songInput.match(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  const songId = uuidMatch ? uuidMatch[0] : songInput;

  const prefix = getArg('prefix');
  const model = getArg('model') || 'chirp-hawk'; // default Suno V6

  // Variety: default 0,1,2,3,4
  const vArg = getArg('variety') || getArg('v');
  const varieties: VarietyLevel[] = vArg
    ? (vArg.split(',').map((s) => Math.max(0, Math.min(4, parseInt(s.trim(), 10)))) as VarietyLevel[])
    : [0, 1, 2, 3, 4];

  // Audio influence: default 0, 25, 50, 75, 100
  const aiArg = getArg('ai') || getArg('audio');
  const audioInfluences = aiArg
    ? aiArg.split(',').map((s) => parseFloat(s.trim()))
    : [0, 25, 50, 75, 100];

  // Style influence: default 50
  const siArg = getArg('si') || getArg('style');
  const styleInfluences = siArg
    ? siArg.split(',').map((s) => parseFloat(s.trim()))
    : [50];

  // Weirdness: default 50
  const wArg = getArg('w') || getArg('weirdness');
  const weirdnessValues = wArg
    ? wArg.split(',').map((s) => parseFloat(s.trim()))
    : [50];

  // Max mode: default off
  const maxArg = getArg('max') || 'off';
  let maxModes: boolean[] = [false];
  if (maxArg === 'on' || maxArg === 'true') {
    maxModes = [true];
  } else if (maxArg === 'both' || maxArg === 'all') {
    maxModes = [false, true];
  }

  const delaySec = parseFloat(getArg('delay') || '8');

  return {
    songId,
    prefix,
    model,
    varieties,
    audioInfluences,
    styleInfluences,
    weirdnessValues,
    maxModes,
    tags: getArg('tags'),
    lyrics: getArg('lyrics'),
    token: getArg('token') || loadAuthToken(),
    delayMs: Math.max(2000, delaySec * 1000),
    dryRun: hasFlag('dry-run'),
    yes: hasFlag('yes') || hasFlag('y'),
    outputPath: getArg('output'),
  };
}

function derivePrefix(title: string): string {
  if (!title) return 'COVER';
  const clean = title.replace(/[^a-zA-Z0-9\s]/g, '').trim();
  const words = clean.split(/\s+/);
  if (words.length > 1) {
    return words.map((w) => w[0].toUpperCase()).join('');
  }
  return clean.slice(0, 4).toUpperCase();
}

async function main() {
  const args = parseArgs();

  console.log('====================================================');
  console.log('  Suno v6 Cover Slider Matrix Generator');
  console.log('====================================================');

  if (!args.token && !args.dryRun) {
    console.error('\n[!] Error: No Suno authentication token found.');
    console.error('Please run: bun run suno:login');
    console.error('Or provide --token=<your_bearer_token> or add SUNO_TOKEN to .env\n');
    process.exit(1);
  }

  console.log(`Source Song ID: ${args.songId}`);
  console.log(`Model:          ${args.model} (${args.model === 'chirp-hawk' ? 'Suno v6' : args.model})`);

  let baseTitle = 'Source Song';
  let basePrompt = args.lyrics || '';
  let baseTags = args.tags || '';

  if (args.token) {
    try {
      console.log('Fetching source song metadata from Suno...');
      const clip = await getSunoClip(args.songId!, args.token);
      baseTitle = clip?.title || baseTitle;
      basePrompt = basePrompt || clip?.metadata?.prompt || '';
      baseTags = baseTags || clip?.metadata?.tags || '';
      console.log(`✓ Found: "${baseTitle}"`);
    } catch (e: any) {
      console.warn(`[!] Note: Could not fetch song directly (${e.message}). Proceeding with parameters.`);
    }
  }

  const prefix = args.prefix || derivePrefix(baseTitle);
  console.log(`Title Prefix:   "${prefix}"`);
  console.log(`Varieties (v):  [${args.varieties.map((v) => `${v}:${formatVarietyName(v)}`).join(', ')}]`);
  console.log(`Audio Inf (ai): [${args.audioInfluences.join('%, ')}%]`);
  console.log(`Style Inf (si): [${args.styleInfluences.join('%, ')}%]`);
  console.log(`Weirdness (w):  [${args.weirdnessValues.join('%, ')}%]`);
  console.log(`Max Mode:       [${args.maxModes.map((m) => (m ? 'maxon' : 'maxoff')).join(', ')}]`);

  // Build matrix
  const matrix: CoverSliderMatrixItem[] = [];
  for (const v of args.varieties) {
    for (const ai of args.audioInfluences) {
      for (const si of args.styleInfluences) {
        for (const w of args.weirdnessValues) {
          for (const maxMode of args.maxModes) {
            const title = formatCoverTitle(prefix, v, ai, si, w, maxMode);
            const id = `cover_${v}_${ai}_${si}_${w}_${maxMode ? '1' : '0'}`;
            matrix.push({
              id,
              title,
              variety: v,
              audioInfluence: ai,
              styleInfluence: si,
              weirdness: w,
              isMaxMode: maxMode,
              status: 'pending',
            });
          }
        }
      }
    }
  }

  const totalRuns = matrix.length;
  const totalClips = totalRuns * 2; // Each Suno generation creates 2 clips
  const estimatedCredits = totalRuns * 10; // 10 credits per generation

  console.log('\n----------------------------------------------------');
  console.log(`Total Generations: ${totalRuns} (${totalClips} songs)`);
  console.log(`Estimated Credits: ${estimatedCredits} credits`);
  console.log(`Estimated Time:    ~${Math.round((totalRuns * args.delayMs) / 60000)} minutes (with ${args.delayMs / 1000}s pacing)`);
  console.log('----------------------------------------------------\n');

  console.log('Matrix Preview (First 10 items):');
  matrix.slice(0, 10).forEach((item, i) => {
    console.log(`  ${String(i + 1).padStart(2, ' ')}. ${item.title}`);
  });
  if (totalRuns > 10) {
    console.log(`  ... and ${totalRuns - 10} more items.`);
  }

  if (args.dryRun) {
    console.log('\n[DRY RUN] Matrix generated successfully. Exiting without triggering generations.');
    return;
  }

  if (!args.yes) {
    process.stdout.write(`\nDo you want to execute all ${totalRuns} generations (${estimatedCredits} credits)? [y/N]: `);
    const line = await new Promise<string>((resolve) => {
      process.stdin.once('data', (d) => resolve(d.toString().trim().toLowerCase()));
    });
    if (line !== 'y' && line !== 'yes') {
      console.log('Aborted by user.');
      process.exit(0);
    }
  }

  fs.mkdirSync(path.resolve(process.cwd(), 'output'), { recursive: true });
  const outFilePath =
    args.outputPath ||
    path.resolve(process.cwd(), `output/cover-matrix-${prefix}-${Date.now()}.json`);

  console.log(`\nStarting execution of ${totalRuns} cover batches...`);
  console.log(`Results will be written continuously to: ${outFilePath}\n`);

  for (let i = 0; i < matrix.length; i++) {
    const item = matrix[i];
    item.status = 'running';
    console.log(`[${i + 1}/${totalRuns}] Generating "${item.title}"...`);

    try {
      const res = await triggerSunoCoverGeneration(
        {
          songId: args.songId!,
          title: item.title,
          prompt: basePrompt,
          tags: baseTags,
          model: args.model,
          audioWeight: item.audioInfluence / 100,
          styleWeight: item.styleInfluence / 100,
          weirdness: item.weirdness / 100,
          variety: item.variety,
          isMaxMode: item.isMaxMode,
        },
        args.token!
      );

      const clips = res?.clips || [];
      item.clipIds = clips.map((c: any) => c.id);
      item.status = 'completed';
      console.log(`   ✓ Success! Created clips: ${item.clipIds?.join(', ') || 'OK'}`);
    } catch (err: any) {
      item.status = 'failed';
      item.error = err.message || String(err);
      console.error(`   ✗ Failed: ${item.error}`);
    }

    // Save state after each step
    fs.writeFileSync(
      outFilePath,
      JSON.stringify(
        {
          timestamp: new Date().toISOString(),
          baseSongId: args.songId,
          prefix,
          total: totalRuns,
          completed: matrix.filter((m) => m.status === 'completed').length,
          failed: matrix.filter((m) => m.status === 'failed').length,
          items: matrix,
        },
        null,
        2
      )
    );

    // Wait between calls unless last item
    if (i < matrix.length - 1) {
      console.log(`   Waiting ${args.delayMs / 1000}s before next request...`);
      await new Promise((r) => setTimeout(r, args.delayMs));
    }
  }

  console.log('\n====================================================');
  console.log('Matrix Run Finished!');
  console.log(`Success: ${matrix.filter((m) => m.status === 'completed').length}/${totalRuns}`);
  console.log(`Failed:  ${matrix.filter((m) => m.status === 'failed').length}/${totalRuns}`);
  console.log(`Log:     ${outFilePath}`);
  console.log('====================================================\n');
}

main().catch((err) => {
  console.error('Matrix error:', err);
  process.exit(1);
});
