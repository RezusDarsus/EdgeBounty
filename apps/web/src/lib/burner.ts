'use client';
import { BaseMessageSignerWalletAdapter, WalletName, WalletReadyState, isVersionedTransaction, type TransactionOrVersionedTransaction } from '@solana/wallet-adapter-base';
import { Keypair, type PublicKey, type TransactionVersion } from '@solana/web3.js';
import nacl from 'tweetnacl';

/**
 * LOCALNET-ONLY burner wallet for demos and UI testing (enabled with NEXT_PUBLIC_DEV_BURNER=1).
 * The key lives in this browser's localStorage. Never enable it against devnet/mainnet funds.
 */
export const BurnerWalletName = 'Dev Burner (localnet)' as WalletName<'Dev Burner (localnet)'>;

export class BurnerWalletAdapter extends BaseMessageSignerWalletAdapter {
  name = BurnerWalletName;
  url = 'https://github.com/';
  icon = 'data:image/svg+xml;base64,' + btoa('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32"><rect width="32" height="32" rx="6" fill="#a35a00"/><text x="16" y="21" font-size="14" text-anchor="middle" fill="white">DEV</text></svg>');
  readyState = WalletReadyState.Installed;
  supportedTransactionVersions: ReadonlySet<TransactionVersion> = new Set(['legacy', 0]);
  private kp: Keypair | null = null;
  private _connecting = false;

  get publicKey(): PublicKey | null {
    return this.kp?.publicKey ?? null;
  }
  get connecting() {
    return this._connecting;
  }

  async connect() {
    this._connecting = true;
    try {
      let secret: string | null = null;
      try {
        secret = localStorage.getItem('eb_burner');
      } catch {
        /* no storage: ephemeral key */
      }
      this.kp = secret ? Keypair.fromSecretKey(Uint8Array.from(JSON.parse(secret))) : Keypair.generate();
      try {
        localStorage.setItem('eb_burner', JSON.stringify(Array.from(this.kp.secretKey)));
      } catch {
        /* ignore */
      }
      this.emit('connect', this.kp.publicKey);
    } finally {
      this._connecting = false;
    }
  }
  async disconnect() {
    this.kp = null;
    this.emit('disconnect');
  }
  async signTransaction<T extends TransactionOrVersionedTransaction<this['supportedTransactionVersions']>>(tx: T): Promise<T> {
    if (!this.kp) throw new Error('not connected');
    if (isVersionedTransaction(tx)) tx.sign([this.kp]);
    else tx.partialSign(this.kp);
    return tx;
  }
  async signAllTransactions<T extends TransactionOrVersionedTransaction<this['supportedTransactionVersions']>>(txs: T[]): Promise<T[]> {
    for (const t of txs) await this.signTransaction(t);
    return txs;
  }
  async signMessage(message: Uint8Array): Promise<Uint8Array> {
    if (!this.kp) throw new Error('not connected');
    return nacl.sign.detached(message, this.kp.secretKey);
  }
}
