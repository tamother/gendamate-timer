const CACHE='speech-timer-v8';
const FILES=['./','./index.html','./style.css?v=8','./app.mjs?v=8','./report.mjs?v=8','./timer-core.mjs?v=8','./agenda-adapter.mjs?v=8','./manifest.webmanifest','./report.html','./report-view.mjs?v=8'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(FILES)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(key=>key.startsWith('speech-timer-')&&key!==CACHE).map(key=>caches.delete(key)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 if(event.request.method!=='GET'||new URL(event.request.url).origin!==self.location.origin)return;
 if(event.request.mode==='navigate'){
  event.respondWith(fetch(event.request).then(response=>{if(response.ok){const copy=response.clone();caches.open(CACHE).then(cache=>cache.put(/\/report(?:\.html)?$/.test(new URL(event.request.url).pathname) ? './report.html' : './index.html',copy));}return response;}).catch(()=>caches.open(CACHE).then(cache=>cache.match(/\/report(?:\.html)?$/.test(new URL(event.request.url).pathname) ? './report.html' : './index.html'))));return;
 }
 event.respondWith(caches.open(CACHE).then(async cache=>(await cache.match(event.request))||fetch(event.request)));
});
