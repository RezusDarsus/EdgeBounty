import type { Metadata } from 'next';
import { Showcase } from './showcase';

export const metadata: Metadata = { title: 'Design system (internal)', robots: { index: false, follow: false } };

export default function DesignSystem() {
  return <Showcase />;
}
