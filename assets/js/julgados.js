// Registro do voto e do status dos processos julgados.
//
// Os julgados chegam das pautas publicadas pela AGR (ver sincronizacao/), que
// são convocação: trazem o processo e a data da sessão, mas voto e status ficam
// nulos porque só existem depois da sessão. Esta página é onde a secretaria
// preenche os dois.
//
// A gravação não é UPDATE direto: vai pela função registrar_votos (ou
// registrar_votos_creg) do banco, que valida as escolhas e anota quem preencheu.
// O destino da Vista (cadeira na CJ, unidade no CREG) é gravado junto com voto
// e status, e o banco devolve o processo ao acervo nele.
//
// A mesma página serve os dois colegiados, como o histórico e o painel do
// acervo: o que muda entre eles cabe em COLEGIADOS, e quem escolhe é o
// data-colegiado do <body>.
const COLEGIADOS = {
  cj: {
    // Os mesmos rótulos que registrar_votos aceita. Mudou aqui, muda lá.
    votos: ['Manter', 'Anular', 'Retirado', 'Vista'],
    status: ['Julgado', 'Retornou', 'Retirado', 'Vista'],
    tabela: 'julgados_cj',
    rpc: 'rpc/registrar_votos',
    // A coluna é a CADEIRA (CJ1..CJ5). Sem o de-para ela mostraria só "CJ3": o
    // nome do conselheiro vai no hover e no aria-label, como nas outras telas.
    destino: 'relator',
    mostraConselheiro: true,
    // Vista e Retirado devolvem o processo ao acervo (julgados_cj_retorno):
    // Vista na cadeira escolhida na janela, Retirado na que levou à sessão.
    vista: {
      campo: 'cadeira_vista', destinos: ['CJ1', 'CJ2', 'CJ3', 'CJ4', 'CJ5'],
      nome: 'cadeira', atualValida: /^CJ[1-9][0-9]*$/
    },
    sujeito: 'a Câmara',
    pautas: 'pautas',
    pauta: 'pauta',
    reuniao: 'reunião'
  },
  creg: {
    // Os de registrar_votos_creg: sete votos e cinco status, porque o Conselho
    // julga além de auto de infração, e a lista acompanha.
    votos: ['Manter', 'Anular', 'Aprovação', 'Indeferimento', 'Extinção', 'Retirado', 'Vista'],
    status: ['Julgado', 'Retirado', 'Vista', 'Sobrestado', 'Prejudicado'],
    tabela: 'julgados_creg',
    rpc: 'rpc/registrar_votos_creg',
    // A UNIDADE (CREG1..CREG4), e para por aí: os responsáveis pelas unidades
    // pediram para não ter os nomes vinculados aos processos (ver FLUXO-CREG.md).
    destino: 'unidade',
    mostraConselheiro: false,
    // A mesma regra da Câmara, com a unidade no lugar da cadeira
    // (julgados_creg_retorno).
    vista: {
      campo: 'unidade_vista', destinos: ['CREG1', 'CREG2', 'CREG3', 'CREG4'],
      nome: 'unidade', atualValida: /^CREG[1-4]$/
    },
    sujeito: 'o Conselho',
    pautas: 'sessões',
    pauta: 'sessão',
    reuniao: 'sessão'
  }
};

const COL = COLEGIADOS[document.body.dataset.colegiado] || COLEGIADOS.cj;
const VOTOS = COL.votos;
const ROTULOS_DAS_COLUNAS = ['Nº Processo', COL.destino === 'relator' ? 'Relator' : 'Unidade',
  ...(COL === COLEGIADOS.creg ? ['Assunto'] : []), 'Voto', 'Status'];
const STATUS = COL.status;

