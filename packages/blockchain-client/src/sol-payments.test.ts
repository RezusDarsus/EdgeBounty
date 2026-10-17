import { describe, expect, it, vi } from 'vitest';
import { Connection, Keypair, SystemInstruction } from '@solana/web3.js';
import { NATIVE_MINT, getAccount } from '@solana/spl-token';
import { EdgeBountyClient } from './client';

vi.mock('@solana/spl-token', async (original) => ({ ...await original<typeof import('@solana/spl-token')>(), getAccount: vi.fn() }));

describe('SOL payment preparation', () => {
  it('creates a native token account and wraps the exact funding amount', async () => {
    const connection = new Connection('http://127.0.0.1:1');
    vi.spyOn(connection, 'getAccountInfo').mockResolvedValue(null);
    const client = new EdgeBountyClient(connection);
    const payer = Keypair.generate().publicKey;
    const instructions = await client.preparePayment(payer, NATIVE_MINT, 123_456_789n);
    expect(instructions).toHaveLength(3);
    const transfer = SystemInstruction.decodeTransfer(instructions[1]);
    expect(transfer.fromPubkey.equals(payer)).toBe(true);
    expect(transfer.toPubkey.equals(client.ata(payer, NATIVE_MINT))).toBe(true);
    expect(transfer.lamports).toBe(123_456_789n);
    expect(instructions[2].data[0]).toBe(17); // SyncNative
  });
  it('uses received wrapped SOL first and only wraps the shortfall', async () => {
    const connection = new Connection('http://127.0.0.1:1');
    vi.spyOn(connection, 'getAccountInfo').mockResolvedValue({} as any);
    vi.mocked(getAccount).mockResolvedValue({ amount: 90n } as any);
    const client = new EdgeBountyClient(connection);
    const payer = Keypair.generate().publicKey;
    expect(SystemInstruction.decodeTransfer((await client.preparePayment(payer, NATIVE_MINT, 100n))[1]).lamports).toBe(10n);
    expect(await client.preparePayment(payer, NATIVE_MINT, 50n)).toHaveLength(1);
  });
  it('returns withdrawals only to the token account owner', () => {
    const client = new EdgeBountyClient(new Connection('http://127.0.0.1:1'));
    const owner = Keypair.generate().publicKey;
    const [ix] = client.unwrapSol(owner);
    expect(ix.data[0]).toBe(9); // CloseAccount
    expect(ix.keys[0].pubkey.equals(client.ata(owner, NATIVE_MINT))).toBe(true);
    expect(ix.keys[1].pubkey.equals(owner)).toBe(true);
    expect(ix.keys[2].pubkey.equals(owner)).toBe(true);
    expect(ix.keys[2].isSigner).toBe(true);
  });
});
