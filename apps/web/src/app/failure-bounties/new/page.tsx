'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { useWallet } from '@solana/wallet-adapter-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { CURRENCY, toMicro, sol } from '@/lib/format';
import { chainClient, hexBytes, pk, platformConfig, sendWithWallet } from '@/lib/chain';
import { RequireSession } from '@/components/nav';
import { AssetUploader, type UploadedAsset } from '@/components/uploader';
import { Button, Card, ErrorNote, Field, Notice, Page, inputCls } from '@/components/ui';

export default function NewFailureBounty() {
  const router = useRouter();
  const wallet = useWallet();
  const { data: providers } = useApi<any[]>('/providers');
  const [model, setModel] = useState<UploadedAsset | null>(null);
  const [f, setF] = useState({
    title: '', description: '', failureDefinition: 'The model’s top-1 prediction differs from the expected label of a correctly labelled input.', inputType: 'RGB image', environment: 'ONNX Runtime CPU, preprocessing as specified',
    classes: 'red,blue', size: '8', reward: '0.01', fee: '0.001', maxExamples: '10', maxEvaluations: '30', days: '14', verifier: 'platform',
  });
  const [err, setErr] = useState<unknown>(null);
  const set = (k: keyof typeof f) => (e: { target: { value: string } }) => setF({ ...f, [k]: e.target.value });
  const total = (() => { try { return BigInt(toMicro(f.reward)) * BigInt(f.maxExamples) + BigInt(toMicro(f.fee)) * BigInt(f.maxEvaluations); } catch { return null; } })();

  async function submit() {
    setErr(null);
    try {
      const cfg = await platformConfig();
      const verifierWallet = f.verifier === 'platform' ? cfg.platformVerifier : f.verifier;
      const n = Number(f.size);
      const prep = await api('/failure-bounties', {
        body: {
          title: f.title, description: f.description, modelAssetVersionId: model!.versionId,
          spec: { kind: 'image_classification_failure', classes: f.classes.split(',').map((s) => s.trim()), preprocessing: { size: [n, n], scale: 255, mean: [0, 0, 0], std: [1, 1, 1], layout: 'NCHW' }, failureDefinition: f.failureDefinition, inputType: f.inputType, environment: f.environment },
          rewardMicro: toMicro(f.reward), verifierFeeMicro: toMicro(f.fee), maxExamples: Number(f.maxExamples), maxEvaluations: Number(f.maxEvaluations), verifierWallet, expiresAt: new Date(Date.now() + Number(f.days) * 86_400_000).toISOString(),
        },
      });
      const a = prep.onchain;
      const c = await chainClient();
      const { ixs } = await c.createFailureBounty(wallet.publicKey!, BigInt(a.bountyId), { verifier: pk(a.verifier), modelCommitment: hexBytes(a.modelCommitment), specHash: hexBytes(a.specHash), termsHash: hexBytes(a.termsHash), rewardPerExample: BigInt(a.rewardPerExample), verifierFee: BigInt(a.verifierFee), maxExamples: a.maxExamples, maxEvaluations: a.maxEvaluations, expiresAt: a.expiresAt });
      await sendWithWallet(wallet, ixs);
      await api(`/failure-bounties/${prep.bounty.id}/sync`, { method: 'POST' });
      router.push(`/failure-bounties/${prep.bounty.id}`);
    } catch (e) {
      setErr(e);
    }
  }

  return (
    <RequireSession>
      <Page title="New failure bounty" subtitle="Escrow rewards for verified failures of a specific model version. Contributors submit inputs + expected labels; the verifier re-runs your committed model in a sandbox.">
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Target model (private)">
            <AssetUploader kind="model" purpose="verification" name="failure bounty target" accept=".onnx" onDone={setModel} />
            <Notice>The model stays private; contributors only see the failure definition and preprocessing spec.</Notice>
          </Card>
          <Card title="Bounty">
            <div className="space-y-2">
              <Field label="Title"><input className={inputCls} value={f.title} onChange={set('title')} placeholder="Motorcycles missed at night in rain" /></Field>
              <Field label="Description"><textarea className={`${inputCls} h-20`} value={f.description} onChange={set('description')} /></Field>
              <Field label="Definition of a verified failure"><textarea className={`${inputCls} h-16`} value={f.failureDefinition} onChange={set('failureDefinition')} /></Field>
              <div className="grid grid-cols-2 gap-2">
                <Field label="Classes (model output order)"><input className={inputCls} value={f.classes} onChange={set('classes')} /></Field>
                <Field label="Input size (px)"><input className={inputCls} value={f.size} onChange={set('size')} /></Field>
                <Field label={`Reward per example (${CURRENCY})`}><input className={inputCls} value={f.reward} onChange={set('reward')} /></Field>
                <Field label="Verifier fee per evaluation"><input className={inputCls} value={f.fee} onChange={set('fee')} /></Field>
                <Field label="Max paid examples"><input className={inputCls} value={f.maxExamples} onChange={set('maxExamples')} /></Field>
                <Field label="Max evaluations"><input className={inputCls} value={f.maxEvaluations} onChange={set('maxEvaluations')} /></Field>
                <Field label="Expires in (days)"><input className={inputCls} value={f.days} onChange={set('days')} /></Field>
                <Field label="Verifier">
                  <select className={inputCls} value={f.verifier} onChange={set('verifier')}>
                    <option value="platform">EdgeBounty automated verifier</option>
                    {providers?.filter((p) => p.capabilities.includes('failure_bounty')).map((p) => <option key={p.wallet} value={p.wallet}>{p.profile?.name ?? p.wallet.slice(0, 8)}</option>)}
                  </select>
                </Field>
              </div>
              <Button onClick={submit} disabled={!model || f.title.length < 3 || f.description.length < 10}>Escrow {total !== null ? sol(total) : ''}</Button>
              <ErrorNote error={err} />
            </div>
          </Card>
        </div>
      </Page>
    </RequireSession>
  );
}
