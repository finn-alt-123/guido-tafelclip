/* Service worker voor de personeelsapp: toont pushmeldingen (geen caching, zodat er nooit oude code blijft hangen). */
self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (e) => e.waitUntil(self.clients.claim()));

self.addEventListener('push', (e) => {
  let d = {};
  try { d = e.data ? e.data.json() : {}; } catch { d = { titel: 'guido.', tekst: e.data ? e.data.text() : '' }; }
  // Staat de app open? Laat ze meteen verversen, zonder te wachten op de volgende controle.
  self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lijst) => lijst.forEach((c) => c.postMessage('ververs'))).catch(() => {});
  e.waitUntil(self.registration.showNotification(d.titel || 'guido.', {
    body: d.tekst || '',
    tag: d.tag || undefined,
    renotify: true,
    icon: '/img/icoon-192.png',
    badge: '/img/icoon-192.png',
    data: { url: d.url || '/beheer.html#meldingen' }
  }));
});

self.addEventListener('notificationclick', (e) => {
  e.notification.close();
  const url = (e.notification.data && e.notification.data.url) || '/beheer.html#meldingen';
  e.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((lijst) => {
    for (const c of lijst) if (c.url.includes('/beheer.html')) { c.postMessage('ververs'); return c.focus(); }
    return self.clients.openWindow(url);
  }));
});