const listaPautas = document.getElementById('listaPautas');
const pautasContainer = document.getElementById('pautasContainer');
const semPendencia = document.getElementById('semPendencia');
const pautasIntro = document.getElementById('pautasIntro');
const detalhePauta = document.getElementById('detalhePauta');
const tituloPauta = document.getElementById('tituloPauta');
const tbody = document.querySelector('#julgadosTable tbody');
const contadorPendentes = document.getElementById('contadorPendentes');
const btnSalvar = document.getElementById('btnSalvar');
const btnVoltar = document.getElementById('btnVoltar');
const btnVoltarInicio = document.getElementById('btnVoltarInicio');
const btnTodosManter = document.getElementById('btnTodosManter');
const btnTodosJulgado = document.getElementById('btnTodosJulgado');
const txtModo = document.getElementById('txtModo');
const listaPautasTitulo = document.getElementById('listaPautasTitulo');
const dialogUnidadeVista = document.getElementById('dialogUnidadeVista');
const formUnidadeVista = document.getElementById('formUnidadeVista');
const resumoUnidadeVista = document.getElementById('resumoUnidadeVista');
const unidadeDestinoVista = document.getElementById('unidadeDestinoVista');
const erroUnidadeVista = document.getElementById('erroUnidadeVista');
const VISTA = COL.vista;
// Vista e Retirado devolvem o processo ao acervo, nos dois colegiados pela
// mesma regra: o voto decide, e o banco só aceita esses rótulos com voto e
// status iguais quando os dois estão preenchidos. O destino da Vista é pedido
// ao escolher o voto.
const RETORNO = ['Vista', 'Retirado'];
const pedeDestino = select => select.value === 'Vista' && select.closest('.col-voto');
const emVista = tr => tr.querySelector('.col-voto select').value === 'Vista';
const incoerente = (voto, status) => Boolean(voto && status && voto !== status
  && (RETORNO.includes(voto) || RETORNO.includes(status)));
// O rótulo da lista ("Pautas pendentes", "Sessões pendentes") nasce no HTML e
// é daqui que ele volta ao sair de uma pauta: com uma fonte só, a barra não
// tem como mostrar a palavra de um colegiado na tela do outro.
const rotuloDaLista = txtModo.textContent;

// Pendentes agrupados por pauta: chave "numero|data".
let pendentesPorPauta = new Map();
let pendentesNaTela = 0;
let escolhaVistaPendente = null;

btnVoltar.addEventListener('click', () => mostrarPautas(true));
btnSalvar.addEventListener('click', salvar);
btnTodosManter.addEventListener('click', () => preencherColuna('col-voto', 'Manter'));
btnTodosJulgado.addEventListener('click', () => preencherColuna('col-status', 'Julgado'));
tbody.addEventListener('change', event => {
  const select = event.target.closest('select');
  if (!select || !tbody.contains(select)) return;
  if (pedeDestino(select)) {
    pedirUnidadeVista(select, true);
    return;
  }
  registrarAlteracao(select);
});

if (dialogUnidadeVista) {
  // A cadeira mostra o conselheiro no hover, como nas outras telas da Câmara.
  if (COL.mostraConselheiro) {
    [...unidadeDestinoVista.options || []].forEach(opcao => rotularCadeira(opcao, opcao.value));
  }
  formUnidadeVista.addEventListener('submit', event => {
    event.preventDefault();
    if (!escolhaVistaPendente) return;
    if (!VISTA.destinos.includes(unidadeDestinoVista.value)) {
      erroUnidadeVista.hidden = false;
      unidadeDestinoVista.focus();
      return;
    }

    const { select, resolve, votoAlterado } = escolhaVistaPendente;
    const tr = select.closest('tr');
    tr.dataset.unidadeVista = unidadeDestinoVista.value;
    escolhaVistaPendente = null;
    dialogUnidadeVista.close();
    if (votoAlterado) registrarAlteracao(select);
    else atualizarLinha(tr);
    resolve(true);
  });
  document.getElementById('cancelarUnidadeVista').addEventListener('click', () => cancelarUnidadeVista());
  dialogUnidadeVista.addEventListener('cancel', () => cancelarUnidadeVista(true));
  unidadeDestinoVista.addEventListener('change', () => { erroUnidadeVista.hidden = true; });
}

function pedirUnidadeVista(select, votoAlterado) {
  const tr = select.closest('tr');
  resumoUnidadeVista.textContent =
    `Processo ${tr.dataset.numProcesso} · ${VISTA.nome} atual: ${tr.dataset.unidadeAtual}`;
  unidadeDestinoVista.value = tr.dataset.unidadeVista || '';
  erroUnidadeVista.hidden = true;
  dialogUnidadeVista.showModal();
  return new Promise(resolve => { escolhaVistaPendente = { select, resolve, votoAlterado }; });
}

function cancelarUnidadeVista(fechaPeloEscape = false) {
  if (!escolhaVistaPendente) return;
  const { select, resolve, votoAlterado } = escolhaVistaPendente;
  escolhaVistaPendente = null;
  if (votoAlterado) {
    select.value = select.dataset.confirmado || '';
    select.classList.toggle('placeholder-select', !select.value);
  }
  if (!fechaPeloEscape) dialogUnidadeVista.close();
  resolve(false);
}

