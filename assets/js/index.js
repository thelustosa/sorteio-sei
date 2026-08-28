const assuntosCreg = ['Auto de Infração', 'Chamamento Público', 'Gratuidade', 'Manifestação', 'Minuta', 'Nota Técnica', 'Ouvidoria', 'Requerimento', 'Plano de Racionamento', 'Quadro de Horários', 'Reajuste', 'Outros'];
const assuntosCj = ['Auto de Infração'];
const recursos = ['Com recurso', 'Sem recurso', 'Não se aplica', 'Pedido de revisão'];
// Na Câmara de Julgamento a mesma coluna registra outra coisa: se o autuado
// apresentou defesa. É o campo que os julgados herdam do acervo.
const defesas = ['Sim', 'Não'];

// ── Aleatoriedade do sorteio ─── início do bloco verificado por tests/test_sorteio.mjs
// sort() com comparador aleatório não embaralha: a distribuição resultante é
// enviesada e varia conforme o algoritmo de ordenação do navegador. Num sorteio
// de processos públicos isso é inaceitável. Fisher-Yates resolve o viés do
// algoritmo; crypto.getRandomValues com descarte do resto resolve o do módulo.
function inteiroAleatorio(limite) {
  const teto = Math.floor(2 ** 32 / limite) * limite;
  const buffer = new Uint32Array(1);
  let valor;
  do {
    crypto.getRandomValues(buffer);
    valor = buffer[0];
  } while (valor >= teto);
  return valor % limite;
}

function embaralhar(lista) {
  for (let i = lista.length - 1; i > 0; i--) {
    const j = inteiroAleatorio(i + 1);
    [lista[i], lista[j]] = [lista[j], lista[i]];
  }
  return lista;
}
// ── fim do bloco verificado ─────────────────────────────────────────────────

let modoSorteio = '';
let unidadesList = [];
let assuntosAtivos = [];

const tbody = document.querySelector('#processTable tbody');
const numRowsInput = document.getElementById('numRows');
const createBtn = document.getElementById('createRows');
const sortearBtn = document.getElementById('sortear');
const addRowBtn = document.getElementById('addRowBtn');

const btnCreg = document.getElementById('btnCreg');
const btnCj = document.getElementById('btnCj');
const btnVoltar = document.getElementById('btnVoltar');
const modeSelector = document.getElementById('modeSelector');
const sorteadorContent = document.getElementById('sorteadorContent');
const thRecurso = document.getElementById('thRecurso');
const thInteressado = document.getElementById('thInteressado');
const pillsContainer = document.getElementById('pillsContainer');
const txtModo = document.getElementById('txtModo');
const processEntry = document.getElementById('processEntry');
const processSetupHint = document.getElementById('processSetupHint');
const processFormMessage = document.getElementById('processFormMessage');
const resultadoSorteio = document.getElementById('resultadoSorteio');
const sortControls = document.getElementById('sortControls');
const tbodyResult = document.querySelector('#resultTable tbody');
const resumoContagem = document.getElementById('resumoContagem');
const resultadoStatus = document.getElementById('resultadoStatus');
const thUnidadeResult = document.getElementById('thUnidadeResult');
const modeSelectorTitle = document.getElementById('modeSelectorTitle');
const resultadoSorteioTitle = document.getElementById('resultadoSorteioTitle');
const baixarBackupBtn = document.getElementById('baixarBackup');
let backupPendente;

// ── Autenticação ─────────────────────────────────────────────────────────────
// Login, token e chamadas ao Supabase ficam em supabase.js, compartilhados com
// a página de registro de voto e status. bootstrap.js chama esta função somente
// depois que a sessão foi validada e este arquivo terminou de carregar.
function inicializarSorteio() {
  if (backupPendente) {
    modeSelector.hidden = true;
    sorteadorContent.hidden = false;
    resultadoSorteio.hidden = false;
    baixarBackupBtn.hidden = false;
    btnVoltar.hidden = false;
    baixarBackupBtn.focus();
    return;
  }
  modeSelector.hidden = false;
  modeSelectorTitle.focus();
}

