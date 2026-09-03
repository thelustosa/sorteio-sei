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
    interessado: false,
    arquivo: 'historico-cj',
    // A ata em .docx segue o padrão da AGR, que aqui difere do que a tela
    // mostra: a Câmara distribui por RELATOR, e a ata publica o nome de quem
    // vai relatar — não o código da cadeira (`destino`) que a tabela usa para
    // poder mostrar o ocupante da época só no hover. A ata do CJ também não
    // agrupa as linhas: fica na mesma ordem de sorteio que a tela já lista.
    docx: {
      agrupar: false,
      colunas: [
        { rotulo: 'Ordem', campo: 'ordem', pct: 600 },
        { rotulo: 'Nº do Processo', campo: 'num_processo', pct: 2200 },
        { rotulo: 'Relator', campo: 'responsavel', pct: 2200 }
      ],
      // Sem o número da Resolução Normativa que designa a composição da
      // Câmara: essa informação não fica gravada por sorteio, e citar um
      // número aqui arriscaria uma ata com uma resolução desatualizada.
      introducao: (dia, mes, ano) => `Aos ${dia} dias do mês de ${mes} de ${ano} na sede da `
        + `Agência Goiana de Regulação, Controle e Fiscalização de Serviços Públicos – AGR, `
        + `realizou-se a distribuição de processos para análise, elaboração de relatório e voto `
        + `entre os integrantes da Câmara de Julgamento, através de sorteio eletrônico.`
    }
  },
  creg: {
    sigla: 'CREG',
    nome: 'Conselho Regulador',
    sujeito: 'O Conselho Regulador',
    destinos: 'Unidades',
    destino: 'Unidade',
    decisao: 'Recurso',
    interessado: true,
    arquivo: 'historico-creg',
    // A ata do Conselho agrupa as linhas por unidade — todas as de uma
    // unidade juntas, unidades em ordem crescente, ordem de sorteio dentro de
    // cada grupo — diferente da tela, que lista pela ordem pura do sorteio.
    // Só a exportação reorganiza; os dados voltam do banco como sempre.
    docx: {
      agrupar: true,
      colunas: [
        { rotulo: 'Ordem', campo: 'ordem', pct: 500 },
        { rotulo: 'Nº do Processo', campo: 'num_processo', pct: 1800 },
        { rotulo: 'Interessado', campo: 'interessado', pct: 1800 },
        { rotulo: 'Unidade', campo: 'destino', pct: 900 }
      ],
      introducao: (dia, mes, ano) => `Aos ${dia} dias do mês de ${mes} de ${ano} na sede da `
        + `Agência Goiana de Regulação, Controle e Fiscalização de Serviços Públicos, realizou-se `
        + `a distribuição de processos por sorteio eletrônico.`
    }
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
const btnExportarDetalhe = document.getElementById('btnExportarDetalhe');
// Cada abertura invalida a anterior: fechar no Escape durante uma busca lenta e
// clicar noutra rodada deixaria a resposta atrasada chegar por último e
// sobrescrever o card — título de um sorteio, lista de outro.
let detalhePedido = 0;
// O que está aberto no card agora: só o que está nele pode ser exportado, e só
// depois que a lista chega — nunca a resposta de uma busca que já saiu de foco.
let detalheAtual = null;

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
btnExportarDetalhe.addEventListener('click', exportarDetalheDocx);
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

function dataHoraBR() {
  const agora = new Date();
  return `${agora.toLocaleDateString('pt-BR')} às ${agora.toLocaleTimeString('pt-BR', {
    hour: '2-digit', minute: '2-digit'
  })}`;
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

// Cada pill também é a porta de entrada do card filtrado: um clique nele abre
// exatamente os processos daquele destino, sem passar pela rodada inteira.
function celulaDestinos(sorteio) {
  const celulaEl = celula('', 'td', 'historico-destinos');
  const distribuicao = distribuicaoDo(sorteio);
  if (!distribuicao.length) {
    celulaEl.textContent = '—';
    return celulaEl;
  }

  const { data, carimbo } = identidade(sorteio);
  const lista = document.createElement('span');
  lista.className = 'historico-destinos-lista';
  const descricoes = [];

  distribuicao.forEach(({ destino, processos }) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'historico-destino';
    Object.assign(item.dataset, { data, carimbo, destino });
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
      item.setAttribute('aria-label', `Ver os ${quantidadeProcessos(processos)} de ${destino}`);
    } else {
      descricoes.push(destino);
      item.setAttribute('aria-label', `Ver os processos de ${destino}`);
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
  historicoAtualizado.textContent = `Atualizado em: ${dataHoraBR()}`;
  historicoVazio.hidden = lista.length > 0;
  return true;
}

// ── Card com os processos de um sorteio ──────────────────────────────────────
// A lista conta; o card mostra o que foi sorteado. Quem responde é
// processos_sorteio, com o MESMO recorte de origem da lista — se as duas
// divergirem, o card abre um número diferente do que a linha mostrava.

function abrirDetalheDaLinha(evento) {
  const botao = evento.target.closest('.historico-ver, .historico-destino');
  if (botao && historicoTabela.contains(botao)) abrirDetalhe(botao);
}

async function abrirDetalhe(botao) {
  const { data, carimbo, destino } = botao.dataset;
  const hora = horaBR(carimbo);
  const pedido = ++detalhePedido;
  detalheAtual = null;

  detalheTitulo.textContent = destino ? `Sorteio de ${dataBR(data)} — ${destino}` : `Sorteio de ${dataBR(data)}`;
  detalheResumo.textContent = 'Carregando…';
  detalheTabela.replaceChildren();
  detalheErro.hidden = true;
  detalheCorpo.hidden = true;
  detalheLoading.hidden = false;
  detalheLoading.replaceChildren(criarIndicadorCarregamento('Carregando processos…'));
  btnExportarDetalhe.disabled = true;
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
  // O filtro por destino é feito aqui, não no banco: processos_sorteio já traz
  // a rodada inteira, e uma rodada tem no máximo algumas dezenas de processos —
  // não vale uma RPC nova só para recortar o que já chegou.
  const lista = destino ? (processos || []).filter(p => p.destino === destino) : (processos || []);
  detalheAtual = { data, destino, processos: lista };
  btnExportarDetalhe.disabled = lista.length === 0;
  desenharDetalhe(lista, hora);
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

// ── Exportar a ata do sorteio em .docx ───────────────────────────────────────
// O arquivo segue o padrão visual e estrutural das atas que a AGR publica:
// cabeçalho institucional em texto (sem imagem, sem numeração de ata),
// parágrafo de abertura e a tabela do sorteio — sem Assunto/Decisão, que
// existem no card mas não na ata oficial.
//
// Sem biblioteca nova: um .docx também é um zip com XML dentro (WordprocessingML,
// em vez do SpreadsheetML do .xlsx), e o projeto já monta esse zip à mão para o
// Excel do acervo. `criarZip`/`crc32`/`escaparXml`/`baixarArquivo` são cópias
// dos mesmos utilitários — não há um arquivo compartilhado entre as páginas, e
// acervo.js e index.js já duplicam essas funções entre si.

function baixarArquivo(blob, nome) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Alguns navegadores só assumem o Blob depois que a navegação de download
  // avança; revogá-lo no mesmo ciclo pode cancelar um arquivo válido.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function escaparXml(valor) {
  return String(valor).replace(/[&<>"']/g, caractere => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&apos;'
  })[caractere]);
}

function crc32(bytes) {
  let crc = 0xffffffff;
  for (const byte of bytes) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function inteiro(buffer, deslocamento, valor, bytes) {
  for (let i = 0; i < bytes; i++) buffer[deslocamento + i] = (valor >>> (i * 8)) & 0xff;
}

function criarZip(arquivos) {
  const encoder = new TextEncoder();
  const locais = [];
  const centrais = [];
  let deslocamento = 0;

  for (const [nome, conteudo] of arquivos) {
    const nomeBytes = encoder.encode(nome);
    const dados = encoder.encode(conteudo);
    const crc = crc32(dados);
    const local = new Uint8Array(30 + nomeBytes.length + dados.length);
    inteiro(local, 0, 0x04034b50, 4); inteiro(local, 4, 20, 2); inteiro(local, 6, 0x0800, 2);
    inteiro(local, 14, crc, 4); inteiro(local, 18, dados.length, 4); inteiro(local, 22, dados.length, 4);
    inteiro(local, 26, nomeBytes.length, 2); local.set(nomeBytes, 30); local.set(dados, 30 + nomeBytes.length);
    locais.push(local);

    const central = new Uint8Array(46 + nomeBytes.length);
    inteiro(central, 0, 0x02014b50, 4); inteiro(central, 4, 20, 2); inteiro(central, 6, 20, 2);
    inteiro(central, 8, 0x0800, 2); inteiro(central, 16, crc, 4); inteiro(central, 20, dados.length, 4);
    inteiro(central, 24, dados.length, 4); inteiro(central, 28, nomeBytes.length, 2);
    inteiro(central, 42, deslocamento, 4); central.set(nomeBytes, 46);
    centrais.push(central);
    deslocamento += local.length;
  }

  const tamanhoCentral = centrais.reduce((total, parte) => total + parte.length, 0);
  const fim = new Uint8Array(22);
  inteiro(fim, 0, 0x06054b50, 4); inteiro(fim, 8, arquivos.length, 2); inteiro(fim, 10, arquivos.length, 2);
  inteiro(fim, 12, tamanhoCentral, 4); inteiro(fim, 16, deslocamento, 4);
  return new Blob([...locais, ...centrais, fim],
    { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' });
}

const DOCX_TIPOS = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">'
  + '<Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>'
  + '<Default Extension="xml" ContentType="application/xml"/>'
  + '<Override PartName="/word/document.xml" '
  + 'ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>'
  + '</Types>';
const DOCX_RELACOES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
  + '<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">'
  + '<Relationship Id="rId1" '
  + 'Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" '
  + 'Target="word/document.xml"/></Relationships>';
// Uma borda simples em toda a tabela, para não sair sem contorno nenhum no
// Word — o schema exige as seis direções, mesmo repetindo o mesmo traço.
const DOCX_TABELA_BORDAS = ['top', 'left', 'bottom', 'right', 'insideH', 'insideV']
  .map(lado => `<w:${lado} w:val="single" w:sz="4" w:space="0" w:color="000000"/>`).join('');
const DOCX_SECAO = '<w:sectPr><w:pgSz w:w="11906" w:h="16838"/>'
  + '<w:pgMar w:top="1417" w:right="1133" w:bottom="1417" w:left="1701" w:header="708" w:footer="708" '
  + 'w:gutter="0"/></w:sectPr>';

const MESES_POR_EXTENSO = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho',
  'agosto', 'setembro', 'outubro', 'novembro', 'dezembro'];

// dd, mês por extenso e aaaa para o parágrafo de abertura da ata. Sem passar
// por toLocaleDateString: o nome do mês sairia dependente da ICU do motor, e a
// ata precisa da mesma grafia sempre.
function dataPorExtenso(iso) {
  const [ano, mes, dia] = String(iso).slice(0, 10).split('-').map(Number);
  return { dia, mes: MESES_POR_EXTENSO[mes - 1] || '', ano };
}

function paragrafoXml(texto, { negrito = false, centralizado = false, justificado = false } = {}) {
  const pPr = centralizado ? '<w:pPr><w:jc w:val="center"/></w:pPr>'
    : justificado ? '<w:pPr><w:jc w:val="both"/></w:pPr>' : '';
  const rPr = negrito ? '<w:rPr><w:b/></w:rPr>' : '';
  return `<w:p>${pPr}<w:r>${rPr}<w:t xml:space="preserve">${escaparXml(texto)}</w:t></w:r></w:p>`;
}

function celulaDocxXml(texto, { negrito = false, pct } = {}) {
  return `<w:tc><w:tcPr><w:tcW w:w="${pct}" w:type="pct"/></w:tcPr>`
    + `${paragrafoXml(texto, { negrito })}</w:tc>`;
}

// O cabeçalho institucional das atas da AGR, sem a imagem do brasão (que o
// card não tem como reproduzir) e sem "ATA Nº ..." — a exportação registra o
// conteúdo do sorteio, não substitui a ata assinada eletronicamente no SEI.
function cabecalhoInstitucionalXml() {
  return [
    'ESTADO DE GOIÁS',
    'AGÊNCIA GOIANA DE REGULAÇÃO, CONTROLE E FISCALIZAÇÃO DE SERVIÇOS PÚBLICOS',
    COL.nome.toLocaleUpperCase('pt-BR')
  ].map(linha => paragrafoXml(linha, { negrito: true, centralizado: true })).join('')
    + paragrafoXml('');
}

function valorDaColunaDocx(processo, campo) {
  if (campo === 'ordem') return processo.ordem ?? '—';
  return processo[campo] || '—';
}

// A ata do Conselho agrupa por unidade (todas as linhas de uma unidade juntas,
// unidades em ordem crescente); a da Câmara não agrupa — cada colegiado usa o
// mesmo `agrupar` que já escolhe as colunas.
function processosParaDocx(processos) {
  if (!COL.docx.agrupar) return processos;
  return [...processos].sort((a, b) => {
    const grupo = String(a.destino).localeCompare(String(b.destino), 'pt-BR', { numeric: true });
    return grupo || ((Number(a.ordem) || 0) - (Number(b.ordem) || 0));
  });
}

// A largura que sobra entre as margens do DOCX_SECAO, em twips. É a régua do
// <w:tblGrid>, que só aceita medida absoluta — o `pct` das colunas é convertido
// contra ela.
const DOCX_LARGURA_UTIL = 11906 - 1701 - 1133;

// O <w:tblGrid> é obrigatório no CT_Tbl e tem de vir logo depois do <w:tblPr>:
// sem ele o Word não abre a ata, oferece reparar o arquivo. Os testes só liam o
// XML cru e passavam com a tabela inválida do mesmo jeito.
//
// O arredondamento é cumulativo — cada coluna recebe a diferença entre o seu
// acumulado e o da anterior — para que a soma feche a largura útil exata em vez
// de escorregar um twip por coluna arredondada.
function gradeDocxXml(colunas) {
  const total = colunas.reduce((soma, c) => soma + c.pct, 0);
  let acumulado = 0;
  let anterior = 0;
  const grade = colunas.map(c => {
    acumulado += c.pct;
    const limite = Math.round(acumulado / total * DOCX_LARGURA_UTIL);
    const largura = limite - anterior;
    anterior = limite;
    return `<w:gridCol w:w="${largura}"/>`;
  }).join('');
  return `<w:tblGrid>${grade}</w:tblGrid>`;
}

function tabelaDocxXml(processos) {
  const colunas = COL.docx.colunas;
  const cabecalho = `<w:tr>${colunas.map(c => celulaDocxXml(c.rotulo, { negrito: true, pct: c.pct })).join('')}</w:tr>`;
  const linhas = processosParaDocx(processos).map(processo =>
    `<w:tr>${colunas.map(c => celulaDocxXml(String(valorDaColunaDocx(processo, c.campo)), { pct: c.pct })).join('')}</w:tr>`
  ).join('');
  return `<w:tbl><w:tblPr><w:tblW w:w="5000" w:type="pct"/><w:tblBorders>${DOCX_TABELA_BORDAS}</w:tblBorders></w:tblPr>`
    + `${gradeDocxXml(colunas)}${cabecalho}${linhas}</w:tbl>`;
}

// `data` é a da própria rodada (aaaa-mm-dd), não a de hoje: a ata registra
// quando o sorteio aconteceu, não quando foi exportada.
function criarDocxDetalhe(processos, data) {
  const { dia, mes, ano } = dataPorExtenso(data);
  const corpo = cabecalhoInstitucionalXml()
    + paragrafoXml(COL.docx.introducao(dia, mes, ano), { justificado: true })
    + paragrafoXml('')
    + tabelaDocxXml(processos)
    + DOCX_SECAO;
  const documentoXml = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>'
    + '<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">'
    + `<w:body>${corpo}</w:body></w:document>`;
  return criarZip([
    ['[Content_Types].xml', DOCX_TIPOS], ['_rels/.rels', DOCX_RELACOES],
    ['word/document.xml', documentoXml]
  ]);
}

function exportarDetalheDocx() {
  if (!detalheAtual || !detalheAtual.processos.length) return;
  // Reaproveita o alerta que o card já tem: sem aviso, uma falha ao montar o
  // arquivo é indistinguível de um download que o navegador engoliu.
  detalheErro.hidden = true;
  try {
    const nome = [COL.arquivo, detalheAtual.data, detalheAtual.destino].filter(Boolean).join('-');
    baixarArquivo(criarDocxDetalhe(detalheAtual.processos, detalheAtual.data), `${nome}.docx`);
  } catch (erro) {
    detalheErro.querySelector('p').textContent = `Não foi possível gerar o arquivo (${erro.message}).`;
    detalheErro.hidden = false;
  }
}
