import { Connection, Keypair, PublicKey, type TransactionInstruction } from '@solana/web3.js';
import { EdgeBountyClient, PROGRAM_ID } from '@edgebounty/blockchain-client';
import type { Config } from './config.js';

const kp = (json?: string) => (json ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(json))) : null);

/**
 * Chain access for the API. Holds the platform-operated keys (platform verifier, dispute
 * authority, settlement crank). In production these live in a KMS/HSM; the dispute
 * authority should be a multisig with the API only proposing transactions.
 */
export class ChainService {
  readonly connection: Connection;
  readonly client: EdgeBountyClient;
  readonly platformVerifier: Keypair | null;
  readonly disputeAuthority: Keypair | null;
  readonly crank: Keypair | null;

  constructor(cfg: Config) {
    this.connection = new Connection(cfg.SOLANA_RPC_URL, 'confirmed');
    this.client = new EdgeBountyClient(this.connection, cfg.PROGRAM_ID ? new PublicKey(cfg.PROGRAM_ID) : PROGRAM_ID);
    this.platformVerifier = kp(cfg.PLATFORM_VERIFIER_KEY);
    this.disputeAuthority = kp(cfg.DISPUTE_AUTHORITY_KEY);
    this.crank = kp(cfg.CRANK_KEY) ?? this.platformVerifier;
  }

  async send(ixs: TransactionInstruction[], signer: Keypair | null, what: string): Promise<string> {
    if (!signer) throw new Error(`no key configured for ${what}`);
    return this.client.send(ixs, [signer]);
  }

  /** Confirms a client-submitted signature landed and succeeded (never trust a browser callback alone). */
  async confirmSignature(signature: string): Promise<{ ok: boolean; err?: unknown }> {
    const st = await this.connection.getSignatureStatus(signature, { searchTransactionHistory: true });
    const v = st.value;
    if (!v) return { ok: false, err: 'not found' };
    if (v.err) return { ok: false, err: v.err };
    return { ok: v.confirmationStatus === 'confirmed' || v.confirmationStatus === 'finalized' };
  }

  async healthy(): Promise<boolean> {
    try {
      await this.connection.getSlot();
      return true;
    } catch {
      return false;
    }
  }
}
