/*
 * Streaming multipart/form-data reader: finds the file field and yields its
 * bytes as they arrive, without holding the whole body in memory (a Worker has
 * 128 MB). Other fields are skipped.
 */

const enc = new TextEncoder();
const dec = new TextDecoder();
const MAX_HEADER_BYTES = 16 * 1024;

export class MultipartError extends Error {}

export function boundaryOf(contentType: string | null): string | null {
  if (!contentType?.toLowerCase().startsWith('multipart/form-data')) return null;
  const match = /boundary=(?:"([^"]+)"|([^;\s]+))/i.exec(contentType);
  return match ? (match[1] ?? match[2] ?? null) : null;
}

function indexOf(haystack: Uint8Array, needle: Uint8Array, from = 0): number {
  const first = needle[0]!;
  for (let i = haystack.indexOf(first, from); i !== -1; i = haystack.indexOf(first, i + 1)) {
    if (i + needle.length > haystack.length) return -1;
    let j = 1;
    while (j < needle.length && haystack[i + j] === needle[j]) j++;
    if (j === needle.length) return i;
  }
  return -1;
}

function concat(a: Uint8Array, b: Uint8Array): Uint8Array {
  if (a.length === 0) return b;
  const out = new Uint8Array(a.length + b.length);
  out.set(a);
  out.set(b, a.length);
  return out;
}

export interface FileField {
  name: string;
  filename: string | undefined;
  /** The file's bytes, in order. */
  chunks: AsyncGenerator<Uint8Array>;
}

/** Returns the first file field called `fieldName`, or null if the body has none. */
export async function readFileField(
  body: ReadableStream<Uint8Array>,
  boundary: string,
  fieldName = 'file',
): Promise<FileField | null> {
  const reader = body.getReader();
  // Treat the body as if it started with CRLF, so every delimiter is "\r\n--boundary".
  let buf: Uint8Array = enc.encode('\r\n');
  let ended = false;
  const delimiter = enc.encode(`\r\n--${boundary}`);

  const pull = async () => {
    const { value, done } = await reader.read();
    if (done) ended = true;
    else buf = concat(buf, value);
  };

  /** Streams bytes up to the next delimiter; leaves buf just after it. */
  async function* partBody(): AsyncGenerator<Uint8Array> {
    for (;;) {
      const at = indexOf(buf, delimiter);
      if (at !== -1) {
        if (at > 0) yield buf.slice(0, at);
        buf = buf.slice(at + delimiter.length);
        return;
      }
      // Keep a tail that could be the start of a delimiter split across reads.
      const keep = delimiter.length - 1;
      if (buf.length > keep) {
        yield buf.slice(0, buf.length - keep);
        buf = buf.slice(buf.length - keep);
      }
      if (ended) throw new MultipartError('The form data ended unexpectedly.');
      await pull();
    }
  }

  // Skip the preamble up to the first delimiter.
  for await (const _ of partBody()) {
    // discard
  }

  for (;;) {
    while (buf.length < 2 && !ended) await pull();
    // "--" after a delimiter closes the body.
    if (buf[0] === 0x2d && buf[1] === 0x2d) {
      await reader.cancel().catch(() => {});
      return null;
    }
    // Headers end at a blank line.
    let end = indexOf(buf, enc.encode('\r\n\r\n'));
    while (end === -1) {
      if (ended || buf.length > MAX_HEADER_BYTES) {
        throw new MultipartError('Malformed form data.');
      }
      await pull();
      end = indexOf(buf, enc.encode('\r\n\r\n'));
    }
    const headers = dec.decode(buf.slice(2, end)); // skip the CRLF after the delimiter
    buf = buf.slice(end + 4);

    const disposition = /^content-disposition:(.*)$/im.exec(headers)?.[1] ?? '';
    const name = /\bname="([^"]*)"/i.exec(disposition)?.[1];
    const filename = /\bfilename="([^"]*)"/i.exec(disposition)?.[1];
    if (name === fieldName && filename !== undefined) {
      return { name, filename: filename || undefined, chunks: partBody() };
    }
    for await (const _ of partBody()) {
      // another field: skip it
    }
  }
}
