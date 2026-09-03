// Registro do voto e do status dos processos julgados no Conselho Regulador.
//
// Gêmea de julgados.js, que faz o mesmo para a Câmara. O fluxo é idêntico: os
// julgados chegam das pautas publicadas pela AGR (ver sincronizacao/), que são
// convocação — trazem o processo e a data da sessão, e deixam voto e status
// nulos porque as duas coisas só existem depois da sessão.
//
// A gravação não é UPDATE direto: vai pela função registrar_votos_creg do
// banco, que aceita só estes dois campos, recusa valor fora da lista e anota
// quem preencheu (ver schema.sql).
//
// O que difere da Câmara:
//   • sete votos e cinco status, contra três e quatro — o Conselho julga além
//     de auto de infração, e a lista acompanha;
//   • a coluna mostra a UNIDADE (CREG1..CREG4) e para por aí. A Câmara traduz a
//     cadeira em nome do conselheiro no hover; aqui não há de-para, por decisão
//     dos responsáveis pelas unidades (ver FLUXO-CREG.md).

// Os mesmos rótulos que a função do banco aceita. Mudou aqui, muda lá.
const VOTOS = ['Manter', 'Anular', 'Aprovação', 'Indeferimento', 'Extinção', 'Retirado', 'Vista'];
const STATUS = ['Julgado', 'Retirado', 'Vista', 'Sobrestado', 'Prejudicado'];

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

// Pendentes agrupados por sessão: chave "numero|data".
let pendentesPorPauta = new Map();
let pendentesNaTela = 0;

btnVoltar.addEventListener('click', () => mostrarPautas(true));
btnSalvar.addEventListener('click', salvar);
btnTodosManter.addEventListener('click', () => preencherColuna('col-voto', 'Manter'));
btnTodosJulgado.addEventListener('click', () => preencherColuna('col-status', 'Julgado'));
tbody.addEventListener('change', event => {
  const select = event.target.closest('select');
  if (!select || !tbody.contains(select)) return;
  registrarAlteracao(select);
});

function registrarAlteracao(select) {
  select.classList.toggle('placeholder-select', !select.value);

  const tr = select.closest('tr');
  const incompletoAntes = tr.dataset.incompleto === 'true';
  const incompletoAgora = [...tr.querySelectorAll('select')].some(campo => !campo.value);
  if (incompletoAntes !== incompletoAgora) {
    pendentesNaTela += incompletoAgora ? 1 : -1;
    tr.dataset.incompleto = String(incompletoAgora);
  }
  tr.dataset.alterada = String([...tr.querySelectorAll('select')]
    .some(campo => campo.value !== (campo.dataset.valorInicial || '')));
  atualizarContador();
}

// Depois de quase toda sessão o resultado repetido é "Manter" no voto e
// "Julgado" no status — 3.426 e 4.404 do histórico do Conselho —, então a
// secretaria preenche a coluna de uma vez e corrige só as exceções. Só toca no
// que está em branco: quem já escolheu Anular numa linha não perde a escolha.
function preencherColuna(coluna, valor) {
  tbody.querySelectorAll(`.${coluna} select`).forEach(select => {
    if (select.value) return;
    select.value = valor;
    registrarAlteracao(select);
  });
}

function inicializarJulgadosCreg() {
  // Devolve a promessa: quem chama espera o carregamento terminar antes de
  // tirar o indicador da tela.
  return carregarPautas(true);
}

