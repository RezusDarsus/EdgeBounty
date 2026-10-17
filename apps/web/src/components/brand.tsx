/** EdgeBounty brand marks and decorative specimens. Specimens are decorative: they never stand in for real dataset contents. */

export function Mark({ className = '' }: { className?: string }) {
  // a booktabs table reduced to a glyph: heavy top rule, a filled cell, heavy bottom rule
  return (
    <svg viewBox="0 0 20 20" className={className} aria-hidden="true">
      <rect x="1" y="2" width="18" height="2.4" fill="currentColor" />
      <rect x="1" y="8.6" width="7" height="2.8" fill="var(--accent)" />
      <rect x="10" y="9.4" width="9" height="1.2" fill="currentColor" opacity=".45" />
      <rect x="1" y="15.6" width="18" height="2.4" fill="currentColor" />
    </svg>
  );
}

function hash(s: string) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) h = Math.imul(h ^ s.charCodeAt(i), 16777619);
  return () => {
    h = Math.imul(h ^ (h >>> 15), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return ((h ^= h >>> 16) >>> 0) / 4294967296;
  };
}

type Shape = 'image' | 'table' | 'model' | 'audio' | 'text';
export function shapeFor(kind: string, formats: string[] = [], category = ''): Shape {
  const f = formats.join(' ').toLowerCase() + ' ' + category.toLowerCase();
  if (kind === 'model' || /onnx|model/.test(f)) return 'model';
  if (/png|jpe?g|webp|image|vision/.test(f)) return 'image';
  if (/wav|mp3|flac|audio|speech/.test(f)) return 'audio';
  if (/csv|parquet|tsv|tabular|json/.test(f)) return 'table';
  return 'text';
}

/** Deterministic, decorative "specimen plate" for a listing, drawn from its id. It shows the *shape* of the data, not its contents. */
export function Specimen({ seed, shape, label, className = '' }: { seed: string; shape: Shape; label?: string; className?: string }) {
  const r = hash(seed);
  const W = 320;
  const H = 180;
  const els: React.ReactNode[] = [];
  if (shape === 'image') {
    const cols = 8;
    const rows = 4;
    const s = 30;
    const ox = (W - cols * (s + 4)) / 2;
    const oy = (H - rows * (s + 4)) / 2;
    const hot = Math.floor(r() * cols * rows);
    for (let y = 0; y < rows; y++)
      for (let x = 0; x < cols; x++) {
        const v = r();
        els.push(<rect key={`${x}-${y}`} x={ox + x * (s + 4)} y={oy + y * (s + 4)} width={s} height={s} rx="1" fill={x * rows + y === hot ? 'var(--accent)' : 'currentColor'} opacity={x * rows + y === hot ? 0.9 : 0.05 + v * 0.2} />);
      }
  } else if (shape === 'table') {
    const cols = [0, 70, 150, 220];
    els.push(<rect key="t" x="24" y="30" width="272" height="2" fill="currentColor" opacity=".7" />);
    els.push(<rect key="m" x="24" y="48" width="272" height="1" fill="currentColor" opacity=".45" />);
    for (let i = 0; i < 6; i++)
      cols.forEach((c, j) => {
        const w = 20 + r() * (j === 0 ? 30 : 46);
        els.push(<rect key={`${i}-${j}`} x={24 + c} y={60 + i * 15} width={w} height="5" rx="1" fill={i === 2 && j === 3 ? 'var(--accent)' : 'currentColor'} opacity={i === 2 && j === 3 ? 0.9 : 0.16 + r() * 0.16} />);
      });
    cols.forEach((c, j) => els.push(<rect key={`h${j}`} x={24 + c} y="37" width={26 + j * 6} height="5" fill="currentColor" opacity=".5" />));
    els.push(<rect key="b" x="24" y="152" width="272" height="2" fill="currentColor" opacity=".7" />);
  } else if (shape === 'model') {
    const layers = [3, 5, 6, 5, 2];
    const xs = layers.map((_, i) => 46 + i * 57);
    const pts = layers.map((n, i) => Array.from({ length: n }, (_, k) => [xs[i], H / 2 + (k - (n - 1) / 2) * 22] as const));
    const hot = Math.floor(r() * layers[2]);
    for (let i = 0; i < pts.length - 1; i++)
      pts[i].forEach(([x1, y1]) => pts[i + 1].forEach(([x2, y2]) => els.push(<line key={`${x1}${y1}${x2}${y2}`} x1={x1} y1={y1} x2={x2} y2={y2} stroke="currentColor" strokeWidth=".6" opacity={0.06 + r() * 0.12} />)));
    pts.forEach((col, i) => col.forEach(([x, y], k) => els.push(<rect key={`n${i}${k}`} x={x - 4} y={y - 4} width="8" height="8" fill={i === 2 && k === hot ? 'var(--accent)' : 'var(--panel)'} stroke="currentColor" strokeOpacity=".55" strokeWidth="1" />)));
  } else if (shape === 'audio') {
    for (let i = 0; i < 64; i++) {
      const h = 6 + Math.abs(Math.sin(i / 5 + r() * 2)) * 60 * (0.4 + r() * 0.6);
      els.push(<rect key={i} x={20 + i * 4.4} y={H / 2 - h / 2} width="2.4" height={h} fill={i > 40 && i < 46 ? 'var(--accent)' : 'currentColor'} opacity={i > 40 && i < 46 ? 0.9 : 0.25} />);
    }
  } else {
    for (let i = 0; i < 8; i++) {
      const w = 120 + r() * 150;
      els.push(<rect key={i} x="28" y={34 + i * 15} width={w} height="5" rx="1" fill="currentColor" opacity={0.12 + r() * 0.14} />);
    }
    els.push(<rect key="hl" x="28" y={34 + 3 * 15} width="64" height="5" rx="1" fill="var(--accent)" opacity=".85" />);
  }
  return (
    <div className={`relative overflow-hidden bg-sunk text-ink ${className}`}>
      <svg viewBox={`0 0 ${W} ${H}`} className="h-full w-full" preserveAspectRatio="xMidYMid meet" aria-hidden="true">
        {els}
      </svg>
      {label && <span className="kicker absolute bottom-2.5 left-3">{label}</span>}
    </div>
  );
}
