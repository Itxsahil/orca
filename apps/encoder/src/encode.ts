import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { env } from './env';
import { run } from './ffmpeg';
import type { Rendition } from './ladder';
import type { MediaInfo } from './probe';

/** HLS segment length in seconds; keyframes every 2 s line up with segment boundaries. */
const SEGMENT_SECONDS = 6;
const KEYFRAME_SECONDS = 2;

/**
 * Encodes every rendition in one ffmpeg pass (the input is decoded once):
 * H.264 + AAC, HLS with fMP4 segments, written to <outDir>/hls/:
 *   master.m3u8, v0/index.m3u8, v0/init.mp4, v0/seg_0000.m4s, ...
 * `onProgress` gets 0..1.
 */
export async function encodeHls(
  input: string,
  outDir: string,
  info: MediaInfo,
  renditions: Rendition[],
  signal: AbortSignal,
  onProgress: (fraction: number) => void,
) {
  const hlsDir = path.join(outDir, 'hls');
  for (let i = 0; i < renditions.length; i++)
    await mkdir(path.join(hlsDir, `v${i}`), { recursive: true });

  const n = renditions.length;
  // Above 60 fps is wasted on viewers and doubles the work.
  const fps = info.fps > 60 ? 'fps=60,' : '';
  const outs = renditions.map((_, i) => `[s${i}]`).join('');
  const filter = [
    `[0:v:0]${fps}split=${n}${outs}`,
    ...renditions.map(
      (r, i) => `[s${i}]scale=${r.width}:${r.height}:flags=bicubic,format=yuv420p,setsar=1[v${i}]`,
    ),
  ].join(';');

  const args = [
    '-hide_banner',
    '-nostats',
    '-loglevel',
    'error',
    '-y',
    '-i',
    input,
    '-filter_complex',
    filter,
  ];
  renditions.forEach((r, i) => {
    args.push('-map', `[v${i}]`);
    if (info.hasAudio) args.push('-map', '0:a:0');
    args.push(`-maxrate:v:${i}`, `${r.kbps}k`, `-bufsize:v:${i}`, `${r.kbps * 2}k`);
  });
  args.push(
    '-c:v',
    'libx264',
    '-preset',
    env.ENCODER_PRESET,
    '-profile:v',
    'high',
    '-crf',
    '21',
    '-sc_threshold',
    '0',
    '-force_key_frames',
    `expr:gte(t,n_forced*${KEYFRAME_SECONDS})`,
  );
  if (info.hasAudio) args.push('-c:a', 'aac', '-b:a', '128k', '-ac', '2', '-ar', '48000');
  args.push(
    '-f',
    'hls',
    '-hls_time',
    String(SEGMENT_SECONDS),
    '-hls_playlist_type',
    'vod',
    '-hls_flags',
    'independent_segments',
    '-hls_segment_type',
    'fmp4',
    '-hls_fmp4_init_filename',
    'init.mp4',
    '-hls_segment_filename',
    path.join(hlsDir, 'v%v', 'seg_%04d.m4s'),
    '-master_pl_name',
    'master.m3u8',
    '-var_stream_map',
    renditions.map((_, i) => (info.hasAudio ? `v:${i},a:${i}` : `v:${i}`)).join(' '),
    '-progress',
    'pipe:1',
    path.join(hlsDir, 'v%v', 'index.m3u8'),
  );

  await run('ffmpeg', args, signal, (line) => {
    // -progress reports out_time_us=<microseconds encoded so far>.
    const m = /^out_time_us=(\d+)/.exec(line);
    if (m) onProgress(Math.min(1, Number(m[1]) / 1e6 / info.duration));
  });
}

/** The default thumbnail, like Stream's /thumbnails/thumbnail.jpg. */
export async function thumbnail(
  input: string,
  outDir: string,
  info: MediaInfo,
  pct: number,
  signal: AbortSignal,
) {
  const dir = path.join(outDir, 'thumbnails');
  await mkdir(dir, { recursive: true });
  const at = Math.max(0, Math.min(info.duration * pct, info.duration - 0.5));
  await run(
    'ffmpeg',
    [
      '-hide_banner',
      '-loglevel',
      'error',
      '-y',
      '-ss',
      at.toFixed(3),
      '-i',
      input,
      '-frames:v',
      '1',
      '-vf',
      "scale='min(1280,iw)':-2",
      '-q:v',
      '3',
      path.join(dir, 'thumbnail.jpg'),
    ],
    signal,
  );
}
