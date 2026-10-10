'use strict';
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const root = __dirname;
const types = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.json':'application/json; charset=utf-8','.png':'image/png','.svg':'image/svg+xml','.md':'text/plain; charset=utf-8'};
const requestedPort = Number(process.env.PORT || process.argv[2] || 8766);
if (!Number.isInteger(requestedPort) || requestedPort < 1024 || requestedPort > 65515) throw new Error('端口应为 1024–65515 的整数');
let port = requestedPort;
const server = http.createServer((req,res)=>{
  if (!['GET','HEAD'].includes(req.method)) { res.writeHead(405,{'Allow':'GET, HEAD'}); res.end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url,'http://127.0.0.1').pathname); }
  catch { res.writeHead(400); res.end('Bad request'); return; }
  if (pathname.includes('\0')) { res.writeHead(400); res.end('Bad request'); return; }
  const target = path.resolve(root,'.'+(pathname==='/'?'/index.html':pathname));
  if (target !== root && !target.startsWith(root + path.sep)) { res.writeHead(403); res.end('Forbidden'); return; }
  fs.stat(target,(err,stat)=>{
    if (err || !stat.isFile()) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200,{'Content-Type':types[path.extname(target)]||'application/octet-stream','Content-Length':stat.size,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
    if (req.method==='HEAD') { res.end(); return; }
    const stream = fs.createReadStream(target);
    stream.on('error',()=>res.destroy());
    stream.pipe(res);
  });
});
server.on('error',err=>{
  if (err.code==='EADDRINUSE' && port<requestedPort+20) { port++; server.listen(port,'127.0.0.1'); }
  else { console.error(err); process.exitCode=1; }
});
server.listen(port,'127.0.0.1',()=>console.log('丞相北伐模拟器：http://127.0.0.1:'+port+'/'));
