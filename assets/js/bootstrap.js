// Carrega apenas o código necessário ao login no primeiro acesso. A lógica da
// página autenticada entra depois que a sessão existe, reduzindo parse e
// execução no caminho crítico sem mudar o fluxo do sistema.
const PAGINAS = {
  sorteio: { arquivo: 'index.min.js', iniciar: 'inicializarSorteio', texto: 'Preparando o sorteio…' },
  'julgados-cj': {
    arquivo: 'julgados.min.js',
    iniciar: 'inicializarJulgados',
    texto: 'Preparando as pautas…',
    carregamentoLocal: true
  },
  julgados: {
    arquivo: 'julgados.min.js',
    iniciar: 'inicializarJulgados',
    texto: 'Preparando as pautas…',
    carregamentoLocal: true
  },
  // A tela do Conselho é gêmea da da Câmara e mostra o mesmo indicador dentro
  // da própria lista, então carrega pelo mesmo caminho.
  'julgados-creg': {
    arquivo: 'julgados-creg.min.js',
    iniciar: 'inicializarJulgadosCreg',
    texto: 'Preparando as sessões…',
    carregamentoLocal: true
  },
  'acervo-cj': { arquivo: 'acervo.min.js', iniciar: 'inicializarAcervo', texto: 'Preparando o dashboard…' },
  acervo: { arquivo: 'acervo.min.js', iniciar: 'inicializarAcervo', texto: 'Preparando o dashboard…' },
  // Mesmo script para os dois colegiados: quem escolhe o par de funções do
  // banco é o data-colegiado do <body> (ver COLEGIADOS em acervo.js).
  'acervo-creg': { arquivo: 'acervo.min.js', iniciar: 'inicializarAcervo', texto: 'Preparando o dashboard…' }
};

const paginaAtual = PAGINAS[document.body.dataset.page];
const sessionLoading = document.getElementById('sessionLoading');

async function carregarPaginaAutenticada() {
  if (!paginaAtual) return;

  if (!paginaAtual.carregamentoLocal) {
    sessionLoading.hidden = false;
    sessionLoading.replaceChildren(criarIndicadorCarregamento(paginaAtual.texto));
  }

  try {
    await carregarScript(`assets/js/${paginaAtual.arquivo}?v=${ASSET_VERSION}`);
    // Julgados já apresenta o andamento dentro da própria lista. A chamada
    // monta esse indicador de forma síncrona antes de devolver a promessa;
    // então o loading geral pode sair sem deixar um quadro vazio ou competir
    // com o indicador menor.
    const inicializacao = window[paginaAtual.iniciar]();
    if (paginaAtual.carregamentoLocal) {
      sessionLoading.hidden = true;
      sessionLoading.replaceChildren();
    }
    await inicializacao;
    sessionLoading.hidden = true;
    sessionLoading.replaceChildren();
  } catch (err) {
    console.error(err);
    // Se o carregamento local falhar, o erro volta ao contêiner geral para não
    // depender do estado parcial que a página conseguiu montar.
    sessionLoading.hidden = false;
    const estado = document.createElement('div');
    estado.className = 'load-error';
    estado.setAttribute('role', 'alert');

    // Sessão vencida não se resolve tentando de novo: sem dizer o que houve, o
    // botão de retentativa vira um laço que sempre termina no mesmo 401.
    const sessaoVencida = err.status === 401;
    const texto = document.createElement('p');
    texto.textContent = sessaoVencida
      ? 'Sua sessão não é mais válida. Use Sair e entre novamente.'
      : `Não foi possível preparar esta página (${err.message}). Verifique sua conexão e tente novamente.`;

    estado.appendChild(texto);

    if (!sessaoVencida) {
      const tentarNovamente = document.createElement('button');
      tentarNovamente.type = 'button';
      tentarNovamente.className = 'button-secondary';
      tentarNovamente.textContent = 'Tentar novamente';
      tentarNovamente.addEventListener('click', carregarPaginaAutenticada, { once: true });
      estado.appendChild(tentarNovamente);
    }

    sessionLoading.replaceChildren(estado);
  }
}

ligarLogin(carregarPaginaAutenticada);