btnCreg.addEventListener('click', () => {
  iniciarSorteador('CREG', ['CREG1', 'CREG2', 'CREG3', 'CREG4']);
});

// As cadeiras da CJ vêm de CADEIRAS_CJ (supabase.js), compartilhado com as
// telas de julgados e do acervo. O que vai para o banco é a CADEIRA — ela é
// estável quando a composição da Câmara muda, e é assim que acervo_cj.relator
// guarda. O nome só aparece no title de cada unidade, para quem escolhe não
// precisar decorar o número da cadeira.
btnCj.addEventListener('click', () => {
  iniciarSorteador('CJ', Object.keys(CADEIRAS_CJ));
});

btnVoltar.addEventListener('click', () => {
  sorteadorContent.hidden = true;
  modeSelector.hidden = false;
  btnVoltar.hidden = true;

  processEntry.hidden = true;
  sortearBtn.hidden = true;
  processSetupHint.hidden = false;
  sortControls.hidden = false;
  txtModo.textContent = 'Sorteio de processos';
  clearRows();
  
  // Resetar visualização de resultados
  resultadoSorteio.hidden = true;
  tbodyResult.replaceChildren();
  resumoContagem.replaceChildren();
  backupPendente = undefined;
  baixarBackupBtn.hidden = true;
  modeSelectorTitle.focus();
});

function iniciarSorteador(modo, unidades) {
  modoSorteio = modo;
  unidadesList = unidades;
  assuntosAtivos = modo === 'CREG' ? assuntosCreg : assuntosCj;

  btnVoltar.hidden = false;
  txtModo.textContent = modo === 'CREG' ? 'Conselho Regulador (CREG)' : 'Câmara de Julgamento (CJ)';

  thRecurso.textContent = modo === 'CREG' ? 'Recurso' : 'Defesa';
  // Interessado é campo livre do Conselho Regulador; a CJ não o coleta.
  thInteressado.hidden = modo !== 'CREG';
  sortearBtn.textContent = `Sortear ${modo} e Exportar`;

  const fragmentoPills = document.createDocumentFragment();
  unidadesList.forEach(unit => {
    const pill = document.createElement('button');
    pill.type = 'button';
    pill.className = 'pill';
    pill.dataset.creg = unit;
    pill.setAttribute('aria-pressed', 'false');
    pill.textContent = unit;
    // A cadeira sozinha não diz quem é: o nome vai no hover e no aria-label.
    rotularCadeira(pill, unit);
    fragmentoPills.appendChild(pill);
  });
  pillsContainer.replaceChildren(fragmentoPills);

  processEntry.hidden = true;
  sortearBtn.hidden = true;
  processSetupHint.hidden = false;
  sortControls.hidden = false;
  esconderMensagemFormulario();
  
  // Garantir que a área de resultados anterior seja limpa e escondida
  resultadoSorteio.hidden = true;
  backupPendente = undefined;
  baixarBackupBtn.hidden = true;

  modeSelector.hidden = true;
  sorteadorContent.hidden = false;

  clearRows();
  numRowsInput.focus();
}

function clearRows() {
  tbody.replaceChildren();
}

function mostrarMensagemFormulario(mensagem, campo) {
  processFormMessage.textContent = mensagem;
  processFormMessage.hidden = false;
  campo?.focus();
}

function esconderMensagemFormulario() {
  processFormMessage.textContent = '';
  processFormMessage.hidden = true;
}

function recalculaOrdem() {
  const rows = Array.from(tbody.querySelectorAll('tr'));
  rows.forEach((r, idx) => {
    const ordem = idx + 1;
    r.querySelector('.num').textContent = ordem;
    r.querySelector('.col-processo input').setAttribute('aria-label', `Número do processo, linha ${ordem}`);
    r.querySelector('.col-interessado input')?.setAttribute('aria-label', `Interessado, linha ${ordem}`);
    r.querySelector('.col-assunto select').setAttribute('aria-label', `Assunto, linha ${ordem}`);
    r.querySelector('.col-decisao select').setAttribute('aria-label', `${modoSorteio === 'CJ' ? 'Defesa' : 'Recurso'}, linha ${ordem}`);
    r.querySelector('.btn-excluir').setAttribute('aria-label', `Excluir linha ${ordem}`);
  });
}

