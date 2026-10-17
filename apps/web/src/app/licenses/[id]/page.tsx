'use client';
import { use } from 'react';
import { useApi } from '@/lib/hooks';
import { Card, ErrorNote, Hash, Page } from '@/components/ui';

export default function License({ params }: { params: Promise<{ id: string }> }) {
  const { id } = use(params);
  const { data, error } = useApi<any>(`/licenses/${id}`);
  return (
    <Page title={data?.name ?? 'License'} subtitle={data && <>License hash recorded on-chain: <Hash value={data.hash} /></>}>
      <ErrorNote error={error} />
      {data && (
        <Card>
          <p className="whitespace-pre-wrap text-sm">{data.text}</p>
          <p className="mt-4 text-xs text-muted">Commercial use: {data.commercial ? 'yes' : 'no'} · Redistribution: {data.redistribution ? 'yes' : 'no'}. An on-chain receipt is evidence of an entitlement; it does not establish copyright ownership.</p>
        </Card>
      )}
    </Page>
  );
}
