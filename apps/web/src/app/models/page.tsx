'use client';
import { ListingGrid } from '@/components/listings';

export default function Models() {
  return <ListingGrid kind="model" title="Models" subtitle="ONNX models with sandboxed benchmark reports. Weights are never released before settlement; metrics are specific to the stated benchmark." />;
}
