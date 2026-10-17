import type { Db } from '../db/index.js';
import { schema } from '../db/index.js';
import type { Session } from '../auth/siws.js';
import { jsonSafe } from './http.js';

export async function audit(db: Db, actor: Session | null, action: string, target: string | null, details: Record<string, unknown> = {}) {
  await db.insert(schema.auditEvents).values({
    actorId: actor?.accountId ?? null,
    actorWallet: actor?.wallet ?? null,
    action,
    target,
    details: jsonSafe(details) as Record<string, unknown>,
  });
}
