// Carrega apenas o código necessário ao login no primeiro acesso. A lógica da
// página autenticada entra depois que a sessão existe, reduzindo parse e
// execução no caminho crítico sem mudar o fluxo do sistema.
const PAGINAS = {
  sorteio: { arquivo: 'index.min.js', iniciar: 'inicializarSorteio', texto: 'Preparando o sorteio…' },
  'julgados-cj': { orgao: 'CJ', familia: 'julgados', arquivo: 'julgados.min.js', iniciar: 'inicializarJulgados', texto: 'Preparando as pautas…' },
  // Mesmo script para os dois colegiados: quem escolhe a tabela, a função do
  // banco e o vocabulário é o data-colegiado do <body> (ver COLEGIADOS em julgados.js).
  'julgados-creg': { orgao: 'CREG', familia: 'julgados', arquivo: 'julgados.min.js', iniciar: 'inicializarJulgados', texto: 'Preparando as sessões…' },
  // `moldura`: a tela é um painel cuja moldura é HTML estático. O andamento
  // nasce dentro dela, no lugar da tabela, e não num card à parte — ver
  // mostrarAndamento abaixo.
  'acervo-cj': { orgao: 'CJ', familia: 'acervo', arquivo: 'acervo.min.js', iniciar: 'inicializarAcervo', texto: 'Carregando o acervo…', moldura: 'acervoPanel' },
  // Mesmo script para os dois colegiados: quem escolhe o par de funções do
  // banco é o data-colegiado do <body> (ver COLEGIADOS em acervo.js).
  'acervo-creg': { orgao: 'CREG', familia: 'acervo', arquivo: 'acervo.min.js', iniciar: 'inicializarAcervo', texto: 'Carregando o acervo…', moldura: 'acervoPanel' },
  'historico-cj': { orgao: 'CJ', familia: 'historico', arquivo: 'historico.min.js', iniciar: 'inicializarHistorico', texto: 'Carregando o histórico…', moldura: 'historicoPanel' },
  // Mesmo script para os dois colegiados, como o painel do acervo: quem escolhe
  // o vocabulário e a sigla que vai ao banco é o data-colegiado do <body>
  // (ver COLEGIADOS em historico.js).
  'historico-creg': { orgao: 'CREG', familia: 'historico', arquivo: 'historico.min.js', iniciar: 'inicializarHistorico', texto: 'Carregando o histórico…', moldura: 'historicoPanel' },
  // A primeira página sem órgão fixo: o painel administrativo atende os dois
  // colegiados e traz o seletor dentro dele. Por isso não entra por `orgao`,
  // que é o que redireciona quem abre a URL do colegiado errado, e sim por
  // `exigeAdmin` — quem decide se ela abre é o papel, não a página.
  admin: { exigeAdmin: true, arquivo: 'admin.min.js', iniciar: 'inicializarAdmin', texto: 'Preparando o painel…' },
  // A Meta 45 do papel de consulta: o mesmo módulo do painel, numa página que
  // só traz aquela aba. Quem decide se ela abre é o papel — consulta ou
  // administrador, os dois que meta_45_exigir() aceita; o administrador chega
  // à Meta pelo painel, mas um link para cá também abre para ele.
  'meta-45': { exigeConsulta: true, arquivo: 'admin.min.js', iniciar: 'inicializarAdmin', texto: 'Preparando o painel…' }
};

const DESTINOS = {
  CJ: { acervo: './acervo-cj.html', julgados: './julgados-cj.html', historico: './historico-cj.html' },
  CREG: { acervo: './acervo-creg.html', julgados: './julgados-creg.html', historico: './historico-creg.html' }
};

const paginaAtual = PAGINAS[document.body.dataset.page];
const sessionLoading = document.getElementById('sessionLoading');
let scriptAntecipado = false;

