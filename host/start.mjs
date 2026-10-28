// Dependency-free, read-only asset service. Game state stays in the browser.
import {createServer} from 'node:http';
import {createReadStream} from 'node:fs';
import {stat} from 'node:fs/promises';
import path from 'node:path';
const root=path.resolve(import.meta.dirname,'../dist'),mount='/games/flashfire/';
const types={'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.svg':'image/svg+xml','.png':'image/png','.webp':'image/webp','.ico':'image/x-icon','.woff2':'font/woff2','.woff':'font/woff','.jpg':'image/jpeg','.jpeg':'image/jpeg','.json':'application/json'};
createServer(async(req,res)=>{
 if(!['GET','HEAD'].includes(req.method)){res.writeHead(405);res.end();return;}
 let pathname;try{pathname=decodeURIComponent(new URL(req.url,'http://localhost').pathname);}catch{res.writeHead(400);res.end();return;}
 if(pathname==='/health'){res.writeHead(200,{'Content-Type':'application/json'});res.end('{"ok":true,"game":"flashfire","runtime":"browser"}');return;}
 if(!pathname.startsWith(mount)||pathname.includes('\\')||pathname.includes('\0')){res.writeHead(404);res.end();return;}
 const relative=pathname.slice(mount.length)||'index.html',file=path.resolve(root,relative);
 if(!file.startsWith(root+path.sep)||relative.split('/').some(p=>p.startsWith('.'))){res.writeHead(404);res.end();return;}
 try{const info=await stat(file);if(!info.isFile())throw Error('not a file');
  res.writeHead(200,{'Content-Type':types[path.extname(file)]||'application/octet-stream','Content-Length':info.size,'Cache-Control':relative.startsWith('assets/')?'public, max-age=31536000, immutable':'no-cache','X-Content-Type-Options':'nosniff'});
  if(req.method==='HEAD')res.end();else createReadStream(file).pipe(res);
 }catch{res.writeHead(404);res.end('Not found');}
}).listen(Number(process.env.WEB_PORT||8080),process.env.BIND||'0.0.0.0',()=>console.log('Flashfire static host ready'));
