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
    campoDecisao: 'defesa',
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
    campoDecisao: 'recurso',
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
// aparecia dentro de um selo, ao lado de datas já formatadas.
const ORIGENS_LEGIVEIS = {
  sorteio: 'Sorteio eletrônico',
  ata: 'Ata publicada'
};

const campoLegivel = nome => CAMPOS_LEGIVEIS[nome] || nome;

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
const btnVoltar = document.getElementById('btnVoltar');

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

// ── Formatação ───────────────────────────────────────────────────────────────
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
  painelTabelaWrap.dataset.rolavel = rolavel ? 'sim' : 'nao';
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
async function carregar() {
  const meu = ++pedido;
  btnVoltar.hidden = !detalhe;
  estado({ carregando: true });
  painelTabela.replaceChildren();
  painelStatus.textContent = 'Carregando…';

  try {
    const linhas = await buscar();
    if (meu !== pedido) return;
    estado({});
    situacao('ok');
    pintar(linhas);
  } catch (err) {
    if (meu !== pedido) return;
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
  }
}

function buscar() {
  const corpo = extra => JSON.stringify({ p_colegiado: orgao, ...extra });

  if (detalhe?.tipo === 'sessao') {
    return api('rpc/admin_processos_sessao', {
      method: 'POST', body: corpo({ p_data_sessao: detalhe.data })
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
  return api('rpc/admin_auditoria', { method: 'POST', body: corpo({ p_limite: 100 }) });
}

function pintar(linhas) {
  if (!Array.isArray(linhas)) linhas = [];

  if (detalhe?.tipo === 'sessao') return pintarProcessosDaSessao(linhas);
  if (detalhe?.tipo === 'sorteio') return pintarProcessosDoSorteio(linhas);
  if (aba === 'sessoes') return pintarSessoes(linhas);
  if (aba === 'sorteios') return pintarSorteios(linhas);
  return pintarAuditoria(linhas);
}

function tituloDoPainel(titulo, descricao, dica) {
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
  definirVisaoTabela('sessoes');
  tituloDoPainel('Sessões de julgamento',
    'Selecione a data da sessão para corrigir voto, status, pauta ou a própria data.',
    'Abra uma sessão para consultar seus processos.');
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

// Aba, título, botão e rodapé diziam sorteio, distribuição e rodada para o mesmo
// registro. "Distribuição" é o termo que cobre os dois casos: a linha pode ter
// vindo do sorteio eletrônico ou de uma ata publicada, e chamar de sorteio a que
// veio da ata seria falso.
function pintarSorteios(linhas) {
  definirVisaoTabela('sorteios');
  tituloDoPainel('Distribuições registradas',
    'Selecione a data da distribuição para corrigir como um processo foi distribuído.',
    'Abra uma distribuição para consultar seus processos.');
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
  definirVisaoTabela('processos-sessao');
  const v = VOCABULARIO[orgao];
  tituloDoPainel(`Sessão de ${dataBR(detalhe.data)}`,
    'Corrija voto, status, pauta ou a data da sessão. Religar refaz o vínculo com o acervo.',
    'Escolha uma ação na linha do processo que precisa de ajuste.');
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
    'Atualizado por'
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
      celula(linha.atualizado_por ? `${linha.atualizado_por} · ${dataHoraBR(linha.atualizado_em)}` : '—',
        'td', 'small')
    ];
  }));
  painelStatus.textContent = `${plural(linhas.length, 'processo', 'processos')} nesta sessão.`;
}

