'use strict';
/**
 * Rádio Caparaó Gospel — servidor opcional Node.js 20+ sem dependências npm.
 * Serve a PWA, retransmite o streaming xCAST de mesma origem e consulta
 * metadados Icecast/Shoutcast quando disponíveis, sem depender de CORS.
 * Para acesso público é necessário colocar este serviço atrás de HTTPS.
 */
const http = require('node:http');
const {createReadStream, stat} = require('node:fs');
const path = require('node:path');
const {Readable} = require('node:stream');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const STREAM = process.env.RADIO_STREAM_URL || 'http://stm17.xcast.com.br:8318';
const UPSTREAM = new URL(STREAM);
const STATIC = new Set([
  '/index.html', '/styles.css', '/gate.js', '/landing.js', '/app.js', '/config.js', '/sw.js', '/manifest.webmanifest',
  '/assets/caparao-gospel-original.png', '/assets/whatsapp.svg', '/assets/neon-waves-v2.svg',
  '/icons/icon-192.png', '/icons/icon-512.png', '/icons/icon-maskable-512.png',
  '/icons/apple-touch-icon.png', '/icons/favicon-64.png'
]);
const TYPES = {'.html':'text/html; charset=utf-8','.js':'text/javascript; charset=utf-8',
  '.css':'text/css; charset=utf-8','.webmanifest':'application/manifest+json; charset=utf-8',
  '.png':'image/png','.svg':'image/svg+xml'};

