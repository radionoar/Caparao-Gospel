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
const net = require('node:net');

const ROOT = __dirname;
const PORT = Number(process.env.PORT || 8080);
const HOST = process.env.HOST || '0.0.0.0';
const STREAM = process.env.RADIO_STREAM_URL || 'http://stm17.xcast.com.br:8318/;';
const UPSTREAM = new URL(STREAM);
// A rádio transmite HE-AAC. Alguns SHOUTcast enviam audio/aacp ou um
// tipo binário, que certos navegadores tentam baixar em vez de reproduzir.
function playableAudioType(value) {
  const type = String(value || '').split(';')[0].trim().toLowerCase();
  if (type === 'audio/aacp' || type === 'audio/x-aacp' || type === 'audio/x-aac' || type === 'application/octet-stream' || !type) return 'audio/aac';
  return type;
}

const STATIC = new Set([
  '/diagnostico.html', '/diagnostico.css', '/diagnostico.js', '/index.html', '/styles.css', '/gate.js', '/landing.js', '/app.js', '/config.js', '/sw.js', '/manifest.webmanifest',
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
    "connect-src 'self' https: http://stm17.xcast.com.br:8318; " +
    "media-src 'self' https: http://stm17.xcast.com.br:8318; " +
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

/**
 * Compatibilidade xCAST/SHOUTcast: a playlist .pls usa /; (não apenas /).
 * Uma origem SHOUTcast antiga também pode responder "ICY 200 OK", que
 * alguns clientes HTTP modernos recusam. Tentamos fetch HTTP primeiro;
 * nesse caso específico, usamos um socket com leitura de cabeçalho ICY.
 */
function streamViaIcySocket(res, target) {
  return new Promise((resolve, reject) => {
    if (target.protocol !== 'http:') return reject(new Error('Fallback ICY exige HTTP do servidor xCAST.'));
    const sock = net.createConnection({host:target.hostname, port:Number(target.port || 80)});
    let finished = false;
    let head = Buffer.alloc(0);
    let ready = false;
    function abort() { sock.destroy(); }
    function fail(err) {
      if (finished) return;
      finished = true;
      sock.destroy();
      if (!res.headersSent) reject(err);
      else { if (!res.destroyed) res.destroy(); resolve(); }
    }
    res.once('close', abort);
    sock.setTimeout(35000, () => fail(new Error('Timeout do streaming ICY.')));
    sock.on('connect', () => {
      const path = target.pathname + target.search;
      sock.write(`GET ${path} HTTP/1.0\r\nHost: ${target.host}\r\nUser-Agent: CaparaoGospelPlayer/1.9.1\r\nAccept: audio/mpeg, audio/aac, */*\r\nIcy-MetaData: 0\r\nConnection: close\r\n\r\n`);
    });
    sock.on('data', (chunk) => {
      if (finished || res.destroyed) return;
      if (!ready) {
        head = Buffer.concat([head, chunk]);
        // O primeiro pacote pode conter cabeçalho + muitos KB de áudio.
        // Não tratar todo o pacote como cabeçalho (causava reconexões falsas).
        const pos = head.indexOf('\r\n\r\n');
        if (pos < 0) {
          if (head.length > 32768) return fail(new Error('Cabeçalho ICY excedeu o limite.'));
          return;
        }
        const header = head.subarray(0, pos).toString('latin1');
        const status = header.split('\r\n',1)[0];
        const ok = /^(?:ICY|HTTP\/1\.[01]) 200(?: |$)/.test(status);
        if (!ok) return fail(new Error(`Status inválido da origem: ${status.slice(0,90)}`));
        const type = /(?:^|\r\n)content-type:\s*([^\r\n]+)/i.exec(header)?.[1]?.trim() || 'audio/aac';
        if (!/^(?:audio\/|application\/octet-stream)/i.test(type))
          return fail(new Error(`SHOUTcast enviou conteúdo não-audio: ${type}`));
        ready = true;
        sock.setTimeout(90000, () => fail(new Error('Sem novos dados do streaming ICY.')));
        res.writeHead(200, {'Content-Type':playableAudioType(type),'Content-Disposition':'inline','Cache-Control':'no-store, no-transform',
          'X-Accel-Buffering':'no','Access-Control-Allow-Origin':'*'});
        const tail = head.subarray(pos + 4);
        head = Buffer.alloc(0);
        if (tail.length && !res.write(tail)) sock.pause();
      } else if (!res.write(chunk)) sock.pause();
    });
    res.on('drain', () => sock.resume());
    sock.on('error', (err) => fail(err));
    sock.on('end', () => {
      if (finished) return;
      finished = true;
      if (ready) { if (!res.writableEnded) res.end(); resolve(); }
      else reject(new Error('A origem encerrou a conexão antes de enviar áudio ICY.'));
    });
    sock.on('close', () => { if (!finished) fail(new Error('Conexão ICY encerrada inesperadamente.')); });
  });
}
async function proxyAudio(res) {
  const controller = new AbortController();
  const connectTimer = setTimeout(() => controller.abort(new Error('Tempo limite ao conectar ao xCAST (12 segundos).')),12000);
  res.on('close', () => {clearTimeout(connectTimer); controller.abort();});
  try {
    const upstream = await fetch(STREAM, {
      redirect:'follow', signal:controller.signal,
      headers:{'Accept':'audio/mpeg, audio/aac, */*','Icy-MetaData':'0'},
      // Stream ao vivo: o timeout deve ser aplicado só ao início, não ao áudio contínuo.
    });
    clearTimeout(connectTimer);
    if (!upstream.ok || !upstream.body) throw new Error(`Status remoto ${upstream.status}`);
    const type = upstream.headers.get('content-type') || 'audio/aac';
    if (!/^(?:audio\/|application\/octet-stream)/i.test(type)) {
      await upstream.body.cancel().catch(() => {});
      throw new Error(`Origem retornou ${type} em vez de áudio (confira URL /;).`);
    }
    res.writeHead(200, {
      'Content-Type': playableAudioType(type),
      'Content-Disposition': 'inline',
      'Cache-Control':'no-store, no-transform','X-Accel-Buffering':'no',
      'Access-Control-Allow-Origin':'*'
    });
    const audio = Readable.fromWeb(upstream.body);
    audio.on('error', () => { if (!res.destroyed) res.destroy(); });
    audio.pipe(res);
  } catch (err) {
    clearTimeout(connectTimer);
    if (res.destroyed) return;
    // ICY 200 OK é um status não-HTTP: o fetch do Node pode lançar Parse Error.
    const looksIcy = /HPE_INVALID_CONSTANT|Expected HTTP|Invalid response|fetch failed|UND_ERR_HTTP_PARSER/i.test(
      String(err?.message || '') + ' ' + String(err?.cause?.code || '') + ' ' + String(err?.cause?.message || '')
    );
    if (looksIcy && !res.headersSent) {
      try { await streamViaIcySocket(res, UPSTREAM); return; }
      catch (socketErr) { err = socketErr; }
    }
    console.error(`[Caparaó Gospel] Streaming (${STREAM}): ${err.message}`);
    if (res.headersSent) res.destroy();
    else json(res, 502, {error:'Não foi possível receber áudio do streaming xCAST.', detail:err.message.slice(0,140)});
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
/**
 * Uma verificação pontual da origem, sem depender da inicialização do player.
 * Nunca lê indefinidamente: pega somente um bloco pequeno para diagnosticar.
 * Retorna erros úteis sem expor credenciais ou fingir que o stream está no ar.
 */
function diagnoseIcySocket(target) {
  return new Promise((resolve, reject) => {
    if (target.protocol !== 'http:') return reject(new Error('Servidor não usa HTTP para ICY.'));
    const sock = net.createConnection({host:target.hostname,port:Number(target.port || 80)});
    const timer = setTimeout(() => {sock.destroy(); reject(new Error('Tempo limite ICY na origem.'));},8500);
    let buffer = Buffer.alloc(0), completed = false;
    const done = (err,result) => {
      if (completed) return;
      completed = true;
      clearTimeout(timer);
      sock.destroy();
      if (err) reject(err); else resolve(result);
    };
    sock.once('connect', () => sock.write(
      `GET ${target.pathname}${target.search} HTTP/1.0\r\nHost: ${target.host}\r\nUser-Agent: Caparao-Diagnostico/1.9.1\r\nIcy-MetaData: 0\r\nConnection: close\r\n\r\n`
    ));
    sock.on('data', chunk => {
      if (completed) return;
      buffer = Buffer.concat([buffer,chunk]);
      const pos = buffer.indexOf('\r\n\r\n');
      if (pos === -1) {
        if (buffer.length > 32768) return done(new Error('Cabeçalho ICY grande ou inválido.'));
        return;
      }
      const head = buffer.subarray(0,pos).toString('latin1');
      const status = head.split('\r\n')[0];
      if (!/^(?:ICY|HTTP\/1\.[01]) 200(?: |$)/.test(status))
        return done(new Error('Resposta do servidor: '+status.slice(0,100)));
      const type = /(?:^|\r\n)content-type:\s*([^\r\n]+)/i.exec(head)?.[1]?.trim() || 'audio/aac';
      if (!/^(?:audio\/|application\/octet-stream)/i.test(type))
        return done(new Error('Origem devolveu conteúdo não-áudio: '+type));
      const tail = buffer.subarray(pos+4);
      if (tail.length) return done(null,{httpStatus:200,contentType:type,bytesReceived:tail.length,validAudio:true,via:'ICY (socket)'});
    });
    sock.once('error',done);
    sock.once('end',()=>done(new Error('Origem ICY fechou sem enviar bytes de áudio.')));
  });
}

async function diagnoseUpstream() {
  const outcome = {upstream:STREAM, validAudio:false, checkedAt:new Date().toISOString()};
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(),8500);
  let response;
  try {
    response = await fetch(STREAM, {signal:controller.signal,redirect:'follow',
      headers:{Accept:'audio/mpeg, audio/aac, */*','Icy-MetaData':'0'}});
    outcome.httpStatus = response.status;
    outcome.contentType = response.headers.get('content-type') || '(ausente)';
    if (!response.ok) throw new Error(`HTTP ${response.status} da origem`);
    if (!response.body) throw new Error('O servidor não enviou um corpo de áudio.');
    if (!/^(audio\/|application\/octet-stream)/i.test(outcome.contentType))
      throw new Error('A origem devolveu conteúdo que não é áudio.');
    const reader = response.body.getReader();
    let chunk;
    try { ({value:chunk} = await reader.read()); }
    finally {reader.cancel().catch(()=>{});}
    if (!chunk?.length) throw new Error('Nenhum byte de áudio foi recebido.');
    outcome.bytesReceived = chunk.length;
    outcome.validAudio = true;
    outcome.message='A origem respondeu com áudio; se o player falhar, verifique a hospedagem HTTPS/CORS ou codec.';
  } catch(err) {
    const looksIcy = /HPE_INVALID_CONSTANT|Expected HTTP|Invalid response|fetch failed|UND_ERR_HTTP_PARSER/i.test(
      String(err?.message || '')+' '+String(err?.cause?.code || '')+' '+String(err?.cause?.message || '')
    );
    if (looksIcy && !controller.signal.aborted) {
      try {
        Object.assign(outcome,await diagnoseIcySocket(UPSTREAM));
        outcome.message='Origem retornou bytes de áudio pelo protocolo SHOUTcast ICY.';
      } catch (socketErr) {outcome.error='Verificações HTTP e ICY falharam: '+socketErr.message;}
    } else {
      outcome.error = controller.signal.aborted ? 'Tempo limite de 8,5 segundos: streaming inacessível ou sem bytes de áudio.'
        : (err?.message || 'Falha desconhecida');
    }
    if (!outcome.validAudio) outcome.message = 'Confirme se a rádio está no ar e se o endereço/porta foram fornecidos pelo titular do streaming.';
  } finally {
    clearTimeout(timer);
    if (response?.body && !response.body.locked) response.body.cancel().catch(()=>{});
    controller.abort();
  }
  return outcome;
}

const server = http.createServer((req, res) => {
  secureHeaders(res);
  const method = req.method || 'GET';
  if (method !== 'GET' && method !== 'HEAD') return json(res, 405, {error:'Método não permitido.'});
  let pathname;
  try { pathname = new URL(req.url, 'http://localhost').pathname; }
  catch (_) {return json(res, 400, {error:'URL inválida.'});}
  if (pathname === '/api/health') return json(res, 200, {service:'caparao-gospel-proxy',ready:true,upstreamNotYetVerified:true,version:'1.9.1-caparao.5'});
  if (pathname === '/api/diagnostico' && method === 'GET') return void diagnoseUpstream().then((result)=>json(res,200,result)).catch((e)=>json(res,502,{error:e.message}));
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
