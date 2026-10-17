import { createHash } from 'node:crypto';
import { eq } from 'drizzle-orm';
import type { AppContext } from '../context.js';
import { schema } from '../db/index.js';
import { getOwnedVersion } from '../lib/assets.js';
import { conflict } from '../lib/http.js';

/** One explicitly selected owner's text prefix, never a bulk object read or automatic AI attachment. */
export async function metadataSample(ctx: AppContext, versionId: string, accountId: string) {
  const { version } = await getOwnedVersion(ctx, versionId, accountId);
  if (version.status !== 'finalized') throw conflict('Finalize the upload before previewing a sample.');
  const files = await ctx.db.select().from(schema.assetFiles).where(eq(schema.assetFiles.versionId, versionId)).orderBy(schema.assetFiles.path).limit(100);
  const file = files.find(f => f.size > 0 && /\.(csv|tsv|txt|json|jsonl|md)$/i.test(f.path));
  if (!file) return { sample: null, limitation: 'No supported text file among the first 100 manifest entries. Use manifest-only suggestions.' };
  const limit = Math.min(file.size, 4096), stream = await ctx.storage.getRange(file.objectKey, 0, limit - 1);
  const chunks: Buffer[] = []; let n = 0;
  try {
    for await (const chunk of stream) {
      const part = Buffer.from(chunk as Buffer).subarray(0, limit - n); chunks.push(part); n += part.length;
      if (n >= limit) break;
    }
  } finally { stream.destroy(); }
  const body = Buffer.concat(chunks);
  if (body.includes(0)) return { sample: null, limitation: 'The selected prefix appears binary; no text sample is shared.' };
  return { sample: { path: file.path, text: body.toString('utf8'), bytes: n, prefixSha256: createHash('sha256').update(body).digest('hex') }, limitation: 'At most 4,096 bytes of one text file. This prefix can be incomplete and does not establish full schema, record count, rights or data quality.' };
}
