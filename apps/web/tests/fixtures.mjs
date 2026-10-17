// TEST FIXTURES ONLY. Used by tests/visual.mjs (MOCK=1) to render populated marketplace screens when no API is
// running. Never imported by the app. Shapes mirror apps/api publicListing() and /bounties responses.
const now = Date.now();
const ago = (d) => new Date(now - d * 86400e3).toISOString();
const listing = (id, title, category, formats, size, files, price, sales, desc, kind = 'dataset') => ({
  id, kind, title, description: desc, category, formats, recordCount: files, language: 'en', labeling: null, details: kind === 'model' ? { task: 'image_classification' } : {},
  licenseId: 'CC-BY-4.0', priceMicro: String(price * 1e6), status: 'published', version: 3, onchainAddress: null, sales,
  seller: { wallet: `Fixture${id}Wallet111111111111111111111111`, alias: 'fixture-seller', mode: 'public' },
  asset: { versionId: `v-${id}`, fileCount: files, totalSize: size, commitment: '7f3a9e1c2b4d5e6f708192a3b4c5d6e7f8091a2b3c4d5e6f708c91e' },
  previews: [], previewStatus: 'none', verification: null, createdAt: ago(sales + 2),
});
export const LISTINGS = [
  listing('fx1', 'Street-level signage, 12 cities', 'image_classification', ['png', 'csv'], 33.7e9, 48210, 240, 7, 'Photos of street signs across 12 cities with class labels for 41 sign types. Daylight and dusk.'),
  listing('fx2', 'Retail transactions, anonymised', 'tabular', ['parquet'], 2.1e9, 12, 90, 3, 'Point-of-sale line items from 140 stores over 18 months. Customer identifiers removed before upload.'),
  listing('fx3', 'Call-centre speech, English', 'speech_recognition', ['wav', 'json'], 18.4e9, 9300, 410, 1, 'Transcribed support calls, 8 kHz, speaker turns marked. Consent records held by the seller.'),
  listing('fx4', 'Defect detector for PCB images', 'image_classification', ['onnx'], 94e6, 1, 150, 0, 'ResNet-style classifier for six solder defect classes. Benchmarked on a held-out set.', 'model'),
  listing('fx5', 'Legal clause pairs', 'text_classification', ['jsonl'], 410e6, 3, 60, 12, 'Contract clauses paired with a plain-English paraphrase and a risk label.'),
  listing('fx6', 'Corroded pipe joints, labelled', 'image_classification', ['jpg', 'csv'], 6.8e9, 20400, 320, 0, 'Close-up images of pipe joints with four corrosion grades, labelled by two annotators.'),
];
export const DETAIL = {
  ...LISTINGS[0],
  verification: [
    { level: 'L1', passed: true, reportHash: 'a1b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9', attestation: null, metrics: { totalFiles: 48211, totalSize: 33.7e9, dataFiles: 48210, readableFiles: 48210, corruptedFiles: 0, exactDuplicates: 14, nearDuplicates: null, minWidth: 640, minHeight: 480, labels: null, rows: null }, findings: [{ severity: 'suspected', code: 'dup', message: '14 exact duplicate images (0.03%).' }], limitations: ['Technical checks only; label correctness was not assessed at L1.'], completedAt: ago(3) },
    { level: 'L2', passed: true, reportHash: 'b2c3d4e5f60718293a4b5c6d7e8f90a1b2c3d4e5f60718293a4b5c6d7e8f9a1', attestation: null, metrics: { totalFiles: 48211, totalSize: 33.7e9, dataFiles: 48210, readableFiles: 48210, corruptedFiles: 0, exactDuplicates: 14, nearDuplicates: 212, minWidth: 640, minHeight: 480, labels: null, rows: null, relevance: { estimateBps: 9610, lowBps: 9400, highBps: 9760, sampleSize: 400 } }, findings: [], limitations: ['Relevance estimated from a random sample of 400 images.', 'Labels were not individually checked.'], completedAt: ago(2) },
  ],
};
export const BOUNTIES = [
  { id: 'fb1', title: '20,000 labelled images of corroded pipe joints', description: 'Four corrosion grades, at least 1024 px on the short side, two annotators per image with disagreements resolved.', amountMicro: String(1800e6), deadline: Math.floor(now / 1000) + 21 * 86400, criteria: { kind: 'image_dataset' }, verifierWallet: 'Platform111' },
  { id: 'fb2', title: 'Tabular churn data for B2B SaaS', description: 'Monthly account-level usage and churn outcome, at least 50k rows, required columns listed in the brief.', amountMicro: String(950e6), deadline: Math.floor(now / 1000) + 14 * 86400, criteria: { kind: 'tabular_dataset' }, verifierWallet: null },
  { id: 'fb3', title: 'Speech model under 300 ms p95 for Georgian', description: 'ONNX speech recognition model; WER at most 0.18 on the stated benchmark, p95 latency under 300 ms.', amountMicro: String(4200e6), deadline: Math.floor(now / 1000) + 45 * 86400, criteria: { kind: 'model' }, verifierWallet: 'Platform111' },
];
export function routeFor(url) {
  const u = new URL(url);
  if (u.pathname === '/listings') return { items: LISTINGS.filter((l) => l.kind === (u.searchParams.get('kind') ?? l.kind)), categories: ['image_classification', 'tabular', 'speech_recognition', 'text_classification'] };
  if (u.pathname.startsWith('/listings/')) return DETAIL;
  if (u.pathname === '/bounties') return BOUNTIES;
  if (u.pathname === '/providers' || u.pathname === '/benchmarks' || u.pathname === '/licenses') return [];
  return null;
}