// No acervo e no histórico eram dois indicadores em fila: "Preparando…" num
// card no meio da página, ~165ms de nada, e "Carregando…" 48px abaixo, já
// dentro do painel. Não se sobrepunham, mas liam como dois carregamentos. Com
// a moldura estática na página, o andamento nasce dentro dela, no lugar da
// tabela, e a tela o assume sem recriá-lo (mostrarIndicador só troca o texto):
// um indicador só, num lugar só, do clique até a tabela. Sem a moldura no
// documento, fica o card de sempre. O nome é longo de propósito: os scripts
// clássicos dividem o escopo global, e admin.js já tem uma `function moldura`
// — um `const moldura` aqui derrubava o painel inteiro (ver test_assets.mjs).
const molduraDaPagina = paginaAtual?.moldura ? document.getElementById(paginaAtual.moldura) : null;
const indicadorDaMoldura = molduraDaPagina ? document.getElementById('painelCarregando') : null;

function mostrarAndamento() {
  if (!molduraDaPagina || !indicadorDaMoldura) {
    sessionLoading.hidden = false;
    sessionLoading.replaceChildren(criarIndicadorCarregamento(paginaAtual.texto));
    return;
  }
  document.querySelector('[data-login-only]').hidden = true;
  molduraDaPagina.hidden = false;
  // O ponto de status do rodapé lê aria-busy: sem ele, "Carregando…" saía ao
  // lado do verde de "atualizado" enquanto a permissão era consultada.
  molduraDaPagina.setAttribute('aria-busy', 'true');
  const tabela = molduraDaPagina.querySelector('.table-scroll');
  if (tabela) tabela.hidden = true;
  mostrarIndicador(indicadorDaMoldura, paginaAtual.texto);
}

// Falha antes de a tela assumir: a mensagem (ou o login) mora no card de
// sessão, que só aparece com o painel fora da tela.
function recolherMoldura() {
  if (!molduraDaPagina || !indicadorDaMoldura) return;
  molduraDaPagina.hidden = true;
  molduraDaPagina.removeAttribute('aria-busy');
  indicadorDaMoldura.hidden = true;
  indicadorDaMoldura.replaceChildren();
  document.querySelector('[data-login-only]').hidden = false;
}

