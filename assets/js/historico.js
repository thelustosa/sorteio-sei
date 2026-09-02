// Histórico de sorteios: quais rodadas já foram feitas, quando, para quem, e
// quais processos entraram em cada uma.
//
// O agrupamento não é feito aqui. Os dois acervos são fechados ao navegador —
// só têm política de INSERT (ver schema.sql) —, então quem reúne as linhas em
// rodadas é a função historico_sorteios e quem lista os processos de uma delas
// é processos_sorteio. As duas só leem: abrir o histórico não altera registro
// nenhum, e esta página não tem um único caminho de escrita.
//
// A mesma página serve os dois colegiados, como o painel do acervo: o que muda
// entre eles cabe na tabela abaixo — a sigla que vai para o banco e o
// vocabulário das colunas. Quem escolhe é o data-colegiado do <body>.
const COLEGIADOS = {
  cj: {
    sigla: 'CJ',
    nome: 'Câmara de Julgamento',
    // Com o artigo junto: 'A Câmara' e 'O Conselho' não saem do mesmo molde, e
    // a frase do estado vazio sairia sem artigo nenhum se montada com `nome`.
    sujeito: 'A Câmara de Julgamento',
    destinos: 'Cadeiras',
    destino: 'Cadeira',
    // Na Câmara a coluna de decisão registra se o autuado apresentou DEFESA.
    decisao: 'Defesa',
    // O interessado é campo livre que só a tela do sorteio do Conselho
    // preenche: na Câmara a coluna nem existe no acervo.
    interessado: false
  },
  creg: {
    sigla: 'CREG',
    nome: 'Conselho Regulador',
    sujeito: 'O Conselho Regulador',
    destinos: 'Unidades',
    destino: 'Unidade',
    decisao: 'Recurso',
    interessado: true
  }
};

const COL = COLEGIADOS[document.body.dataset.colegiado] || COLEGIADOS.cj;

// O dia em que a série começa, igual para os dois colegiados: 27/08/2026, o
// primeiro sorteio feito nesta tela. Quem corta é o banco — a função
// historico_marco, chamada pelas duas RPCs —, e esta cópia existe só para a
// tela poder DIZER a data. Um teste compara as duas; se divergirem, a frase
// mentiria sobre o recorte que o banco aplicou.
const INICIO_DA_SERIE = '2026-08-27';

const COLUNAS = ['Data', 'Horário', 'Processos', COL.destinos, 'Detalhes'];

const historicoPanel = document.getElementById('historicoPanel');
const historicoTabela = document.getElementById('historicoTable');
const historicoVazio = document.getElementById('historicoVazio');
const historicoVazioTexto = document.getElementById('historicoVazioTexto');
const historicoInicio = document.getElementById('historicoInicio');
const historicoErro = document.getElementById('historicoErro');
const historicoTotal = document.getElementById('historicoTotal');
const historicoAtualizado = document.getElementById('historicoAtualizado');
const btnAtualizar = document.getElementById('btnAtualizar');
const btnTentarNovamente = document.getElementById('btnTentarNovamente');
const loginOnlyCard = document.querySelector('[data-login-only]');
const detalheDialog = document.getElementById('detalheDialog');
const detalheTitulo = document.getElementById('detalheTitulo');
const detalheResumo = document.getElementById('detalheResumo');
const detalheLoading = document.getElementById('detalheLoading');
const detalheCorpo = document.getElementById('detalheCorpo');
const detalheTabela = document.getElementById('detalheTable');
const detalheErro = document.getElementById('detalheErro');
const btnFecharDetalhe = document.getElementById('btnFecharDetalhe');
// Cada abertura invalida a anterior: fechar no Escape durante uma busca lenta e
// clicar noutra rodada deixaria a resposta atrasada chegar por último e
// sobrescrever o card — título de um sorteio, lista de outro.
let detalhePedido = 0;

// A data de início entra assim que o script carrega: ela não depende da
// resposta do banco, e escrevê-la só depois deixaria o rodapé piscando.
historicoInicio.textContent = `Série iniciada em ${dataBR(INICIO_DA_SERIE)}`;
historicoVazioTexto.textContent = `O histórico reúne os sorteios realizados no sistema a partir de `
  + `${dataBR(INICIO_DA_SERIE)}. ${COL.sujeito} não distribuiu processos nesse período — o próximo `
  + `sorteio aparece aqui assim que for realizado.`;

