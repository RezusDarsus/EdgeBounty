// Copies the Anchor-generated IDL + TS types into the blockchain-client package.
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, 'packages/blockchain-client/src/idl');
mkdirSync(out, { recursive: true });
copyFileSync(join(root, 'target/idl/edgebounty_marketplace.json'), join(out, 'edgebounty_marketplace.json'));
copyFileSync(join(root, 'target/types/edgebounty_marketplace.ts'), join(out, 'edgebounty_marketplace.ts'));
const idl = JSON.parse(readFileSync(join(out, 'edgebounty_marketplace.json'), 'utf8'));
writeFileSync(join(out, 'program-id.ts'), `export const PROGRAM_ID_STR = '${idl.address}';\n`);
console.log('IDL synced, program id', idl.address);
