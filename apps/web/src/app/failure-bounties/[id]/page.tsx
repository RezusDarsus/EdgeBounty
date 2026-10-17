'use client';
import { use, useState } from 'react';
import { useWallet } from '@solana/wallet-adapter-react';
import { api } from '@/lib/api';
import { useApi } from '@/lib/hooks';
import { date, sol } from '@/lib/format';
import { chainClient, hexBytes, pk, sendWithWallet } from '@/lib/chain';
import { useSession } from '@/app/providers';
import { AssetUploader, type UploadedAsset } from '@/components/uploader';
import { Badge, Button, Card, ErrorNote, Hash, KV, Notice, Page } from '@/components/ui';

export default function FailureBountyPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data: b, reload, error } = useApi<any>(`/failure-bounties/${id}`);
  const { account } = useSession();
  const wallet = useWallet();
  const [ex, setEx] = useState<UploadedAsset | null>(null);
  const [err, setErr] = useState<unknown>(null);
  if (error) return <Page title="Failure bounty"><ErrorNote error={error} /></Page>;
  if (!b) return <Page title="Loading…"><span /></Page>;
  const isCreator = account?.wallet === b.creatorWallet;

  async function submit() {
    setErr(null);
    try {
      const prep = await api(`/failure-bounties/${id}/examples`, { body: { assetVersionId: ex!.versionId } });
      const c = await chainClient();
      const { ixs } = await c.submitFailureExample(wallet.publicKey!, pk(prep.onchain.bounty), hexBytes(prep.onchain.commitment));
      await sendWithWallet(wallet, ixs);
      await api(`/failure-bounties/${id}/sync`, { method: 'POST' });
      setEx(null);
      reload();
    } catch (e) {
      setErr(e);
    }
  }

  return (
    <Page title={b.title} subtitle={<>{sol(b.rewardMicro)} per verified failure · {b.accepted}/{b.maxExamples} paid · expires {date(b.expiresAt)}</>}>
      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <Card title="What counts as a failure">
            <p className="text-sm">{b.spec.failureDefinition}</p>
            <p className="mt-2 whitespace-pre-wrap text-sm text-muted">{b.description}</p>
          </Card>
          {account && !isCreator && b.chainState === 'open' && (
            <Card title="Submit an example">
              <p className="mb-2 text-sm text-muted">Upload input images plus <span className="mono">labels.csv</span> (columns <span className="mono">filename,label</span>) with the correct labels. Your example is evaluated against the committed model; you are paid if the model fails on it.</p>
              <AssetUploader kind="dataset" purpose="failure_example" name="failure example" onDone={setEx} />
              <Button className="mt-2" onClick={submit} disabled={!ex}>Submit on-chain</Button>
              <ErrorNote error={err} />
            </Card>
          )}
          <Card title="Examples">
            {b.examples.length === 0 && <p className="text-sm text-muted">No examples yet.</p>}
            {b.examples.map((e: any) => (
              <div key={e.id} className="flex items-center justify-between border-b border-line py-2 text-sm last:border-0">
                <span><Hash value={e.commitment} /> {e.mine && <Badge>yours</Badge>}</span>
                <span className="flex items-center gap-2">
                  {e.report?.accuracy !== undefined && e.report?.accuracy !== null && <span className="text-xs text-muted">model accuracy on example: {e.report.accuracy}</span>}
                  <Badge tone={e.status === 'accepted' ? 'good' : e.status === 'rejected' ? 'bad' : 'warn'}>{e.status}</Badge>
                </span>
              </div>
            ))}
          </Card>
        </div>
        <Card title="Contract">
          <KV rows={[['Model commitment', <Hash key="m" value={b.modelCommitment} />], ['Spec hash', <Hash key="s" value={b.specHash} />], ['Verifier', <Hash key="v" value={b.verifierWallet} />], ['Verifier fee', sol(b.verifierFeeMicro)], ['Pending', b.pending], ['Account', <Hash key="a" value={b.onchainAddress} />]]} />
          {isCreator && (
            <div className="mt-3">
              <Button variant="ghost" onClick={async () => { try { const c = await chainClient(); await sendWithWallet(wallet, await c.closeFailureBounty(wallet.publicKey!, pk(b.onchainAddress))); await api(`/failure-bounties/${id}/sync`, { method: 'POST' }); reload(); } catch (e) { setErr(e); } }}>Close & reclaim remainder</Button>
              <Notice>Closing is allowed once filled, or after expiry (plus a grace period while examples are pending).</Notice>
            </div>
          )}
        </Card>
      </div>
    </Page>
  );
}