function createRowElement(index) {
  const tr = document.createElement('tr');
  const tdOrdem = document.createElement('td'); tdOrdem.className = 'num'; tdOrdem.dataset.label = 'Ordem'; tdOrdem.textContent = index;
  const tdProc = document.createElement('td');
  tdProc.className = 'col-processo';
  tdProc.dataset.label = 'Nº Processo';
  const inpProc = document.createElement('input'); inpProc.type = 'text'; inpProc.placeholder = 'Digite o nº do processo'; inpProc.setAttribute('aria-label', `Número do processo, linha ${index}`);
  tdProc.appendChild(inpProc);
  const tdInt = document.createElement('td');
  tdInt.className = 'col-interessado';
  tdInt.dataset.label = 'Interessado';
  const inpInt = document.createElement('input'); inpInt.type = 'text'; inpInt.placeholder = 'Digite o interessado'; inpInt.setAttribute('aria-label', `Interessado, linha ${index}`);
  tdInt.appendChild(inpInt);
  const tdAss = document.createElement('td');
  tdAss.className = 'col-assunto';
  tdAss.dataset.label = 'Assunto';
  const selAss = document.createElement('select'); selAss.setAttribute('aria-label', `Assunto, linha ${index}`);
  const optDefaultAss = document.createElement('option'); optDefaultAss.value = ''; optDefaultAss.textContent = 'Selecione o Assunto'; optDefaultAss.disabled = true; optDefaultAss.selected = true;
  selAss.appendChild(optDefaultAss);
  assuntosAtivos.forEach(a => { const o = document.createElement('option'); o.value = a; o.textContent = a; selAss.appendChild(o) });
  selAss.classList.toggle('placeholder-select', !selAss.value);
  // Na Câmara de Julgamento o assunto é sempre Auto de Infração: já vem definido e travado.
  if (modoSorteio === 'CJ') {
    selAss.value = 'Auto de Infração';
    selAss.disabled = true;
    selAss.classList.add('fixed-field');
    selAss.classList.remove('placeholder-select');
  }
  tdAss.appendChild(selAss);
  const tdRec = document.createElement('td');
  tdRec.className = 'col-decisao';
  tdRec.dataset.label = modoSorteio === 'CJ' ? 'Defesa' : 'Recurso';
  const selRec = document.createElement('select'); selRec.setAttribute('aria-label', `${modoSorteio === 'CJ' ? 'Defesa' : 'Recurso'}, linha ${index}`);
  const optDefaultRec = document.createElement('option'); optDefaultRec.value = ''; optDefaultRec.textContent = modoSorteio === 'CJ' ? 'Houve defesa?' : 'Selecione o Recurso'; optDefaultRec.disabled = true; optDefaultRec.selected = true;
  selRec.appendChild(optDefaultRec);
  (modoSorteio === 'CJ' ? defesas : recursos).forEach(r => { const o = document.createElement('option'); o.value = r; o.textContent = r; selRec.appendChild(o) });
  selRec.classList.toggle('placeholder-select', !selRec.value);
  tdRec.appendChild(selRec);

  // Só no CREG: fora de Auto de Infração não existe recurso. Na CJ o assunto é
  // travado em Auto de Infração e a coluna é Defesa, que sempre se aplica.
  const tdDel = document.createElement('td');
  tdDel.className = 'acoes';
  tdDel.dataset.label = 'Ações';
  const btnDel = document.createElement('button');
  btnDel.type = 'button';
  btnDel.className = 'button-secondary button-danger btn-excluir';
  btnDel.textContent = 'Excluir';
  btnDel.setAttribute('aria-label', `Excluir linha ${index}`);
  btnDel.title = 'Excluir esta linha';
  tdDel.appendChild(btnDel);

  // Só o CREG tem interessado: na CJ a célula nem é criada, para a linha não
  // carregar um campo que ninguém preenche nem grava.
  if (modoSorteio === 'CREG') tr.append(tdOrdem, tdProc, tdInt, tdAss, tdRec, tdDel);
  else tr.append(tdOrdem, tdProc, tdAss, tdRec, tdDel);
  return tr;
}

const proximoFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

async function createRows(n) {
  tbody.replaceChildren();
  const fragmento = document.createDocumentFragment();
  for (let i = 1; i <= n; i++) {
    fragmento.appendChild(createRowElement(i));
    // Em lotes grandes, devolve o controle ao navegador para que o loading seja
    // pintado e outras interações não esperem toda a construção das linhas.
    if (i % 40 === 0 || i === n) {
      tbody.appendChild(fragmento);
      if (i < n) await proximoFrame();
    }
  }
}

pillsContainer.addEventListener('click', event => {
  const pill = event.target.closest('.pill');
  if (!pill || !pillsContainer.contains(pill)) return;
  const excluido = pill.classList.toggle('excluded');
  pill.setAttribute('aria-pressed', String(excluido));
});

tbody.addEventListener('change', event => {
  const select = event.target.closest('select');
  if (!select || !tbody.contains(select)) return;
  select.classList.toggle('placeholder-select', !select.value);

  if (modoSorteio === 'CJ' || !select.closest('.col-assunto')) return;

  const row = select.closest('tr');
  const decisao = row.querySelector('.col-decisao select');
  if (select.value !== 'Auto de Infração') {
    decisao.value = 'Não se aplica';
    decisao.disabled = true;
    row.dataset.decisaoAutomatica = 'true';
  } else {
    decisao.disabled = false;
    if (row.dataset.decisaoAutomatica === 'true') decisao.value = '';
    delete row.dataset.decisaoAutomatica;
  }
  decisao.classList.toggle('placeholder-select', !decisao.value);
});

tbody.addEventListener('click', event => {
  const botao = event.target.closest('.btn-excluir');
  if (!botao || !tbody.contains(botao)) return;
  botao.closest('tr').remove();
  recalculaOrdem();
});

function getParticipantes() {
  const excluidos = Array.from(document.querySelectorAll('#pillsContainer .excluded')).map(p => p.dataset.creg);
  return unidadesList.filter(c => !excluidos.includes(c));
}

