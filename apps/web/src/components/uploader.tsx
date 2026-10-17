'use client';
import { useRef, useState } from 'react';
import { api, loadToken } from '@/lib/api';
import { bytes } from '@/lib/format';
import { uploadFile, type UploadProgress } from '@/lib/upload';
import { Button, ErrorNote, Hash } from './ui';

export interface UploadedAsset {
  assetId: string;
  versionId: string;
  commitment: string;
  fileCount: number;
  totalSize: number;
}

/**
 * Creates a private asset, uploads files with resumable multipart, and finalizes the version
 * (salted manifest commitment). Folder structure is preserved via webkitRelativePath.
 */
export function AssetUploader({ kind, purpose, name, onDone, accept, allowEncryption = false }: { kind: 'dataset' | 'model'; purpose: string; name: string; onDone: (a: UploadedAsset) => void; accept?: string; allowEncryption?: boolean }) {
  const [encrypt, setEncrypt] = useState(false);
  const [files, setFiles] = useState<File[]>([]);
  const [progress, setProgress] = useState<Record<string, UploadProgress>>({});
  const [error, setError] = useState<unknown>(null);
  const [uploading, setUploading] = useState(false);
  const uploadSession = useRef<{ assetId: string; versionId: string; kind: string; purpose: string; files: File[]; completed: Set<string>; uploads: Record<string, string> } | null>(null);
  const [done, setDone] = useState<UploadedAsset | null>(null);

  const total = files.reduce((n, f) => n + f.size, 0);
  const pathOf = (f: File) => ((f as any).webkitRelativePath as string) || f.name;

  function chooseFiles(next: File[]) { uploadSession.current = null; setProgress({}); setError(null); setFiles(next); }

  async function start() {
    setError(null);
    setUploading(true);
    try {
      const emptyFiles = files.filter((file) => file.size === 0);
      if (emptyFiles.length) throw new Error(`The folder contains ${emptyFiles.length} empty files: ${emptyFiles.slice(0, 3).map(pathOf).join(', ')}. Remove or replace them before uploading.`);
      let session = uploadSession.current;
      if (session && (session.kind !== kind || session.purpose !== purpose)) throw new Error('The upload type changed. Choose files again before starting a new version.');
      if (!session) {
        const { asset, version } = await api('/assets', { body: { kind, name, purpose } });
        let toUpload = files;
        if (encrypt) {
          const { encryptFiles, declareEncryption } = await import('@/lib/private-delivery');
          const enc = await encryptFiles(files);
          await declareEncryption(version.id, enc.ivs, enc.key, enc.fingerprint);
          toUpload = enc.encrypted;
        }
        session = { assetId: asset.id, versionId: version.id, kind, purpose, files: toUpload, completed: new Set(), uploads: {} };
        uploadSession.current = session;
      }
      const token = loadToken();
      for (const f of session.files) {
        const path = pathOf(f);
        if (session.completed.has(path)) continue;
        try {
          await uploadFile(session.versionId, f, path, token, (p) => setProgress((s) => ({ ...Object.fromEntries(Object.entries(s).slice(-99)), [p.file]: p })), { uploadId: session.uploads[path], onCreated: (id) => { session!.uploads[path] = id; } });
          session.completed.add(path);
        } catch (e) {
          const message = e instanceof Error ? e.message : 'Upload failed';
          setProgress((s) => ({ ...s, [path]: { file: path, phase: 'error', progress: 0, error: message } }));
          throw new Error(`${path}: ${message}`);
        }
      }
      const fin = await api(`/versions/${session.versionId}/finalize`, { method: 'POST' });
      const a = { assetId: session.assetId, versionId: session.versionId, commitment: fin.commitment, fileCount: fin.fileCount, totalSize: fin.totalSize };
      setDone(a);
      onDone(a);
    } catch (e) {
      setError(e);
    } finally {
      setUploading(false);
    }
  }

  if (done)
    return (
      <div className="rounded-md border border-good/35 bg-good/6 p-4 text-sm" role="status">
        <p className="font-medium text-ink">
          <span aria-hidden="true" className="mr-1.5 text-good">●</span>
          Uploaded {done.fileCount} files ({bytes(done.totalSize)}) and sealed the version.
        </p>
        <p className="mt-1">
          Commitment: <Hash value={done.commitment} />
        </p>
      </div>
    );

  return (
    <div className="space-y-3">
      <div
        className="flex flex-wrap items-center gap-2 rounded-md border border-dashed border-ink/25 bg-sunk/50 p-4"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!uploading) chooseFiles(Array.from(e.dataTransfer.files ?? []));
        }}
      >
        <span className="mr-auto w-full text-sm text-ink-2 sm:w-auto">Drop files here, or</span>
        <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-line bg-panel px-3 text-sm font-medium transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-accent hover:border-ink/40">
          Choose files
          <input type="file" multiple accept={accept} className="sr-only" disabled={uploading} onChange={(e) => chooseFiles(Array.from(e.target.files ?? []))} />
        </label>
        <label className="inline-flex h-9 cursor-pointer items-center rounded-md border border-line bg-panel px-3 text-sm font-medium transition-colors focus-within:outline focus-within:outline-2 focus-within:outline-accent hover:border-ink/40">
          Choose folder
          <input type="file" className="sr-only" {...({ webkitdirectory: '', directory: '' } as any)} disabled={uploading} onChange={(e) => chooseFiles(Array.from(e.target.files ?? []))} />
        </label>
        {allowEncryption && (
          <label className="flex items-center gap-1.5 text-sm" title="Advanced private mode: files are encrypted in your browser; the platform cannot analyse or preview them.">
            <input type="checkbox" disabled={uploading || !!uploadSession.current} checked={encrypt} onChange={(e) => setEncrypt(e.target.checked)} /> Encrypt client-side
          </label>
        )}
        <Button onClick={start} disabled={!files.length || uploading}>
          {uploadSession.current ? 'Resume upload' : 'Upload privately'}
        </Button>
      </div>
      {files.length > 0 && (
        <p className="text-sm text-muted">
          {files.length} files · {bytes(total)} · files go to private storage; nothing is published until you list it.
        </p>
      )}
      <ul className="max-h-56 space-y-2.5 overflow-auto text-xs" aria-label="Upload progress">
        {Object.values(progress).map((p) => (
          <li key={p.file} className="grid grid-cols-[1fr_auto_44px] items-center gap-x-3 gap-y-1">
            <span className="mono truncate text-ink-2">{p.file}</span>
            <span className={p.error ? 'text-bad' : 'text-muted'} title={p.error}>{p.phase}</span>
            <span className="num text-right">{Math.round(p.progress * 100)}%</span>
            <span className="col-span-3 h-[3px] overflow-hidden rounded-[1px] bg-sunk" aria-hidden="true">
              <span className={`block h-full origin-left transition-transform duration-300 ${p.error ? 'bg-bad' : 'bg-ink'}`} style={{ transform: `scaleX(${p.progress})` }} />
            </span>
          </li>
        ))}
      </ul>
      <ErrorNote error={error} />
    </div>
  );
}
