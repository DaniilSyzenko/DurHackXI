const FFT_SIZE = 4096;
const FRAMES_PER_SEGMENT = 6;
const SEGMENT_SECONDS = 2;

const hannWindow = new Float32Array(FFT_SIZE);
for (let i = 0; i < FFT_SIZE; i++) {
  hannWindow[i] = 0.5 * (1 - Math.cos((2 * Math.PI * i) / (FFT_SIZE - 1)));
}

function fft(real, imag) {
  const n = real.length;

  let j = 0;
  for (let i = 1; i < n; i++) {
    let bit = n >> 1;
    while (j & bit) {
      j ^= bit;
      bit >>= 1;
    }
    j ^= bit;
    if (i < j) {
      const tr = real[i];
      real[i] = real[j];
      real[j] = tr;

      const ti = imag[i];
      imag[i] = imag[j];
      imag[j] = ti;
    }
  }

  for (let size = 2; size <= n; size <<= 1) {
    const half = size >> 1;
    const angleStep = (-2 * Math.PI) / size;

    for (let i = 0; i < n; i += size) {
      for (let k = 0; k < half; k++) {
        const angle = angleStep * k;
        const wr = Math.cos(angle);
        const wi = Math.sin(angle);

        const idx1 = i + k;
        const idx2 = idx1 + half;

        const tr = wr * real[idx2] - wi * imag[idx2];
        const ti = wr * imag[idx2] + wi * real[idx2];

        real[idx2] = real[idx1] - tr;
        imag[idx2] = imag[idx1] - ti;
        real[idx1] += tr;
        imag[idx1] += ti;
      }
    }
  }
}

function normalizeArray(values) {
  if (values.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  for (let i = 0; i < values.length; i++) {
    if (values[i] < min) min = values[i];
    if (values[i] > max) max = values[i];
  }
  const range = max - min;
  if (range < 1e-8) {
    const fallback = max < 1e-8 ? 0 : 0.5;
    return values.map(() => fallback);
  }
  return values.map((v) => Math.max(0, Math.min(1, (v - min) / range)));
}

function analyzeChannel(samples, sampleRate, bands) {
  const totalSamples = samples.length;
  const samplesPerSegment = Math.max(1, Math.floor(sampleRate * SEGMENT_SECONDS));

  const real = new Float32Array(FFT_SIZE);
  const imag = new Float32Array(FFT_SIZE);

  const rawRms = [];
  const rawBass = [];
  const rawMid = [];
  const rawTreble = [];

  for (let start = 0; start < totalSamples; start += samplesPerSegment) {
    const end = Math.min(start + samplesPerSegment, totalSamples);
    const segLen = end - start;

    if (rawRms.length > 0 && segLen < sampleRate * 0.25) {
      break;
    }

    let sumSq = 0;
    for (let i = start; i < end; i++) {
      const s = samples[i];
      sumSq += s * s;
    }
    const rms = Math.sqrt(sumSq / segLen);
    rawRms.push(rms);

    if (rms < 1e-6) {
      rawBass.push(0);
      rawMid.push(0);
      rawTreble.push(0);
      continue;
    }

    let bassAccum = 0;
    let midAccum = 0;
    let trebleAccum = 0;

    const maxOffset = Math.max(0, segLen - FFT_SIZE);
    const frameCount = segLen >= FFT_SIZE ? FRAMES_PER_SEGMENT : 1;

    for (let f = 0; f < frameCount; f++) {
      const frameStart =
        frameCount === 1
          ? start
          : start + Math.floor((f / (frameCount - 1)) * maxOffset);

      real.fill(0);
      imag.fill(0);

      const copyLen = Math.min(FFT_SIZE, totalSamples - frameStart);
      for (let i = 0; i < copyLen; i++) {
        real[i] = samples[frameStart + i] * hannWindow[i];
      }

      fft(real, imag);

      let bSum = 0;
      for (let b = bands.bassStart; b <= bands.bassEnd; b++) {
        bSum += Math.hypot(real[b], imag[b]);
      }
      bassAccum += bSum / Math.max(1, bands.bassEnd - bands.bassStart + 1);

      let mSum = 0;
      for (let b = bands.midStart; b <= bands.midEnd; b++) {
        mSum += Math.hypot(real[b], imag[b]);
      }
      midAccum += mSum / Math.max(1, bands.midEnd - bands.midStart + 1);

      let tSum = 0;
      for (let b = bands.trebleStart; b <= bands.trebleEnd; b++) {
        tSum += Math.hypot(real[b], imag[b]);
      }
      trebleAccum += tSum / Math.max(1, bands.trebleEnd - bands.trebleStart + 1);
    }

    rawBass.push(bassAccum / frameCount);
    rawMid.push(midAccum / frameCount);
    rawTreble.push(trebleAccum / frameCount);
  }

  const normRms = normalizeArray(rawRms);
  const normBass = normalizeArray(rawBass);
  const normMid = normalizeArray(rawMid);
  const normTreble = normalizeArray(rawTreble);

  return normRms.map((_, idx) => ({
    rms: normRms[idx],
    bass: normBass[idx],
    mid: normMid[idx],
    treble: normTreble[idx],
  }));
}

export async function readAudioMetadata(file) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();
  try {
    const buffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(buffer);
    return { duration: audioBuffer.duration };
  } finally {
    await ctx.close();
  }
}

export async function analyzeAudioFile(file) {
  const AudioCtx = window.AudioContext || window.webkitAudioContext;
  const ctx = new AudioCtx();

  try {
    const arrayBuffer = await file.arrayBuffer();
    const audioBuffer = await ctx.decodeAudioData(arrayBuffer);

    const sampleRate = audioBuffer.sampleRate;
    const binHz = sampleRate / FFT_SIZE;
    const bands = {
      bassStart: Math.max(1, Math.floor(20 / binHz)),
      bassEnd: Math.min(FFT_SIZE / 2 - 1, Math.floor(250 / binHz)),
      midStart: Math.min(FFT_SIZE / 2 - 1, Math.floor(250 / binHz) + 1),
      midEnd: Math.min(FFT_SIZE / 2 - 1, Math.floor(2000 / binHz)),
      trebleStart: Math.min(FFT_SIZE / 2 - 1, Math.floor(2000 / binHz) + 1),
      trebleEnd: Math.min(FFT_SIZE / 2 - 1, Math.floor(8000 / binHz)),
    };

    const leftSamples = audioBuffer.getChannelData(0);
    const rightSamples =
      audioBuffer.numberOfChannels > 1
        ? audioBuffer.getChannelData(1)
        : leftSamples;

    const leftFeatures = analyzeChannel(leftSamples, sampleRate, bands);
    const rightFeatures =
      rightSamples === leftSamples
        ? leftFeatures
        : analyzeChannel(rightSamples, sampleRate, bands);

    const count = Math.min(leftFeatures.length, rightFeatures.length);
    const segments = [];

    for (let i = 0; i < count; i++) {
      segments.push({
        index: i,
        startTime: i * SEGMENT_SECONDS,
        left: leftFeatures[i],
        right: rightFeatures[i],
      });
    }

    return {
      duration: audioBuffer.duration,
      segmentSeconds: SEGMENT_SECONDS,
      segments,
    };
  } finally {
    await ctx.close();
  }
}