function sortearProcessos() {
  const rows = Array.from(tbody.querySelectorAll('tr'));
  if (rows.length === 0) {
    mostrarMensagemFormulario('Gere pelo menos uma linha antes de realizar o sorteio.', createBtn);
    return;
  }

  const numerosVistos = new Map();
  for (let idx = 0; idx < rows.length; idx++) {
    const r = rows[idx];
    const campoProc = r.querySelector('.col-processo input');
    const campoAssunto = r.querySelector('.col-assunto select');
    const campoDecisao = r.querySelector('.col-decisao select');
    const numProc = campoProc.value.trim();

    if (!numProc || !campoAssunto.value || !campoDecisao.value) {
      const campoPendente = !numProc ? campoProc
        : !campoAssunto.value ? campoAssunto : campoDecisao;
      mostrarMensagemFormulario(`Preencha todos os campos da linha ${idx + 1} antes de sortear.`, campoPendente);
      return;
    }

    // O número SEI tem 15 dígitos nos dois colegiados. Barrar máscara ou número
    // incompleto aqui mantém ata, backup e banco com a mesma chave auditável.
    if (!/^\d{15}$/.test(numProc)) {
      mostrarMensagemFormulario(
        `O processo da linha ${idx + 1} deve ter 15 dígitos, sem pontos ou barras. Corrija antes de sortear.`,
        campoProc);
      return;
    }

    const anterior = numerosVistos.get(numProc);
    if (anterior) {
      mostrarMensagemFormulario(`O processo ${numProc} está repetido nas linhas ${anterior} e ${idx + 1}. Corrija antes de sortear.`, campoProc);
      return;
    }
    numerosVistos.set(numProc, idx + 1);
  }

  const participantes = getParticipantes();
  if (participantes.length === 0) {
    mostrarMensagemFormulario(`Todos os ${modoSorteio}s estão excluídos. Selecione pelo menos um para participar.`, pillsContainer.querySelector('button'));
    return;
  }

  esconderMensagemFormulario();

  const atribuicoesPorCreg = {};
  participantes.forEach(c => {
    atribuicoesPorCreg[c] = {
      total: 0,
      assuntos: {}
    };
  });

  const linhasPorAssunto = {};
  rows.forEach(r => {
    const assunto = r.querySelector('.col-assunto select').value;
    if (!linhasPorAssunto[assunto]) {
      linhasPorAssunto[assunto] = [];
    }
    linhasPorAssunto[assunto].push(r);
  });

  const assuntosOrdenados = Object.keys(linhasPorAssunto).sort((a, b) => {
    return linhasPorAssunto[b].length - linhasPorAssunto[a].length;
  });

  // Um só instante para o sorteio inteiro: a data que vai para o banco, a do
  // nome do arquivo e a da ata precisam ser a mesma. Duas chamadas a new Date()
  // podem cair em dias diferentes se o sorteio atravessar a meia-noite.
  const hoje = new Date();
  const dataHoje = hoje.toLocaleDateString('pt-BR');

  assuntosOrdenados.forEach(assunto => {
    const linhas = embaralhar([...linhasPorAssunto[assunto]]);

    const totalLinhasAssunto = linhas.length;
    const base = Math.floor(totalLinhasAssunto / participantes.length);
    const resto = totalLinhasAssunto % participantes.length;

    participantes.forEach(creg => {
      for (let i = 0; i < base; i++) {
        const row = linhas.pop();
        row.dataset.unidade = creg;
        atribuicoesPorCreg[creg].total++;
        atribuicoesPorCreg[creg].assuntos[assunto] = (atribuicoesPorCreg[creg].assuntos[assunto] || 0) + 1;
      }
    });

    if (resto > 0) {
      const candidatos = embaralhar([...participantes])
        .sort((a, b) => atribuicoesPorCreg[a].total - atribuicoesPorCreg[b].total);

      for (let i = 0; i < resto; i++) {
        const creg = candidatos[i];
        const row = linhas.pop();
        row.dataset.unidade = creg;
        atribuicoesPorCreg[creg].total++;
        atribuicoesPorCreg[creg].assuntos[assunto] = (atribuicoesPorCreg[creg].assuntos[assunto] || 0) + 1;
      }
    }
  });

  // ── Renderizar Resultados na Interface ──────────────────────────────────────
  const divResultado = document.getElementById('resultadoSorteio');
  const divResumo = document.getElementById('resumoContagem');
  if (divResultado && divResumo && tbodyResult) {
    // 1. Atualizar cabeçalho da coluna de resultado
    if (thUnidadeResult) {
      thUnidadeResult.textContent = modoSorteio === 'CREG' 
        ? 'Sorteado Para (Conselho Regulador)' 
        : 'Sorteado Para (Câmara de Julgamento)';
    }

    // 2. Limpar conteúdo anterior
    tbodyResult.replaceChildren();
    divResumo.replaceChildren();
    
    // 3. Montar a contagem de cada processo para cada unidade
    const countWrapper = document.createElement('div');
    countWrapper.className = 'resumo-wrapper';

    participantes.forEach(p => {
      const totalProcessosUnidade = atribuicoesPorCreg[p].total;
      
      const badge = document.createElement('div');
      badge.className = 'unidade-badge';
      badge.textContent = `${p}: ${totalProcessosUnidade} ${totalProcessosUnidade === 1 ? 'processo' : 'processos'}`;
      if (CADEIRAS_CJ[p]) badge.title = CADEIRAS_CJ[p];
      
      countWrapper.appendChild(badge);
    });
    divResumo.appendChild(countWrapper);

    // 4. Preencher a tabela de resultados
    const fragmentoResultado = document.createDocumentFragment();
    rows.forEach(r => {
      const numProc = r.querySelector('.col-processo input').value.trim();
      const assunto = r.querySelector('.col-assunto select').value;
      const unidadeSorteada = r.dataset.unidade || '';

      const tr = document.createElement('tr');
      
      const tdProc = document.createElement('td');
      tdProc.textContent = numProc;

      const tdAss = document.createElement('td');
      tdAss.textContent = assunto;

      const tdUn = document.createElement('td');
      tdUn.className = 'sorteado-unidade';
      tdUn.textContent = unidadeSorteada;

      tr.append(tdProc, tdAss, tdUn);
      fragmentoResultado.appendChild(tr);
    });
    tbodyResult.appendChild(fragmentoResultado);

    // Exibir a seção de resultados e ocultar a tabela de inputs / controles
    divResultado.hidden = false;
    
    // Ocultar o formulário de entrada e manter o resultado como etapa final.
    sortControls.hidden = true;
    processSetupHint.hidden = true;
    processEntry.hidden = true;

    resultadoSorteioTitle.focus({ preventScroll: true });
    // Fazer scroll suave para o resultado
    divResultado.scrollIntoView({ behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'auto' : 'smooth' });
  }

  const sorteio = {
    modo: modoSorteio,
    dataHora: hoje.toISOString(),
    unidades: participantes,
    processos: coletarDados(rows, dataHoje)
  };

  exportarWord(sorteio);

  if (resultadoStatus) {
    resultadoStatus.replaceChildren(criarIndicadorCarregamento('Registrando o sorteio…'));
    resultadoStatus.hidden = false;
  }

  btnVoltar.disabled = true;
  salvar(sorteio)
    .then(destino => {
      if (destino === 'banco') {
        aviso('Sorteio gravado no banco de dados.');
        return;
      }
      backupPendente = sorteio;
      baixarBackupBtn.hidden = false;
      aviso('Banco não configurado — o backup .json está pronto para baixar.', 'atencao');
    })
    // Conflito não é "não gravou": alguma linha deste sorteio já existe no
    // banco, e mandar o backup de novo daria o mesmo erro. Pedir reenvio ali
    // mandaria a secretaria repetir uma operação que nunca vai passar.
    .catch(err => {
      backupPendente = sorteio;
      baixarBackupBtn.hidden = false;
      aviso(err.status === 409
        ? `Nada foi gravado: ${err.message}. O backup .json está pronto para baixar — confira o sorteio anterior antes de repetir.`
        : `Falha ao gravar no banco (${err.message}). O backup .json está pronto para baixar.`, 'erro');
    })
    .finally(() => {
      btnVoltar.disabled = false;
      if (resultadoStatus) {
        resultadoStatus.hidden = true;
        resultadoStatus.replaceChildren();
      }
    });
}

