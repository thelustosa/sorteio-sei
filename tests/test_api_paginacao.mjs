import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import vm from 'node:vm';

function cliente(fetch) {
  const contexto = vm.createContext({
    window: { addEventListener() {} }, AbortController, setTimeout, clearTimeout, fetch
  });
  vm.runInContext(readFileSync(new URL('../assets/js/supabase.js', import.meta.url), 'utf8'), contexto);
  return (caminho, opcoes = {}) => contexto.api(caminho, opcoes);
}

const resposta = (itens, intervalo) => ({
  ok: true, status: 200, json: async () => itens,
  headers: { get: () => intervalo }
});

test('busca todas as páginas de RPC mesmo com limite do servidor menor que 1000', async () => {
  const chamadas = [];
  const api = cliente(async (url, opcoes) => {
    chamadas.push({ url, opcoes });
    const offset = Number(new URL(url).searchParams.get('offset') || 0);
    const itens = Array.from({ length: Math.min(400, 1001 - offset) }, (_, i) => ({ id: offset + i }));
    return resposta(itens, `${offset}-${offset + itens.length - 1}/1001`);
  });
  const itens = await api('rpc/processos_acervo_cj', {
    method: 'POST', body: '{"p_ordem":null}', paginar: true
  });
  assert.equal(itens.length, 1001);
  assert.equal(new Set(itens.map(i => i.id)).size, 1001);
  assert.equal(chamadas.length, 3);
  assert.ok(chamadas.every(c => c.opcoes.body === '{"p_ordem":null}'));
  assert.ok(chamadas.every(c => c.opcoes.headers.Prefer.includes('count=exact')));
});

test('pagina GET mantendo filtros e ordenação', async () => {
  const urls = [];
  const api = cliente(async url => {
    urls.push(url);
    return urls.length === 1 ? resposta([{ id: 1 }], '0-0/2') : resposta([{ id: 2 }], '1-1/2');
  });
  assert.equal((await api('julgados_cj?select=id&order=id.asc')).length, 2);
  const params = new URL(urls[1]).searchParams;
  assert.equal(params.get('select'), 'id');
  assert.equal(params.get('order'), 'id.asc');
  assert.equal(params.get('offset'), '1');
});

test('não devolve exportação parcial quando uma página falha', async () => {
  let chamadas = 0;
  const api = cliente(async () => {
    if (++chamadas === 1) return resposta([{ id: 1 }], '0-0/2');
    throw new Error('sem rede');
  });
  await assert.rejects(api('julgados_cj'), /sem rede/);
});

test('não repete POST de escrita que retorna array', async () => {
  let chamadas = 0;
  const api = cliente(async () => { chamadas++; return resposta([{ id: 1 }], '0-0/2'); });
  assert.equal((await api('rpc/admin_corrigir_julgado_cj', { method: 'POST', body: '{}' })).length, 1);
  assert.equal(chamadas, 1);
});

test('rejeita servidor que ignora offset sem entrar em loop', async () => {
  let chamadas = 0;
  const api = cliente(async () => { chamadas++; return resposta([{ id: 1 }], '0-0/2'); });
  await assert.rejects(api('julgados_cj'), /paginação/);
  assert.equal(chamadas, 2);
});

test('resultado vazio não consulta outra página', async () => {
  let chamadas = 0;
  const api = cliente(async () => { chamadas++; return resposta([], '*/0'); });
  assert.equal((await api('julgados_cj')).length, 0);
  assert.equal(chamadas, 1);
});

test('não apresenta lista como completa se o servidor não confirmar a contagem', async () => {
  const api = cliente(async () => resposta([{ id: 1 }], '0-0/*'));
  await assert.rejects(api('julgados_cj'), /total de registros/);
});

test('insert com return=minimal (201 sem corpo) é sucesso', async () => {
  let chamadas = 0;
  const api = cliente(async () => {
    chamadas++;
    return { ok: true, status: 201, headers: { get: () => '*/*' },
      json: async () => { throw new SyntaxError('Unexpected end of JSON input'); } };
  });
  assert.equal(await api('acervo_cj', {
    method: 'POST', headers: { Prefer: 'return=minimal' }, body: '[]'
  }), null);
  assert.equal(chamadas, 1);
});

test('resposta JSON inválida é erro, não sucesso sem dados', async () => {
  const api = cliente(async () => ({ ok: true, status: 200, json: async () => { throw new Error('JSON inválido'); } }));
  await assert.rejects(api('julgados_cj'), /JSON inválido/);
});

test('páginas depois da primeira saem juntas, sem esperar uma pela outra', async () => {
  const pendentes = [];
  const api = cliente(url => {
    const offset = Number(new URL(url).searchParams.get('offset') || 0);
    const itens = Array.from({ length: Math.min(1000, 3447 - offset) }, (_, i) => ({ id: offset + i }));
    const pronta = resposta(itens, `${offset}-${offset + itens.length - 1}/3447`);
    if (!offset) return Promise.resolve(pronta);
    return new Promise(resolve => pendentes.push(() => resolve(pronta)));
  });
  const resultado = api('acervo_cj?select=id');
  await new Promise(resolve => setTimeout(resolve, 0));
  assert.equal(pendentes.length, 3, 'as três páginas restantes são pedidas antes de qualquer uma voltar');
  pendentes.reverse().forEach(liberar => liberar());
  const itens = await resultado;
  assert.deepEqual(itens.map(i => i.id), Array.from({ length: 3447 }, (_, i) => i),
    'a ordem é a dos offsets, não a de chegada');
});

test('lista que muda de tamanho no meio da paginação é recusada', async () => {
  const api = cliente(async url => {
    const offset = Number(new URL(url).searchParams.get('offset') || 0);
    return offset ? resposta([{ id: 2 }], '1-1/3') : resposta([{ id: 1 }], '0-0/2');
  });
  await assert.rejects(api('julgados_cj'), /inconsistentes/);
});