function registrarAlteracao(select, sugerirStatus = true) {
  // O valor aceito é para onde o cancelamento da janela da Vista volta.
  select.dataset.confirmado = select.value;
  if (select.closest('.col-status')) {
    // Uma escolha explícita prevalece sobre as próximas sugestões do voto.
    select.dataset.statusAutomatico = 'false';
  } else if (select.closest('.col-voto') && select.value) {
    const status = select.closest('tr').querySelector('.col-status select');
    // Vista e Retirado não são sugestão: sem o status igual, o banco recusa a
    // sessão inteira. Vale mesmo depois de um status escolhido à mão.
    if ((sugerirStatus && status.dataset.statusAutomatico !== 'false')
        || RETORNO.includes(select.value)) {
      status.value = select.value === 'Retirado' || select.value === 'Vista'
        ? select.value : 'Julgado';
      status.dataset.statusAutomatico = 'true';
      status.dataset.confirmado = status.value;
      status.classList.remove('placeholder-select');
    }
  }
  const tr = select.closest('tr');
  if (!emVista(tr)) tr.dataset.unidadeVista = '';

  select.classList.toggle('placeholder-select', !select.value);

  atualizarLinha(select.closest('tr'));
}

function atualizarLinha(tr) {
  const incompletoAntes = tr.dataset.incompleto === 'true';
  const incompletoAgora = [...tr.querySelectorAll('select')].some(campo => !campo.value);
  if (incompletoAntes !== incompletoAgora) {
    pendentesNaTela += incompletoAgora ? 1 : -1;
    tr.dataset.incompleto = String(incompletoAgora);
  }
  tr.dataset.alterada = String([...tr.querySelectorAll('select')]
    .some(campo => campo.value !== (campo.dataset.valorInicial || ''))
    || tr.dataset.unidadeVista !== tr.dataset.unidadeVistaInicial);
  mostrarDestino(tr);
  atualizarContador();
}

// O destino da Vista só aparece na janela: sem este lembrete embaixo do voto,
// a linha dizia "Vista" e ninguém sabia para onde. Clicar reabre a janela.
function mostrarDestino(tr) {
  const celula = tr.querySelector('.col-voto');
  let marca = celula.querySelector('.vista-destino');
  const destino = emVista(tr) ? tr.dataset.unidadeVista : '';
  if (!destino) {
    marca?.remove();
    return;
  }
  if (!marca) {
    marca = document.createElement('button');
    marca.type = 'button';
    marca.className = 'vista-destino';
    marca.addEventListener('click', () => pedirUnidadeVista(celula.querySelector('select'), false));
    celula.appendChild(marca);
  }
  marca.textContent = `Destino: ${destino}`;
  if (COL.mostraConselheiro) rotularCadeira(marca, destino);
  marca.setAttribute('aria-label', `Destino da vista: ${destino}. Alterar`);
}

// Depois de quase toda sessão o resultado repetido é "Manter" no voto e
// "Julgado" no status — no Conselho, 3.426 e 4.404 do histórico —, então a
// secretaria preenche a coluna de uma vez e corrige só as exceções. Só toca no que está em branco: quem já escolheu
// Anular numa linha não perde a escolha ao clicar no botão.
function preencherColuna(coluna, valor) {
  tbody.querySelectorAll(`.${coluna} select`).forEach(select => {
    if (select.value) return;
    // A linha que já tem Vista ou Retirado no outro campo fica para a escolha
    // manual: preenchê-la em lote criaria um par que o banco recusa.
    const outro = select.closest('tr')
      .querySelector(coluna === 'col-voto' ? '.col-status select' : '.col-voto select');
    if (incoerente(valor, outro.value)) return;
    select.value = valor;
    // O lote não sugere status por cima de um que a linha já tem: "Retirado" ou
    // "Sobrestado" gravados antes são decisão, não campo em branco.
    registrarAlteracao(select, !outro.value);
  });
}

function inicializarJulgados() {
  // Devolve a promessa: quem chama espera o carregamento terminar antes de
  // tirar o indicador da tela.
  return carregarPautas(true);
}