// ── Persistência (Supabase / PostgREST) ──────────────────────────────────────
// Cada colegiado grava no próprio acervo, e de lá saem os julgados (ver
// schema.sql). Sem Supabase configurado, o sorteio vira um botão para baixar um
// .json de backup.
const TABELAS = { CJ: 'acervo_cj', CREG: 'acervo_creg' };

// A coluna de decisão é Defesa na Câmara de Julgamento e Recurso no Conselho
// Regulador — coisas diferentes, então cada modo guarda a sua com o próprio nome.
// As células são buscadas por classe, e não por posição: assim mexer nas colunas
// da tabela não desalinha silenciosamente a leitura.
//
// A data da distribuição é a mesma para o sorteio inteiro e chega por parâmetro.
// Antes ela viajava numa coluna escondida da tabela, escrita durante o sorteio e
// lida aqui — a tela servindo de variável entre duas funções.
function coletarDados(rows, dataDistribuicao) {
  return rows.map(r => {
    const processo = {
      ordem: Number(r.querySelector('.num').textContent.trim()),
      numProcesso: r.querySelector('.col-processo input').value.trim(),
      assunto: r.querySelector('.col-assunto select').value.trim(),
      dataDistribuicao,
      unidade: r.dataset.unidade || ''
    };

    const escolha = r.querySelector('.col-decisao select').value.trim();
    if (modoSorteio === 'CJ') processo.defesa = escolha;
    else {
      processo.recurso = escolha;
      processo.interessado = r.querySelector('.col-interessado input').value.trim();
    }

    return processo;
  });
}

