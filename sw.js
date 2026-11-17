const CACHE='speech-timer-v10';
const FILES=['./','./index.html','./style.css?v=10','./app.mjs?v=10','./report.mjs?v=10','./timer-core.mjs?v=10','./agenda-adapter.mjs?v=10','./manifest.webmanifest','./report.html','./report-view.mjs?v=10'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('speech-timer-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
 if(event.request.mode==='navigate'){
  event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(/\/report(?:\.html)?$/.test(new URL(event.request.url).pathname) ? './report.html' : './index.html',copy));}return response;}).catch(()=>caches.open(CACHE).then(cache=>cache.match(/\/report(?:\.html)?$/.test(new URL(event.request.url).pathname) ? './report.html' : './index.html'))));return;
 }
 event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(event.request))||fetch(event.request)));
});