btnAtualizar.addEventListener('click', () => carregarHistorico());
btnTentarNovamente.addEventListener('click', () => carregarHistorico());
historicoTabela.addEventListener('click', abrirDetalheDaLinha);
btnFecharDetalhe.addEventListener('click', () => detalheDialog.close());
// Clique no ::backdrop chega como clique no próprio dialog: fechar ali é o que
// a pessoa espera de um card modal, e o <dialog> não faz isso sozinho.
detalheDialog.addEventListener('click', evento => {
  if (evento.target === detalheDialog) detalheDialog.close();
});

async function inicializarHistorico() {
  const carregado = await carregarHistorico({ carregamentoInicial: true });
  if (!carregado) return;

  // Troca atômica: o loading geral sai e o painel entra já completo.
  // "Atualizar" só aparece junto com a lista — revelado antes, ele redesenharia
  // uma tabela ainda escondida e o clique "funcionaria" sem nada mudar na tela.
  if (loginOnlyCard) loginOnlyCard.hidden = true;
  historicoPanel.hidden = false;
  btnAtualizar.hidden = false;
}

function hojeBR() {
  return new Date().toLocaleDateString('pt-BR');
}

// aaaa-mm-dd → dd/mm/aaaa, sem passar por Date: o construtor lê data pura como
// UTC e, em fuso negativo, devolveria o dia anterior.
function dataBR(iso) {
  const [ano, mes, dia] = String(iso).slice(0, 10).split('-');
  return `${dia}/${mes}/${ano}`;
}

// O dia da semana é do calendário local, montado a partir das partes pela mesma
// razão: `new Date('2026-08-27')` é meia-noite em UTC, que aqui ainda é dia 26.
//
// A maiúscula é feita aqui, e só na primeira letra: `text-transform: capitalize`
// no CSS devolveria "Quinta-Feira", que não é como se escreve em português.
function diaDaSemana(iso) {
  const [ano, mes, dia] = String(iso).slice(0, 10).split('-').map(Number);
  if (!ano || !mes || !dia) return '';
  const nome = new Date(ano, mes - 1, dia).toLocaleDateString('pt-BR', { weekday: 'long' });
  return nome.charAt(0).toLocaleUpperCase('pt-BR') + nome.slice(1);
}

// O carimbo é um instante (timestamptz): convertido para o relógio de quem lê,
// que é o mesmo de quem sorteou. Ele é opcional no acervo — uma carga em lote
// pode deixá-lo vazio —, e nesse caso a coluna fica com o travessão em vez de
// uma hora inventada.
function horaBR(carimbo) {
  if (!carimbo) return '';
  const instante = new Date(carimbo);
  return Number.isNaN(instante.getTime())
    ? ''
    : instante.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
}

const quantidadeProcessos = total => total === 1 ? '1 processo' : `${total} processos`;
const quantidadeSorteios = total => total === 1 ? '1 sorteio' : `${total} sorteios`;

function celula(texto, tag = 'td', classe = '') {
  const el = document.createElement(tag);
  if (tag === 'th') el.scope = classe === 'linha' ? 'row' : 'col';
  if (classe && classe !== 'linha') el.className = classe;
  // String() explícito: o DOM converteria sozinho, mas deixar number aqui
  // tornaria o valor da célula dependente do motor em vez do código.
  el.textContent = String(texto);
  return el;
}

// A chave da rodada viaja no dataset e volta inteira para a função do banco.
// `sorteado_em` ausente fica vazio aqui e sai como null na chamada, que é o que
// o `is not distinct from` espera do outro lado.
function identidade(sorteio) {
  return {
    data: String(sorteio.data_sorteio).slice(0, 10),
    carimbo: sorteio.sorteado_em || ''
  };
}

// Durante o deploy a página nova pode encontrar a RPC antiga por alguns
// instantes. Nesse caso as siglas continuam aparecendo, apenas sem inventar uma
// contagem. Quando `distribuicao` existe, cada número vem da mesma agregação que
// calcula o total da rodada no banco.
function distribuicaoDo(sorteio) {
  const itens = Array.isArray(sorteio.distribuicao)
    ? sorteio.distribuicao
    : (sorteio.destinos || []).map(destino => ({ destino, processos: null }));

  return itens
    .filter(item => item && String(item.destino || '').trim())
    .map(item => {
      const numero = item.processos == null ? null : Number(item.processos);
      return {
        destino: String(item.destino).trim(),
        processos: Number.isInteger(numero) && numero >= 0 ? numero : null
      };
    });
}

