// O GitHub Pages fixa cache curto nos cabeçalhos. Este cache versionado mantém
// apenas assets estáticos do próprio projeto entre visitas; HTML e chamadas ao
// Supabase continuam sempre na rede para não servir dados ou telas obsoletos.
const CACHE_NAME = 'sorteio-sei-assets-20260824-9';

self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes
      .filter(nome => nome.startsWith('sorteio-sei-assets-') && nome !== CACHE_NAME)
      .map(nome => caches.delete(nome)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  if (request.method !== 'GET'
      || url.origin !== self.location.origin
      || !url.pathname.includes('/assets/')) return;

  event.respondWith((async () => {
    const cache = await caches.open(CACHE_NAME);
    const armazenado = await cache.match(request);
    if (armazenado) return armazenado;

    const resposta = await fetch(request);
    if (resposta.ok) await cache.put(request, resposta.clone());
    return resposta;
  })());
});
