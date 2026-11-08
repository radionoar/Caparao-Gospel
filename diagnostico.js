/* Teste independente — não interfere no layout do player. */
'use strict';
(() => {
  const $ = id => document.getElementById(id);
  const KEY = 'caparao-gospel-worker-url';
  const out = $('out'), field = $('workerUrl');
  const audio = $('nativeAudio'), report = $('nativeResult');
  const direct = window.RADIO_CONFIG?.secureStreamUrl || 'https://stm17.xcast.com.br:8318/;';
  const support = ['audio/aac','audio/aacp','audio/mp4; codecs="mp4a.40.5"'].map(t => `${t}: ${audio.canPlayType(t) || 'não informado'}`).join('; ');
  report.textContent = 'Compatibilidade declarada pelo navegador: ' + support + '. Teste prático é necessário.';
  audio.addEventListener('playing', () => { report.textContent = 'O navegador iniciou a reprodução. Confirme se há som audível.'; });
  audio.addEventListener('waiting', () => { report.textContent = 'O navegador está aguardando dados do streaming.'; });
  audio.addEventListener('error', () => { const code = audio.error?.code || 0; report.textContent = `Erro ${code} na reprodução HE-AAC (código 4: formato ou cabeçalhos incompatíveis; código 3: decodificação). Se não houver áudio, teste o Worker opcional.`; });
  $('nativeStart').addEventListener('click', () => {
    audio.pause(); audio.removeAttribute('src'); audio.load();
    audio.src = direct; audio.load(); report.textContent = 'Conectando por HTTPS ao xCAST…';
    audio.play().catch(err => { report.textContent = `O navegador rejeitou o áudio: ${err.name} — ${err.message}.`; });
  });
  $('nativeStop').addEventListener('click', () => { audio.pause(); audio.removeAttribute('src'); audio.load(); report.textContent = 'Teste interrompido.'; });
  $('mode').textContent = `Site: ${location.origin} (${location.protocol === 'https:' ? 'HTTPS' : 'HTTP'}).`;
  function valid(value) {
    try {
      const url = new URL(value.trim());
      if (url.protocol !== 'https:' || url.username || url.password ||
          !['', '/', '/health', '/stream', '/diagnostico'].includes(url.pathname) ||
          url.search || url.hash) return '';
      return url.origin;
    } catch (_) { return ''; }
  }
  let saved = '';
  try { saved = localStorage.getItem(KEY) || ''; } catch (_) {}
  field.value = window.RADIO_CONFIG?.proxyBaseUrl || saved;
  $('save').addEventListener('click', () => {
    const base = valid(field.value);
    if (!base) { out.textContent = 'Informe uma URL HTTPS válida do Worker Cloudflare.'; return; }
    try { localStorage.setItem(KEY, base); } catch (_) {
      out.textContent = 'O navegador não permitiu salvar a configuração. Insira o endereço em config.js.'; return;
    }
    out.textContent = `Endereço salvo neste navegador: ${base}
Abra o aplicativo instalado novamente para testar a reprodução.
ATENÇÃO: esta configuração NÃO é aplicada automaticamente a outros ouvintes.`;
  });
  $('clear').addEventListener('click', () => {
    try { localStorage.removeItem(KEY); } catch (_) {}
    field.value = window.RADIO_CONFIG?.proxyBaseUrl || '';
    out.textContent = 'Teste local apagado. A configuração geral de config.js não foi alterada.';
  });
  $('go').addEventListener('click', async () => {
    const base = valid(field.value || window.RADIO_CONFIG?.proxyBaseUrl || '');
    if (!base) { out.textContent = 'Nenhum Worker configurado. Use primeiro o botão Testar áudio acima. Se falhar, publique o Worker opcional do pacote.'; return; }
    out.textContent = 'Verificando Worker HTTPS…';
    const signal = AbortSignal.timeout ? AbortSignal.timeout(18000) : undefined;
    try {
      const h = await fetch(`${base}/health`, {cache:'no-store', signal});
      const health = await h.json();
      if (!h.ok || health?.service !== 'caparao-gospel-worker') throw Error('A URL não responde como o Worker deste projeto.');
      out.textContent = 'Worker acessível. Testando a conexão real com xCAST na porta 8318…';
      const r = await fetch(`${base}/diagnostico`, {cache:'no-store', signal});
      const report = await r.json();
      out.textContent = JSON.stringify({worker:base, ...report}, null, 2) + (r.ok ? '\n\nAgora salve a URL e abra o app. Teste real do som no aparelho ainda é necessário.' : '\n\nFalha na conexão entre Worker e xCAST.');
    } catch (err) {
      out.textContent = `Falha ao verificar a ponte HTTPS.
${err.message}

Verifique se o Worker foi implantado e se o servidor xCAST responde na porta 8318.`;
    }
  });
})();