function celulaDestinos(sorteio) {
  const celulaEl = celula('', 'td', 'historico-destinos');
  const distribuicao = distribuicaoDo(sorteio);
  if (!distribuicao.length) {
    celulaEl.textContent = '—';
    return celulaEl;
  }

  const lista = document.createElement('span');
  lista.className = 'historico-destinos-lista';
  const descricoes = [];

  distribuicao.forEach(({ destino, processos }) => {
    const item = document.createElement('span');
    item.className = 'historico-destino';
    const sigla = document.createElement('span');
    sigla.className = 'historico-destino-sigla';
    sigla.textContent = destino;
    item.append(sigla);

    if (processos !== null) {
      const contagem = document.createElement('span');
      contagem.className = 'historico-destino-contagem';
      contagem.textContent = String(processos);
      item.append(contagem);
      descricoes.push(`${destino}: ${quantidadeProcessos(processos)}`);
    } else {
      descricoes.push(destino);
    }

    lista.append(item);
  });

  celulaEl.setAttribute('aria-label', descricoes.join('; '));
  celulaEl.append(lista);
  return celulaEl;
}

// Uma linha por rodada, na ordem que o banco devolveu — da mais recente para a
// mais antiga. A data é a identidade da linha, e por isso é o <th> dela.
function desenhar(sorteios) {
  // Sem rodada nenhuma a tabela sai inteira, cabeçalho incluído: o estado vazio
  // logo acima já explicou o que houve, e uma faixa de colunas sobre o nada só
  // faz a tela parecer meio carregada.
  if (!sorteios.length) {
    historicoTabela.replaceChildren();
    return;
  }

  const thead = document.createElement('thead');
  const cabecalho = document.createElement('tr');
  COLUNAS.forEach(rotulo => cabecalho.append(celula(rotulo, 'th')));
  thead.append(cabecalho);

  const tbody = document.createElement('tbody');
  sorteios.forEach(sorteio => {
    const { data, carimbo } = identidade(sorteio);
    const tr = document.createElement('tr');

    // Data e dia da semana em duas linhas: a data é o que se procura, o dia da
    // semana é o que confirma que se achou a sessão certa.
    const celulaData = document.createElement('th');
    celulaData.scope = 'row';
    celulaData.className = 'historico-data';
    const dia = document.createElement('span');
    dia.className = 'historico-data-dia';
    dia.textContent = dataBR(data);
    const semana = document.createElement('span');
    semana.className = 'historico-data-semana';
    semana.textContent = diaDaSemana(data);
    celulaData.append(dia, semana);
    tr.append(celulaData);

    const hora = horaBR(carimbo);
    const celulaHora = celula(hora || '—', 'td', 'historico-hora');
    if (!hora) {
      celulaHora.title = 'Rodada gravada sem o horário do sorteio';
      celulaHora.setAttribute('aria-label', 'Horário não registrado');
    }
    tr.append(celulaHora);

    tr.append(celula(sorteio.processos, 'td', 'historico-numero'));

    // Cada destino leva a sua parcela da rodada. A soma desses números é o total
    // da coluna anterior; juntos eles respondem "quantos foram para quem".
    tr.append(celulaDestinos(sorteio));

    // O alvo é um <button> dentro do <td>: a célula precisa continuar sendo
    // célula para o leitor de tela, e o botão nativo já traz foco, Enter e
    // Espaço sem handler nenhum.
    const acao = document.createElement('td');
    acao.className = 'historico-acao';
    const botao = document.createElement('button');
    botao.type = 'button';
    botao.className = 'button-secondary historico-ver';
    botao.textContent = 'Ver processos';
    const quando = hora ? `${dataBR(data)} às ${hora}` : dataBR(data);
    botao.setAttribute('aria-label',
      `Ver os ${quantidadeProcessos(sorteio.processos)} do sorteio de ${quando}`);
    Object.assign(botao.dataset, { data, carimbo });
    acao.append(botao);
    tr.append(acao);

    tbody.append(tr);
  });

  historicoTabela.replaceChildren(thead, tbody);
}

async function carregarHistorico({ carregamentoInicial = false } = {}) {
  historicoErro.hidden = true;
  historicoVazio.hidden = true;
  historicoAtualizado.textContent = 'Carregando…';
  btnAtualizar.disabled = true;
  btnAtualizar.setAttribute('aria-busy', 'true');
  historicoPanel.setAttribute('aria-busy', 'true');

  let sorteios;
  try {
    sorteios = await api('rpc/historico_sorteios', {
      method: 'POST',
      body: JSON.stringify({ p_colegiado: COL.sigla })
    });
  } catch (err) {
    if (carregamentoInicial) throw err;
    historicoTabela.replaceChildren();
    // O total é do histórico que acabou de sair da tela: mantê-lo anunciaria N
    // sorteios acima de uma tabela vazia.
    historicoTotal.textContent = '';
    historicoAtualizado.textContent = 'Atualização indisponível';
    historicoErro.querySelector('p').textContent = `Não foi possível carregar o histórico (${err.message}).`;
    historicoErro.hidden = false;
    return false;
  } finally {
    btnAtualizar.disabled = false;
    btnAtualizar.removeAttribute('aria-busy');
    historicoPanel.removeAttribute('aria-busy');
  }

  const lista = sorteios || [];
  desenhar(lista);
  const processos = lista.reduce((soma, s) => soma + (Number(s.processos) || 0), 0);
  historicoTotal.textContent = `${quantidadeSorteios(lista.length)} · ${quantidadeProcessos(processos)}`;
  historicoAtualizado.textContent = `Atualizado em: ${hojeBR()}`;
  historicoVazio.hidden = lista.length > 0;
  return true;
}

