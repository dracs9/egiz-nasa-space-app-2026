// MapLibre 6 resolves its default worker beside the original module. Vite moves
// that module into a hashed chunk, so explicitly emit and configure its worker.
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';

export async function loadMapLibrary() {
  const library = await import('maplibre-gl');
  library.setWorkerUrl(new URL(workerUrl, document.baseURI).href);
  return library;
}
