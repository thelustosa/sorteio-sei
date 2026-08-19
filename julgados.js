// Registro do voto e do status dos processos julgados.
//
// Os julgados chegam das pautas publicadas pela AGR (ver sincronizacao/), que
// são convocação: trazem o processo e a data da sessão, mas voto e status ficam
// nulos porque só existem depois da sessão. Esta página é onde a secretaria
// preenche os dois.
//
// A gravação não é UPDATE direto: vai pela função registrar_votos do banco, que
// aceita só estes dois campos, recusa valor fora da lista e anota quem
// preencheu (ver schema.sql).

// Os mesmos rótulos que a função do banco aceita. Mudou aqui, muda lá.
const VOTOS = ['Manter', 'Anular', 'Vista'];
const STATUS = ['Julgado', 'Retornou', 'Retirado', 'Vista'];

const listaPautas = document.getElementById('listaPautas');
const pautasContainer = document.getElementById('pautasContainer');
const semPendencia = document.getElementById('semPendencia');
const detalhePauta = document.getElementById('detalhePauta');
const tituloPauta = document.getElementById('tituloPauta');
const tbody = document.querySelector('#julgadosTable tbody');
const contadorPendentes = document.getElementById('contadorPendentes');
const btnSalvar = document.getElementById('btnSalvar');
const btnVoltar = document.getElementById('btnVoltar');
const txtModo = document.getElementById('txtModo');

// Pendentes agrupados por pauta: chave "numero|data".
let pendentesPorPauta = new Map();

ligarLogin(carregarPautas);

btnVoltar.addEventListener('click', mostrarPautas);
btnSalvar.addEventListener('click', salvar);
tbody.addEventListener('change', atualizarContador);

function dataBR(iso) {
  const [ano, mes, dia] = iso.split('-');
  return `${dia}/${mes}/${ano}`;
}

// ── Tela 1: pautas pendentes ─────────────────────────────────────────────────

async function carregarPautas() {
  pautasContainer.innerHTML = '<p class="lead">Carregando…</p>';
  listaPautas.style.display = 'block';

  let pendentes;
  try {
    pendentes = await api(
      'julgados_cj?select=id,num_processo,interessado,relator,data_sessao,pauta,voto,status'
      + '&or=(voto.is.null,status.is.null)'
      + '&order=data_sessao.desc,num_processo.asc');
  } catch (err) {
    pautasContainer.innerHTML = '';
    aviso(`❌ Não foi possível carregar os julgados (${err.message}).`, true);
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

function mostrarPautas() {
  detalhePauta.style.display = 'none';
  btnVoltar.style.display = 'none';
  txtModo.textContent = '';
  listaPautas.style.display = 'block';

  pautasContainer.innerHTML = '';
  semPendencia.style.display = pendentesPorPauta.size ? 'none' : 'block';

  for (const [chave, processos] of pendentesPorPauta) {
    const [numero, data] = chave.split('|');

    const cartao = document.createElement('button');
    cartao.className = 'pauta-card';
    cartao.addEventListener('click', () => abrirPauta(chave));

    const titulo = document.createElement('strong');
    titulo.textContent = numero === 'null' ? 'Sem pauta' : `${numero}ª reunião`;

    const quando = document.createElement('span');
    quando.className = 'pauta-data';
    quando.textContent = dataBR(data);

    const quantos = document.createElement('span');
    quantos.className = 'pauta-quantidade';
    quantos.textContent = `${processos.length} ${processos.length === 1 ? 'processo' : 'processos'}`;

    cartao.append(titulo, quando, quantos);
    pautasContainer.appendChild(cartao);
  }
}

// ── Tela 2: processos da pauta ───────────────────────────────────────────────

function seletor(opcoes, valor, rotulo) {
  const sel = document.createElement('select');
  const vazio = document.createElement('option');
  vazio.value = '';
  vazio.textContent = rotulo;
  sel.appendChild(vazio);

  opcoes.forEach(o => {
    const op = document.createElement('option');
    op.value = o;
    op.textContent = o;
    sel.appendChild(op);
  });

  sel.value = valor || '';
  return sel;
}

function abrirPauta(chave) {
  const [numero, data] = chave.split('|');
  const processos = pendentesPorPauta.get(chave);

  listaPautas.style.display = 'none';
  detalhePauta.style.display = 'block';
  btnVoltar.style.display = 'inline-block';
  txtModo.textContent = numero === 'null'
    ? `Sessão de ${dataBR(data)}`
    : `${numero}ª reunião — ${dataBR(data)}`;
  tituloPauta.textContent = 'Processos aguardando voto e status';

  tbody.innerHTML = '';
  processos.forEach(j => {
    const tr = document.createElement('tr');
    tr.dataset.id = j.id;

    const proc = document.createElement('td');
    proc.textContent = j.num_processo;

    const interessado = document.createElement('td');
    interessado.textContent = j.interessado || '—';

    const relator = document.createElement('td');
    relator.className = 'small';
    relator.textContent = j.relator || '— fora do acervo —';

    const tdVoto = document.createElement('td');
    tdVoto.appendChild(seletor(VOTOS, j.voto, 'Selecione o voto'));

    const tdStatus = document.createElement('td');
    tdStatus.appendChild(seletor(STATUS, j.status, 'Selecione o status'));

    tr.append(proc, interessado, relator, tdVoto, tdStatus);
    tbody.appendChild(tr);
  });

  atualizarContador();
}

function linhasDaTela() {
  return Array.from(tbody.querySelectorAll('tr')).map(tr => ({
    id: Number(tr.dataset.id),
    voto: tr.children[3].querySelector('select').value,
    status: tr.children[4].querySelector('select').value
  }));
}

function atualizarContador() {
  const faltando = linhasDaTela().filter(l => !l.voto || !l.status).length;
  contadorPendentes.textContent = faltando === 0
    ? 'Todos preenchidos.'
    : `${faltando} ${faltando === 1 ? 'processo ainda sem' : 'processos ainda sem'} voto ou status.`;
}

// ── Gravação ─────────────────────────────────────────────────────────────────

async function salvar() {
  // Só o que o funcionário efetivamente preencheu. Linha intocada continua
  // pendente e reaparece na próxima vez.
  const itens = linhasDaTela().filter(l => l.voto || l.status);
  if (itens.length === 0) {
    aviso('Nada para salvar: preencha o voto ou o status de pelo menos um processo.', true);
    return;
  }

  btnSalvar.disabled = true;
  btnSalvar.textContent = 'Salvando…';

  try {
    const gravados = await api('rpc/registrar_votos', {
      method: 'POST',
      body: JSON.stringify({ itens })
    });
    aviso(`✅ ${gravados} ${gravados === 1 ? 'julgamento gravado' : 'julgamentos gravados'}.`);
    await carregarPautas();
  } catch (err) {
    aviso(`❌ Falha ao gravar (${err.message}). Nada foi salvo — tente novamente.`, true);
  } finally {
    btnSalvar.disabled = false;
    btnSalvar.textContent = 'Salvar julgamentos';
  }
}
