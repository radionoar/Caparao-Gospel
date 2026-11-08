/* Diagnóstico individual para streaming HTTPS, título texto puro e restrição CORS. */
'use strict';
(() => {
  const cfg = window.RADIO_CONFIG;
  const out = document.getElementById('report');
  const logs = [];
  let audio = null;
  const log = (line) => { logs.push(new Date().toLocaleTimeString('pt-BR') + '  ' + line); out.textContent = logs.join('\n'); };
  const proxy = (cfg.proxyBaseUrl || '.').replace(/\/+$/, '') + '/api';
  document.getElementById('testAudio').onclick = async () => {
    logs.length = 0; log('Streaming HTTPS: ' + cfg.streamUrl);
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); }
    audio = new Audio(); audio.preload = 'none'; audio.src = cfg.streamUrl;
    audio.onplaying = () => log('Evento playing: fluxo iniciou. Verifique se o som é audível.');
    audio.oncanplay = () => log('Evento canplay: navegador reconheceu o áudio.');
    audio.onerror = () => log('ERRO de áudio: ' + (audio.error?.message || audio.error?.code || '?'));
    audio.onwaiting = () => log('Aguardando áudio da origem.');
    try { await audio.play(); log('play() autorizado.'); }
    catch (e) { log('play() recusado: ' + (e.message || e.name)); }
  };
  document.getElementById('stopAudio').onclick = () => {
    if (audio) { audio.pause(); audio.removeAttribute('src'); audio.load(); } log('Áudio parado.');
  };
  document.getElementById('testMeta').onclick = async () => {
    logs.length = 0;
    const direct = cfg.metadataUrl;
    const bridge = cfg.metadataFallbackUrl;
    log('Fonte oficial: ' + direct + ' (retorno em TEXTO SIMPLES)');
    const sources = [['xCAST DIRETO', direct], ['PONTE PÚBLICA DE TEXTO', bridge]];
    if (cfg.proxyBaseUrl) sources.push(['PROXY PRÓPRIO', proxy + '/metadata']);
    for (const [label,url] of sources) {
      if (!url) continue;
      const response = await window.CAPARAO_METADATA.read(url, 9000);
      if (response.item) log(label + ' — TÍTULO IDENTIFICADO: ' + response.item.title);
      else log(label + ' — NÃO ACESSÍVEL: ' + response.error + (response.preview ? ' | resposta: ' + response.preview : ''));
    }
    log('Se ambas as fontes falharem, é necessário autorizar CORS no xCAST ou configurar o Worker próprio.');
    log('VU meter real também exige CORS na origem do áudio ou o Worker de streaming.');
  };
  log('Rádio Caparaó Gospel — diagnóstico de metadados em TEXTO SIMPLES.');
})();
