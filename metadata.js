/* Leitor de metadados SHOUTcast da Rádio Caparaó Gospel.
 * Aceita o texto simples de /currentsong?sid=1 e JSON dos proxies.
 * Nenhum título inventado; nunca usa no-cors (resposta opaca não pode ser lida).
 */
'use strict';
window.CAPARAO_METADATA = (() => {
  function parse(input) {
    if (input === null || input === undefined) return null;
    let text = String(input).replace(/^\uFEFF/, '').replace(/\0/g, '').trim();
    if (!text || text.length > 20000) return null;
    // Respostas de proxy podem ser JSON, mas a fonte oficial é TEXTO simples.
    try {
      const parsed = JSON.parse(text);
      if (typeof parsed === 'string') text = parsed;
      else if (typeof parsed === 'object' && parsed !== null) {
        if (parsed.available === false) return null;
        const song = parsed.now_playing?.song;
        text = parsed.streamTitle ?? parsed.stream_title ?? parsed.streamtitle ??
          parsed.songtitle ?? parsed.current_song ?? parsed.currentsong ??
          parsed.currentSong ?? parsed.stats?.songtitle ?? parsed.now_playing?.text ??
          song?.text ?? (song && typeof song === 'object' ?
            [song.artist, song.title].filter(Boolean).join(' - ') : song) ??
          parsed.title ?? (Array.isArray(parsed) ? parsed[0]?.title : '') ?? '';
      } else return null;
    } catch (_) { /* Texto simples: manter integralmente. */ }
    if (typeof text !== 'string') return null;
    text = text.replace(/^\uFEFF/, '').replace(/\0/g, '').trim();
    // Formato legado de /7.html: seis campos numéricos seguidos do título.
    if (/^\d+(,\d+){5},/.test(text)) text = text.split(',').slice(6).join(',').trim();
    // Não aceitar HTML de erro/login como se fosse nome da música.
    if (/<(?:!doctype|html|head|body|script|title)\b/i.test(text)) return null;
    text = text.replace(/[\r\n\t]+/g, ' ').replace(/\s{2,}/g, ' ').trim();
    if (!text || text.length > 300 || /^(?:unknown|null|undefined|offline|no metadata|sem metadados|0|r[aá]dio show gospel|r[aá]dio capara[oó] gospel)$/i.test(text)) return null;
    // O título exibido é EXATAMENTE a identificação publicada pelo /currentsong.
    return {title: text.slice(0, 180), artist: ''};
  }

  async function read(url, timeoutMs = 7000) {
    if (!url || !/^https:\/\//i.test(url)) return {item: null, error: 'URL HTTPS não configurada'};
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), timeoutMs);
    try {
      const response = await fetch(url, {
        method: 'GET', mode: 'cors', credentials: 'omit',
        cache: 'no-store', signal: abort.signal
      });
      if (!response.ok) return {item: null, error: 'HTTP ' + response.status};
      const raw = await response.text();
      if (raw.length > 20000) return {item: null, error: 'Resposta excessivamente longa'};
      const item = parse(raw);
      return {item, error: item ? '' : 'Sem título válido na resposta', preview: raw.slice(0, 160)};
    } catch (error) {
      return {item: null, error: error?.name === 'AbortError' ? 'Tempo esgotado' : 'Rede ou CORS: ' + (error?.message || 'falha no fetch')};
    } finally { clearTimeout(timer); }
  }
  return Object.freeze({parse, read});
})();
