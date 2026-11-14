import type { Body } from '../types/contracts';

/** Decorative interface artwork. Never used as terrain, imagery evidence or solver input. */
export function DestinationArtwork({ body, className = '', sizes = '(max-width: 767px) 100vw, 50vw', loading = 'eager' }: {
  body: Body; className?: string; sizes?: string; loading?: 'eager' | 'lazy';
}) {
  const base = `${import.meta.env.BASE_URL}artwork/${body}-destination`;
  return <img className={`destination-artwork ${className}`} src={`${base}.jpg`} srcSet={`${base}-768.jpg 768w, ${base}.jpg 1536w`} sizes={sizes} width={1536} height={1024} alt="" aria-hidden="true" draggable={false} decoding="async" loading={loading} />;
}
