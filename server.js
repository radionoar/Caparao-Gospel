'use strict';
/**
 * Rádio Caparaó Gospel — servidor local opcional, Node.js 20+, sem npm.
 * Base visual e app: Nativa FM 1.9.1 original.
 * GitHub Pages NÃO executa este arquivo; para produção veja cloudflare-worker/.
 * Origem fixa xCAST HTTP na porta 8318. Aceita cabeçalhos HTTP e ICY.
 */
const http = require('node:http');
const net = require('node:net');
const {createReadStream, stat} = require('node:fs');
const path = require('node:path');
const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '127.0.0.1';
const UP_HOST = process.env.CAPARAO_ORIGIN_HOST || 'stm17.xcast.com.br';
const UP_PORT = Number(process.env.CAPARAO_ORIGIN_PORT || 8318);
const STATIC = new Set([
  '/index.html', '/styles.css', '/gate.js', '/landing.js', '/app.js', '/config.js', '/sw.js', '/manifest.webmanifest',
  '/diagnostico.html', '/diagnostico.js',
  '/assets/caparao-gospel-original.png', '/assets/whatsapp.svg', '/assets/neon-waves-v2.svg', '/assets/neon-waves.svg',
  '/icons/icon-192.png','/icons/icon-512.png','/icons/icon-maskable-512.png','/icons/apple-touch-icon.png','/icons/favicon-64.png'
]);
const TYPES = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8',
  '.png':'image/png','.svg':'image/svg+xml'};
