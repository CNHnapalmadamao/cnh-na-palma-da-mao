
const CACHE_NAME = 'sinal-verde-v2';
const ASSETS = [
  '/',
  '/index.html',
  '/manifest.json',
  '/legislacao.json',
  '/direcao.json',
  '/socorros.json',
  '/mecanica.json',
  '/ambiente.json',
  '/infracoes.json',
  '/crimes.json',
  '/sinalizacao.json',
  '/habilitacao.json',
  '/registro.json',
  'https://fonts.googleapis.com/css2?family=Roboto:wght@400;500;700;900&display=swap',
  'https://fonts.googleapis.com/icon?family=Material+Icons'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => {
      return cache.addAll(ASSETS);
    })
  );
});

self.addEventListener('fetch', (event) => {
  event.respondWith(
    caches.match(event.request).then((response) => {
      return response || fetch(event.request);
    })
  );
});
