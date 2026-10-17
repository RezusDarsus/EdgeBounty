import { PublicKey } from '@solana/web3.js';
import { PROGRAM_ID_STR } from './idl/program-id';

export const PROGRAM_ID = new PublicKey(PROGRAM_ID_STR);

const enc = (s: string) => new TextEncoder().encode(s);
const u64 = (n: bigint | number) => {
  const b = new Uint8Array(8);
  new DataView(b.buffer).setBigUint64(0, BigInt(n), true);
  return b;
};
const u8 = (n: number) => Uint8Array.of(n);

export function pda(seeds: Uint8Array[], programId = PROGRAM_ID): PublicKey {
  return PublicKey.findProgramAddressSync(seeds, programId)[0];
}

export const pdas = (programId: PublicKey = PROGRAM_ID) => ({
  config: () => pda([enc('config')], programId),
  provider: (authority: PublicKey) => pda([enc('provider'), authority.toBytes()], programId),
  listing: (seller: PublicKey, id: bigint | number) => pda([enc('listing'), seller.toBytes(), u64(id)], programId),
  order: (buyer: PublicKey, id: bigint | number) => pda([enc('order'), buyer.toBytes(), u64(id)], programId),
  vault: (order: PublicKey) => pda([enc('vault'), order.toBytes()], programId),
  submission: (order: PublicKey, index: number) => pda([enc('submission'), order.toBytes(), u8(index)], programId),
  attestation: (subject: PublicKey, index: number) => pda([enc('attestation'), subject.toBytes(), u8(index)], programId),
  dispute: (subject: PublicKey, index: number) => pda([enc('dispute'), subject.toBytes(), u8(index)], programId),
  license: (order: PublicKey) => pda([enc('license'), order.toBytes()], programId),
  reputation: (wallet: PublicKey) => pda([enc('reputation'), wallet.toBytes()], programId),
  failureBounty: (creator: PublicKey, id: bigint | number) => pda([enc('fbounty'), creator.toBytes(), u64(id)], programId),
  failureVault: (bounty: PublicKey) => pda([enc('fvault'), bounty.toBytes()], programId),
  failureExample: (bounty: PublicKey, commitment: Uint8Array) => pda([enc('fexample'), bounty.toBytes(), commitment], programId),
  job: (requester: PublicKey, id: bigint | number) => pda([enc('vjob'), requester.toBytes(), u64(id)], programId),
  jobVault: (job: PublicKey) => pda([enc('jvault'), job.toBytes()], programId),
  receipt: (reference: Uint8Array) => pda([enc('receipt'), reference], programId),
});
