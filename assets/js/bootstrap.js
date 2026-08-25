// Carrega apenas o código necessário ao login no primeiro acesso. A lógica da
// página autenticada entra depois que a sessão existe, reduzindo parse e
// execução no caminho crítico sem mudar o fluxo do sistema.
const PAGINAS = {
  sorteio: { arquivo: 'index.min.js', iniciar: 'inicializarSorteio', texto: 'Preparando o sorteio…' },
  julgados: { arquivo: 'julgados.min.js', iniciar: 'inicializarJulgados', texto: 'Preparando as pautas…' },
  acervo: { arquivo: 'acervo.min.js', iniciar: 'inicializarAcervo', texto: 'Preparando o dashboard…' }
};

const paginaAtual = PAGINAS[document.body.dataset.page];
const sessionLoading = document.getElementById('sessionLoading');

async function carregarPaginaAutenticada() {
  if (!paginaAtual) return;

  sessionLoading.hidden = false;
  sessionLoading.replaceChildren(criarIndicadorCarregamento(paginaAtual.texto));

  try {
    await carregarScript(`assets/js/${paginaAtual.arquivo}?v=${ASSET_VERSION}`);
    // A inicialização também pode buscar dados. O loading geral só sai depois
    // que a superfície inteira estiver pronta para ser revelada.
    await window[paginaAtual.iniciar]();
    sessionLoading.hidden = true;
    sessionLoading.replaceChildren();
  } catch (_) {
    const estado = document.createElement('div');
    estado.className = 'load-error';
    estado.setAttribute('role', 'alert');

    const texto = document.createElement('p');
    texto.textContent = 'Não foi possível preparar esta página. Verifique sua conexão e tente novamente.';

    const tentarNovamente = document.createElement('button');
    tentarNovamente.type = 'button';
    tentarNovamente.className = 'button-secondary';
    tentarNovamente.textContent = 'Tentar novamente';
    tentarNovamente.addEventListener('click', carregarPaginaAutenticada, { once: true });

    estado.append(texto, tentarNovamente);
    sessionLoading.replaceChildren(estado);
  }
}

ligarLogin(carregarPaginaAutenticada);
