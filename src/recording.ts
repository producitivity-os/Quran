export function compactWaveformPeaks(
  input: readonly number[],
  maximumPeaks = 256,
): number[] {
  const peaks = input.map((value) => Math.max(0, Math.min(1, Number.isFinite(value) ? value : 0)));
  if (peaks.length <= maximumPeaks) return peaks;
  return Array.from({ length: maximumPeaks }, (_, index) => {
    const start = Math.floor(index / maximumPeaks * peaks.length);
    const end = Math.max(start + 1, Math.floor((index + 1) / maximumPeaks * peaks.length));
    let peak = 0;
    for (let cursor = start; cursor < end; cursor += 1) peak = Math.max(peak, peaks[cursor] ?? 0);
    return peak;
  });
}

export function recordingStorageMimeType(value: string): string {
  const mediaType = value.split(";", 1)[0]?.trim().toLowerCase() ?? "";
  return /^audio\/[a-z0-9][a-z0-9.+-]*$/.test(mediaType)
    ? mediaType
    : "audio/webm";
}