function secureHeaders(res) {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self' https:; media-src 'self' https:; object-src 'none'; base-uri 'self'; frame-ancestors 'self'");
}
function json(res, code, obj) {
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store','Access-Control-Allow-Origin':'*'});
  res.end(JSON.stringify(obj));
}
function serveStatic(req, res, pathname) {
  const name = pathname === '/' ? '/index.html' : pathname;
  if (!STATIC.has(name)) return json(res, 404, {error:'Arquivo não encontrado.'});
  const file = path.join(ROOT, name.slice(1));
  stat(file, (err, info) => {
    if (err || !info.isFile()) return json(res,404,{error:'Arquivo não encontrado.'});
    res.writeHead(200, {'Content-Type':TYPES[path.extname(file)] || 'application/octet-stream',
      'Content-Length':info.size, 'Cache-Control': /\.(?:html|js|css|webmanifest)$/.test(name) ? 'no-cache' : 'public, max-age=3600'});
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
}
function splitHead(buf) {
  let pos = buf.indexOf('\r\n\r\n'), extra = 4;
  if (pos === -1) { pos = buf.indexOf('\n\n'); extra = 2; }
  if (pos === -1) return null;
  const head = buf.subarray(0,pos).toString('latin1');
  const line = head.split(/\r?\n/)[0].trim();
  const match = /^(?:ICY|HTTP\/1\.[01])\s+(\d{3})\b/i.exec(line);
  if (!match) throw new Error('Resposta HTTP/ICY inválida');
  const fields = {};
  for (const item of head.split(/\r?\n/).slice(1)) {
    const i = item.indexOf(':');
    if (i > 0) fields[item.slice(0,i).trim().toLowerCase()] = item.slice(i+1).trim();
  }
  return {code:+match[1], fields, body:buf.subarray(pos+extra)};
}
function openSocket(uri, handleData, onError, onEnd) {
  const socket = net.connect({host:UP_HOST,port:UP_PORT});
  let ended = false;
  const fail = (error) => { if (ended) return; ended=true; onError(error); socket.destroy(); };
  socket.setTimeout(11000,()=>fail(new Error('Tempo esgotado ao conectar ao xCAST')));
  socket.on('connect',()=> socket.write(`GET ${uri} HTTP/1.0\r\nHost: ${UP_HOST}:${UP_PORT}\r\nUser-Agent: RadioCaparaoGospel/1.9.1\r\nAccept: */*\r\nIcy-MetaData: 0\r\nConnection: close\r\n\r\n`));
  socket.on('data', chunk=> { try {handleData(chunk,socket);} catch(e){fail(e);} });
  socket.on('end',()=>{ if(!ended){ended=true;onEnd();} });
  socket.on('error',fail);
  return socket;
}
function audioStream(req,res) {
  let initial=Buffer.alloc(0), ready=false, closed=false;
  const socket=openSocket('/;', (chunk,socket)=> {
    if (closed) return;
    if (!ready) {
      initial = Buffer.concat([initial,chunk]);
      if (initial.length > 65536) throw new Error('Cabeçalhos do xCAST excederam 64 KB');
      const parsed=splitHead(initial);
      if(!parsed)return;
      if(parsed.code!==200)throw new Error('Servidor xCAST retornou '+parsed.code);
      if (parsed.fields['transfer-encoding']?.includes('chunked')) throw new Error('Origem não suporta HTTP/1.0 sem chunked');
      const type = (parsed.fields['content-type'] || 'audio/aac').split(';')[0].toLowerCase();
      if (/^(text\/|application\/(?:json|xml|xhtml|vnd\.apple\.mpegurl))/.test(type))throw new Error('xCAST retornou HTML/JSON, não áudio');
      const out = ['audio/aacp','audio/x-aacp','audio/x-aac','application/octet-stream'].includes(type) ? 'audio/aac' : (type.startsWith('audio/') ? type : 'audio/aac');
      ready=true;socket.setTimeout(0);
      res.writeHead(200,{'Content-Type':out, 'Content-Disposition':'inline', 'Cache-Control':'no-store, no-transform',
        'Access-Control-Allow-Origin':'*','X-Accel-Buffering':'no'});
      if(parsed.body.length && !res.write(parsed.body)) socket.pause();
      return;
    }
    if(!res.write(chunk)) socket.pause();
  }, err=>{console.error('[Caparaó] Áudio:',err.message);if(!res.headersSent)json(res,502,{error:err.message});else res.destroy();},()=>{if(!res.writableEnded)res.end();});
  res.on('drain',()=>socket.resume());
  res.on('close',()=>{closed=true;socket.destroy();});
}
function requestText(uri) {
  return new Promise((resolve,reject)=>{
    let initial=Buffer.alloc(0), parsed=null, body=Buffer.alloc(0);
    const socket=openSocket(uri,(chunk,socket)=>{
      if(!parsed){
        initial=Buffer.concat([initial,chunk]);
        if(initial.length>65536)throw new Error('Cabeçalho muito grande');
        parsed=splitHead(initial);if(!parsed)return;
        if(parsed.code!==200)throw new Error('Status '+parsed.code);
        body=parsed.body;
      }else body=Buffer.concat([body,chunk]);
      if(body.length>131072)throw new Error('Metadados muito extensos');
      if(parsed && body.length && !parsed.fields['content-length']){socket.end();}
      if(parsed && +parsed.fields['content-length']>0 && body.length >= +parsed.fields['content-length'])socket.end();
    }, reject,()=>resolve(body.toString('utf8')));
  });
}
function extractTitle(text) {
  let val=text.trim();
  try {
    const json=JSON.parse(val);
    val=String(json.songtitle||json.streamTitle||json.current_song||json.currentsong||json.now_playing?.song?.text||'').trim();
  }catch(_){
    val=val.replace(/<[^>]*>/g,'').trim();
    if (/^\d+(,\d+){5},/.test(val))val=val.split(',').slice(6).join(',').trim();
  }
  return val && val.length<=300 && !/^(unknown|null|undefined|offline)$/i.test(val)? val:'';
}
function readIcyTitle() {
  return new Promise((resolve) => {
    const socket=net.connect({host:UP_HOST,port:UP_PORT});
    let headers=null, buf=Buffer.alloc(0), finished=false;
    const finish=(v)=>{if(finished)return;finished=true;socket.destroy();resolve(v||'');};
    socket.setTimeout(12000,()=>finish(''));
    socket.on('connect',()=>socket.write(`GET /; HTTP/1.0\r\nHost: ${UP_HOST}:${UP_PORT}\r\nIcy-MetaData: 1\r\nConnection: close\r\n\r\n`));
    socket.on('data',(data)=>{
      try {
        if(!headers){
          buf=Buffer.concat([buf,data]);
          const result=splitHead(buf);
          if(!result){if(buf.length>65536)finish('');return;}
          headers=result.fields;buf=result.body;
          if(result.code!==200)return finish('');
        }else buf=Buffer.concat([buf,data]);
        const interval=Number(headers['icy-metaint']||0);
        if(!(interval>0 && interval<=262144))return finish('');
        if(buf.length>interval){
          const length=buf[interval]*16;
          if(length===0)return finish('');
          if(buf.length>=interval+length+1){
            const meta=buf.subarray(interval+1,interval+length+1).toString('latin1').replace(/\x00/g,'');
            const match=/StreamTitle=['"]([^'"]*)['"]/i.exec(meta);
            return finish(extractTitle(match?.[1]||''));
          }
        }
      }catch(_){finish('');}
    });
    socket.on('error',()=>finish(''));
    socket.on('end',()=>finish(''));
  });
}
async function metadata(res) {
  for(const uri of ['/currentsong?sid=1','/stats?sid=1&json=1','/7.html']) {
    try {const title=extractTitle(await requestText(uri)); if(title)return json(res,200,{streamTitle:title});}
    catch(_){/* tentar próximo formato */}
  }
  const icy=await readIcyTitle();
  if(icy)return json(res,200,{streamTitle:icy,available:true,source:'icy'});
  return json(res,200,{streamTitle:null,available:false});
}
const server=http.createServer((req,res)=> {
  secureHeaders(res);
  const method=req.method||'GET';
  if(method!=='GET' && method!=='HEAD')return json(res,405,{error:'Método não permitido.'});
  let pathname;
  try{pathname=new URL(req.url,'http://localhost').pathname;}catch(_){return json(res,400,{error:'URL inválida.'});}
  if(pathname==='/api/health')return json(res,200,{service:'caparao-gospel-proxy',ready:true,version:'rebase-1'});
  if(pathname==='/api/stream')return method==='HEAD' ? (res.writeHead(200,{'Content-Type':'audio/aac'}),res.end()) : audioStream(req,res);
  if(pathname==='/api/metadata')return method==='HEAD' ? (res.writeHead(200),res.end()) : void metadata(res);
  if(pathname.startsWith('/api/'))return json(res,404,{error:'Rota não encontrada'});
  serveStatic(req,res,pathname);
});
server.listen(PORT,HOST,()=> console.log(`Rádio Caparaó Gospel: http://localhost:${PORT} — áudio xCAST HTTP e metadados via proxy local.`));
server.on('error',e=>{console.error('Servidor:',e.message);process.exitCode=1;});
