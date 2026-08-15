/* Shoko service worker
   アプリ本体だけをキャッシュする。作品データは IndexedDB にあるので触らない。
   TMDB / AniList への通信は常にネットワークへ行く（古い結果を返さないため）。 */

const CACHE = "shoko-v1.8.1";
const SHELL = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icons/icon-192.png',
  './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE).then(c => c.addAll(SHELL)).then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 共有された画像を IndexedDB に預ける（アプリ側が起動時に拾う） */
function idbPut(key, value) {
  return new Promise((res, rej) => {
    const r = indexedDB.open('shoko-db', 1);
    r.onupgradeneeded = () => {
      if (!r.result.objectStoreNames.contains('kv')) r.result.createObjectStore('kv');
    };
    r.onsuccess = () => {
      const db = r.result;
      const t = db.transaction('kv', 'readwrite').objectStore('kv').put(value, key);
      t.onsuccess = () => res(true);
      t.onerror = () => rej(t.error);
    };
    r.onerror = () => rej(r.error);
  });
}

self.addEventListener('fetch', e => {
  const req = e.request;

  // 他のアプリから共有されてきたとき
  if (req.method === 'POST' && new URL(req.url).pathname.endsWith('/share')) {
    e.respondWith((async () => {
      let q = '?shared=1';
      try {
        const fd = await req.formData();
        const file = fd.get('image');
        const title = (fd.get('title') || fd.get('text') || '').toString().trim();
        if (file && file.size) await idbPut('shoko:shared', file);
        else q = '?';
        if (title) q += (q === '?' ? '' : '&') + 'title=' + encodeURIComponent(title.slice(0, 120));
      } catch (err) { q = '?'; }
      return Response.redirect('./' + (q === '?' ? '' : q), 303);
    })());
    return;
  }

  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // API と画像 CDN は素通し。キャッシュすると情報が古くなる。
  if (url.origin !== self.location.origin) return;

  // 画面遷移：まずネットワーク、駄目ならキャッシュ（オフラインでも開ける）
  if (req.mode === 'navigate') {
    e.respondWith(
      fetch(req)
        .then(res => {
          const copy = res.clone();
          caches.open(CACHE).then(c => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html'))
    );
    return;
  }

  // それ以外の自サイト資産：キャッシュ優先
  e.respondWith(
    caches.match(req).then(hit => hit || fetch(req).then(res => {
      const copy = res.clone();
      caches.open(CACHE).then(c => c.put(req, copy));
      return res;
    }).catch(() => hit))
  );
});
