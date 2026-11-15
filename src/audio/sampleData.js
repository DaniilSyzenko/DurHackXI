export const SAMPLE_SEGMENTS = Array.from({ length: 32 }, (_, i) => ({
  rms: (Math.sin(i * 0.45) + 1) * 0.5,
  bass: (Math.cos(i * 0.3) + 1) * 0.5,
  mid: ((i * 7) % 10) / 10,
  treble: (Math.sin(i * 0.8 + 1) + 1) * 0.5,
}));