// Carrega apenas o código necessário ao login no primeiro acesso. A lógica da
// página autenticada entra depois que a sessão existe, reduzindo parse e
// execução no caminho crítico sem mudar o fluxo do sistema.
const PAGINAS = {
  sorteio: { arquivo: 'index.min.js', iniciar: 'inicializarSorteio', texto: 'Preparando o sorteio…' },
  'julgados-cj': {
    orgao: 'CJ',
    familia: 'julgados',
    arquivo: 'julgados.min.js',
    iniciar: 'inicializarJulgados',
    texto: 'Preparando as pautas…'
  },
  // A tela do Conselho é gêmea da da Câmara e mostra o mesmo indicador dentro
  // da própria lista, então carrega pelo mesmo caminho.
  'julgados-creg': {
    orgao: 'CREG',
    familia: 'julgados',
    arquivo: 'julgados-creg.min.js',
    iniciar: 'inicializarJulgadosCreg',
    texto: 'Preparando as sessões…'
  },
  'acervo-cj': { orgao: 'CJ', familia: 'acervo', arquivo: 'acervo.min.js', iniciar: 'inicializarAcervo', texto: 'Preparando o dashboard…' },
  // Mesmo script para os dois colegiados: quem escolhe o par de funções do
  // banco é o data-colegiado do <body> (ver COLEGIADOS em acervo.js).
  'acervo-creg': { orgao: 'CREG', familia: 'acervo', arquivo: 'acervo.min.js', iniciar: 'inicializarAcervo', texto: 'Preparando o dashboard…' },
  'historico-cj': { orgao: 'CJ', familia: 'historico', arquivo: 'historico.min.js', iniciar: 'inicializarHistorico', texto: 'Preparando o histórico…' },
  // Mesmo script para os dois colegiados, como o painel do acervo: quem escolhe
  // o vocabulário e a sigla que vai ao banco é o data-colegiado do <body>
  // (ver COLEGIADOS em historico.js).
  'historico-creg': { orgao: 'CREG', familia: 'historico', arquivo: 'historico.min.js', iniciar: 'inicializarHistorico', texto: 'Preparando o histórico…' },
  // A primeira página sem órgão fixo: o painel administrativo atende os dois
  // colegiados e traz o seletor dentro dele. Por isso não entra por `orgao`,
  // que é o que redireciona quem abre a URL do colegiado errado, e sim por
  // `exigeAdmin` — quem decide se ela abre é o papel, não a página.
  admin: { exigeAdmin: true, arquivo: 'admin.min.js', iniciar: 'inicializarAdmin', texto: 'Preparando o painel…' }
};

const DESTINOS = {
  CJ: { acervo: './acervo-cj.html', julgados: './julgados-cj.html', historico: './historico-cj.html' },
  CREG: { acervo: './acervo-creg.html', julgados: './julgados-creg.html', historico: './historico-creg.html' }
};

const paginaAtual = PAGINAS[document.body.dataset.page];
const sessionLoading = document.getElementById('sessionLoading');

function resolverDestinoPermitido(paginaId, orgaos) {
  const pagina = PAGINAS[paginaId];
  if (!pagina?.orgao || orgaos.has(pagina.orgao)) return null;

  for (const orgao of ['CJ', 'CREG']) {
    if (orgaos.has(orgao)) return DESTINOS[orgao][pagina.familia] || null;
  }
  return null;
}

async function carregarPaginaAutenticada() {
  if (!paginaAtual) return;

  // O indicador geral cobre o que acontece antes de a tela existir: a consulta
  // de permissões e o download do script dela. Antes ele era suprimido nas
  // telas de julgados, que mostram o andamento dentro da própria lista — só que
  // essa lista só é montada DEPOIS da consulta de permissões, e no intervalo a
  // página ficava literalmente vazia (`main.innerText === ''`), que é o quadro
  // em que a transição entre páginas aterrissava.
  sessionLoading.hidden = false;
  sessionLoading.replaceChildren(criarIndicadorCarregamento(paginaAtual.texto));

  try {
    const orgaos = await buscarOrgaosAutorizados();
    if (!(orgaos instanceof Set) || orgaos.size === 0) throw erroSemPermissao();

    const destino = resolverDestinoPermitido(document.body.dataset.page, orgaos);
    if (destino) {
      redirecionarSemTransicao(destino);
      return;
    }
    if (paginaAtual.orgao && !orgaos.has(paginaAtual.orgao)) throw erroSemPermissao();

    aplicarVisibilidadePorOrgao(orgaos);

    // O papel de administrador custa uma consulta a mais, então só é buscado
    // onde muda alguma coisa: no próprio painel, e na tela inicial, que decide
    // se mostra o link para ele. As outras páginas seguem com uma consulta só.
    let orgaosAdmin = new Set();
    if (paginaAtual.exigeAdmin) {
      // Aqui a consulta é o porteiro da página: ela vem ANTES do download, para
      // não buscar o módulo do painel de quem não pode abri-lo.
      orgaosAdmin = await buscarOrgaosAdministrados();
      if (orgaosAdmin.size === 0) throw erroSemPermissao();
      aplicarVisibilidadeAdmin(orgaosAdmin);
    } else if (document.querySelector('[data-admin]')) {
      // Fora do painel a consulta decide UMA coisa: se um atalho opcional
      // aparece. Sem o catch, uma falha nela — RPC indisponível, ambiente sem a
      // migração aplicada — trocava a tela inicial inteira pelo erro de
      // carregamento. Sem resposta, o atalho fica escondido, que é o mesmo
      // estado de quem não administra nada.
      //
      // E como nada na tela inicial depende dela, aqui ela só é DISPARADA, nunca
      // aguardada. Esperá-la — antes do download ou logo depois dele — segurava
      // "Preparando o sorteio…" no ar até a resposta chegar, e com a rede lenta
      // isso é o tempo-limite inteiro, só para decidir se um cartão aparece. O
      // atalho surge quando a resposta vier, com a tela já de pé.
      buscarOrgaosAdministrados()
        .catch(() => new Set())
        .then(orgaos => aplicarVisibilidadeAdmin(orgaos));
    }

    await carregarScript(`assets/js/${paginaAtual.arquivo}?v=${ASSET_VERSION}`);
    // Toda tela monta a própria moldura de forma síncrona antes de buscar dado
    // algum — a lista de pautas, o painel do acervo/histórico, o seletor de
    // modalidade — e põe o próprio indicador dentro dela. Então o indicador
    // geral sai aqui, sem deixar quadro vazio e sem competir com o menor.
    // O painel recebe os órgãos que pode administrar — é o que monta o seletor,
    // e é dado que só o bootstrap tem. As demais telas ignoram o argumento:
    // quem escolhe o colegiado nelas é o data-colegiado do <body>.
    const inicializacao = window[paginaAtual.iniciar](orgaosAdmin);
    sessionLoading.hidden = true;
    sessionLoading.replaceChildren();
    await inicializacao;
  } catch (err) {
    console.error(err);
    if (err.semPermissao) {
      // sair() revoga o refresh token no servidor antes de limpar a aba; com
      // encerrarSessao() sozinho, o token recém-emitido no login seguiria
      // válido até expirar. Falha de rede na revogação não muda a tela: o
      // finally de sair() já descartou as credenciais desta aba.
      await sair().catch(() => {});
      document.getElementById('loginScreen').hidden = false;
      document.getElementById('btnSair').hidden = true;
      document.getElementById('loginErro').textContent = err.message;
      sessionLoading.hidden = true;
      sessionLoading.replaceChildren();
      return;
    }
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