// ── Card com os processos de um sorteio ──────────────────────────────────────
// A lista conta; o card mostra o que foi sorteado. Quem responde é
// processos_sorteio, com o MESMO recorte de origem da lista — se as duas
// divergirem, o card abre um número diferente do que a linha mostrava.

function abrirDetalheDaLinha(evento) {
  const botao = evento.target.closest('.historico-ver');
  if (botao && historicoTabela.contains(botao)) abrirDetalhe(botao);
}

async function abrirDetalhe(botao) {
  const { data, carimbo } = botao.dataset;
  const hora = horaBR(carimbo);
  const pedido = ++detalhePedido;

  detalheTitulo.textContent = `Sorteio de ${dataBR(data)}`;
  detalheResumo.textContent = 'Carregando…';
  detalheTabela.replaceChildren();
  detalheErro.hidden = true;
  detalheCorpo.hidden = true;
  detalheLoading.hidden = false;
  detalheLoading.replaceChildren(criarIndicadorCarregamento('Carregando processos…'));
  // showModal antes da busca: o card aparece com o loading em vez de a tela
  // ficar parada sem resposta ao clique.
  if (!detalheDialog.open) detalheDialog.showModal();

  let processos;
  try {
    processos = await api('rpc/processos_sorteio', {
      method: 'POST',
      body: JSON.stringify({
        p_colegiado: COL.sigla,
        p_data: data,
        // Vazio é a rodada sem carimbo: precisa chegar como null para o
        // `is not distinct from` do banco casar com as linhas dela.
        p_sorteado_em: carimbo || null
      })
    });
  } catch (err) {
    if (pedido !== detalhePedido) return;
    detalheLoading.hidden = true;
    detalheLoading.replaceChildren();
    detalheCorpo.hidden = true;
    detalheResumo.textContent = '';
    detalheErro.querySelector('p').textContent = `Não foi possível carregar os processos (${err.message}).`;
    detalheErro.hidden = false;
    return;
  }

  if (pedido !== detalhePedido) return;
  detalheLoading.hidden = true;
  detalheLoading.replaceChildren();
  detalheCorpo.hidden = false;
  desenharDetalhe(processos || [], hora);
}

function desenharDetalhe(processos, hora) {
  detalheResumo.textContent = [COL.nome, quantidadeProcessos(processos.length), hora && `às ${hora}`]
    .filter(Boolean).join(' · ');

  const thead = document.createElement('thead');
  const cabecalho = document.createElement('tr');
  ['Ordem', 'Nº do Processo', COL.destino,
   ...(COL.interessado ? ['Interessado'] : []),
   'Assunto', COL.decisao]
    .forEach(rotulo => cabecalho.append(celula(rotulo, 'th')));
  thead.append(cabecalho);

  const tbody = document.createElement('tbody');
  processos.forEach(p => {
    const tr = document.createElement('tr');
    // Rodada gravada sem a ordem do sorteio: travessão, e não um número
    // inventado a partir da posição na lista.
    tr.append(celula(p.ordem ?? '—'));
    tr.append(celula(p.num_processo, 'th', 'linha'));

    const destino = celula(p.destino || '—');
    // A cadeira sozinha não diz quem é. O responsável vem da mesma resposta,
    // com o ocupante da época — o hover e o leitor de tela o anunciam em vez de
    // soletrar "CJ3" em cada linha.
    if (p.responsavel && p.responsavel !== p.destino) {
      destino.title = p.responsavel;
      destino.setAttribute('aria-label', `${p.destino} — ${p.responsavel}`);
    }
    tr.append(destino);

    // Nome de pessoa e assunto não cabem numa coluna que não quebra linha.
    if (COL.interessado) tr.append(celula(p.interessado || '—', 'td', 'historico-livre'));
    tr.append(celula(p.assunto || '—', 'td', 'historico-livre'));
    tr.append(celula(p.decisao || '—'));
    tbody.append(tr);
  });

  detalheTabela.replaceChildren(thead, tbody);
}
