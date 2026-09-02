export interface BoundedStreamResult {
  readonly text: string;
  readonly truncated: boolean;
}

export const readBoundedStream = async (
  stream: ReadableStream<Uint8Array> | null,
  limit: number,
): Promise<BoundedStreamResult> => {
  if (!stream) return { text: "", truncated: false };
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let retained = 0;
  let truncated = false;
  try {
    while (true) {
      // Stream reads are sequential so the retained-byte cap remains exact.
      // eslint-disable-next-line no-await-in-loop
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      const remaining = limit - retained;
      if (remaining <= 0) {
        truncated = true;
        continue;
      }
      const accepted = value.byteLength > remaining ? value.slice(0, remaining) : value;
      chunks.push(accepted);
      retained += accepted.byteLength;
      truncated ||= accepted.byteLength !== value.byteLength;
    }
  } finally {
    reader.releaseLock();
  }
  return {
    text: Buffer.concat(chunks.map((chunk) => Buffer.from(chunk))).toString("utf8"),
    truncated,
  };
};
