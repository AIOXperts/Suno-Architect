# Web-Audio-Master — Settings Reference & Usage Guide

This guide explains the **Web-Audio-Master** panel in Suno-Architect: what each
setting does, the underlying DSP, and when to turn it on or off. It covers the
"Quick Fix / Polish" toggles, the Stereo / Loudness controls, the Output options,
and the EQ section.

> **Context.** Web-Audio-Master is a native in-browser mastering chain that
> processes Suno tracks (or any uploaded audio) through a full DSP pipeline and
> exports a mastered WAV. It does not send audio to any server — all processing
> happens locally in the browser.

---

## 1. How it works (two paths)

There are two independent render paths that use the *same* settings object and
the *same* DSP chain:

| Path | Where | Purpose | Trade-offs |
|------|-------|---------|-----------|
| **Offline render** | Web Worker (`masteringWorker.ts`) | Produces the final mastered WAV (`Native Master + Save Variant`) | Full-fidelity, sample-accurate, whole-file gated loudness |
| **Realtime preview** | AudioWorklet (falls back to ScriptProcessor) | Lets you *listen* and watch meters before exporting | Low-latency, block-based, smooths loudness over time |

The preview is a close approximation of the final render, but a few parameters
are intentionally tuned lighter for realtime (e.g. tape-warmth mix `0.25` vs
`0.40`, add-punch `+1.5 dB` vs `+2.0 dB`). **The offline render is the source of
truth** — always judge the final result by the exported WAV, not only the
preview.

### Signal chain (exact order)

The settings below are applied in this fixed order. Order matters: each stage
sees the output of the previous one.

```
1.  Input Gain          (linear gain from the "Input Gain" slider)
2.  Clean Low End       (high-pass @ 30 Hz — removes subsonic rumble)
3.  Tape Warmth         (tanh saturation — harmonic warmth)
4.  EQ                  (5 peaking bands + Add Air shelf + Cut Mud notch)
5.  Glue Compression    (3-band multiband compressor)
6.  Stereo Imager       (width + Mono Bass)
7.  Add Air (reverb)    (subtle algorithmic reverb tail)
8.  De-harsh            (de-esser, broadband)
9.  Add Punch           (transient shaper)
10. Normalize Loudness  (K-weighted gated LUFS → Target LUFS)
11. True Peak Limiter   (lookahead brickwall @ Ceiling)
12. Metering            (final LUFS / true-peak readout)
```

---

## 2. Quick Fix / Polish

These nine on/off toggles are "one-click fixes" for the most common problems in
Suno-style AI-generated tracks. Each one is a small, safe, pre-tuned processor.
Turn them on to fix a specific symptom; leave them off when the track doesn't
have that problem.

### Glue Compression — *default: OFF*

A gentle **3-band multiband compressor** that "glues" the mix together so the
frequency ranges move as one cohesive whole.

- **DSP:** Linkwitz-Riley 4th-order crossovers at **200 Hz** and **3 kHz**,
  splitting the signal into low / mid / high bands. Each band is compressed with
  a soft 2:1–2.5:1 ratio (thresholds ≈ −18 to −22 dB), channel-linked so the
  stereo image is preserved.
- **When to use:** The track feels loose, "separated," or dynamically uneven
  across the spectrum; you want a more finished, radio-style cohesion.
- **When to avoid:** Suno tracks are *already* mastered and compressed, so
  additional compression can squash dynamics. It's OFF by default for a reason —
  enable it only when the material genuinely feels too dynamic.

### De-harsh — *default: ON*

A **de-esser** that tames harsh, brittle high-frequency content — sibilance
("s", "t", "sh" sounds), piercing cymbals, and digital "ice-pick" highs.

- **DSP:** A high-pass sidechain at **6 kHz** detects when high-frequency energy
  dominates and gently reduces the *whole* signal (broadband, up to **3 dB**,
  ratio 2.5, strength 0.35).
