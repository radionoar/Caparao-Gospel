/* Rádio Caparaó Gospel — classificação do modo PWA — classificação antes da primeira pintura. */
    // Apenas a janela de aplicativo pode exibir o rádio. Navegador comum: página de instalação.
    document.documentElement.dataset.pwaDisplay = (
      (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches) ||
      window.navigator.standalone === true
    ) ? 'standalone' : 'browser';