function dataBR(iso) {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

// ── Tela 1: pautas pendentes ─────────────────────────────────────────────────

async function carregarPautas(moverFoco = false) {
  pautasIntro.hidden = true;
  semPendencia.hidden = true;
  pautasContainer.replaceChildren(criarIndicadorCarregamento(`Buscando ${COL.pautas} com julgamento pendente…`));
  listaPautas.hidden = false;
  detalhePauta.hidden = true;
  btnVoltarInicio.hidden = false;
  btnVoltar.hidden = true;
  if (moverFoco) listaPautasTitulo.focus();

  let pendentes;
  try {
    pendentes = await api(
      `${COL.tabela}?select=id,num_processo,${COL.destino},${COL === COLEGIADOS.creg ? 'assunto,' : ''}${VISTA.campo},data_sessao,pauta,voto,status`
      + '&or=(voto.is.null,status.is.null)'
      + '&order=data_sessao.desc,num_processo.asc,id.asc');
  } catch (err) {
    mostrarErroDeCarregamento();
    aviso('Não foi possível carregar os julgados. Verifique sua conexão e tente novamente.', 'erro', err.message);
    return;
  }

  pendentesPorPauta = new Map();
  pendentes.forEach(j => {
    const chave = `${j.pauta}|${j.data_sessao}`;
    if (!pendentesPorPauta.has(chave)) pendentesPorPauta.set(chave, []);
    pendentesPorPauta.get(chave).push(j);
  });

  mostrarPautas();
}

function mostrarPautas(moverFoco = false) {
  detalhePauta.hidden = true;
  btnVoltar.hidden = true;
  btnVoltarInicio.hidden = false;
  txtModo.textContent = rotuloDaLista;
  listaPautas.hidden = false;

  semPendencia.hidden = pendentesPorPauta.size > 0;
  pautasIntro.hidden = pendentesPorPauta.size === 0;

  const fragmento = document.createDocumentFragment();
  for (const [chave, processos] of pendentesPorPauta) {
    const [numero, data] = chave.split('|');

    const cartao = document.createElement('button');
    cartao.className = 'pauta-card';
    cartao.addEventListener('click', () => abrirPauta(chave));

    // A data vem primeiro de propósito: ela confere com a listagem oficial da
    // AGR em todas as sessões, enquanto o número da pauta é referência interna:
    // na Câmara, até 2025, não bate com o publicado (ver FLUXO-CJ.md), e no
    // Conselho diverge em 121 das 132 sessões do histórico (ver FLUXO-CREG.md).
    const titulo = document.createElement('strong');
    titulo.textContent = dataBR(data);

    const quando = document.createElement('span');
    quando.className = 'pauta-data';
    quando.textContent = numero === 'null' ? `sem número de ${COL.pauta}` : `${numero}ª ${COL.reuniao}`;

    const quantos = document.createElement('span');
    quantos.className = 'pauta-quantidade';
    quantos.textContent = `${processos.length} ${processos.length === 1 ? 'processo' : 'processos'}`;

    cartao.append(titulo, quando, quantos);
    fragmento.appendChild(cartao);
  }
  pautasContainer.replaceChildren(fragmento);
  if (moverFoco) listaPautasTitulo.focus();
}

function mostrarErroDeCarregamento() {
  // A falha não pode prender a pessoa nesta página: o único caminho de volta ao
  // sorteio é este botão, e ele só é revelado em mostrarPautas().
  btnVoltarInicio.hidden = false;

  const estado = document.createElement('div');
  estado.className = 'load-error';
  estado.setAttribute('role', 'alert');

  const texto = document.createElement('p');
  texto.textContent = `Não foi possível carregar as ${COL.pautas}. Verifique sua conexão e tente novamente.`;

  const tentarNovamente = document.createElement('button');
  tentarNovamente.type = 'button';
  tentarNovamente.className = 'button-secondary';
  tentarNovamente.textContent = 'Tentar novamente';
  tentarNovamente.addEventListener('click', () => carregarPautas(true));

  estado.append(texto, tentarNovamente);
  pautasContainer.replaceChildren(estado);
}

// ── Tela 2: processos da pauta ───────────────────────────────────────────────

function seletor(opcoes, valor, rotulo) {
  const sel = document.createElement('select');
  sel.setAttribute('aria-label', rotulo);
  const vazio = document.createElement('option');
  vazio.value = '';
  vazio.textContent = rotulo;
  vazio.disabled = true;
  sel.appendChild(vazio);

  opcoes.forEach(o => {
    const op = document.createElement('option');
    op.value = o;
    op.textContent = o;
    sel.appendChild(op);
  });

  // Rótulo que veio da planilha e não está na lista do colegiado (no Conselho,
  // "Parcialmente Deferido", "Suspender") entra como opção própria. Sem ela o select viria em branco — atribuir um valor que não é
  // option o DOM ignora —, a linha entraria como "sem decisão" e a primeira
  // gravação apagaria uma decisão que já existia.
  if (valor && !opcoes.includes(valor)) {
    const historico = document.createElement('option');
    historico.value = valor;
    historico.textContent = `${valor} (registro anterior)`;
    sel.appendChild(historico);
  }

  sel.value = valor || '';
  sel.classList.toggle('placeholder-select', !sel.value);
  return sel;
}

function abrirPauta(chave) {
  const [numero, data] = chave.split('|');
  const processos = pendentesPorPauta.get(chave);

  listaPautas.hidden = true;
  detalhePauta.hidden = false;
  btnVoltar.hidden = false;
  btnVoltarInicio.hidden = true;
  txtModo.textContent = numero === 'null'
    ? `Sessão de ${dataBR(data)}`
    : `Sessão de ${dataBR(data)} — ${numero}ª ${COL.reuniao}`;
  tituloPauta.textContent = 'Processos aguardando voto e status';

  const fragmento = document.createDocumentFragment();
  pendentesNaTela = 0;
  processos.forEach(j => {
    const tr = document.createElement('tr');
    tr.dataset.id = j.id;
    tr.dataset.numProcesso = j.num_processo;
    tr.dataset.unidadeAtual = j[COL.destino] || 'Não informada';
    tr.dataset.unidadeVistaInicial = j[VISTA.campo] || '';
    tr.dataset.unidadeVista = j[VISTA.campo] || '';
    const incompleto = !j.voto || !j.status;
    tr.dataset.incompleto = String(incompleto);
    if (incompleto) pendentesNaTela++;

    const proc = document.createElement('td');
    proc.textContent = j.num_processo;

    const destino = document.createElement('td');
    destino.textContent = j[COL.destino] || 'Sem cadeira no acervo';
    if (COL.mostraConselheiro) rotularCadeira(destino, j[COL.destino]);

    const tdVoto = document.createElement('td');
    tdVoto.className = 'col-voto';
    const voto = seletor(VOTOS, j.voto, 'Selecione o voto');
    voto.dataset.valorInicial = voto.value;
    voto.dataset.confirmado = voto.value;
    tdVoto.appendChild(voto);

    const tdStatus = document.createElement('td');
    tdStatus.className = 'col-status';
    const status = seletor(STATUS, j.status, 'Selecione o status');
    status.dataset.valorInicial = status.value;
    status.dataset.confirmado = status.value;
    tdStatus.appendChild(status);

    tr.append(proc, destino);
    if (COL === COLEGIADOS.creg) {
      const assunto = document.createElement('td');
      assunto.className = 'col-assunto';
      assunto.textContent = j.assunto || 'Não informado';
      tr.appendChild(assunto);
    }
    tr.append(tdVoto, tdStatus);
    mostrarDestino(tr);
    // No celular a linha vira ficha e o cabeçalho sai de vista: cada campo
    // leva o próprio rótulo (ver "Tabelas no celular" no CSS).
    ROTULOS_DAS_COLUNAS.forEach((rotulo, i) => { tr.children[i].dataset.label = rotulo; });
    fragmento.appendChild(tr);
  });
  tbody.replaceChildren(fragmento);

  atualizarContador();
  tituloPauta.focus();
}

function linhasDaTela() {
  return Array.from(tbody.querySelectorAll('tr')).map(tr => ({
    id: Number(tr.dataset.id),
    voto: tr.querySelector('.col-voto select').value,
    status: tr.querySelector('.col-status select').value,
    destinoVista: tr.dataset.unidadeVista || null,
    destinoVistaInicial: tr.dataset.unidadeVistaInicial || null,
    anterior: Object.fromEntries(['voto', 'status'].map(campo =>
      [campo, tr.querySelector(`.col-${campo} select`).dataset.valorInicial || null])),
    alterada: tr.dataset.alterada === 'true'
  }));
}

function atualizarContador() {
  const faltando = pendentesNaTela;
  contadorPendentes.textContent = faltando === 0
    ? 'Todos preenchidos.'
    : `${faltando} ${faltando === 1 ? 'processo ainda sem' : 'processos ainda sem'} voto ou status.`;
}

// ── Gravação ─────────────────────────────────────────────────────────────────

async function salvar() {
  // O banco recusa a sessão inteira por uma linha; aqui a mensagem diz qual.
  const alteradas = [...tbody.querySelectorAll('tr')].filter(tr => tr.dataset.alterada === 'true');
  const valor = (tr, campo) => tr.querySelector(`.col-${campo} select`).value;
  const numeros = linhas => linhas.map(tr => tr.dataset.numProcesso).join(', ');
  const incoerentes = alteradas.filter(tr => incoerente(valor(tr, 'voto'), valor(tr, 'status')));
  if (incoerentes.length > 0) {
    aviso('Vista e Retirado exigem voto e status iguais. '
      + `Corrija antes de salvar: ${numeros(incoerentes)}.`, 'atencao');
    return;
  }
  const semUnidade = alteradas.filter(tr => valor(tr, 'voto') === 'Retirado'
    && !VISTA.atualValida.test(tr.dataset.unidadeAtual));
  if (semUnidade.length > 0) {
    aviso(`Retirado devolve o processo à ${VISTA.nome} que o levou à sessão, e `
      + `estes não têm distribuição no acervo: ${numeros(semUnidade)}.`, 'atencao');
    return;
  }

  for (const tr of alteradas) {
    if (emVista(tr) && !VISTA.destinos.includes(tr.dataset.unidadeVista)) {
      if (!await pedirUnidadeVista(tr.querySelector('.col-voto select'), false)) return;
    }
  }

  // Só o que o funcionário efetivamente preencheu. Linha intocada continua
  // pendente e reaparece na próxima vez.
  const itens = linhasDaTela()
    .filter(l => l.alterada)
    .map(({ id, voto, status, destinoVista, destinoVistaInicial, anterior }) => ({
      id, anterior: {
        ...anterior,
        ...(destinoVista !== destinoVistaInicial ? { [VISTA.campo]: destinoVistaInicial } : {})
      },
      ...(voto !== (anterior.voto || '') ? { voto } : {}),
      ...(status !== (anterior.status || '') ? { status } : {}),
      ...(destinoVista !== destinoVistaInicial ? { [VISTA.campo]: destinoVista } : {})
    }));
  if (itens.length === 0) {
    aviso('Nada para salvar: preencha o voto ou o status de pelo menos um processo.', 'atencao');
    return;
  }

  // A função do banco recusa a lista inteira quando um item traz rótulo fora da
  // lista — e "registro anterior" é exatamente esse caso. Avisar aqui diz qual
  // linha corrigir; deixar seguir devolveria um erro do Postgres sem endereço.
  //
  // Campo VAZIO não entra nesta conta: preencher só o voto ou só o status é
  // fluxo previsto (processo retirado de pauta tem status e não tem voto), e o
  // banco grava null.
  const foraDaLista = itens.filter(i =>
    (i.voto && !VOTOS.includes(i.voto)) || (i.status && !STATUS.includes(i.status)));
  if (foraDaLista.length > 0) {
    aviso(`${foraDaLista.length} ${foraDaLista.length === 1 ? 'processo tem' : 'processos têm'} `
      + `voto ou status de um registro anterior, que ${COL.sujeito} não usa mais. `
      + 'Escolha um rótulo da lista nesses processos antes de salvar.', 'atencao');
    return;
  }

  alternarBotaoCarregando(btnSalvar, true, 'Salvando…');

  try {
    const gravados = await api(COL.rpc, {
      method: 'POST',
      body: JSON.stringify({ itens })
    });
    // A função do banco recusa em silêncio a linha que não é editável por essa
    // porta (histórico da planilha). Sem comparar com o que foi enviado, um
    // "0 julgamentos gravados" apareceria em verde, como se tivesse dado certo.
    if (gravados < itens.length) {
      aviso(`${gravados} de ${itens.length} julgamentos gravados. `
        + 'O restante já estava registrado e não pode ser alterado por aqui.', 'atencao');
    } else {
      aviso(`${gravados} ${gravados === 1 ? 'julgamento gravado' : 'julgamentos gravados'}.`);
    }
    await carregarPautas(true);
  } catch (err) {
    aviso('Nada foi salvo. Tente novamente.', 'erro', err.message);
  } finally {
    alternarBotaoCarregando(btnSalvar, false);
  }
}
