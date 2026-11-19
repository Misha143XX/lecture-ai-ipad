const CACHE='lecture-ai-shell-v040';
const ASSETS=['./','./index.html','./styles.css','./app.js','./localTranscribe.mjs','./manifest.webmanifest','./icons/icon-192.png','./icons/icon-512.png','./icons/icon-180.png'];
self.addEventListener('install',event=>event.waitUntil(caches.open(CACHE).then(cache=>cache.addAll(ASSETS)).then(()=>self.skipWaiting())));
self.addEventListener('activate',event=>event.waitUntil(caches.keys().then(names=>Promise.all(names.filter(x=>x!==CACHE&&x.startsWith('lecture-ai-shell-')).map(x=>caches.delete(x)))).then(()=>self.clients.claim())));
self.addEventListener('fetch',event=>{
 const req=event.request;
 if(req.method!=='GET'||new URL(req.url).origin!==self.location.origin)return;
 const path=new URL(req.url).pathname;
 const isAppFile=req.mode==='navigate'||/(?:\/|^)(?:index\.html|app\.js|styles\.css|localSummarize\.mjs|localTranscribe\.mjs|manifest\.webmanifest)$/.test(path);
 if(isAppFile){
   event.respondWith(fetch(req).then(async res=>{if(res.ok){const cache=await caches.open(CACHE);cache.put(req,res.clone()).catch(()=>{});}return res;}).catch(async()=> (await caches.match(req))||(await caches.match('./index.html'))));
 }else{
   event.respondWith(caches.match(req).then(hit=>hit||fetch(req)));
 }
});
