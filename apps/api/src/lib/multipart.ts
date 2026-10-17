/** R2: maximum 10,000 parts, 5 MiB minimum except the final part, 5 GiB maximum part. */
export function multipartLayout(size: number, preferred: number) {
  if (!Number.isSafeInteger(size) || size <= 0 || size > 5 * 1024 ** 4) throw new Error('invalid object size');
  const mib = 1024 ** 2;
  const partSize = Math.max(5 * mib, preferred, Math.ceil(size / 10_000 / mib) * mib);
  if (partSize > 5 * 1024 ** 3) throw new Error('part size exceeds provider limit');
  return { partSize, partsTotal: Math.ceil(size / partSize) };
}
