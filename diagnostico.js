'use strict';
(() => {
  const cfg=window.RADIO_CONFIG;
  const out=document.getElementById('report');
  const logs=[];let audio=null;
  const log=(line)=>{logs.push(new Date().toLocaleTimeString('pt-BR')+'  '+line);out.textContent=logs.join('\n');};
  const proxy=(cfg.proxyBaseUrl||'.').replace(/\/+$/,'')+'/api';
  document.getElementById('testAudio').onclick=async()=>{
    logs.length=0;log('URL HTTPS: '+cfg.streamUrl);
    if(audio){audio.pause();audio.removeAttribute('src');audio.load();}
    audio=new Audio();audio.preload='none';audio.src=cfg.streamUrl;
    audio.onplaying=()=>log('Evento playing: navegador iniciou o fluxo de áudio. Confira se escuta som.');
    audio.oncanplay=()=>log('Evento canplay: navegador reconheceu dados reproduzíveis.');
    audio.onerror=()=>log('ERRO no elemento de áudio (código '+(audio.error?.code||'?')+'): '+(audio.error?.message||'consulte o navegador'));
    audio.onwaiting=()=>log('Aguardando dados do servidor.');
    try{await audio.play();log('play() aceito: verifique som nos alto-falantes.');}
    catch(e){log('play() recusado: '+(e.message||e.name));}
  };
  document.getElementById('stopAudio').onclick=()=>{
    if(audio){audio.pause();audio.removeAttribute('src');audio.load();}log('Áudio de teste parado.');
  };
  document.getElementById('testMeta').onclick=async()=>{
    logs.length=0;
    const urls=[proxy+'/health',proxy+'/metadata',new URL('/currentsong?sid=1',cfg.streamUrl).href,new URL('/stats?sid=1&json=1',cfg.streamUrl).href,new URL('/7.html',cfg.streamUrl).href];
    for(const url of urls){
      const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),5000);
      try{
        const r=await fetch(url,{cache:'no-store',signal:controller.signal});
        if(!r.ok) {log(url+' → HTTP '+r.status);continue;}
        const type=r.headers.get('content-type')||'não informado';
        const body=await r.text();
        log(url+' → HTTP '+r.status+' '+type+' | '+body.slice(0,220).replace(/\s+/g,' '));
      }catch(err){log(url+' → acesso indisponível: '+err.message);}
      finally{clearTimeout(timer);}
    }
    log('VU meter: disponível com proxy CORS ou CORS habilitado no xCAST. Reprodução direta sem CORS não dá acesso às amostras de áudio.');
  };
  log('Projeto reconstruído do original Nativa FM 1.9.1.');
})();
