// Minimal service worker — only handles Web Push display + tap-to-open.
// No caching/offline strategy; this is not a full PWA, just the transport
// needed for free browser push notifications (no third-party vendor).

self.addEventListener('push', (event) => {
  if (!event.data) return;
  let payload;
  try {
    payload = event.data.json();
  } catch {
    return;
  }

  event.waitUntil(
    self.registration.showNotification(payload.title || 'Vet AI Lab', {
      body: payload.body || '',
      icon: '/icon-128x128.png',
      data: { url: payload.url || '/my-pickups' },
    })
  );
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = event.notification.data?.url || '/my-pickups';

  event.waitUntil(
    self.clients
      .matchAll({ type: 'window', includeUncontrolled: true })
      .then((list) => {
        for (const client of list) {
          if ('focus' in client) {
            client.navigate(url);
            return client.focus();
          }
        }
        return self.clients.openWindow(url);
      })
  );
});
