// 税理士電卓（calc.html）専用のサービスワーカー。
// calc.html から scope './calc.html' で登録するため、index.html など他のページの通信には関与しない。
// 方針: まずネットワークから取り、つながらないときだけ保存済みのものを返す（オンライン時は常に最新）。
const CACHE = 'taxcalc-v1';
const FILES = ['calc.html', 'calc.webmanifest', 'calc-icon.svg', 'calc-icon-192.png', 'calc-icon-512.png'];

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((cache) => cache.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('taxcalc-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  const name = url.pathname.split('/').pop() || '';
  if (!FILES.includes(name)) return; // calc.html とその付属ファイル以外は素通し
  event.respondWith(
    fetch(req)
      .then((res) => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(CACHE).then((cache) => cache.put(name, copy));
        }
        return res;
      })
      .catch(() => caches.match(name, { ignoreSearch: true }))
  );
});