function secureHeaders(res) {
  res.setHeader('X-Content-Type-Options','nosniff');
  res.setHeader('Referrer-Policy','strict-origin-when-cross-origin');
  res.setHeader('X-Frame-Options','SAMEORIGIN');
  res.setHeader('Cross-Origin-Opener-Policy','same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; " +
    "connect-src 'self' http://stm17.xcast.com.br:8318; " +
    "media-src 'self' http://stm17.xcast.com.br:8318; " +
    "object-src 'none'; base-uri 'self'; frame-ancestors 'self'; form-action 'self'");
}
function json(res, code, obj) {
  res.writeHead(code, {'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(obj));
}
function sendFile(req, res, pathname) {
  const name = pathname === '/' ? '/index.html' : pathname;
  if (!STATIC.has(name)) return json(res, 404, {error:'Arquivo não encontrado.'});
  const file = path.join(ROOT, name.slice(1));
  stat(file, (err, info) => {
    if (err || !info.isFile()) return json(res,404,{error:'Arquivo não encontrado.'});
    res.writeHead(200, {
      'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
      'Content-Length':info.size,
      'Cache-Control': /\.(?:html|js|css|webmanifest)$/.test(name)
        ? 'no-cache' : 'public, max-age=3600'
    });
    if (req.method === 'HEAD') return res.end();
    createReadStream(file).on('error', () => res.destroy()).pipe(res);
  });
}
async function proxyAudio(res) {
  const controller = new AbortController();
  let completed = false;
  res.on('close', () => { if (!completed) controller.abort(); });
  try {
    const upstream = await fetch(STREAM, {
      redirect:'follow', signal:controller.signal,
      headers:{'Accept':'audio/mpeg, audio/aac, */*','Icy-MetaData':'0'}
    });
    if (!upstream.ok || !upstream.body) throw new Error(`Status remoto ${upstream.status}`);
    res.writeHead(200, {
      'Content-Type': upstream.headers.get('content-type') || 'audio/mpeg',
      'Cache-Control':'no-store, no-transform', 'X-Accel-Buffering':'no',
      'Access-Control-Allow-Origin':'*'
    });
    const audio = Readable.fromWeb(upstream.body);
    audio.on('error', () => { if (!res.destroyed) res.destroy(); });
    audio.on('end', () => { completed = true; });
    audio.pipe(res);
  } catch (err) {
    if (res.destroyed || controller.signal.aborted) return;
    console.error(`[Caparaó Gospel] Streaming: ${err.message}`);
    if (res.headersSent) res.destroy();
    else json(res, 502, {error:'Streaming xCAST indisponível nesta tentativa.'});
  }
}
function stripMarkup(value) {
  return String(value ?? '').replace(/<[^>]*>/g, '').replace(/&amp;/gi,'&')
    .replace(/&quot;/gi,'"').replace(/&#39;/gi,"'").replace(/&lt;/gi,'<')
    .replace(/&gt;/gi,'>').trim().slice(0,230);
}
function extractTrack(data) {
  if (typeof data === 'string') return stripMarkup(data);
  if (!data || typeof data !== 'object') return '';
  let source = data.icestats?.source;
  if (Array.isArray(source)) source = source[0];
  const song = data.now_playing?.song || data.song;
  const fromSong = song && typeof song === 'object'
    ? [song.artist, song.title].filter(Boolean).join(' - ') : song;
  return stripMarkup(data.songtitle || data.streamTitle || data.stream_title ||
    data.title || data.now_playing?.text || fromSong || source?.title || source?.yp_currently_playing || '');
}
async function requestTrack(url, kind) {
  try {
    const response = await fetch(url, {
      redirect:'follow',signal:AbortSignal.timeout(2800),
      headers:{Accept:kind === 'json' ? 'application/json,*/*' : 'text/plain,*/*'}
    });
    if (!response.ok) return '';
    const raw = (await response.text()).slice(0,65536);
    if (kind === 'html7') {
      const match = raw.match(/<body[^>]*>([\s\S]*?)<\/body>/i);
      const text = stripMarkup(match?.[1] || raw);
      const columns = text.split(',');
      return columns.length >= 7 ? stripMarkup(columns.slice(6).join(',')) : '';
    }
    if (kind === 'json') return extractTrack(JSON.parse(raw));
    return stripMarkup(raw);
  } catch (_) { return ''; }
}
async function nowPlaying() {
  const endpoints = [
    [new URL('/stats?sid=1&json=1',UPSTREAM), 'json'],
    [new URL('/status-json.xsl',UPSTREAM), 'json'],
    [new URL('/7.html',UPSTREAM), 'html7'],
    [new URL('/currentsong?sid=1',UPSTREAM), 'plain']
  ];
  for (const [url,kind] of endpoints) {
    const title = await requestTrack(url,kind);
    if (title && !/^(unknown|null|undefined|offline|no metadata)$/i.test(title)) return title;
  }
  return '';
}
function eventMetadata(res) {
  res.writeHead(200, {
    'Content-Type':'text/event-stream; charset=utf-8',
    'Cache-Control':'no-cache, no-transform', 'X-Accel-Buffering':'no',
    'Connection':'keep-alive', 'Access-Control-Allow-Origin':'*'
  });
  res.write(': conectado\n\n');
  let closed = false, busy = false, last = undefined;
  const poll = async () => {
    if (closed || busy) return;
    busy = true;
    try {
      const title = await nowPlaying();
      if (closed || title === last) return;
      last = title;
      res.write(`data: ${JSON.stringify(title ? {streamTitle:title} : {unavailable:true})}\n\n`);
    } finally { busy = false; }
  };
  const timer = setInterval(poll,18000);
  const ping = setInterval(() => { if (!closed) res.write(': ping\n\n'); },15000);
  res.on('close', () => { closed = true; clearInterval(timer); clearInterval(ping); });
  poll();
}
const server = http.createServer((req, res) => {
  secureHeaders(res);
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') return json(res, 405, {error:'Método não permitido.'});
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; }
  catch (_) {return json(res, 400, {error:'URL inválida.'});}
  if (pathname === '/api/health') return json(res, 200, {service:'caparao-gospel-proxy',ready:true,version:'1.9.1-caparao.1'});
  if (pathname === '/api/stream' && method === 'GET') return void proxyAudio(res);
  if (pathname === '/api/metadata' && method === 'GET') return void eventMetadata(res);
  if (pathname.startsWith('/api/')) return json(res, 404, {error:'Rota não encontrada.'});
  sendFile(req, res, pathname);
});
server.keepAliveTimeout = 65000;
server.listen(PORT, HOST, () => {
  console.log(`\n Rádio Caparaó Gospel pronta: http://localhost:${PORT}`);
  console.log(' Áudio xCAST e metadados encaminhados pela própria origem.');
  console.log(' Para disponibilizar ao público, configure domínio e HTTPS.\n');
});
server.on('error', (error) => {
  if (error?.code === 'EADDRINUSE') {
    console.error(`Porta ${PORT} ocupada: encerre o servidor anterior ou use PORT diferente.`);
    process.exitCode = 2;
    return;
  }
  console.error('Não foi possível iniciar o servidor:', error);
  process.exitCode = 1;
});
