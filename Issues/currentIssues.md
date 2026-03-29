# Current Issues

- [ ] **Mastering Pipeline Volume Fade**
  - **Symptom**: Audio buffer fades during playback despite source file playing correctly in external players.
  - **Root Cause**: Web Audio API's `decodeAudioData` is not properly decoding MP3/WAV files, creating a faded buffer.
  - **Fix**: Replaced `decodeAudioData` with audio element + `createMediaElementSource` + `ScriptProcessorNode` capture pipeline. This uses the browser's native media decoder which correctly decodes the file.
  - **Status**: Implemented fix, needs testing.
