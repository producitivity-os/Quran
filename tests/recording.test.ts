import assert from "node:assert/strict";
import test from "node:test";
import {
  compactWaveformPeaks,
  recordingStorageMimeType,
} from "../src/recording.ts";

test("waveform peaks are clamped and retained when already compact", () => {
  assert.deepEqual(compactWaveformPeaks([-1, 0.25, 2, Number.NaN], 8), [0, 0.25, 1, 0]);
});

test("waveform peaks compact with the maximum amplitude in each bucket", () => {
  assert.deepEqual(compactWaveformPeaks([0.1, 0.8, 0.2, 0.6], 2), [0.8, 0.6]);
});

test("recording MIME types are normalized before media storage", () => {
  assert.equal(recordingStorageMimeType("audio/webm;codecs=opus"), "audio/webm");
  assert.equal(recordingStorageMimeType("audio/mp4; codecs=mp4a.40.2"), "audio/mp4");
  assert.equal(recordingStorageMimeType("invalid"), "audio/webm");
});
