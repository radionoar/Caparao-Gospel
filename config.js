/* Rádio Caparaó Gospel — configuração. Visual e funcionalidades da Nativa FM 1.9.1 preservados. */
window.RADIO_CONFIG = Object.freeze({
  name: 'Rádio Caparaó Gospel',
  slogan: 'Tocando o seu Coração',
  frequency: 'Web Rádio',
  location: 'Iúna · ES',
  // URL HTTPS testada pelo proprietário no navegador; a barra e ponto-e-vírgula são necessários.
  streamUrl: 'https://stm17.xcast.com.br:8318/;',
  // Fonte OFICIAL dos metadados fornecida pela emissora (título atual).
  metadataUrl: 'https://stm17.xcast.com.br:8318/currentsong?sid=1',
  // Ponte pública opcional para texto: só usada se a leitura direta falhar por CORS/rede.
  // Recurso de terceiros, sujeito a disponibilidade. Para uso definitivo, prefira proxy próprio.
  metadataFallbackUrl: 'https://proxy.cors.dev/https://stm17.xcast.com.br:8318/currentsong?sid=1',
  whatsappNumber: '5528999482110',
  // Opcional: endereço HTTPS do proxy instalado na Cloudflare Workers.
  // Sem proxy, o áudio tenta reprodução direta; VU e metadados dependem do CORS do xCAST.
  proxyBaseUrl: ''
});
