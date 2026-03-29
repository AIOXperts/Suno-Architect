export interface AudioBlock {
  channels: Float32Array[];
  sampleRate: number;
}

export interface Processor {
  process(block: AudioBlock): void;
}
