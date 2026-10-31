interface HlsResponseBody {
  manifest: string | null;
  body: ReadableStream<Uint8Array> | null;
}

function hasManifestPath(value: string): boolean {
  try { return /\.m3u8$/i.test(new URL(value).pathname); } catch { return false; }
}

/** Identify signed/redirected/extensionless HLS without buffering binary media. */
export async function readHlsResponse(
  response: Response,
  requestedUrl: string,
  finalUrl = requestedUrl
): Promise<HlsResponseBody> {
  if (!response.ok || !response.body) return { manifest: null, body: response.body };
  const contentType = (response.headers.get('content-type') || '').toLowerCase();
  const declaredHls = contentType.includes('mpegurl') || hasManifestPath(requestedUrl) || hasManifestPath(finalUrl);
  // Some CDNs serve extensionless manifests as plain text or octet-stream.
  // Read only the prefix; binary segments/keys retain their streaming body.
  if (!declaredHls && contentType && !/^(?:text\/plain|application\/octet-stream)(?:;|$)/.test(contentType)) {
    return { manifest: null, body: response.body };
  }
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let prefix = '';
  let done = false;
  const decoder = new TextDecoder();
  while (!done && prefix.trimStart().length < 8 && prefix.length < 256) {
    const result = await reader.read();
    done = result.done;
    if (result.value) {
      chunks.push(result.value);
      prefix += decoder.decode(result.value.subarray(0, 256), { stream: true });
    }
  }
  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(chunk);
      if (done) controller.close();
    },
    async pull(controller) {
      try {
        const result = await reader.read();
        if (result.done) controller.close();
        else controller.enqueue(result.value);
      } catch (error) { controller.error(error); }
    },
    cancel(reason) { return reader.cancel(reason); },
  });
  if (/^\s*#EXTM3U(?:\s|$)/.test(prefix)) {
    return { manifest: await new Response(body).text(), body: null };
  }
  return { manifest: null, body };
}
