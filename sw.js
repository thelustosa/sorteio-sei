// Lápide do cache estático, removido em 27/08/2026.
//
// Nada mais registra este arquivo. Ele existe para os navegadores que ainda têm
// o service worker antigo instalado: na atualização eles buscam ./sw.js, e um
// 404 não desfaz o registro — o worker antigo continuaria servindo /assets/ do
// cache, inclusive imagens e fontes, que não têm ?v= para invalidar.
//
// Sem handler de fetch, tudo volta a passar pela rede. Pode ser apagado depois
// que os acessos recorrentes tiverem passado por uma versão com este arquivo.
self.addEventListener('install', () => self.skipWaiting());

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const nomes = await caches.keys();
    await Promise.all(nomes
      .filter(nome => nome.startsWith('sorteio-sei-assets-'))
      .map(nome => caches.delete(nome)));
    await self.registration.unregister();
    // Recarrega as abas abertas para que saiam do controle do worker antigo.
    const clientes = await self.clients.matchAll({ type: 'window' });
    clientes.forEach(cliente => cliente.navigate(cliente.url));
  })());
});