// Cada processo carrega só a decisão do seu modo: recurso no CREG, defesa na CJ.
// Quem lê os dois de uma vez — a ata — passa por aqui.
function decisaoDe(processo) {
  return processo.recurso ?? processo.defesa ?? '';
}

// Usa a data local, não a do ISO (que é UTC): um sorteio às 22h de Brasília
// cairia no dia seguinte em UTC e o nome do arquivo divergiria da ata.
function nomeArquivo(sorteio, ext) {
  const d = new Date(sorteio.dataHora);
  const dia = d.getDate().toString().padStart(2, '0');
  const mes = (d.getMonth() + 1).toString().padStart(2, '0');
  return `Sorteio_${sorteio.modo}_${dia}.${mes}.${d.getFullYear()}.${ext}`;
}

// ── Word (.doc) ──────────────────────────────────────────────────────────────
function exportarWord(sorteio) {
  const hoje = new Date(sorteio.dataHora);
  const dia = hoje.getDate().toString().padStart(2, '0');
  const mesExtenso = hoje.toLocaleString('pt-BR', { month: 'long' });
  const ano = hoje.getFullYear();

  const cabecalho = `Aos ${dia} dias do mês de ${mesExtenso} de ${ano} na sede da Agência Goiana de Regulação, Controle e Fiscalização de Serviços Públicos, realizou-se a distribuição de processos por sorteio eletrônico.`;
  const colunaNome = sorteio.modo === 'CREG' ? 'Unidade Conselho Regulador' : 'Unidade Câmara de Julgamento';
  // A 6ª coluna muda de pergunta conforme o colegiado, como na tela.
  const colunaDecisao = sorteio.modo === 'CJ' ? 'Defesa' : 'Recurso';

  const dados = [...sorteio.processos].sort((a, b) => a.unidade.localeCompare(b.unidade, 'pt-BR', { numeric: true }));

  // A ata repete as mesmas colunas que a secretaria preencheu: sem o assunto e a
  // decisão, quem lê o documento não consegue conferir a repartição por assunto
  // que o rodapé do sistema promete.
  const colunas = sorteio.modo === 'CREG'
    ? ['Ordem', 'Nº Processo', 'Interessado', 'Assunto', colunaDecisao, colunaNome]
    : ['Ordem', 'Nº Processo', 'Assunto', colunaDecisao, colunaNome];

  let tableHtml = '<table border="1" style="border-collapse:collapse;width:100%"><tr>'
    + colunas.map(c => `<th>${escaparHtml(c)}</th>`).join('')
    + '</tr>';
  dados.forEach(d => {
    const celulas = sorteio.modo === 'CREG'
      ? [d.ordem, d.numProcesso, d.interessado, d.assunto, decisaoDe(d), d.unidade]
      : [d.ordem, d.numProcesso, d.assunto, decisaoDe(d), d.unidade];
    tableHtml += '<tr>' + celulas.map(c => `<td>${escaparHtml(c ?? '')}</td>`).join('') + '</tr>';
  });
  tableHtml += '</table>';

  const wordConteudo = '﻿' + `<meta charset="UTF-8"><p>${escaparHtml(cabecalho)}</p>${tableHtml}`;
  baixarArquivo(new Blob([wordConteudo], { type: 'application/msword' }), nomeArquivo(sorteio, 'doc'));
}

