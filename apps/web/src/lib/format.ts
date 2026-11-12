const UNITS = ['B', 'KB', 'MB', 'GB', 'TB'];

/** 1536000 → "1.5 MB" (decimal units, like file managers). */
export function formatBytes(bytes: number | null | undefined) {
  if (bytes == null) return '—';
  let value = bytes;
  let unit = 0;
  while (value >= 1000 && unit < UNITS.length - 1) {
    value /= 1000;
    unit++;
  }
  return `${value < 10 && unit > 0 ? value.toFixed(1) : Math.round(value)} ${UNITS[unit]}`;
}

/** 3725 → "1:02:05", 65 → "1:05". */
export function formatDuration(seconds: number | null | undefined) {
  if (seconds == null || seconds < 0) return '—';
  const s = Math.round(seconds);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s % 60)}` : `${m}:${pad(s % 60)}`;
}

export function formatDate(date: Date | null | undefined) {
  if (!date) return '—';
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}
