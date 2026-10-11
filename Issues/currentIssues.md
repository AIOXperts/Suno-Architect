# Current Issues

- [ ] **Mastering Pipeline Volume Fade**
  - **Symptom**: Audio buffer fades during playback despite source file playing correctly in external players.
  - **Root Cause**: Web Audio API's `decodeAudioData` is not properly decoding MP3/WAV files, creating a faded buffer.
  - **Fix**: Replaced `decodeAudioData` with audio element + `createMediaElementSource` + `ScriptProcessorNode` capture pipeline. This uses the browser's native media decoder which correctly decodes the file.
  - **Status**: Implemented fix, needs testing.

## Known Gaps

- [ ] **Hard delete intentionally omitted**
  - **Context**: Library track cleanup roadmap (`.omo/plans/library-track-cleanup-roadmap.md`).
  - **Decision**: User chose a non-destructive model. Tracks are archived/restored and flagged "No longer on Suno"; no code path deletes an `OfflineTrack` row.
  - **Status**: By design, not planned.

- [ ] **Publish workflow remains dry-run**
  - **Symptom**: The Visualizer Export tab's YouTube/Facebook publish action only runs a preview; nothing is uploaded.
  - **Root Cause**: Worker `/api/publish/*` endpoints are stubs; no OAuth integration exists.
  - **Status**: Labelled as "Dry-Run Publish Preview" in the UI. Real publishing is out of scope.

- [ ] **Mastering volume-fade fix pending**
  - **Context**: See "Mastering Pipeline Volume Fade" above.
  - **Status**: Fix lives in in-flight, uncommitted work (`src/services/mastering/realtimeMasteringProcessor.ts`, `src/services/mastering/realtimeMasteringWorklet.js`). Not touched by the library roadmap; still needs testing.

- [ ] **Dirty-worktree files excluded from the library roadmap**
  - **Context**: Uncommitted edits exist in `useVisualizer.ts`, `CanvasPreview.tsx`, `MetadataCard.tsx`, `WebAudioMasterNativePreview.tsx`, `lyrics.ts`, the realtime mastering processor/worklet, and `demo/`.
  - **Status**: The roadmap deliberately avoided editing these (import-only in tests). They remain the user's in-flight work and are not reviewed or validated by the roadmap's test suites.