function pintarProcessosDoSorteio(linhas) {
  definirVisaoTabela('processos-sorteio');
  const v = VOCABULARIO[orgao];
  tituloDoPainel(`Distribuição de ${dataBR(detalhe.data)}`,
    'Corrigir alcança também os julgados que copiaram este processo; redistribuir, não.',
    'Escolha uma ação na linha do processo que precisa de ajuste.');
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

function pintarAuditoria(linhas) {
  definirVisaoTabela('auditoria');
  tituloDoPainel('Auditoria das correções',
    'Somente consulta: cada linha é um registro já alterado por este painel, com o valor anterior e o posterior.',
    'Nenhuma linha pode ser alterada aqui.');
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
    const registro = `${TABELAS_LEGIVEIS[linha.tabela] || linha.tabela} nº ${linha.registro_id}`;
    return [
      celula(dataHoraBR(linha.feito_em), 'td', 'small'),
      celula(OPERACOES_LEGIVEIS[linha.operacao] || linha.operacao),
      celula(registro, 'td', 'small'),
      celula(mudancas),
      celula(ou(linha.motivo), 'td', 'small'),
      celula(ou(linha.feito_por), 'td', 'small')
    ];
  }));
  painelStatus.textContent = `${plural(linhas.length, 'correção listada', 'correções listadas')}.`;
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

  opcoes.forEach(opcao => {
    const item = document.createElement('option');
    item.value = String(opcao);
    item.textContent = String(opcao);
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

function abrirDialogo({ titulo, resumo, campos, montarDelta, impacto, gravar }) {
  dialogoAtual = { montarDelta, impacto, gravar, delta: null };

  edicaoTitulo.textContent = titulo;
  edicaoResumo.textContent = resumo;
  edicaoCampos.replaceChildren(...campos);
  edicaoMotivo.value = '';
  edicaoErro.hidden = true;
  edicaoImpacto.hidden = true;
  edicaoImpactoLista.replaceChildren();
  edicaoEtapaCampos.hidden = false;
  edicaoEtapaConfirmacao.hidden = true;
  edicaoEtapaRotulo.textContent = 'Etapa 1 de 2';
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
  if (!dialogoAtual) return;
  edicaoErro.hidden = true;

  // Etapa 1 → 2: monta o delta e mostra a confirmação.
  if (!dialogoAtual.delta) {
    let delta;
    try {
      delta = dialogoAtual.montarDelta();
    } catch (err) {
      mostrarErroNoDialogo(err.message);
      return;
    }
    if (!delta.length) {
      mostrarErroNoDialogo('Nenhuma alteração foi informada.');
      return;
    }

    dialogoAtual.delta = delta;
    edicaoDelta.replaceChildren(...delta.map(({ rotulo, antes, depois }) => {
      const item = document.createElement('li');
      item.textContent = `${rotulo}: ${legivel(antes)} → ${legivel(depois)}`;
      return item;
    }));

    if (dialogoAtual.impacto) {
      try {
        const afetados = await dialogoAtual.impacto();
        if (afetados.length) {
          edicaoImpactoLista.replaceChildren(...afetados.map(texto => {
            const item = document.createElement('li');
            item.textContent = texto;
            return item;
          }));
          edicaoImpacto.hidden = false;
        }
      } catch (_) {
        // O preview é informativo: falhar nele não impede a confirmação, e
        // inventar "nenhum julgado afetado" seria pior que omiti-lo.
      }
    }

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
  try {
    await dialogoAtual.gravar(edicaoMotivo.value.trim() || null);
    dialogo.close();
    aviso('Alteração gravada.', 'sucesso');
    await carregar();
  } catch (err) {
    mostrarErroNoDialogo(err.message);
    aviso(`Não foi possível gravar: ${err.message}`, 'erro');
  } finally {
    alternarBotaoCarregando(btnAvancar, false, 'Confirmar e gravar');
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
      dica: 'Mudar a data pode religar o julgado a outra distribuição; a confirmação mostra se isso acontecer.'
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
    resumo: `Processo ${linha.num_processo} · sessão de ${dataBR(detalhe.data)}`,
    campos,
    montarDelta() {
      const alterados = {};
      const delta = [];
      const comparar = (nome, rotulo, converter) => {
        const bruto = valorDoCampo(nome);
        const novo = bruto === '' ? null : converter(bruto);
        const antigo = vazio(original[nome]) ? null : converter(String(original[nome]).slice(0, 10));
        if (novo === antigo) return;
        alterados[nome] = novo;
        delta.push({ rotulo, antes: antigo, depois: novo });
      };

      comparar('voto', 'Voto', String);
      comparar('status', 'Status', String);
      comparar('data_sessao', 'Data da sessão', String);
      comparar('pauta', 'Número da pauta', Number);

      if (alterados.data_sessao === null) {
        throw new Error('A data da sessão não pode ficar em branco.');
      }
      this.alterados = alterados;
      return delta;
    },
    gravar(motivo) {
      return api(`rpc/admin_corrigir_julgado_${VOCABULARIO[orgao].sufixo}`, {
        method: 'POST',
        body: JSON.stringify({ p_id: linha.id, p_campos: this.alterados, p_motivo: motivo })
      });
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
      valor: detalhe.data }),
    campoTexto({ nome: 'assunto', rotulo: 'Assunto', valor: linha.assunto }),
    campoTexto({ nome: 'ordem', rotulo: 'Ordem no sorteio', tipo: 'number', valor: linha.ordem,
      atributos: { min: '1', step: '1' } })
  ];

  // A 6ª coluna muda de nome e de natureza entre os colegiados: na Câmara é a
  // DEFESA, booleana; no Conselho é o RECURSO, texto. Não é o mesmo campo com
  // rótulo trocado, então nem o controle é o mesmo.
  if (orgao === 'CJ') {
    campos.splice(2, 0, campoSelecao({
      nome: 'defesa', rotulo: 'Defesa', opcoes: ['Sim', 'Não'],
      valor: linha.decisao === 'Sim' ? 'Sim' : linha.decisao === 'Não' ? 'Não' : null
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
    defesa: linha.decisao === 'Sim' ? 'Sim' : linha.decisao === 'Não' ? 'Não' : null,
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
    }
  });
}

// O caso que descartou a busca por número: quando o próprio número está errado,
// só a navegação por data chega até ele.
function abrirCorrecaoDeNumero(numAtual) {
  const campos = [
    campoTexto({
      nome: 'num_novo', rotulo: 'Número correto', valor: '',
      atributos: { inputmode: 'numeric', maxlength: '15', pattern: '[0-9]{15}' },
      dica: 'Processo SEI da AGR: 15 dígitos, só dígitos.'
    }),
    campoSelecao({
      nome: 'escopo', rotulo: 'Onde corrigir', valor: 'tudo', rotuloVazio: '— selecione —',
      opcoes: ['tudo', 'acervo', 'julgados']
    })
  ];

  abrirDialogo({
    titulo: 'Corrigir número do processo',
    resumo: `Número atual: ${numAtual}`,
    campos,
    montarDelta() {
      const novo = valorDoCampo('num_novo');
      const escopo = valorDoCampo('escopo');
      if (!/^[0-9]{15}$/.test(novo)) {
        throw new Error('O número precisa ter 15 dígitos, só dígitos.');
      }
      if (novo === numAtual) throw new Error('O número novo é igual ao atual.');
      if (!['tudo', 'acervo', 'julgados'].includes(escopo)) {
        throw new Error('Escolha onde a correção deve valer.');
      }
      this.novo = novo;
      this.escopo = escopo;
      return [
        { rotulo: 'Número do processo', antes: numAtual, depois: novo },
        { rotulo: 'Alcance', antes: '—', depois: escopo }
      ];
    },
    gravar(motivo) {
      return api(`rpc/admin_corrigir_processo_${VOCABULARIO[orgao].sufixo}`, {
        method: 'POST',
        body: JSON.stringify({
          p_num_atual: numAtual, p_num_novo: this.novo,
          p_escopo: this.escopo, p_motivo: motivo
        })
      });
    }
  });
}

function religarJulgado(linha) {
  abrirDialogo({
    titulo: 'Religar ao acervo',
    resumo: `Processo ${linha.num_processo} · os campos copiados voltam a sair da distribuição vinculada`,
    campos: [],
    montarDelta: () => ([{
      rotulo: 'Campos derivados',
      antes: 'como estão hoje no julgado',
      depois: 'rederivados do acervo'
    }]),
    gravar(motivo) {
      return api(`rpc/admin_religar_julgado_${VOCABULARIO[orgao].sufixo}`, {
        method: 'POST',
        body: JSON.stringify({ p_id: linha.id, p_motivo: motivo })
      });
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
