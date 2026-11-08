/* Rádio Caparaó Gospel — configuração. Visual e funcionalidades da Nativa FM 1.9.1 preservados. */
window.RADIO_CONFIG = Object.freeze({
  name: 'Rádio Caparaó Gospel',
  slogan: 'Tocando o seu Coração',
  frequency: 'Web Rádio',
  location: 'Iúna · ES',
  // URL HTTPS testada pelo proprietário no navegador; a barra e ponto-e-vírgula são necessários.
  streamUrl: 'https://stm17.xcast.com.br:8318/;',
  whatsappNumber: '5528999482110',
  // Opcional: endereço HTTPS do proxy instalado na Cloudflare Workers.
  // Sem proxy, o áudio tenta reprodução direta; VU e metadados dependem do CORS do xCAST.
  proxyBaseUrl: ''
});
