// Painel administrativo: correção dos registros já gravados.
//
// É a porta que registrar_votos anunciou quando explicou por que campo em
// branco não apaga decisão gravada — "DESFAZER é decisão administrativa, e vai
// ter porta própria". Aqui ela existe, e só para quem tem papel de admin.
//
// A navegação é por DATA, nunca por número de processo. Quando o próprio
// número está errado — que é um dos defeitos a corrigir — procurar por ele não
// acharia nada. Por isso as duas portas são "a sessão do dia tal" e "o sorteio
// do dia tal", e o número é editável de dentro delas.
//
// Nada é gravado sem duas etapas: o formulário monta a alteração, e a tela de
// confirmação mostra o que muda de quê para quê. Na correção de acervo mostra
// também os julgados que vão junto, lidos de admin_julgados_do_acervo.

const VOCABULARIO = {
  CJ: {
    nome: 'Câmara de Julgamento',
    sufixo: 'cj',
    destino: 'Relator',
    destinoPadrao: /^CJ[1-9][0-9]*$/,
    decisao: 'Defesa',
    campoDestino: 'relator',
    votos: ['Manter', 'Anular', 'Vista'],
    status: ['Julgado', 'Retornou', 'Retirado', 'Vista'],
    assuntoObrigatorio: true,
    temInteressado: false
  },
  CREG: {
    nome: 'Conselho Regulador',
    sufixo: 'creg',
    destino: 'Unidade',
    destinoPadrao: /^CREG[1-9][0-9]*$/,
    decisao: 'Recurso',
    campoDestino: 'unidade',
    votos: ['Manter', 'Anular', 'Aprovação', 'Indeferimento', 'Extinção', 'Retirado', 'Vista'],
    status: ['Julgado', 'Retirado', 'Vista', 'Sobrestado', 'Prejudicado'],
    assuntoObrigatorio: false,
    temInteressado: true
  }
};

const OPERACOES_LEGIVEIS = {
  corrigir_julgado: 'Correção de julgado',
  religar_julgado: 'Religação ao acervo',
  corrigir_acervo: 'Correção de distribuição',
  redistribuir: 'Redistribuição',
  corrigir_processo: 'Correção do número do processo'
};

// A auditoria é lida por quem opera o sistema, não por quem o escreveu: nome de
// tabela e chave de coluna do banco não dizem nada a uma secretária executiva.
const TABELAS_LEGIVEIS = {
  julgados_cj: 'Julgado', julgados_creg: 'Julgado',
  acervo_cj: 'Distribuição', acervo_creg: 'Distribuição'
};

const CAMPOS_LEGIVEIS = {
  voto: 'Voto',
  status: 'Status',
  // Toda religação observa acervo_id, e uma correção de data pode mexer nele
  // por baixo: sem rótulo, a operação mais comum da auditoria era a única que
  // aparecia com nome de coluna de banco.
  acervo_id: 'Distribuição vinculada',
  pauta: 'Número da pauta',
  data_sessao: 'Data da sessão',
  data_distribuicao: 'Data da distribuição',
  num_processo: 'Número do processo',
  assunto: 'Assunto',
  ordem: 'Ordem no sorteio',
  interessado: 'Interessado',
  defesa: 'Defesa',
  recurso: 'Recurso',
  relator: 'Relator',
  unidade: 'Unidade'
};

// De onde veio a linha da distribuição: o valor cru do banco em minúsculas
// aparecia dentro de um selo, ao lado de datas já formatadas. São os três
// valores que as checks admitem — a Câmara aceita sorteio e planilha, o
// Conselho aceita também ata —, e faltar um deles devolve o selo ao valor cru.
const ORIGENS_LEGIVEIS = {
  sorteio: 'Sorteio eletrônico',
  planilha: 'Planilha importada',
  ata: 'Ata publicada'
};

// O escopo da correção de número decide quantos registros mudam de nome — e se
// o vínculo dos julgados com o acervo cai. Os três valores do banco em minúscula
// solta não diziam isso a ninguém: 'tudo', 'acervo' e 'julgados' apareciam como
// rótulo visível de um <select>, no único arquivo que traduz todo valor de banco
// antes de mostrá-lo.
const ESCOPOS = [
  { valor: 'tudo', rotulo: 'Distribuições e julgados' },
  { valor: 'acervo', rotulo: 'Somente as distribuições' },
  { valor: 'julgados', rotulo: 'Somente os julgados' }
];
const escopoLegivel = valor => ESCOPOS.find(e => e.valor === valor)?.rotulo || valor;

const campoLegivel = nome => CAMPOS_LEGIVEIS[nome] || nome;

// A meta de 45 dias chega por mês; o agrupamento é só quantos meses cabem num
// período. O valor de cada chave é o `value` do <select id="metaAgrupamento">.
const PERIODOS = {
  1: ['mês', 'meses'],
  2: ['bimestre', 'bimestres'],
  3: ['trimestre', 'trimestres'],
  4: ['quadrimestre', 'quadrimestres'],
  6: ['semestre', 'semestres']
};
const MESES = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
               'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// "5 sessão(ões) registrada(s)" pede que a pessoa monte a frase de cabeça, e a
// contagem que resolveria isso já está ali do lado.
function plural(quantidade, singular, plural) {
  return `${quantidade} ${quantidade === 1 ? singular : plural}`;
}

const seletorOrgaoCard = document.getElementById('seletorOrgaoCard');
const seletorOrgao = document.getElementById('seletorOrgao');
const abas = document.getElementById('abas');
const painel = document.getElementById('adminPainel');
const painelConteudo = document.getElementById('painelConteudo');
const painelTitulo = document.getElementById('painelTitulo');
const painelEyebrow = document.getElementById('painelEyebrow');
const metaFiltros = document.getElementById('metaFiltros');
const metaResumo = document.getElementById('metaResumo');
const metaAno = document.getElementById('metaAno');
const metaAgrupamento = document.getElementById('metaAgrupamento');
const painelDescricao = document.getElementById('painelDescricao');
const painelTabela = document.getElementById('painelTable');
const painelCarregando = document.getElementById('painelCarregando');
const painelErro = document.getElementById('painelErro');
const painelVazio = document.getElementById('painelVazio');
const painelVazioTitulo = document.getElementById('painelVazioTitulo');
const painelVazioTexto = document.getElementById('painelVazioTexto');
const painelErroDetalhe = document.getElementById('painelErroDetalhe');
const painelStatus = document.getElementById('painelStatus');
const painelHint = document.getElementById('painelHint');
const tabelaInstrucao = document.getElementById('tabelaInstrucao');
const painelTabelaWrap = document.querySelector('.admin-table-wrap');
const painelStatusBloco = document.querySelector('.admin-panel-status');
const adminOrgaoAtual = document.getElementById('adminOrgaoAtual');
const btnTentarNovamente = document.getElementById('btnTentarNovamente');
const btnMaisAntigas = document.getElementById('btnMaisAntigas');
const btnVoltar = document.getElementById('btnVoltar');
const btnVoltarInicio = document.getElementById('btnVoltarInicio');

const dialogo = document.getElementById('edicaoDialog');
const edicaoForm = document.getElementById('edicaoForm');
const edicaoTitulo = document.getElementById('edicaoTitulo');
const edicaoResumo = document.getElementById('edicaoResumo');
const edicaoCampos = document.getElementById('edicaoCampos');
const edicaoMotivo = document.getElementById('edicaoMotivo');
const edicaoEtapaCampos = document.getElementById('edicaoEtapaCampos');
const edicaoEtapaConfirmacao = document.getElementById('edicaoEtapaConfirmacao');
const edicaoDelta = document.getElementById('edicaoDelta');
const edicaoImpacto = document.getElementById('edicaoImpacto');
const edicaoImpactoTitulo = document.getElementById('edicaoImpactoTitulo');
const edicaoImpactoLista = document.getElementById('edicaoImpactoLista');
const edicaoErro = document.getElementById('edicaoErro');
const edicaoEtapaRotulo = document.getElementById('edicaoEtapaRotulo');
const btnAvancar = document.getElementById('btnAvancarEdicao');
const btnCancelar = document.getElementById('btnCancelarEdicao');
const btnFecharEdicao = document.getElementById('btnFecharEdicao');

let orgao = null;
let aba = 'sessoes';
// Onde estamos dentro da aba: null é a lista de datas; preenchido é o detalhe
// de uma data. É o que o botão Voltar desfaz.
let detalhe = null;
// Cada carregamento carrega um número. Resposta de pedido velho é descartada:
// trocar de aba durante uma consulta lenta não pode repintar a tabela errada.
let pedido = 0;
let dialogoAtual = null;

// A auditoria é a única visão que cresce sem limite: uma linha por correção,
// para sempre. Pedir "as 100 mais recentes" e rotular o resultado como "100
// correções listadas" fazia a página parecer o rastro inteiro. Agora a página é
// uma página, o rodapé diz isso, e o cursor que admin_auditoria já aceitava
// (p_antes_de) busca as anteriores.
const PAGINA_AUDITORIA = 100;
let auditoria = { linhas: [], cursor: null, temMais: false };
const reiniciarAuditoria = () => { auditoria = { linhas: [], cursor: null, temMais: false }; };

// A última resposta de admin_meta_45: trocar ano ou agrupamento repinta a partir
// dela, sem nova consulta.
let metaLinhas = [];

