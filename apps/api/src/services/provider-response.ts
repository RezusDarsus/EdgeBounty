/** Bound provider responses before buffering, including non-JSON/erroring streams. */
export async function providerJson(response: Response, maxBytes = 96_000): Promise<any> {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('Missing provider response');
  const chunks: Uint8Array[] = []; let size = 0;
  try {
    for (;;) { const r = await reader.read(); if (r.done) break; size += r.value.length; if (size > maxBytes) throw new Error('Provider response exceeds limit'); chunks.push(r.value); }
  } finally { await reader.cancel().catch(() => {}); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}
