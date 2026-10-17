import { ALLOWED_LICENSES } from '@edgebounty/shared-types';
import { DOMAIN, bytesToHex, hashText } from '@edgebounty/verification-schemas';
import type { Db } from './db/index.js';
import { schema } from './db/index.js';

const TEXTS: Record<string, string> = {
  'eb-nonexclusive-commercial-v1':
    'EdgeBounty Non-Exclusive Commercial License v1. The seller grants the buyer a worldwide, non-exclusive, non-transferable license to use the licensed asset version for commercial and non-commercial purposes, including training and evaluating machine-learning models. Redistribution of the asset itself is prohibited. The seller warrants that it holds the rights required to grant this license.',
  'eb-nonexclusive-research-v1':
    'EdgeBounty Non-Exclusive Research License v1. The seller grants the buyer a non-exclusive, non-transferable license to use the licensed asset version for non-commercial research only. Redistribution is prohibited.',
  'eb-exclusive-transfer-v1':
    'EdgeBounty Exclusive Transfer v1. Subject to the agreed contract terms and proof of rights, the seller transfers exclusive rights in the delivered asset version to the buyer and will not license it to third parties.',
  'cc-by-4.0': 'Creative Commons Attribution 4.0 International (https://creativecommons.org/licenses/by/4.0/legalcode).',
  'cc-by-nc-4.0': 'Creative Commons Attribution-NonCommercial 4.0 International (https://creativecommons.org/licenses/by-nc/4.0/legalcode).',
  'apache-2.0': 'Apache License, Version 2.0 (https://www.apache.org/licenses/LICENSE-2.0).',
  mit: 'MIT License (https://opensource.org/license/mit).',
};

export async function seed(db: Db) {
  for (const l of ALLOWED_LICENSES) {
    const text = TEXTS[l.id];
    await db
      .insert(schema.licenses)
      .values({ id: l.id, name: l.name, text, hash: bytesToHex(hashText(DOMAIN.license, text)), commercial: l.commercial, redistribution: l.redistribution })
      .onConflictDoNothing();
  }
}