function dataBR(iso) {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

// ── Tela 1: sessões pendentes ────────────────────────────────────────────────

async function carregarPautas(moverFoco = false) {
  pautasIntro.hidden = true;
  semPendencia.hidden = true;
  pautasContainer.replaceChildren(criarIndicadorCarregamento('Buscando sessões com julgamento pendente…'));
  listaPautas.hidden = false;
  detalhePauta.hidden = true;
  btnVoltarInicio.hidden = false;
  btnVoltar.hidden = true;
  if (moverFoco) listaPautasTitulo.focus();

  let pendentes;
  try {
    pendentes = await api(
      'julgados_creg?select=id,num_processo,unidade,data_sessao,pauta,voto,status'
      + '&or=(voto.is.null,status.is.null)'
      + '&order=data_sessao.desc,num_processo.asc');
  } catch (err) {
    mostrarErroDeCarregamento();
    aviso(`Não foi possível carregar os julgados (${err.message}).`, 'erro');
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
  txtModo.textContent = 'Sessões pendentes';
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
    // AGR em todas as sessões, enquanto o número da pauta diverge do publicado
    // em 121 das 132 sessões do histórico (ver FLUXO-CREG.md).
    const titulo = document.createElement('strong');
    titulo.textContent = dataBR(data);

    const quando = document.createElement('span');
    quando.className = 'pauta-data';
    quando.textContent = numero === 'null' ? 'sem número de sessão' : `${numero}ª sessão`;

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
  texto.textContent = 'Não foi possível carregar as sessões. Verifique sua conexão e tente novamente.';

  const tentarNovamente = document.createElement('button');
  tentarNovamente.type = 'button';
  tentarNovamente.className = 'button-secondary';
  tentarNovamente.textContent = 'Tentar novamente';
  tentarNovamente.addEventListener('click', () => carregarPautas(true));

  estado.append(texto, tentarNovamente);
  pautasContainer.replaceChildren(estado);
}

// ── Tela 2: processos da sessão ──────────────────────────────────────────────

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

  // Rótulo que veio da planilha e não está na lista do Conselho ("Parcialmente
  // Deferido", "Suspender") entra como opção própria, senão o select viria em
  // branco e a primeira gravação apagaria uma decisão que já existia.
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
    : `Sessão de ${dataBR(data)} — ${numero}ª sessão`;
  tituloPauta.textContent = 'Processos aguardando voto e status';

  const fragmento = document.createDocumentFragment();
  pendentesNaTela = 0;
  processos.forEach(j => {
    const tr = document.createElement('tr');
    tr.dataset.id = j.id;
    const incompleto = !j.voto || !j.status;
    tr.dataset.incompleto = String(incompleto);
    if (incompleto) pendentesNaTela++;

    const proc = document.createElement('td');
    proc.textContent = j.num_processo;

    // A unidade é o que o Conselho mostra, e só. Diferente da Câmara, aqui não
    // existe de-para de nomes: os responsáveis por CREG1..CREG4 pediram para
    // não ter os nomes vinculados aos processos.
    const unidade = document.createElement('td');
    unidade.textContent = j.unidade || 'Sem cadeira no acervo';

    const tdVoto = document.createElement('td');
    tdVoto.className = 'col-voto';
    const voto = seletor(VOTOS, j.voto, 'Selecione o voto');
    voto.dataset.valorInicial = voto.value;
    tdVoto.appendChild(voto);

    const tdStatus = document.createElement('td');
    tdStatus.className = 'col-status';
    const status = seletor(STATUS, j.status, 'Selecione o status');
    status.dataset.valorInicial = status.value;
    tdStatus.appendChild(status);

    tr.append(proc, unidade, tdVoto, tdStatus);
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
  // Só o que o funcionário efetivamente preencheu. Linha intocada continua
  // pendente e reaparece na próxima vez.
  const itens = linhasDaTela()
    .filter(l => l.alterada)
    .map(({ id, voto, status }) => ({ id, voto, status }));
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
  // banco grava null. Barrá-lo aqui daria a mensagem errada para quem apenas
  // ainda não decidiu.
  const foraDaLista = itens.filter(i =>
    (i.voto && !VOTOS.includes(i.voto)) || (i.status && !STATUS.includes(i.status)));
  if (foraDaLista.length > 0) {
    aviso(`${foraDaLista.length} ${foraDaLista.length === 1 ? 'processo tem' : 'processos têm'} `
      + 'voto ou status de um registro anterior, que o Conselho não usa mais. '
      + 'Escolha um rótulo da lista nesses processos antes de salvar.', 'atencao');
    return;
  }

  alternarBotaoCarregando(btnSalvar, true, 'Salvando…');

  try {
    const gravados = await api('rpc/registrar_votos_creg', {
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
    aviso(`Falha ao gravar (${err.message}). Nada foi salvo — tente novamente.`, 'erro');
  } finally {
    alternarBotaoCarregando(btnSalvar, false);
  }
}