- **When to use:** Most AI vocals benefit — this is the single most reliable
  "polish" toggle. Turn on for bright/harsh vocals or fizzy top end.
- **When to avoid:** If the track is already dark or muffled and you're trying
  to *add* brightness (pair it with "Add Air" instead).

### Clean Low End — *default: ON*

A **high-pass filter at 30 Hz** that removes subsonic rumble and infrasonic
energy below the audible range.

- **DSP:** Biquad high-pass @ 30 Hz, Q 0.707.
- **Why:** Sub-30 Hz content wastes headroom, muddies the low end, and makes
  speakers/streaming encoders work harder for sound you can't hear.
- **When to use:** Almost always — leave ON. It's a free headroom win.
- **When to avoid:** Only if you're mastering intentional sub-bass/EDM where
  energy below 30 Hz is deliberate (very rare in this context).

### Auto Level — *default: OFF*

Historically intended as a realtime "automatic gain" control. In the current
engine it **triggers the same loudness normalization as "Normalize Loudness"**
(the two switches feed the same condition in both the offline and realtime
paths).

- **When to use:** Treat it as a duplicate/alias of **Normalize Loudness**. In
  practice, use the *Normalize Loudness* toggle and leave this OFF to avoid
  confusion.

### Add Punch — *default: ON*

A **transient shaper** that emphasizes the attack of percussive elements — kick,
snare, plucks — so they cut through the mix.

- **DSP:** Detects fast vs. slow envelope energy and boosts the transient
  portion by **+2.0 dB** (offline) / **+1.5 dB** (realtime). Sustain is left
  untouched.
- **When to use:** Drums feel weak or buried; you want more impact and rhythm
  definition.
- **When to avoid:** Already-aggressive transients, or softer genres (ambient,
  classical, solo piano) where exaggerated attacks sound unnatural.

### Mono Bass — *default: ON*

Forces the **low frequencies into mono**, collapsing the stereo width below
200 Hz.

- **DSP:** Mid/side processing with a high-pass on the **side** channel at
  **200 Hz** — everything below that frequency becomes center-mono.
- **Why:** Bass that's wide in stereo causes phase cancellation when summed to
  mono (phones, Bluetooth speakers, clubs) and can sound unfocused.
- **When to use:** Almost always — improves mono compatibility and tightens the
  low end.
- **When to avoid:** Only if you have intentionally wide/stereo sub-bass effects
  that you want to preserve.

### Cut Mud — *default: OFF*

A **narrow cut at 250 Hz** that removes "mud" — the boxy, congested low-mid
buildup that masks clarity.

- **DSP:** A −3 dB peaking cut at **250 Hz**, Q 2.0.
- **When to use:** The mix sounds muddy, boxy, or congested; vocals/guitars feel
  buried in the low-mids.
- **When to avoid:** Thin or warm material that would become hollow if you cut
  more low-mid.

### Add Air — *default: ON*

Adds "sparkle" and a sense of open space to the top end. This toggle actually
does **two** things:

1. A **high-shelf EQ boost of +3 dB at 15 kHz** (brightens the very top).
2. A **subtle algorithmic reverb** (Freeverb, mix 0.04) that gives a faint sense
   of room/air around the sound.

- **When to use:** Flat, dull, or "closed-in" recordings that need openness and
  sheen.
- **When to avoid:** Already-bright or sibilant material (combine with *De-harsh*
  if you keep it on).

### Tape Warmth — *default: ON*

A **tape/analog saturation** stage that adds gentle harmonics and warmth,
rounding off harsh digital edges.

- **DSP:** `tanh` soft-clipping with +2 dB drive and a 40 % wet mix (25 % in
  realtime), then gain-compensated so level stays roughly constant.
- **When to use:** Cold, sterile, or "digital-sounding" AI output — this makes
  it feel more analog and musical.
- **When to avoid:** Already-distorted, over-driven, or lo-fi material where
  more saturation would add mud.

---

## 3. Stereo / Loudness

These controls shape overall level, stereo image, and the final loudness
targets.

