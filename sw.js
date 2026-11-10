// No portfolio/API response caching. IndexedDB event receipts persist across worker restarts.
self.addEventListener('install', event => event.waitUntil(self.skipWaiting()));
self.addEventListener('activate', event => event.waitUntil(self.clients.claim()));
function receipts() {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open('revel-push-receipts', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('events');
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
self.addEventListener('push', event => event.waitUntil((async () => {
  let payload;
  try { payload = event.data.json(); } catch { return; }
  if (!payload.id || typeof payload.title !== 'string') return;
  const db = await receipts();
  const seen = await new Promise((resolve, reject) => {
    const tx = db.transaction('events', 'readwrite'), store = tx.objectStore('events');
    const request = store.get(payload.id); let exists = false;
    request.onsuccess = () => { exists = !!request.result; if (!exists) store.put(Date.now(), payload.id); };
    tx.oncomplete = () => resolve(exists); tx.onerror = () => reject(tx.error);
  });
  db.close();
  if (seen) return;
  try {
    await self.registration.showNotification(payload.title, { body: payload.body, tag: payload.id, renotify: false, icon: '/assets/icon-192.png', data: { url: '/#notifications' } });
  } catch (error) {
    const db = await receipts();
    await new Promise(resolve => { const tx = db.transaction('events', 'readwrite'); tx.objectStore('events').delete(payload.id); tx.oncomplete = resolve; });
    db.close(); throw error;
  }
})()));
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    for (const client of await self.clients.matchAll({ type: 'window', includeUncontrolled: true })) {
      if (new URL(client.url).origin === self.location.origin) { await client.navigate('/#notifications'); return client.focus(); }
    }
    return self.clients.openWindow('/#notifications');
  })());
});
