import type { MediaInfo } from './probe';

/*
 * The HLS renditions made for a video. "1080p" means the short side, so portrait
 * phone videos get the same ladder as landscape ones. No rendition is larger
 * than the input; an input smaller than the lowest rung keeps its own size.
 */

const RUNGS = [
  { short: 1080, kbps: 5000 },
  { short: 720, kbps: 2800 },
  { short: 480, kbps: 1400 },
  { short: 360, kbps: 800 },
  { short: 240, kbps: 400 },
];

export interface Rendition {
  width: number;
  height: number;
  /** Maximum video bitrate (kbit/s). */
  kbps: number;
}

const even = (n: number) => Math.max(2, Math.round(n / 2) * 2);

export function ladder(info: MediaInfo): Rendition[] {
  const short = Math.min(info.width, info.height);
  const landscape = info.width >= info.height;
  const size = (s: number) => {
    const long = (s * Math.max(info.width, info.height)) / short;
    return landscape
      ? { width: even(long), height: even(s) }
      : { width: even(s), height: even(long) };
  };
  // Higher frame rates need more bits for the same quality.
  const fpsFactor = info.fps > 40 ? 1.5 : 1;

  const rungs = RUNGS.filter((r) => r.short <= short);
  if (rungs.length === 0) {
    return [{ ...size(short), kbps: Math.round(400 * fpsFactor) }];
  }
  return rungs.map((r) => ({ ...size(r.short), kbps: Math.round(r.kbps * fpsFactor) }));
}