### Input Gain — *default: 0 dB (range −12 to +12 dB)*

A pre-chain gain applied **first**, before every other processor. Use it to
correct a source that's recorded too quiet or too hot before it hits the
saturation/EQ/limiter stages.

- **When to raise:** Quiet sources that you want to drive harder into the
  warmth/limiter.
- **When to lower:** Hot sources that already clip or are hitting the limiter
  too hard.

### Stereo Width — *default: 100 % (range 0–200 %)*

Mid/side width control. **100 % = unchanged.**

- **< 100 %** narrows the image (toward mono).
- **> 100 %** widens beyond the original (can sound huge, but risk phase issues).
- **When to widen:** Narrow, mono-ish mixes that need more dimension.
- **When to narrow:** Overly wide mixes that collapse or sound phasey in mono.

### Target LUFS — *default: −14 (range −16 to −6)*

The integrated-loudness target used by **Normalize Loudness**. −14 LUFS is the
common streaming-platform target (YouTube, Spotify). −16 is "quiet/audiophile,"
−8 to −6 is "loud/competitive" for club/EDM.

- **When to change:** Match your distribution target, or push louder for
  competitive playback.

### Ceiling (dBTP) — *default: −1 (range −6 to 0)*

The true-peak ceiling for the final limiter. The mastered output will not exceed
this level, measured on inter-sample (true) peaks.

- **−1 dBTP** is the EBU R128 production standard for streaming/broadcast.
- **0 dBTP** is the absolute ceiling (safe for lossless, but can clip on
  lossy-encoder overshoot).
- **−2 to −6 dBTP** leaves more headroom for downstream encoding.

### Normalize Loudness — *default: ON*

Measures the track's **K-weighted gated integrated loudness** (ITU-R BS.1770-4)
and applies gain to bring it to **Target LUFS**.

- **DSP:** EBU R128 metering (400 ms blocks, −70 LUFS absolute gate, −10 LU
  relative gate), gain capped at +12 dB for safety.
- **When to use:** You want consistent loudness across tracks / platform
  compliance. This is the primary "make it loud enough" control.
- **When to avoid:** If you want to preserve the track's original dynamic
  balance exactly (turn it off and rely on the limiter alone).

### True Peak Limit — *default: ON*

Enables the **true-peak lookahead brickwall limiter** at **Ceiling**.

- **DSP:** 5 ms lookahead + 4× oversampled inter-sample peak detection so peaks
  that fall *between* samples can't slip past the ceiling; channel-linked to
  preserve stereo.
- **When to use:** Always for deliverables. It's the final safety net against
  clipping/distortion.
- **When to avoid:** Effectively never — turning it off switches to a plain
  safety limiter (−0.5 dB), which offers less protection.

---

## 4. Output

Controls the format of the exported WAV.

### Output presets

| Preset | Sample Rate | Bit Depth | Use for |
|--------|------------|-----------|---------|
| **streaming** | 48 kHz | 24-bit | General high-quality / streaming pipeline |
| **cd** | 44.1 kHz | 16-bit | CD / Red Book compatibility |

### Sample Rate — *default: 48 kHz (44.1 kHz or 48 kHz)*

The output sample rate. The source is resampled (via the browser's
high-quality `OfflineAudioContext` resampler) when it differs from this value.

- **48 kHz** — standard for video/streaming.
- **44.1 kHz** — standard for CD and most music distribution.

### Bit Depth — *default: 24-bit (16-bit or 24-bit)*

- **24-bit** — higher headroom/dynamic range, no dither needed.
- **16-bit** — CD standard; exported with **TPDF dither** (triangular
  probability-density) applied to prevent truncation distortion at the lower
  bit depth.

---

## 5. EQ

A **5-band parametric EQ** applied in the mid/side domain. Each band is a
peaking filter with ±12 dB range (0.5 dB steps).

### The bands

