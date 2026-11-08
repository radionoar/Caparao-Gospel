/* Rádio Caparaó Gospel — mesma aparência da Nativa FM; áudio ao vivo HE-AAC. */
window.RADIO_CONFIG = Object.freeze({
  name: 'Rádio Caparaó Gospel',
  slogan: 'Tocando o seu Coração',
  frequency: 'Web Rádio',
  location: 'Iúna · ES',
  // Fonte original fornecida pelo responsável da emissora.
  streamUrl: 'http://stm17.xcast.com.br:8318/;',
  // Endereço HTTPS de streaming informado/testado no navegador pelo usuário.
  // Primeira tentativa no GitHub Pages: fonte direta, sem infraestrutura extra.
  secureStreamUrl: 'https://stm17.xcast.com.br:8318/;',
  // ALTERNATIVA OPCIONAL para navegadores que não aceitam HE-AAC/headers do xCAST.
  // Se necessário, publique cloudflare-worker/worker.js e informe a URL workers.dev.
  proxyBaseUrl: '',
  whatsappNumber: '5528999482110'
});
