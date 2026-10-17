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
      <div className="rounded-lg border border-good/40 bg-good/10 p-4 text-sm">
        <p className="font-medium">
          Uploaded {done.fileCount} files ({bytes(done.totalSize)}) and sealed the version.
        </p>
        <p className="mt-1">
          Commitment: <Hash value={done.commitment} />
        </p>
      </div>
    );

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap gap-2">
        <label className="cursor-pointer rounded-lg border border-line bg-panel px-3 py-2 text-sm hover:bg-code">
          Choose files
          <input type="file" multiple accept={accept} className="hidden" disabled={uploading} onChange={(e) => chooseFiles(Array.from(e.target.files ?? []))} />
        </label>
        <label className="cursor-pointer rounded-lg border border-line bg-panel px-3 py-2 text-sm hover:bg-code">
          Choose folder
          <input type="file" className="hidden" {...({ webkitdirectory: '', directory: '' } as any)} disabled={uploading} onChange={(e) => chooseFiles(Array.from(e.target.files ?? []))} />
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
      <ul className="max-h-48 space-y-1 overflow-auto text-xs">
        {Object.values(progress).map((p) => (
          <li key={p.file} className="flex items-center gap-2">
            <span className="mono flex-1 truncate">{p.file}</span>
            <span className="text-muted" title={p.error}>{p.phase}</span>
            <span className="w-10 text-right">{Math.round(p.progress * 100)}%</span>
          </li>
        ))}
      </ul>
      <ErrorNote error={error} />
    </div>
  );
}
