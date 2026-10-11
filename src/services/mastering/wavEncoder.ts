export async function encodeWavAsync(
  audioBuffer: AudioBuffer,
  targetSampleRate: number,
  bitDepth: 16 | 24,
  options?: {
    onProgress?: (progress: number) => void;
    shouldCancel?: () => boolean;
    chunkSize?: number;
  }
): Promise<Uint8Array> {
  const onProgress = options?.onProgress;
  const shouldCancel = options?.shouldCancel;
  const chunkSize = Math.max(1024, options?.chunkSize ?? 65536);

  const safeBitDepth: 16 | 24 = bitDepth === 24 ? 24 : 16;
  const numChannels = audioBuffer.numberOfChannels;
  const sampleRate = targetSampleRate || audioBuffer.sampleRate;
  const bytesPerSample = safeBitDepth / 8;

  const channels: Float32Array[] = [];
  for (let ch = 0; ch < numChannels; ch++) {
    channels.push(audioBuffer.getChannelData(ch));
  }

  const numSamples = channels[0]?.length ?? 0;
  const dataSize = numSamples * numChannels * bytesPerSample;
  const out = new ArrayBuffer(44 + dataSize);
  const view = new DataView(out);

  const writeString = (offset: number, str: string) => {
    for (let i = 0; i < str.length; i++) view.setUint8(offset + i, str.charCodeAt(i));
  };

  writeString(0, 'RIFF');
  view.setUint32(4, 36 + dataSize, true);
  writeString(8, 'WAVE');
  writeString(12, 'fmt ');
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, numChannels, true);
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * numChannels * bytesPerSample, true);
  view.setUint16(32, numChannels * bytesPerSample, true);
  view.setUint16(34, safeBitDepth, true);
  writeString(36, 'data');
  view.setUint32(40, dataSize, true);

  const maxVal = safeBitDepth === 16 ? 32767 : 8388607;
  let offset = 44;

  for (let i = 0; i < numSamples; i += chunkSize) {
    if (shouldCancel?.()) throw new Error('Cancelled');
    const end = Math.min(i + chunkSize, numSamples);

    for (let s = i; s < end; s++) {
      for (let ch = 0; ch < numChannels; ch++) {
        const sample = Math.max(-1, Math.min(1, channels[ch][s]));

        if (safeBitDepth === 16) {
          // TPDF dither (triangular probability density) = two independent
          // RPDF sources, added at ±1 LSB before quantization. This decorrelates
          // quantization error from the signal, replacing truncation distortion
          // with a constant low-level noise floor (avoids audible harmonic
          // distortion on 16-bit exports).
          const dithered = sample * maxVal + (Math.random() + Math.random() - 1);
          const intSample = Math.max(-32768, Math.min(32767, Math.round(dithered)));
          view.setInt16(offset, intSample, true);
          offset += 2;
        } else {
          const intSample = Math.round(sample * maxVal);
          const clamped = Math.max(-8388607, Math.min(8388607, intSample));
          view.setUint8(offset, clamped & 0xff);
          view.setUint8(offset + 1, (clamped >> 8) & 0xff);
          view.setUint8(offset + 2, (clamped >> 16) & 0xff);
          offset += 3;
        }
      }
    }

    onProgress?.(end / numSamples);
    if (end < numSamples) await new Promise((resolve) => setTimeout(resolve, 0));
  }

  onProgress?.(1);
  return new Uint8Array(out);
}