| Band | Center | Q | Typical role |
|------|--------|---|--------------|
| **low**     | 100 Hz | 0.7 | Low end / sub-bass weight |
| **lowMid**  | 400 Hz | 1.0 | Body / warmth / mud zone |
| **mid**     | 1 kHz  | 1.0 | Presence / midrange honk |
| **highMid** | 4 kHz  | 1.0 | Clarity / attack / harshness |
| **high**    | 12 kHz | 0.7 | Air / brilliance / sibilance |

### EQ presets

One-click starting points (all values in dB):

| Preset | 100 Hz | 400 Hz | 1 kHz | 4 kHz | 12 kHz | For |
|--------|--------|--------|-------|-------|--------|-----|
| **flat**   | 0   | 0   | 0   | 0   | 0   | Neutral baseline |
| **vocal**  | −1  | −1  | +1.5| +2  | +1.5| Vocal clarity, presence |
| **bass**   | +3  | +1.5| 0   | −0.5| −1  | Bass-heavy / low-end weight |
| **bright** | −1  | 0   | +0.5| +2  | +3  | Adding top-end sparkle |
| **warm**   | +1.5| +1  | −0.5| −1  | −0.5| Mellow, analog warmth |
| **aifix**  | 0   | −1.5| −0.5| −2  | +1.5| Fixing harsh AI highs |

- **When to use presets:** Start from a preset matching your goal, then fine-tune
  individual bands.
- **When to hand-tune:** When you know the specific problem region (e.g. a
  resonance at ~4 kHz) and want surgical correction.

---

## 6. Default settings (summary)

| Setting | Default |
|---------|---------|
| Input Gain | 0 dB |
| Glue Compression | OFF |
| De-harsh | ON |
| Clean Low End | ON |
| Auto Level | OFF |
| Add Punch | ON |
| Stereo Width | 100 % |
| Mono Bass | ON |
| Cut Mud | OFF |
| Add Air | ON |
| Tape Warmth | ON |
| Normalize Loudness | ON |
| Target LUFS | −14 |
| True Peak Limit | ON |
| Ceiling | −1 dBTP |
| Sample Rate | 48 kHz |
| Bit Depth | 24-bit |
| EQ | flat (all 0 dB) |

These defaults are a conservative, general-purpose "polish" profile suited to
most Suno tracks: remove rumble, tame harshness, add a little punch/air/warmth,
normalize to −14 LUFS, and limit at −1 dBTP.

---

## 7. Suggested recipes

**General polish (start here)**
- Use the defaults. Listen to the realtime preview, then export. This is the
  intended "Quick Fix" workflow.

**Fix harsh/bright AI vocals**
- Keep **De-harsh** ON, add **Cut Mud** (if boxy), and lower the **4 kHz** EQ
  band slightly. Consider the **aifix** EQ preset.

**Make a flat track open up**
- **Add Air** ON, **Add Punch** ON, try the **bright** EQ preset. Raise
  **Stereo Width** to 110–130 %.

**Boost a weak/low track**
- Raise **Input Gain** a few dB, keep **Clean Low End** ON, try the **bass** EQ
  preset.

**Competitive loudness (EDM/club)**
- **Target LUFS** to −8 to −6, **Ceiling** to −1, keep **True Peak Limit** ON.

**CD-ready export**
- Select the **cd** output preset (44.1 kHz / 16-bit). Dither is applied
  automatically.

**Preserve dynamics exactly**
- Turn **Normalize Loudness** OFF, **Glue Compression** OFF, leave the limiter
  ON only as a safety ceiling.

---

## 8. Known limitations / notes

- **Auto Level** currently duplicates **Normalize Loudness** (same code path).
- **De-harsh** is a *broadband* de-esser (it attenuates the whole signal when
  highs dominate), not a split-band de-esser.
- The realtime preview uses slightly lighter parameter values than the offline
  render for a few effects (tape warmth, add punch). Trust the exported WAV for
  the final judgment.
- The **"Use Suno WAV"** option in the panel fetches a full-length WAV from the
  Suno API; without it, library MP3/preview audio can fade out early.