// O script da página desce junto com a consulta de permissões, e não depois
// dela: eram duas idas à rede em fila antes de a tela existir. `preload` só
// baixa — quem executa continua sendo o carregarScript, depois do porteiro. O
// painel fica de fora: lá a consulta decide se o módulo é baixado.
function anteciparScript(src) {
  if (scriptAntecipado || paginaAtual.exigeAdmin || paginaAtual.exigeConsulta) return;
  scriptAntecipado = true;
  const link = document.createElement('link');
  link.rel = 'preload';
  link.as = 'script';
  link.href = src;
  document.head.append(link);
}

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
  mostrarAndamento();
  const inicioDoAndamento = Date.now();
  const src = `assets/js/${paginaAtual.arquivo}?v=${ASSET_VERSION}`;
  anteciparScript(src);

  try {
    // Uma consulta só traz órgão e papel: o porteiro de toda página, o atalho
    // do painel e os cards do papel de consulta saem da mesma resposta. Com
    // uma consulta por papel, a tela inicial esperava duas, e a falha de uma
    // delas mostrava ao papel de consulta os caminhos que o banco lhe recusa.
    const papeis = await buscarPapeis();
    if (!(papeis instanceof Map) || papeis.size === 0) throw erroSemPermissao();

    const orgaos = new Set(papeis.keys());
    const comPapel = (...aceitos) => new Set([...papeis]
      .filter(([, papel]) => aceitos.includes(papel))
      .map(([orgao]) => orgao));
    const consultados = comPapel('consulta', 'consulta_historico');
    const administrados = comPapel('admin');
    const historicos = comPapel('operador', 'admin', 'consulta_historico', 'acervo_historico');
    // Sorteio e julgados exigem papel pleno. O histórico também aceita o
    // papel de leitura ampliada; o acervo abre em qualquer órgão autorizado.
    const plenos = comPapel('operador', 'admin');
    const permitidos = paginaAtual.familia === 'acervo' ? orgaos
      : paginaAtual.familia === 'historico' ? historicos : plenos;

    const destino = resolverDestinoPermitido(document.body.dataset.page, permitidos);
    if (destino) {
      redirecionarSemTransicao(destino);
      return;
    }

    // As páginas sem órgão fixo entram pelo papel, e os órgãos dele montam o
    // seletor: o painel é do administrador; a Meta 45, do administrador e da
    // consulta, como meta_45_exigir() no banco. As demais não usam o argumento.
    const orgaosDaPagina = paginaAtual.exigeAdmin ? administrados
      : paginaAtual.exigeConsulta ? comPapel('admin', 'consulta', 'consulta_historico')
        : null;

    // Quem tem acesso, só não àquela tela — a consulta num favorito de
    // julgados, o operador num link do painel —, volta para a inicial. O login
    // seria errado: sair() revoga a sessão de todas as abas e diz que a pessoa
    // não tem acesso nenhum.
    if ((paginaAtual.orgao && !permitidos.has(paginaAtual.orgao)) || orgaosDaPagina?.size === 0) {
      redirecionarSemTransicao('./index.html');
      return;
    }

    aplicarVisibilidadePorOrgao(orgaos);
    aplicarVisibilidadeAdmin(administrados);
    aplicarVisibilidadeConsulta(consultados, plenos);
    aplicarVisibilidadeHistorico(historicos);

    await carregarScript(src);
    // O card "Preparando…" segue a regra de todo indicador: ou não aparece,
    // ou fica tempo de ser lido. Sem isto, voltar do acervo à tela inicial com
    // a permissão em ~400ms mostrava o indicador pleno por ~80ms e o tirava —
    // um lampejo. A espera vem ANTES de a tela montar, para os dois não
    // dividirem a tela. No painel com moldura não há espera: o indicador segue
    // dentro da tela, que o assume sem recriá-lo.
    if (!molduraDaPagina || !indicadorDaMoldura) await aguardarIndicador(inicioDoAndamento);
    // Toda tela monta a própria moldura de forma síncrona antes de buscar dado
    // algum — a lista de pautas, o painel do acervo/histórico, o seletor de
    // modalidade — e põe o próprio indicador dentro dela. Então o indicador
    // geral sai aqui, sem deixar quadro vazio e sem competir com o menor.
    // O painel recebe os órgãos que pode administrar — é o que monta o seletor,
    // e é dado que só o bootstrap tem. As demais telas ignoram o argumento:
    // quem escolhe o colegiado nelas é o data-colegiado do <body>.
    const inicializacao = window[paginaAtual.iniciar](orgaosDaPagina);
    sessionLoading.hidden = true;
    sessionLoading.replaceChildren();
    await inicializacao;
  } catch (err) {
    console.error(err);
    recolherMoldura();
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
    // Sessão vencida — um "Lembrar-me" cujo refresh token o servidor já não
    // aceita — não se resolve tentando de novo, e mandar a pessoa usar Sair é
    // pedir um passo que o sistema pode dar sozinho. Descarta os tokens e
    // recarrega a própria página: ela abre no login, e depois de entrar a
    // pessoa continua onde estava. Recarregar, e não só reexibir o login, porque
    // o 401 pode chegar com a tela da página já montada. reload(), e não
    // replace(location.href): com #fragmento na URL (o link "pular para o
    // conteúdo" deixa um) o replace só rola a página e o indicador fica no ar.
    if (err.status === 401) {
      await sair().catch(() => {});
      location.reload();
      return;
    }
    // Se o carregamento local falhar, o erro volta ao contêiner geral para não
    // depender do estado parcial que a página conseguiu montar.
    sessionLoading.hidden = false;
    const estado = document.createElement('div');
    estado.className = 'load-error';
    estado.setAttribute('role', 'alert');

    // A frase diz o que fazer; a mensagem da exceção desce para a linha de
    // apoio, como em mostrarErro (supabase.js).
    const texto = document.createElement('p');
    texto.textContent = 'Não foi possível preparar esta página. Verifique sua conexão e tente novamente.';
    const detalhe = document.createElement('p');
    detalhe.className = 'load-error-detalhe';
    detalhe.textContent = `Detalhe técnico: ${err.message}`;

    const tentarNovamente = document.createElement('button');
    tentarNovamente.type = 'button';
    tentarNovamente.className = 'button-secondary';
    tentarNovamente.textContent = 'Tentar novamente';
    tentarNovamente.addEventListener('click', carregarPaginaAutenticada, { once: true });

    estado.append(texto, detalhe, tentarNovamente);
    sessionLoading.replaceChildren(estado);
  }
}

ligarLogin(carregarPaginaAutenticada);