// ── Formatação ───────────────────────────────────────────────────────────────
// Hoje em aaaa-mm-dd pelo calendário LOCAL: toISOString() converte para UTC e,
// em fuso negativo depois das 21h, devolveria amanhã — que é justamente o valor
// que o `max` dos campos de data existe para barrar.
function hojeISO() {
  const agora = new Date();
  const doisDigitos = n => String(n).padStart(2, '0');
  return `${agora.getFullYear()}-${doisDigitos(agora.getMonth() + 1)}-${doisDigitos(agora.getDate())}`;
}

// aaaa-mm-dd → dd/mm/aaaa sem passar por Date: o construtor lê data pura como
// UTC e, em fuso negativo, devolveria o dia anterior.
function dataBR(iso) {
  if (!iso) return '—';
  const [ano, mes, dia] = String(iso).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

function dataHoraBR(carimbo) {
  if (!carimbo) return '—';
  const instante = new Date(carimbo);
  return Number.isNaN(instante.getTime())
    ? '—'
    : `${instante.toLocaleDateString('pt-BR')} ${instante.toLocaleTimeString('pt-BR', {
        hour: '2-digit', minute: '2-digit'
      })}`;
}

const vazio = valor => valor === null || valor === undefined || valor === '';
const ou = valor => vazio(valor) ? '—' : String(valor);

// O valor como a pessoa o vê na confirmação e na auditoria: null é ausência de
// decisão, e "vazio" diz isso melhor que uma célula em branco que parece bug.
function legivel(valor) {
  if (vazio(valor)) return '(vazio)';
  if (valor === true) return 'Sim';
  if (valor === false) return 'Não';
  if (typeof valor === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(valor)) return dataBR(valor);
  return String(valor);
}

function celula(conteudo, tag = 'td', classe = '') {
  const el = document.createElement(tag);
  if (tag === 'th') el.scope = 'col';
  if (classe) el.className = classe;
  // Duck typing em vez de `instanceof Node`: o global Node é do navegador, e
  // este arquivo também roda no escopo isolado dos testes, que não o tem.
  if (conteudo !== null && typeof conteudo === 'object') el.appendChild(conteudo);
  else el.textContent = String(conteudo);
  return el;
}

function badge(rotulo, tom = 'neutro') {
  const elemento = document.createElement('span');
  elemento.className = `admin-badge admin-badge-${tom}`;
  elemento.textContent = rotulo;
  return elemento;
}

// Um travessão dentro de um selo parece campo quebrado, e no selo de status a
// ausência ainda herdava a cor de alerta — a falta de registro era pintada como
// se fosse um aviso. Sem valor, sai texto simples.
function valorOuSelo(valor, tom) {
  if (vazio(valor)) {
    const traco = document.createElement('span');
    traco.className = 'sem-valor';
    traco.textContent = '—';
    return traco;
  }
  return badge(String(valor), tom);
}

function botaoDeLinha(rotulo, aoClicar, { tom = 'secundario' } = {}) {
  const botao = document.createElement('button');
  botao.type = 'button';
  botao.className = `admin-acao admin-acao-${tom}`;
  botao.textContent = rotulo;
  botao.addEventListener('click', aoClicar);
  return botao;
}

function celulaDeAcoes(botoes) {
  const grupo = document.createElement('div');
  grupo.className = 'admin-acoes';
  botoes.forEach(botao => grupo.appendChild(botao));
  return celula(grupo, 'td', 'historico-acao');
}

// ── Moldura ──────────────────────────────────────────────────────────────────
// O ponto do rodapé é o único sinal de cor do painel: deixá-lo verde ao lado de
// "não foi possível carregar" faz a cor contradizer o texto justamente nos dois
// estados em que ela teria algo a dizer.
function situacao(estadoAtual) {
  if (painelStatusBloco) painelStatusBloco.dataset.estado = estadoAtual;
}

function estado({ carregando = false, erro = '', detalhe = '', vazioTitulo = '', vazioTexto = '' } = {}) {
  painelCarregando.hidden = !carregando;
  if (carregando) {
    painelCarregando.replaceChildren(criarIndicadorCarregamento('Carregando…'));
  } else {
    painelCarregando.replaceChildren();
  }

  painelErro.hidden = !erro;
  if (erro) {
    painelErro.querySelector('p').textContent = erro;
    // O detalhe técnico ajuda quem for investigar, mas não pode ocupar o lugar
    // da frase que diz o que fazer agora.
    painelErroDetalhe.textContent = detalhe ? `Detalhe técnico: ${detalhe}` : '';
    painelErroDetalhe.hidden = !detalhe;
  }

  painelVazio.hidden = !vazioTitulo;
  if (vazioTitulo) {
    painelVazioTitulo.textContent = vazioTitulo;
    painelVazioTexto.textContent = vazioTexto;
  }

  painelConteudo.setAttribute('aria-busy', String(carregando));
}

// Uma coluna é ou um rótulo, ou `{ rotulo, eixo }`. Três eixos, e cada um
// responde a uma pergunta diferente que a pessoa faz na tabela:
//
//   (padrão)  texto que se lê — alinha à esquerda, onde o olho começa.
//   'numero'  valor que se compara entre linhas (pauta, contagem, ordem,
//             hora) — alinha à direita, para as unidades ficarem no mesmo
//             eixo vertical; é o que torna 9 e 29 comparáveis de relance.
//   'centro'  rótulo curto e fechado (selo de estado, código de cadeira) —
//             centraliza, porque não há dígito para alinhar nem leitura
//             corrida para ancorar.
//
// O eixo vai para o cabeçalho e para a célula ao mesmo tempo: cabeçalho e dado
// em eixos diferentes fazem a tabela parecer torta mesmo estando correta.
const rotuloDaColuna = coluna => (typeof coluna === 'string' ? coluna : coluna.rotulo);
const eixoDaColuna = coluna => (typeof coluna === 'string' ? '' : coluna.eixo || '');
const CLASSES_DE_EIXO = Object.freeze({
  numero: 'col-numero',
  centro: 'col-centro',
  acoes: 'col-acoes'
});
const classeDoEixo = coluna => {
  const eixo = eixoDaColuna(coluna);
  return CLASSES_DE_EIXO[eixo] || '';
};

function cabecalho(colunas) {
  const thead = document.createElement('thead');
  const tr = document.createElement('tr');
  colunas.forEach(coluna => tr.appendChild(celula(rotuloDaColuna(coluna), 'th', classeDoEixo(coluna))));
  thead.appendChild(tr);
  return thead;
}

function desenhar(colunas, linhas) {
  const tbody = document.createElement('tbody');
  linhas.forEach(celulas => {
    const tr = document.createElement('tr');
    celulas.forEach((c, indice) => {
      c.dataset.label = rotuloDaColuna(colunas[indice]);
      const classe = classeDoEixo(colunas[indice]);
      if (classe) c.classList.add(classe);
      tr.appendChild(c);
    });
    tbody.appendChild(tr);
  });
  painelTabela.replaceChildren(cabecalho(colunas), tbody);
  medirRolagem();
}

// A dica e a parada de tabulação só aparecem quando há de fato o que rolar.
function medirRolagem() {
  if (!painelTabelaWrap) return;
  const rolavel = painelTabelaWrap.scrollWidth > painelTabelaWrap.clientWidth + 1;
  painelTabelaWrap.tabIndex = rolavel ? 0 : -1;
  tabelaInstrucao.hidden = !rolavel;
}

function definirVisaoTabela(visao) {
  painelTabela.dataset.visao = visao;
  painelTabela.dataset.orgao = orgao;
}

// ── Seleção de órgão e de aba ────────────────────────────────────────────────
function selecionarOrgao(novo) {
  orgao = novo;
  adminOrgaoAtual.textContent = VOCABULARIO[orgao].nome;
  seletorOrgao.querySelectorAll('[data-orgao-admin]').forEach(botao => {
    botao.setAttribute('aria-pressed', String(botao.dataset.orgaoAdmin === orgao));
    botao.classList.toggle('is-selected', botao.dataset.orgaoAdmin === orgao);
  });
  detalhe = null;
  return carregar();
}

function selecionarAba(nova) {
  aba = nova;
  abas.querySelectorAll('[data-aba]').forEach(botao => {
    const selecionada = botao.dataset.aba === aba;
    botao.setAttribute('aria-selected', String(selecionada));
    botao.setAttribute('tabindex', selecionada ? '0' : '-1');
    if (selecionada) painelConteudo.setAttribute('aria-labelledby', botao.id);
  });
  detalhe = null;
  return carregar();
}

function navegarAbas(evento) {
  const botoes = [...abas.querySelectorAll('[data-aba]')];
  const atual = evento.currentTarget || evento.target;
  const indice = botoes.indexOf(atual);
  if (indice < 0) return;

  let destino;
  if (evento.key === 'ArrowRight') destino = (indice + 1) % botoes.length;
  else if (evento.key === 'ArrowLeft') destino = (indice - 1 + botoes.length) % botoes.length;
  else if (evento.key === 'Home') destino = 0;
  else if (evento.key === 'End') destino = botoes.length - 1;
  else return;

  evento.preventDefault();
  botoes[destino].focus();
  selecionarAba(botoes[destino].dataset.aba);
}

// ── Carregamento ─────────────────────────────────────────────────────────────
// A identidade da visão — título, descrição, dica e o data-visao que dá as
// larguras de coluna — é decidida pelo par (aba, detalhe), e os dois são
// conhecidos ANTES de a consulta sair. Por isso a moldura é montada aqui e não
// dentro de cada pintar*: quando a consulta falhava, o cabeçalho continuava
// descrevendo a aba anterior e a tabela mantinha o layout dela, de modo que a
// pessoa lia "não foi possível carregar" sob um título de outro lugar.
function moldura() {
  // Filtro e resumo da meta só existem com a resposta dela na tela: durante a
  // consulta, o resumo do colegiado anterior ao lado da tabela vazia mentiria.
  metaFiltros.hidden = true;
  metaResumo.hidden = true;

  if (detalhe?.tipo === 'sessao') {
    definirVisaoTabela('processos-sessao');
    return tituloDoPainel(
      `Sessão de ${dataBR(detalhe.data)}${vazio(detalhe.pauta) ? '' : ` · pauta ${detalhe.pauta}`}`,
      'Corrija voto, status, pauta ou a data da sessão. Religar refaz o vínculo com o acervo.',
      'Escolha uma ação na linha do processo que precisa de ajuste.');
  }
  if (detalhe?.tipo === 'sorteio') {
    definirVisaoTabela('processos-sorteio');
    return tituloDoPainel(`Distribuição de ${dataBR(detalhe.data)}`,
      'Corrigir alcança também os julgados que copiaram este processo; redistribuir, não.',
      'Escolha uma ação na linha do processo que precisa de ajuste.');
  }
  if (aba === 'sessoes') {
    definirVisaoTabela('sessoes');
    return tituloDoPainel('Sessões de julgamento',
      'Selecione a data da sessão para corrigir voto, status, pauta ou a própria data.',
      'Abra uma sessão para consultar seus processos.');
  }
  if (aba === 'sorteios') {
    definirVisaoTabela('sorteios');
    // Aba, título, botão e rodapé diziam sorteio, distribuição e rodada para o
    // mesmo registro. "Distribuição" é o termo que cobre os dois casos: a linha
    // pode ter vindo do sorteio eletrônico ou de uma ata publicada, e chamar de
    // sorteio a que veio da ata seria falso.
    return tituloDoPainel('Distribuições registradas',
      'Selecione a data da distribuição para corrigir como um processo foi distribuído.',
      'Abra uma distribuição para consultar seus processos.');
  }
  if (aba === 'meta') {
    definirVisaoTabela('meta');
    return tituloDoPainel('Julgados na meta de 45 dias',
      'Dias da distribuição até a sessão em que o processo foi julgado. Sem prazo aferível: '
        + 'falta a data da distribuição, ou a sessão veio antes dela.',
      'O percentual considera só os julgados com prazo aferível.',
      'Indicador de prazo');
  }
  definirVisaoTabela('auditoria');
  return tituloDoPainel('Auditoria das correções',
    'Somente consulta: cada linha é um registro já alterado por este painel, com o valor anterior e o posterior.',
    'Nenhuma linha pode ser alterada aqui.');
}

// `anexando` é a busca das correções anteriores da auditoria: ela acrescenta à
// tabela em vez de substituí-la, então não pode apagar o que já está na tela nem
// trocar o rodapé por "Carregando…". Quem indica o andamento ali é o próprio
// botão que a pediu.
async function carregar({ anexando = false } = {}) {
  const meu = ++pedido;
  // Os dois botões de volta se revezam, como em julgados.js: dentro de um
  // detalhe quem volta é o Voltar (para a lista), e fora dele o Início (para o
  // index.html). Uma saída de cada vez, a de dentro com precedência.
  //
  // O Início existia no admin.html desde o começo, mas nascia hidden e nada
  // aqui o revelava — o painel era a única tela do sistema sem caminho de volta
  // à inicial, e só o botão do navegador tirava a pessoa de lá.
  btnVoltar.hidden = !detalhe;
  btnVoltarInicio.hidden = !!detalhe;
  moldura();

  if (anexando) {
    alternarBotaoCarregando(btnMaisAntigas, true, 'Buscando…');
  } else {
    // Carregamento que não anexa SUBSTITUI: sem zerar o acumulado, repetir a
    // consulta da auditoria — trocar de aba e voltar, "Tentar novamente", ou o
    // recarregamento que segue uma gravação — somava as mesmas linhas de novo.
    reiniciarAuditoria();
    if (btnMaisAntigas) btnMaisAntigas.hidden = true;
    estado({ carregando: true });
    painelTabela.replaceChildren();
    painelStatus.textContent = 'Carregando…';
  }

  try {
    const linhas = await buscar();
    if (meu !== pedido) return;
    estado({});
    situacao('ok');
    pintar(linhas);
  } catch (err) {
    if (meu !== pedido) return;
    // Anexando, a tabela na tela continua válida: trocá-la pelo estado de erro
    // apagaria as correções já lidas por causa de uma página que não veio.
    if (anexando) {
      aviso(`Não foi possível buscar as correções anteriores: ${err.message}`, 'erro');
      return;
    }
    painelTabela.replaceChildren();
    medirRolagem();
    painelStatus.textContent = 'Não foi possível carregar.';
    situacao('erro');
    // Mesmo motivo do estado vazio: não há sessão carregada para abrir.
    painelHint.textContent = '';
    // O molde antigo era `carregar os dados (${err.message})`, e a mensagem da
    // exceção costuma começar do mesmo jeito: a pessoa lia a mesma frase duas
    // vezes e nenhuma delas dizia o que fazer.
    estado({
      erro: 'Não foi possível carregar os dados. Verifique sua conexão e tente novamente.',
      detalhe: err.message
    });
  } finally {
    if (anexando) alternarBotaoCarregando(btnMaisAntigas, false, 'Mostrar correções anteriores');
  }
}

function buscar() {
  const corpo = extra => JSON.stringify({ p_colegiado: orgao, ...extra });

  if (detalhe?.tipo === 'sessao') {
    // A pauta vai junto porque a lista agrupa por (data, pauta): sem ela, duas
    // pautas do mesmo dia abriam a mesma tabela, com o total das duas.
    return api('rpc/admin_processos_sessao', {
      method: 'POST', body: corpo({ p_data_sessao: detalhe.data, p_pauta: detalhe.pauta ?? null })
    });
  }
  if (detalhe?.tipo === 'sorteio') {
    return api('rpc/admin_processos_acervo', {
      method: 'POST',
      body: corpo({
        p_data: detalhe.data,
        p_sorteado_em: detalhe.carimbo || null,
        p_origem: detalhe.origem || null
      })
    });
  }
  if (aba === 'sessoes') return api('rpc/admin_sessoes', { method: 'POST', body: corpo() });
  if (aba === 'sorteios') return api('rpc/admin_sorteios', { method: 'POST', body: corpo() });
  if (aba === 'meta') return api('rpc/admin_meta_45', { method: 'POST', body: corpo() });
  // Um a mais que a página: se vier, é porque existe registro anterior — e é
  // como se sabe disso sem uma segunda consulta de contagem.
  return api('rpc/admin_auditoria', {
    method: 'POST',
    body: corpo({ p_limite: PAGINA_AUDITORIA + 1, p_antes_de: auditoria.cursor })
  });
}

function pintar(linhas) {
  if (!Array.isArray(linhas)) linhas = [];

  if (detalhe?.tipo === 'sessao') return pintarProcessosDaSessao(linhas);
  if (detalhe?.tipo === 'sorteio') return pintarProcessosDoSorteio(linhas);
  if (aba === 'sessoes') return pintarSessoes(linhas);
  if (aba === 'sorteios') return pintarSorteios(linhas);
  if (aba === 'meta') return pintarMeta(linhas);
  return pintarAuditoria(linhas);
}

function tituloDoPainel(titulo, descricao, dica, sobrancelha = 'Consulta e correção') {
  painelEyebrow.textContent = sobrancelha;
  painelTitulo.textContent = titulo;
  painelDescricao.textContent = descricao;
  painelHint.textContent = dica;
}

// `dica` é o que sobra no rodapé quando não há registro. Vazia por padrão:
// "Abra uma sessão para consultar seus processos" convida a abrir algo que a
// própria tela acaba de dizer que não existe. Uma dica que continua verdadeira
// sem registro nenhum — como a da auditoria — é passada explicitamente.
function semRegistros(titulo, texto, dica = '') {
  painelTabela.replaceChildren();
  medirRolagem();
  painelStatus.textContent = 'Nada a exibir.';
  situacao('vazio');
  painelHint.textContent = dica;
  estado({ vazioTitulo: titulo, vazioTexto: texto });
}

function pintarSessoes(linhas) {
  if (!linhas.length) {
    return semRegistros('Nenhuma sessão registrada',
      'Assim que uma pauta da AGR for sincronizada, ela aparece aqui.');
  }

  const colunas = [
    { rotulo: 'Data', eixo: 'centro' },
    { rotulo: 'Ações', eixo: 'acoes' },
    { rotulo: 'Pauta', eixo: 'centro' },
    { rotulo: 'Processos', eixo: 'centro' },
    { rotulo: 'Pendentes', eixo: 'centro' }
  ];

  desenhar(colunas, linhas.map(linha => [
    celula(dataBR(linha.data_sessao), 'td', 'historico-data'),
    celulaDeAcoes([botaoDeLinha('Abrir sessão', () => {
      detalhe = { tipo: 'sessao', data: String(linha.data_sessao).slice(0, 10), pauta: linha.pauta };
      carregar();
    }, { tom: 'primario' })]),
    celula(ou(linha.pauta), 'td', 'historico-numero'),
    celula(linha.processos, 'td', 'historico-numero'),
    celula(linha.pendentes
      ? badge(plural(linha.pendentes, 'pendente', 'pendentes'), 'alerta')
      : badge('Em dia', 'sucesso'))
  ]));
  painelStatus.textContent = `${plural(linhas.length, 'sessão registrada', 'sessões registradas')}.`;
}

function pintarSorteios(linhas) {
  if (!linhas.length) {
    return semRegistros('Nenhuma distribuição registrada',
      'O acervo deste colegiado ainda está vazio.');
  }

  const colunas = [
    { rotulo: 'Data', eixo: 'centro' },
    { rotulo: 'Ações', eixo: 'acoes' },
    { rotulo: 'Hora', eixo: 'centro' },
    { rotulo: 'Origem', eixo: 'centro' },
    { rotulo: 'Processos', eixo: 'centro' },
    { rotulo: 'Destinos', eixo: 'centro' }
  ];

  desenhar(colunas, linhas.map(linha => [
    celula(dataBR(linha.data_distribuicao), 'td', 'historico-data'),
    celulaDeAcoes([botaoDeLinha('Abrir distribuição', () => {
      detalhe = {
        tipo: 'sorteio',
        data: String(linha.data_distribuicao).slice(0, 10),
        carimbo: linha.sorteado_em || null,
        origem: linha.origem || null
      };
      carregar();
    }, { tom: 'primario' })]),
    celula(linha.sorteado_em
      ? new Date(linha.sorteado_em).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
      : '—', 'td', 'historico-hora'),
    celula(badge(ORIGENS_LEGIVEIS[linha.origem] || ou(linha.origem), 'neutro')),
    celula(linha.processos, 'td', 'historico-numero'),
    celula((linha.destinos || []).join(', '))
  ]));
  painelStatus.textContent =
    `${plural(linhas.length, 'distribuição registrada', 'distribuições registradas')}.`;
}

function pintarProcessosDaSessao(linhas) {
  const v = VOCABULARIO[orgao];
  if (!linhas.length) {
    return semRegistros('Nenhum processo nesta sessão',
      'A sessão não tem processos registrados.');
  }

  const colunas = [
    { rotulo: 'Processo', eixo: 'centro' },
    { rotulo: 'Ações', eixo: 'acoes' },
    { rotulo: v.destino, eixo: 'centro' },
    { rotulo: 'Voto', eixo: 'centro' },
    { rotulo: 'Status', eixo: 'centro' },
    // "Religar ao acervo" aparece em toda linha, e o julgado SEM vínculo — o caso
    // que a operação existe para resolver — era desenhado igual ao que está
    // vinculado. acervo_id e data_distribuicao já vinham na resposta de
    // admin_processos_sessao e eram descartados aqui.
    { rotulo: 'Vínculo', eixo: 'centro' },
    { rotulo: 'Atualizado por', eixo: 'centro' }
  ];

  desenhar(colunas, linhas.map(linha => {
    const destino = celula(ou(linha.destino));
    if (orgao === 'CJ') rotularCadeira(destino, linha.destino);
    return [
      celula(linha.num_processo, 'td', 'historico-numero'),
      celulaDeAcoes([
        botaoDeLinha('Corrigir dados', () => abrirCorrecaoDeJulgado(linha), { tom: 'primario' }),
        botaoDeLinha('Corrigir número', () => abrirCorrecaoDeNumero(linha.num_processo)),
        botaoDeLinha('Religar ao acervo', () => religarJulgado(linha))
      ]),
      destino,
      celula(valorOuSelo(linha.voto, 'info')),
      celula(valorOuSelo(linha.status, linha.status === 'Julgado' ? 'sucesso' : 'alerta')),
      celula(linha.acervo_id
        ? badge(`Distribuição de ${dataBR(linha.data_distribuicao)}`, 'neutro')
        : badge('Sem distribuição', 'alerta')),
      celula(linha.atualizado_por ? `${linha.atualizado_por} · ${dataHoraBR(linha.atualizado_em)}` : '—',
        'td', 'small')
    ];
  }));
  painelStatus.textContent = `${plural(linhas.length, 'processo', 'processos')} nesta sessão.`;
}

function pintarProcessosDoSorteio(linhas) {
  const v = VOCABULARIO[orgao];
  if (!linhas.length) {
    return semRegistros('Nenhum processo nesta distribuição',
      'A distribuição não tem processos registrados.');
  }

  const colunas = [
    { rotulo: 'Ordem', eixo: 'centro' },
    { rotulo: 'Processo', eixo: 'centro' },
    { rotulo: 'Ações', eixo: 'acoes' },
    { rotulo: v.destino, eixo: 'centro' },
    'Assunto',
    { rotulo: v.decisao, eixo: 'centro' }
  ];
  if (v.temInteressado) colunas.push('Interessado');
  colunas.push({ rotulo: 'Julgados', eixo: 'centro' });

  desenhar(colunas, linhas.map(linha => {
    const destino = celula(ou(linha.destino));
    if (orgao === 'CJ') rotularCadeira(destino, linha.destino);
    const celulas = [
      celula(ou(linha.ordem), 'td', 'historico-numero'),
      celula(linha.num_processo, 'td', 'historico-numero'),
      celulaDeAcoes([
        botaoDeLinha('Corrigir dados', () => abrirAlteracaoDeAcervo(linha, 'corrigir'), { tom: 'primario' }),
        botaoDeLinha('Redistribuir', () => abrirAlteracaoDeAcervo(linha, 'redistribuir')),
        botaoDeLinha('Corrigir número', () => abrirCorrecaoDeNumero(linha.num_processo))
      ]),
      destino,
      celula(ou(linha.assunto)),
      celula(ou(linha.decisao))
    ];
    if (v.temInteressado) celulas.push(celula(ou(linha.interessado)));
    celulas.push(celula(linha.julgados, 'td', 'historico-numero'));
    return celulas;
  }));
  painelStatus.textContent = `${plural(linhas.length, 'processo', 'processos')} nesta distribuição.`;
}

// Soma os meses de `ano` em períodos de `meses` meses e devolve do primeiro ao
// último período com julgado. Antes do primeiro o sistema ainda não tinha o dado
// (a série da CJ recomeça em jun/2026), e um zero ali afirmaria que ninguém foi
// julgado. Entre eles o zero é verdade: período sem sessão.
function agruparMeta(linhas, ano, meses) {
  const periodos = Array.from({ length: 12 / meses }, (_, indice) =>
    ({ indice, julgados: 0, dentro: 0, fora: 0, semPrazo: 0 }));
  linhas.filter(linha => linha.ano === ano).forEach(linha => {
    const periodo = periodos[Math.floor((linha.mes - 1) / meses)];
    periodo.julgados += linha.julgados;
    periodo.dentro += linha.dentro;
    periodo.fora += linha.fora;
    periodo.semPrazo += linha.sem_prazo;
  });
  const primeiro = periodos.findIndex(periodo => periodo.julgados);
  return primeiro < 0 ? [] : periodos.slice(primeiro, periodos.findLastIndex(p => p.julgados) + 1);
}

// Sem prazo aferível fica fora do denominador: não é dentro nem fora.
const taxaDentro = ({ dentro, fora }) => (dentro + fora ? (dentro / (dentro + fora)) * 100 : null);
const percentual = taxa =>
  `${taxa.toLocaleString('pt-BR', { minimumFractionDigits: 1, maximumFractionDigits: 1 })}%`;
const contagem = n => Number(n).toLocaleString('pt-BR');

function celulaDoPeriodo({ indice }, meses, ano) {
  const inicio = indice * meses;
  const nome = document.createElement('strong');
  nome.textContent = meses === 1
    ? MESES[inicio][0].toUpperCase() + MESES[inicio].slice(1)
    : `${indice + 1}º ${PERIODOS[meses][0]}`;

  // O período corrente ainda recebe sessões: o percentual dele vai mudar.
  const hoje = hojeISO();
  const apoio = [];
  if (meses > 1) apoio.push(`${MESES[inicio].slice(0, 3)}–${MESES[inicio + meses - 1].slice(0, 3)}`);
  if (Number(hoje.slice(0, 4)) === ano && Math.floor((Number(hoje.slice(5, 7)) - 1) / meses) === indice) {
    apoio.push('em andamento');
  }

  const bloco = document.createElement('div');
  bloco.className = 'admin-meta-periodo';
  bloco.appendChild(nome);
  if (apoio.length) {
    const detalheDoPeriodo = document.createElement('span');
    detalheDoPeriodo.textContent = apoio.join(' · ');
    bloco.appendChild(detalheDoPeriodo);
  }
  return celula(bloco);
}

// O medidor repete o percentual ao lado dele, por isso é aria-hidden: é o
// número que se lê, a barra só deixa as linhas comparáveis de relance.
function celulaDaTaxa(periodo) {
  const taxa = taxaDentro(periodo);
  if (taxa === null) return celula(valorOuSelo(null));

  const medidor = document.createElement('span');
  medidor.className = 'admin-meta-medidor';
  medidor.setAttribute('aria-hidden', 'true');
  const preenchido = document.createElement('span');
  preenchido.style.width = `${taxa}%`;
  medidor.appendChild(preenchido);

  const valor = document.createElement('span');
  valor.className = 'admin-meta-percentual';
  valor.textContent = percentual(taxa);

  const bloco = document.createElement('div');
  bloco.className = 'admin-meta-taxa';
  bloco.append(medidor, valor);
  return celula(bloco);
}

function pintarMeta(linhas) {
  metaLinhas = linhas;
  const anos = [...new Set(linhas.map(linha => linha.ano))].sort((a, b) => b - a);
  if (!anos.length) {
    return semRegistros('Nenhum julgado registrado',
      'Assim que um processo deste colegiado tiver status Julgado, ele entra na contagem.');
  }

  // Trocar de colegiado mantém o ano escolhido quando o outro também o tem.
  const escolhido = anos.includes(Number(metaAno.value)) ? Number(metaAno.value) : anos[0];
  metaAno.replaceChildren(...anos.map(ano => {
    const opcao = document.createElement('option');
    opcao.value = String(ano);
    opcao.textContent = String(ano);
    return opcao;
  }));
  metaAno.value = String(escolhido);
  metaFiltros.hidden = false;
  repintarMeta();
}

function repintarMeta() {
  const ano = Number(metaAno.value);
  const meses = Number(metaAgrupamento.value);
  const periodos = agruparMeta(metaLinhas, ano, meses);
  const total = periodos.reduce((soma, p) => ({
    julgados: soma.julgados + p.julgados, dentro: soma.dentro + p.dentro,
    fora: soma.fora + p.fora, semPrazo: soma.semPrazo + p.semPrazo
  }), { julgados: 0, dentro: 0, fora: 0, semPrazo: 0 });

  // Dentro e Fora repartem os aferíveis, então os dois saem em percentual, com a
  // contagem embaixo: com um em % e o outro em número, "100,0%" ao lado de "0"
  // parecia medir coisas diferentes.
  const taxa = taxaDentro(total);
  const julgados = n => `${contagem(n)} ${n === 1 ? 'julgado' : 'julgados'}`;
  metaResumo.replaceChildren(...[
    [`Julgados em ${ano}`, contagem(total.julgados), 'com status Julgado'],
    ['Dentro da meta', taxa === null ? '—' : percentual(taxa), `${julgados(total.dentro)} em até 45 dias`],
    ['Fora da meta', taxa === null ? '—' : percentual(100 - taxa), `${julgados(total.fora)} com mais de 45 dias`],
    ['Sem prazo aferível', contagem(total.semPrazo), 'fora do percentual']
  ].map(([rotulo, valor, apoio]) => {
    const grupo = document.createElement('div');
    const termo = document.createElement('dt');
    termo.textContent = rotulo;
    const dado = document.createElement('dd');
    dado.textContent = valor;
    const nota = document.createElement('dd');
    nota.className = 'admin-meta-nota';
    nota.textContent = apoio;
    grupo.append(termo, dado, nota);
    return grupo;
  }));
  metaResumo.hidden = false;

  desenhar([
    { rotulo: 'Período', eixo: 'centro' },
    { rotulo: 'Julgados', eixo: 'centro' },
    { rotulo: 'Dentro da meta', eixo: 'centro' },
    { rotulo: 'Fora da meta', eixo: 'centro' },
    { rotulo: 'Sem prazo aferível', eixo: 'centro' },
    { rotulo: '% dentro da meta', eixo: 'centro' }
  ], periodos.map(periodo => [
    celulaDoPeriodo(periodo, meses, ano),
    celula(contagem(periodo.julgados), 'td', 'admin-meta-total'),
    celula(contagem(periodo.dentro)),
    celula(contagem(periodo.fora)),
    celula(contagem(periodo.semPrazo)),
    celulaDaTaxa(periodo)
  ]));
  painelStatus.textContent = `${plural(periodos.length, ...PERIODOS[meses])} de ${ano}.`;
}

function pintarAuditoria(pagina) {
  // A resposta traz um registro além da página justamente para revelar que há
  // mais; ele não entra na tabela.
  auditoria.temMais = pagina.length > PAGINA_AUDITORIA;
  auditoria.linhas = auditoria.linhas.concat(
    auditoria.temMais ? pagina.slice(0, PAGINA_AUDITORIA) : pagina);
  auditoria.cursor = auditoria.linhas.at(-1)?.id ?? null;

  const linhas = auditoria.linhas;
  if (btnMaisAntigas) btnMaisAntigas.hidden = !auditoria.temMais;

  if (!linhas.length) {
    // Continua verdadeiro com a lista vazia: a auditoria nunca aceita edição.
    return semRegistros('Nenhuma correção registrada',
      'Assim que uma alteração for gravada, ela aparece aqui.',
      'Nenhuma linha pode ser alterada aqui.');
  }

  desenhar(['Quando', 'Operação', 'Registro', 'Alteração', 'Motivo', 'Quem'], linhas.map(linha => {
    const mudancas = document.createElement('ul');
    mudancas.className = 'admin-delta admin-delta-compacta';
    Object.keys(linha.depois || {}).forEach(campo => {
      const item = document.createElement('li');
      item.textContent =
        `${campoLegivel(campo)}: ${legivel(linha.antes?.[campo])} → ${legivel(linha.depois?.[campo])}`;
      mudancas.appendChild(item);
    });

    // A chave interna sozinha ("Julgado nº 3417") não liga a linha a processo
    // nenhum, e cruzar o rastro com um processo exigia SQL direto no banco.
    // admin_auditoria devolve o número atual do registro justamente para isto.
    const registro = document.createElement('div');
    const tipo = document.createElement('span');
    tipo.textContent = `${TABELAS_LEGIVEIS[linha.tabela] || linha.tabela} nº ${linha.registro_id}`;
    const processo = document.createElement('span');
    processo.className = 'admin-registro-processo';
    processo.textContent = vazio(linha.num_processo)
      ? 'processo não localizado'
      : `processo ${linha.num_processo}`;
    registro.append(tipo, processo);

    return [
      celula(dataHoraBR(linha.feito_em), 'td', 'small'),
      celula(OPERACOES_LEGIVEIS[linha.operacao] || linha.operacao),
      celula(registro, 'td', 'small'),
      celula(mudancas),
      celula(ou(linha.motivo), 'td', 'small'),
      celula(ou(linha.feito_por), 'td', 'small')
    ];
  }));

  // "100 correções listadas" lia-se como o total. O rodapé precisa dizer se o
  // que está na tela é o rastro inteiro ou apenas a parte mais recente dele.
  painelStatus.textContent = auditoria.temMais
    ? `${plural(linhas.length, 'correção listada', 'correções listadas')}, das mais recentes para as anteriores. Há registros além destes.`
    : `${plural(linhas.length, 'correção listada', 'correções listadas')} — rastro completo.`;
}

// ── Diálogo de edição ────────────────────────────────────────────────────────
// Dois passos no mesmo <dialog>: o formulário e a confirmação. `montarDelta`
// devolve a lista do que muda; lista vazia impede a gravação, porque confirmar
// "nenhuma alteração" seria pedir uma decisão sobre coisa nenhuma.
function campoTexto({ nome, rotulo, valor, tipo = 'text', dica = '', atributos = {} }) {
  const bloco = document.createElement('div');
  bloco.className = 'admin-campo';

  const label = document.createElement('label');
  label.htmlFor = `campo-${nome}`;
  label.textContent = rotulo;

  const input = document.createElement('input');
  input.id = `campo-${nome}`;
  input.name = nome;
  input.type = tipo;
  input.value = vazio(valor) ? '' : String(valor).slice(0, tipo === 'date' ? 10 : undefined);
  Object.entries(atributos).forEach(([chave, v]) => input.setAttribute(chave, v));

  bloco.append(label, input);
  if (dica) {
    const hint = document.createElement('p');
    hint.className = 'form-hint';
    hint.textContent = dica;
    bloco.appendChild(hint);
  }
  return bloco;
}

function campoSelecao({ nome, rotulo, valor, opcoes, rotuloVazio = '— em branco —' }) {
  const bloco = document.createElement('div');
  bloco.className = 'admin-campo';

  const label = document.createElement('label');
  label.htmlFor = `campo-${nome}`;
  label.textContent = rotulo;

  const select = document.createElement('select');
  select.id = `campo-${nome}`;
  select.name = nome;

  const branco = document.createElement('option');
  branco.value = '';
  branco.textContent = rotuloVazio;
  select.appendChild(branco);

  // Uma opção é ou o próprio valor — voto, status, cadeira: o que o banco
  // guarda é o que a pessoa lê —, ou `{ valor, rotulo }`, para quando o valor do
  // banco não é frase nenhuma em português.
  opcoes.forEach(opcao => {
    const item = document.createElement('option');
    const valorBruto = typeof opcao === 'object' ? opcao.valor : opcao;
    item.value = String(valorBruto);
    item.textContent = String(typeof opcao === 'object' ? opcao.rotulo : opcao);
    select.appendChild(item);
  });
  select.value = vazio(valor) ? '' : String(valor);

  bloco.append(label, select);
  return bloco;
}

function valorDoCampo(nome) {
  const campo = edicaoForm.elements[nome];
  return campo ? campo.value.trim() : '';
}

// `tituloImpacto` nomeia a lista da etapa 2. O padrão é o da correção de
// distribuição, que lista julgados; a renumeração lista distribuições E
// julgados, e herdar o título fazia a lista dizer que eram só julgados.
function abrirDialogo({ titulo, resumo, campos, montarDelta, impacto, gravar, mensagem,
                        tituloImpacto = 'Julgados que serão alterados junto' }) {
  // avancar() é assíncrono nas DUAS etapas, e o <form> aceita submit por Enter
  // além do clique no botão. Sem a trava `avancando`, um segundo submit durante
  // a consulta de impacto reentrava com `delta` já preenchido e caía direto na
  // gravação: a etapa de confirmação era pulada justamente na operação que
  // propaga. A trava é DESTE diálogo, não da página: global, a gravação lenta de
  // uma janela fechada no meio deixava o botão da janela seguinte mudo.
  dialogoAtual = { montarDelta, impacto, gravar, mensagem, delta: null, avancando: false };

  edicaoTitulo.textContent = titulo;
  edicaoResumo.textContent = resumo;
  edicaoCampos.replaceChildren(...campos);
  edicaoMotivo.value = '';
  edicaoErro.hidden = true;
  edicaoImpacto.hidden = true;
  edicaoImpactoTitulo.textContent = tituloImpacto;
  edicaoImpactoLista.replaceChildren();
  edicaoEtapaCampos.hidden = false;
  edicaoEtapaConfirmacao.hidden = true;
  edicaoEtapaRotulo.textContent = 'Etapa 1 de 2';
  // A janela anterior pode ter sido fechada com o botão ainda em "Verificando…"
  // ou "Gravando…". A espera dela não toca mais no botão (ver passo), então quem
  // o devolve ao estado da etapa 1 é quem abre a janela nova.
  alternarBotaoCarregando(btnAvancar, false);
  btnAvancar.textContent = 'Revisar alteração';
  btnAvancar.disabled = false;

  dialogo.showModal();
  // Religar ao acervo não tem campo nenhum: ali o foco vai para a ação.
  (edicaoCampos.querySelector('input, select') || edicaoMotivo).focus();
}

function mostrarErroNoDialogo(mensagem) {
  edicaoErro.hidden = false;
  edicaoErro.querySelector('p').textContent = mensagem;
}

async function avancar() {
  const atual = dialogoAtual;
  if (!atual || atual.avancando) return;
  atual.avancando = true;
  try {
    await passo(atual);
  } catch (err) {
    // Nenhum caminho de passo() deveria chegar aqui, mas um `await` num diálogo
    // que a pessoa fechou no meio é justamente o tipo de falha que se perdia
    // como rejeição não tratada — sem nada na tela e sem nada no console.
    console.error(err);
  } finally {
    atual.avancando = false;
  }
}

// `atual` é o diálogo que esta chamada conduz. Fechar a janela zera
// `dialogoAtual` (ouvinte de `close`), e há dois `await` abaixo: depois deles a
// janela na tela pode ser nenhuma — ou OUTRA, aberta enquanto a espera corria.
// Escrever nela fechava a janela nova no meio do preenchimento, punha o erro da
// antiga no formulário da nova e devolvia ao botão o rótulo de outra etapa. Por
// isso toda escrita na janela depois de um `await` passa por naTela().
async function passo(atual) {
  edicaoErro.hidden = true;
  const naTela = () => dialogoAtual === atual;

  // Etapa 1 → 2: monta o delta e mostra a confirmação.
  if (!atual.delta) {
    let delta;
    try {
      delta = atual.montarDelta();
    } catch (err) {
      mostrarErroNoDialogo(err.message);
      return;
    }
    if (!delta.length) {
      mostrarErroNoDialogo('Nenhuma alteração foi informada.');
      return;
    }

    // Uma linha do delta é uma mudança de valor ("Voto: Manter → Anular") ou uma
    // escolha que não substitui valor nenhum — o alcance da renumeração, por
    // exemplo, que saía como "Alcance: — → tudo" e emprestava a forma antes→
    // depois a algo que nunca teve um "antes".
    edicaoDelta.replaceChildren(...delta.map(({ rotulo, antes, depois, texto }) => {
      const item = document.createElement('li');
      item.textContent = texto === undefined
        ? `${rotulo}: ${legivel(antes)} → ${legivel(depois)}`
        : `${rotulo}: ${texto}`;
      return item;
    }));

    if (atual.impacto) {
      // O botão vira indicador durante a consulta: rotulado "Revisar alteração"
      // e clicável, ele dizia que a etapa 1 ainda não terminou enquanto a
      // resposta vinha.
      alternarBotaoCarregando(btnAvancar, true, 'Verificando…');
      let afetados = [];
      try {
        afetados = await atual.impacto();
      } catch (_) {
        // O preview é informativo: falhar nele não impede a confirmação, e
        // inventar "nenhum julgado afetado" seria pior que omiti-lo.
      }

      // A janela foi fechada enquanto o impacto vinha: não há etapa 2 para
      // montar, e a lista e o botão na tela, se houver, são de outra janela.
      if (!naTela()) return;
      alternarBotaoCarregando(btnAvancar, false, 'Revisar alteração');
      if (afetados.length) {
        edicaoImpactoLista.replaceChildren(...afetados.map(texto => {
          const item = document.createElement('li');
          item.textContent = texto;
          return item;
        }));
        edicaoImpacto.hidden = false;
      }
    }

    // Só aqui a etapa 1 está de fato concluída: marcar o delta antes da espera
    // acima deixava a etapa 2 alcançável enquanto a tela ainda mostrava a 1.
    atual.delta = delta;
    edicaoEtapaCampos.hidden = true;
    edicaoEtapaConfirmacao.hidden = false;
    edicaoEtapaRotulo.textContent = 'Etapa 2 de 2';
    btnAvancar.textContent = 'Confirmar e gravar';
    // Sem isto o foco cai no <body>: o bloco que o continha acabou de ser
    // escondido. Quem usa teclado ou leitor de tela não era avisado de que o
    // formulário virou revisão — justo na etapa que existe para ser lida.
    edicaoEtapaConfirmacao.focus();
    return;
  }

  // Etapa 2: grava.
  alternarBotaoCarregando(btnAvancar, true, 'Gravando…');
  const descrever = atual.mensagem;
  try {
    // O que o gatilho de derivação fez por baixo da correção só é sabido depois
    // da escrita — é o que a função devolve em `alterados` e `propagados`, e o
    // motivo de a migração dizer que "nada é silencioso". Descartar o retorno
    // deixava a divergência para aparecer em verificacao_cj.sql, que é
    // exatamente o que ela existe para evitar.
    const resultado = await atual.gravar(edicaoMotivo.value.trim() || null);
    // A gravação aconteceu mesmo que a janela tenha sido fechada no meio: o aviso
    // e a recarga valem igual. Só fechar depende de ela ainda ser esta.
    if (naTela()) dialogo.close();
    // `mensagem` devolve texto, ou `{ texto, tom }` quando o que o banco fez por
    // baixo não é motivo de comemoração — um julgado que perdeu o vínculo com o
    // acervo não pode sair no mesmo verde de uma correção bem-sucedida.
    const anuncio = descrever && descrever(resultado);
    const { texto, tom } = typeof anuncio === 'string' ? { texto: anuncio } : (anuncio || {});
    aviso(texto || 'Alteração gravada.', tom || 'sucesso');
    await carregar();
  } catch (err) {
    if (naTela()) mostrarErroNoDialogo(err.message);
    aviso(`Não foi possível gravar: ${err.message}`, 'erro');
  } finally {
    if (naTela()) alternarBotaoCarregando(btnAvancar, false, 'Confirmar e gravar');
  }
}

// ── Operações ────────────────────────────────────────────────────────────────
function abrirCorrecaoDeJulgado(linha) {
  const v = VOCABULARIO[orgao];
  const campos = [
    campoSelecao({ nome: 'voto', rotulo: 'Voto', valor: linha.voto, opcoes: v.votos }),
    campoSelecao({ nome: 'status', rotulo: 'Status', valor: linha.status, opcoes: v.status }),
    campoTexto({
      nome: 'data_sessao', rotulo: 'Data da sessão', tipo: 'date', valor: detalhe.data,
      // O `max` é a mesma regra que admin_corrigir_julgado_* aplica no banco.
      // Sem ele, a única resposta a uma data futura era a frase crua do Postgres
      // ('sessao no futuro: 2027-01-01') aparecendo na tela — a única regra desta
      // classe que não tinha frase em português, ao lado de data em branco e
      // formato de cadeira, que têm.
      atributos: { max: hojeISO() },
      // Quem religa é o gatilho de derivação, DURANTE a escrita: na confirmação
      // isso ainda não aconteceu. Quem informa é o aviso de gravação, montado
      // com o `alterados` que a função devolve.
      dica: 'Mudar a data pode religar o julgado a outra distribuição; o aviso da gravação diz se isso aconteceu.'
    }),
    campoTexto({ nome: 'pauta', rotulo: 'Número da pauta', tipo: 'number', valor: linha.pauta,
      atributos: { min: '1', step: '1' } })
  ];

  const original = {
    voto: linha.voto, status: linha.status,
    data_sessao: detalhe.data, pauta: linha.pauta
  };

  abrirDialogo({
    titulo: 'Corrigir julgado',
    resumo: `Processo ${linha.num_processo} · sessão de ${dataBR(detalhe.data)}`
      + (vazio(detalhe.pauta) ? '' : `, pauta ${detalhe.pauta}`),
    campos,
    montarDelta() {
      const alterados = {};
      const delta = [];
      const comparar = (nome, rotulo, normalizar) => {
        const bruto = valorDoCampo(nome);
        const novo = bruto === '' ? null : normalizar(bruto);
        const antigo = vazio(original[nome]) ? null : normalizar(String(original[nome]));
        if (novo === antigo) return;
        alterados[nome] = novo;
        delta.push({ rotulo, antes: antigo, depois: novo });
      };

      // O corte em 10 põe carimbo do banco e <input type="date"> na mesma
      // unidade, e é SÓ da data. Aplicado a todos os campos, truncava
      // 'Indeferimento' em 'Indeferime' e o painel via alteração onde não
      // houve: a confirmação exibia uma mudança inventada e a gravação
      // reescrevia atualizado_por por uma edição que ninguém fez.
      comparar('voto', 'Voto', String);
      comparar('status', 'Status', String);
      comparar('data_sessao', 'Data da sessão', valor => String(valor).slice(0, 10));
      comparar('pauta', 'Número da pauta', Number);

      if (alterados.data_sessao === null) {
        throw new Error('A data da sessão não pode ficar em branco.');
      }
      if (alterados.data_sessao && alterados.data_sessao > hojeISO()) {
        throw new Error('A data da sessão não pode ser futura.');
      }
      this.alterados = alterados;
      return delta;
    },
    gravar(motivo) {
      return api(`rpc/admin_corrigir_julgado_${VOCABULARIO[orgao].sufixo}`, {
        method: 'POST',
        body: JSON.stringify({ p_id: linha.id, p_campos: this.alterados, p_motivo: motivo })
      });
    },
    // O gatilho reescreve acervo_id em TODA correção — data_sessao entra sempre na
    // lista do UPDATE, e `update of` dispara pela presença da coluna, não pela
    // mudança de valor. Então `alterados.acervo_id` presente não significa que
    // alguém mexeu na data, e o vínculo pode ter CAÍDO: dizer "religou o julgado
    // a outra distribuição" nesse caso anunciava como sucesso a perda do vínculo,
    // que é o AVISO de verificacao_cj.sql.
    mensagem(resultado) {
      const vinculo = resultado?.alterados?.acervo_id;
      if (!vinculo) return null;
      if (vazio(vinculo.depois)) {
        return {
          texto: 'Alteração gravada, mas o julgado ficou SEM distribuição vinculada: '
            + 'nenhuma distribuição deste processo corresponde à data gravada. '
            + 'Use "Religar ao acervo" ou corrija a data da distribuição.',
          tom: 'atencao'
        };
      }
      return vazio(vinculo.antes)
        ? 'Alteração gravada. O julgado passou a ter uma distribuição vinculada.'
        : 'Alteração gravada. A data nova religou o julgado a outra distribuição.';
    }
  });
}

function abrirAlteracaoDeAcervo(linha, modo) {
  const v = VOCABULARIO[orgao];
  const corrigindo = modo === 'corrigir';

  const campos = [
    campoTexto({
      nome: v.campoDestino, rotulo: v.destino, valor: linha.destino,
      dica: orgao === 'CJ' ? 'Cadeira, no formato CJ1…CJ5.' : 'Unidade, no formato CREG1…CREG4.'
    }),
    campoTexto({ nome: 'data_distribuicao', rotulo: 'Data da distribuição', tipo: 'date',
      valor: detalhe.data, atributos: { max: hojeISO() } }),
    campoTexto({ nome: 'assunto', rotulo: 'Assunto', valor: linha.assunto }),
    campoTexto({ nome: 'ordem', rotulo: 'Ordem no sorteio', tipo: 'number', valor: linha.ordem,
      atributos: { min: '1', step: '1' } })
  ];

  // A 6ª coluna muda de nome e de natureza entre os colegiados: na Câmara é a
  // DEFESA, booleana; no Conselho é o RECURSO, texto. Não é o mesmo campo com
  // rótulo trocado, então nem o controle é o mesmo.
  //
  // E o valor vem de `linha.defesa`, a coluna booleana, não de `linha.decisao`:
  // essa outra CAI no texto legado de `recurso` quando a defesa é nula (é o que
  // a tabela mostra, e está certo lá). Lido como "antes" do formulário, o legado
  // fazia a confirmação prometer "Defesa: Sim → Não" para uma linha que vai de
  // vazio para Não — divergindo da auditoria, que registra a verdade.
  if (orgao === 'CJ') {
    campos.splice(2, 0, campoSelecao({
      nome: 'defesa', rotulo: 'Defesa', opcoes: ['Sim', 'Não'],
      valor: linha.defesa === true ? 'Sim' : linha.defesa === false ? 'Não' : null
    }));
  } else {
    campos.splice(2, 0, campoTexto({ nome: 'recurso', rotulo: 'Recurso', valor: linha.decisao }));
    campos.push(campoTexto({ nome: 'interessado', rotulo: 'Interessado', valor: linha.interessado }));
  }

  const original = {
    [v.campoDestino]: linha.destino,
    data_distribuicao: detalhe.data,
    assunto: linha.assunto,
    ordem: linha.ordem,
    defesa: linha.defesa === true ? 'Sim' : linha.defesa === false ? 'Não' : null,
    recurso: linha.decisao,
    interessado: linha.interessado
  };

  abrirDialogo({
    titulo: corrigindo ? 'Corrigir distribuição' : 'Redistribuir processo',
    resumo: corrigindo
      ? `Processo ${linha.num_processo} · a correção também alcança os julgados que a copiaram`
      : `Processo ${linha.num_processo} · os julgados anteriores preservam quem levou o processo à mesa`,
    campos,
    montarDelta() {
      const alterados = {};
      const delta = [];
      const nomes = [
        [v.campoDestino, v.destino],
        ['data_distribuicao', 'Data da distribuição'],
        ['assunto', 'Assunto'],
        ['ordem', 'Ordem no sorteio'],
        ...(orgao === 'CJ' ? [['defesa', 'Defesa']]
                           : [['recurso', 'Recurso'], ['interessado', 'Interessado']])
      ];

      nomes.forEach(([nome, rotulo]) => {
        if (!edicaoForm.elements[nome]) return;
        const bruto = valorDoCampo(nome);
        const antigo = vazio(original[nome]) ? null : String(original[nome]);
        const novoTexto = bruto === '' ? null : bruto;
        if (novoTexto === antigo) return;

        alterados[nome] = nome === 'ordem'
          ? (novoTexto === null ? null : Number(novoTexto))
          : nome === 'defesa'
            ? (novoTexto === null ? null : novoTexto === 'Sim')
            : novoTexto;
        delta.push({ rotulo, antes: original[nome], depois: alterados[nome] });
      });

      if (alterados[v.campoDestino] !== undefined
          && !v.destinoPadrao.test(String(alterados[v.campoDestino] ?? ''))) {
        throw new Error(`${v.destino} inválido: use o formato ${orgao === 'CJ' ? 'CJ1' : 'CREG1'}.`);
      }
      if (alterados.data_distribuicao === null) {
        throw new Error('A data da distribuição não pode ficar em branco.');
      }
      if (alterados.data_distribuicao && alterados.data_distribuicao > hojeISO()) {
        throw new Error('A data da distribuição não pode ser futura.');
      }
      if (v.assuntoObrigatorio && alterados.assunto === null) {
        throw new Error('O assunto não pode ficar em branco.');
      }

      this.alterados = alterados;
      return delta;
    },
    // O preview só faz sentido quando a alteração propaga: numa redistribuição
    // os julgados ficam intocados de propósito, e listá-los sugeriria o oposto.
    impacto: corrigindo ? async () => {
      const julgados = await api('rpc/admin_julgados_do_acervo', {
        method: 'POST',
        body: JSON.stringify({ p_colegiado: orgao, p_acervo_id: linha.id })
      });
      return (Array.isArray(julgados) ? julgados : []).map(j =>
        `Sessão de ${dataBR(j.data_sessao)}${j.pauta ? ` · pauta ${j.pauta}` : ''} — ${ou(j.voto)} / ${ou(j.status)}`);
    } : null,
    gravar(motivo) {
      const porta = corrigindo ? 'admin_corrigir_acervo' : 'admin_redistribuir';
      return api(`rpc/${porta}_${v.sufixo}`, {
        method: 'POST',
        body: JSON.stringify({ p_id: linha.id, p_campos: this.alterados, p_motivo: motivo })
      });
    },
    // Na correção, o preview da etapa 2 lista quem PODE ir junto e este aviso
    // diz quem foi. Na redistribuição a lista é sempre vazia de propósito, e
    // o aviso cai no texto padrão.
    mensagem(resultado) {
      const quantos = Array.isArray(resultado?.propagados) ? resultado.propagados.length : 0;
      return quantos
        ? `Alteração gravada. ${plural(quantos, 'julgado seguiu', 'julgados seguiram')} a correção.`
        : null;
    }
  });
}

// O caso que descartou a busca por número: quando o próprio número está errado,
// só a navegação por data chega até ele.
//
// E a correção NÃO é a edição da linha em que a pessoa clicou: alcança toda
// distribuição e todo julgado do colegiado que carregam aquele número. O diálogo
// abria a partir de uma linha só e não dizia nada disso — por isso a etapa 2
// lista os registros alcançados, lidos de admin_registros_do_processo.
function abrirCorrecaoDeNumero(numAtual) {
  const campos = [
    campoTexto({
      nome: 'num_novo', rotulo: 'Número correto', valor: '',
      atributos: { inputmode: 'numeric', maxlength: '15', pattern: '[0-9]{15}' },
      dica: 'Processo SEI da AGR: 15 dígitos, só dígitos.'
    }),
    campoSelecao({
      nome: 'escopo', rotulo: 'Onde corrigir', valor: 'tudo', rotuloVazio: '— selecione —',
      opcoes: ESCOPOS
    })
  ];

  abrirDialogo({
    titulo: 'Corrigir número do processo',
    resumo: `Número atual: ${numAtual} · a correção alcança todos os registros com este número`,
    tituloImpacto: 'Registros alcançados pela renumeração',
    campos,
    montarDelta() {
      const novo = valorDoCampo('num_novo');
      const escopo = valorDoCampo('escopo');
      if (!/^[0-9]{15}$/.test(novo)) {
        throw new Error('O número precisa ter 15 dígitos, só dígitos.');
      }
      if (novo === numAtual) throw new Error('O número novo é igual ao atual.');
      if (!ESCOPOS.some(e => e.valor === escopo)) {
        throw new Error('Escolha onde a correção deve valer.');
      }
      this.novo = novo;
      this.escopo = escopo;
      return [
        { rotulo: 'Número do processo', antes: numAtual, depois: novo },
        // `texto` e não antes→depois: o alcance não substitui valor nenhum, e
        // "Alcance: — → tudo" emprestava a forma de uma mudança a uma escolha.
        { rotulo: 'Alcance', texto: escopoLegivel(escopo) }
      ];
    },
    async impacto() {
      const registros = await api('rpc/admin_registros_do_processo', {
        method: 'POST',
        body: JSON.stringify({ p_colegiado: orgao, p_num_processo: numAtual })
      });
      const todos = Array.isArray(registros) ? registros : [];
      const alcancados = todos.filter(r => this.escopo === 'tudo' || r.origem_registro === this.escopo);

      const itens = alcancados.map(r => r.origem_registro === 'acervo'
        ? `Distribuição de ${dataBR(r.data_referencia)} — ${ou(r.destino)}`
        : `Julgado da sessão de ${dataBR(r.data_referencia)}${vazio(r.pauta) ? '' : ` · pauta ${r.pauta}`}`
          + (r.vinculado ? '' : ' — hoje sem distribuição vinculada'));

      // Renumerar um lado só desfaz o par que o gatilho usa para vincular, e o
      // vínculo cai. Só os julgados: o acervo não tem mais o número deles. Só as
      // distribuições: admin_corrigir_processo_* redispara o gatilho dos julgados
      // que apontavam para elas, e ele derruba o vínculo em vez de deixá-lo
      // apontar para outro processo. É consequência, não erro — mas confirmar sem
      // saber dela é o que a etapa de revisão existe para evitar. No escopo das
      // distribuições os julgados nem entram na lista acima, e o aviso é o único
      // ponto da confirmação que fala deles.
      const haVinculados = todos.some(r => r.origem_registro === 'julgados' && r.vinculado);
      if (haVinculados && this.escopo === 'julgados') {
        itens.push('Atenção: sem renumerar as distribuições, os julgados vinculados '
          + 'perdem o vínculo com o acervo.');
      }
      if (haVinculados && this.escopo === 'acervo') {
        itens.push('Atenção: sem renumerar os julgados, os que estão vinculados a estas '
          + 'distribuições perdem o vínculo com o acervo.');
      }
      return itens;
    },
    gravar(motivo) {
      return api(`rpc/admin_corrigir_processo_${VOCABULARIO[orgao].sufixo}`, {
        method: 'POST',
        body: JSON.stringify({
          p_num_atual: numAtual, p_num_novo: this.novo,
          p_escopo: this.escopo, p_motivo: motivo
        })
      });
    },
    // A função devolve os ids de cada grupo que tocou, e o painel os descartava:
    // o aviso caía no 'Alteração gravada.' genérico depois de renumerar sete
    // registros e gravar sete linhas de auditoria.
    mensagem(resultado) {
      const quantos = chave => (Array.isArray(resultado?.[chave]) ? resultado[chave].length : 0);
      const partes = [];
      if (quantos('acervo')) {
        partes.push(plural(quantos('acervo'), 'distribuição renumerada', 'distribuições renumeradas'));
      }
      if (quantos('julgados')) {
        partes.push(plural(quantos('julgados'), 'julgado renumerado', 'julgados renumerados'));
      }
      if (!partes.length) return null;

      const desvinculados = quantos('desvinculados');
      const texto = `Alteração gravada: ${partes.join(' e ')}.`
        + (desvinculados
          ? ` ${plural(desvinculados, 'julgado ficou', 'julgados ficaram')} sem distribuição `
            + 'vinculada — use "Religar ao acervo" quando a distribuição existir.'
          : '');
      return desvinculados ? { texto, tom: 'atencao' } : texto;
    }
  });
}

// A operação não recebe campo nenhum: grava null nos derivados e deixa o gatilho
// rederivá-los. Por isso a confirmação não tem um "antes → depois" de valor — o
// que ela precisa dizer é de onde o julgado sai HOJE, porque religar um julgado
// já vinculado à distribuição certa é um não-efeito que ainda assim reescreve
// atualizado_por, e a tela não distinguia os dois casos.
function religarJulgado(linha) {
  const vinculado = !!linha.acervo_id;
  abrirDialogo({
    titulo: 'Religar ao acervo',
    resumo: `Processo ${linha.num_processo} · `
      + (vinculado
        ? `vinculado hoje à distribuição de ${dataBR(linha.data_distribuicao)}`
        : 'hoje sem distribuição vinculada'),
    campos: [],
    montarDelta: () => ([
      {
        rotulo: 'Distribuição vinculada',
        texto: vinculado
          ? `distribuição de ${dataBR(linha.data_distribuicao)} — reprocurada pelo número e pela data da sessão`
          : 'nenhuma — o gatilho procura de novo pelo número e pela data da sessão'
      },
      {
        rotulo: 'Campos derivados',
        texto: 'rederivados da distribuição que o gatilho encontrar'
      }
    ]),
    gravar(motivo) {
      return api(`rpc/admin_religar_julgado_${VOCABULARIO[orgao].sufixo}`, {
        method: 'POST',
        body: JSON.stringify({ p_id: linha.id, p_motivo: motivo })
      });
    },
    // Religar não é garantia de vínculo: se nenhuma distribuição corresponde, o
    // gatilho devolve null e o julgado continua solto. Dizer "gravado" e nada
    // mais deixava a pessoa sem saber em qual dos dois casos caiu.
    mensagem(resultado) {
      const vinculo = resultado?.alterados?.acervo_id;
      const aindaSolto = vinculo ? vazio(vinculo.depois) : !vinculado;
      return aindaSolto
        ? {
            texto: 'Religação gravada, mas nenhuma distribuição deste processo corresponde '
              + 'à data da sessão: o julgado continua sem vínculo.',
            tom: 'atencao'
          }
        : 'Religação gravada. Os campos derivados voltaram a sair da distribuição vinculada.';
    }
  });
}

// ── Ligação ──────────────────────────────────────────────────────────────────
function inicializarAdmin(orgaosAdmin) {
  const administrados = orgaosAdmin instanceof Set ? orgaosAdmin : new Set();

  seletorOrgao.querySelectorAll('[data-orgao-admin]').forEach(botao => {
    botao.hidden = !administrados.has(botao.dataset.orgaoAdmin);
    botao.addEventListener('click', () => selecionarOrgao(botao.dataset.orgaoAdmin));
  });

  // Com um órgão só, o seletor não é escolha: é um botão preso numa opção.
  seletorOrgaoCard.hidden = administrados.size < 2;

  abas.querySelectorAll('[data-aba]').forEach(botao => {
    botao.addEventListener('click', () => selecionarAba(botao.dataset.aba));
    botao.addEventListener('keydown', navegarAbas);
    const selecionada = botao.dataset.aba === aba;
    botao.setAttribute('aria-selected', String(selecionada));
    botao.setAttribute('tabindex', selecionada ? '0' : '-1');
    if (selecionada) painelConteudo.setAttribute('aria-labelledby', botao.id);
  });

  btnVoltar.addEventListener('click', () => {
    detalhe = null;
    carregar();
  });
  btnTentarNovamente.addEventListener('click', () => carregar());
  metaAno.addEventListener('change', repintarMeta);
  metaAgrupamento.addEventListener('change', repintarMeta);
  // A auditoria é a única lista que não cabe numa consulta só. O botão pede a
  // página anterior pelo cursor que admin_auditoria já aceitava, e ACRESCENTA à
  // tabela: quem está lendo o rastro não perde o que já leu.
  if (btnMaisAntigas) {
    btnMaisAntigas.addEventListener('click', () => carregar({ anexando: true }));
  }
  // A tabela cabe ou não conforme a largura da janela, então a dica de rolagem
  // acompanha a medição real — não o breakpoint. O guard existe porque este
  // arquivo também roda no escopo isolado dos testes, sem o global do navegador.
  if (typeof window !== 'undefined') window.addEventListener('resize', medirRolagem);

  edicaoForm.addEventListener('submit', evento => {
    evento.preventDefault();
    avancar();
  });
  btnCancelar.addEventListener('click', () => dialogo.close());
  btnFecharEdicao.addEventListener('click', () => dialogo.close());
  // Clique no ::backdrop chega como clique no próprio dialog, e não há trabalho
  // não salvo depois da confirmação — fechar ali é o que se espera de um modal.
  dialogo.addEventListener('click', evento => {
    if (evento.target === dialogo) dialogo.close();
  });
  dialogo.addEventListener('close', () => { dialogoAtual = null; });

  painel.hidden = false;
  return selecionarOrgao(administrados.has('CJ') ? 'CJ' : 'CREG');
}
