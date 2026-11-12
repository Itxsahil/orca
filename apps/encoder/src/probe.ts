import { run } from './ffmpeg';

/** What we need to know about an input before encoding it. */
export interface MediaInfo {
  duration: number;
  /** Display size: rotation (phone videos) already applied. */
  width: number;
  height: number;
  fps: number;
  hasAudio: boolean;
  videoCodec: string;
}

/** A problem with the file itself; encoding again will not help. */
export class InputError extends Error {
  constructor(
    public code:
      | 'ERR_NON_VIDEO'
      | 'ERR_MALFORMED_VIDEO'
      | 'ERR_DURATION_TOO_SHORT'
      | 'ERR_DURATION_EXCEED_CONSTRAINT',
    message: string,
  ) {
    super(message);
  }
}

interface Stream {
  codec_type?: string;
  codec_name?: string;
  width?: number;
  height?: number;
  duration?: string;
  avg_frame_rate?: string;
  r_frame_rate?: string;
  disposition?: { attached_pic?: number };
  tags?: Record<string, string>;
  side_data_list?: { rotation?: number }[];
}

const rate = (r: string | undefined) => {
  const [n, d] = (r ?? '').split('/').map(Number);
  return n && d ? n / d : 0;
};

export async function probe(file: string, signal: AbortSignal): Promise<MediaInfo> {
  let data: { streams?: Stream[]; format?: { duration?: string } };
  try {
    const out = await run(
      'ffprobe',
      ['-v', 'error', '-print_format', 'json', '-show_format', '-show_streams', file],
      signal,
    );
    data = JSON.parse(out);
  } catch (err) {
    if (signal.aborted) throw err;
    throw new InputError('ERR_MALFORMED_VIDEO', 'The file could not be read as a video.');
  }

  const streams = data.streams ?? [];
  // Cover art in audio files shows up as a one-frame "video" stream: ignore it.
  const video = streams.find((s) => s.codec_type === 'video' && !s.disposition?.attached_pic);
  if (!video) throw new InputError('ERR_NON_VIDEO', 'The file has no video track.');
  if (!video.width || !video.height) {
    throw new InputError('ERR_MALFORMED_VIDEO', 'The video track has no picture size.');
  }

  const duration = Number(data.format?.duration ?? video.duration ?? NaN);
  if (!Number.isFinite(duration) || duration <= 0) {
    throw new InputError('ERR_MALFORMED_VIDEO', 'The video has no readable duration.');
  }
  if (duration < 0.1) throw new InputError('ERR_DURATION_TOO_SHORT', 'The video is too short.');

  const rotation = Math.abs(
    Number(
      video.side_data_list?.find((d) => d.rotation != null)?.rotation ?? video.tags?.rotate ?? 0,
    ),
  );
  const sideways = rotation % 180 === 90;
  return {
    duration,
    width: sideways ? video.height : video.width,
    height: sideways ? video.width : video.height,
    fps: rate(video.avg_frame_rate) || rate(video.r_frame_rate) || 30,
    hasAudio: streams.some((s) => s.codec_type === 'audio'),
    videoCodec: video.codec_name ?? 'unknown',
  };
}