function escaparHtml(valor) {
  return String(valor).replace(/[&<>"']/g, caractere => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[caractere]);
}

function baixarArquivo(blob, nome) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = nome;
  link.hidden = true;
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}

// dd/mm/aaaa → aaaa-mm-dd (formato date do Postgres)
function dataISO(dataBR) {
  const [dia, mes, ano] = dataBR.split('/');
  return `${ano}-${mes}-${dia}`;
}

// Uma linha por processo, no formato da tabela de cada modo. A unidade sorteada
// é quem fica com o processo no acervo — é ela que os julgados usam depois para
// saber quem levou o processo à sessão. Os dois acervos têm o mesmo desenho e
// mudam de vocabulário: na Câmara a coluna é `relator` e guarda a decisão sobre
// a DEFESA (booleana); no Conselho é `unidade` e guarda o RECURSO (texto, com
// mais de dois valores).
function linhasParaBanco(sorteio) {
  if (sorteio.modo === 'CJ') {
    return sorteio.processos.map(p => ({
      num_processo: p.numProcesso,
      relator: p.unidade,
      data_distribuicao: dataISO(p.dataDistribuicao),
      defesa: p.defesa === 'Sim',
      assunto: p.assunto,
      ordem: p.ordem,
      sorteado_em: sorteio.dataHora
    }));
  }

  return sorteio.processos.map(p => ({
    num_processo: p.numProcesso,
    unidade: p.unidade,
    data_distribuicao: dataISO(p.dataDistribuicao),
    recurso: p.recurso,
    assunto: p.assunto,
    // Campo livre da secretaria, só no Conselho. Vazio vira null e não string
    // vazia: no banco a ausência do dado é null, e "" seria um valor.
    interessado: p.interessado || null,
    ordem: p.ordem,
    sorteado_em: sorteio.dataHora
  }));
}

// Grava o sorteio no banco. A interface oferece o JSON por clique explícito
// quando não há Supabase configurado ou a chamada falha.
async function salvar(sorteio) {
  const tabela = TABELAS[sorteio.modo];
  if (!SUPABASE_URL || !SUPABASE_KEY || !accessToken || !tabela) {
    return 'arquivo';
  }

  const linhas = linhasParaBanco(sorteio);

  // Passa por api() para que um token vencido seja renovado antes da gravação.
  try {
    await api(tabela, {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(linhas)
    });
    return 'banco';
  } catch (err) {
    // O POST é uma transação só: basta uma linha em conflito para nenhuma
    // entrar. Dizer "o sorteio já está gravado" seria falso quando só um
    // processo repetiu — os outros continuam de fora.
    if (err.status === 409) {
      throw Object.assign(
        new Error('algum processo deste sorteio já foi distribuído hoje para a mesma unidade'),
        { status: 409 });
    }
    throw err;
  }
}

function baixarBackup(sorteio) {
  const json = JSON.stringify(sorteio, null, 2);
  baixarArquivo(new Blob([json], { type: 'application/json' }), nomeArquivo(sorteio, 'json'));
}

baixarBackupBtn.addEventListener('click', () => {
  if (!backupPendente) return;
  baixarBackup(backupPendente);
  backupPendente = undefined;
  baixarBackupBtn.hidden = true;
  btnVoltar.focus();
  aviso('Backup .json baixado.');
});

createBtn.addEventListener('click', async () => {
  const n = Number(numRowsInput.value);
  if (!Number.isInteger(n) || n < 1 || n > 500) {
    mostrarMensagemFormulario('Informe uma quantidade entre 1 e 500 processos.', numRowsInput);
    return;
  }
  esconderMensagemFormulario();
  numRowsInput.disabled = true;
  addRowBtn.disabled = true;
  sortearBtn.hidden = true;
  processEntry.hidden = false;
  processEntry.setAttribute('aria-busy', 'true');
  alternarBotaoCarregando(createBtn, true, 'Gerando linhas…');

  try {
    await createRows(n);
    sortearBtn.hidden = false;
    tbody.querySelector('input')?.focus();
  } finally {
    numRowsInput.disabled = false;
    addRowBtn.disabled = false;
    processEntry.removeAttribute('aria-busy');
    alternarBotaoCarregando(createBtn, false);
  }
});

addRowBtn.addEventListener('click', () => {
  if (tbody.children.length >= 500) {
    mostrarMensagemFormulario('O limite é de 500 processos.', addRowBtn);
    return;
  }
  const nextIndex = tbody.children.length + 1;
  const tr = createRowElement(nextIndex);
  tbody.appendChild(tr);
});

sortearBtn.addEventListener('click', sortearProcessos);
