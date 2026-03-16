
const CACHE_NAME = 'sinal-verde-v2';
const ASSETS = [
  './',
  './index.html',
  './pwa-manifest.json',
  './legislacao.json',
  './direcao.json',
  './socorros.json',
  './mecanica.json',
  './ambiente.json',
  './infracoes.json',
  './crimes.json',
  './sinalizacao.json',
  './habilitacao.json',
  './registro.json',
  './ctb.json',
  'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap',
  'https://fonts.googleapis.com/icon?family=Material+Icons'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      // Usamos um loop para que se um arquivo falhar, os outros ainda sejam cacheados
      return Promise.allSettled(ASSETS.map(asset => cache.add(asset)));
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((cachedResponse) => {
      if (cachedResponse) return cachedResponse;
      
      return fetch(event.request).then(response => {
        // Opcional: cachear novos assets (como o index.css hashado) dinamicamente
        if (response.ok && (event.request.url.includes('.css') || event.request.url.includes('.js'))) {
          const responseClone = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(event.request, responseClone));
        }
        return response;
      });
    })
  );
});
