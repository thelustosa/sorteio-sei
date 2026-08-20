#!/usr/bin/env node
// Verifica a aleatoriedade do sorteio:
//
//     node tests/test_sorteio.mjs
//
// O sorteio distribui processos entre unidades do Conselho Regulador e da
// Câmara de Julgamento, e o rodapé do sistema promete que ele é auditável.
// Isso exige embaralhamento uniforme. O teste falha tanto se alguém trocar
// Fisher-Yates por `sort(() => Math.random() - 0.5)` (enviesado e dependente do
// navegador) quanto se o descarte do resto sumir de inteiroAleatorio.

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const raiz = join(dirname(fileURLToPath(import.meta.url)), '..');
const fonte = readFileSync(join(raiz, 'index.js'), 'utf8');

const inicio = fonte.indexOf('function inteiroAleatorio');
const fim = fonte.indexOf('// ── fim do bloco verificado');
assert.ok(inicio > 0 && fim > inicio, 'bloco de aleatoriedade não encontrado em index.js');

const { inteiroAleatorio, embaralhar } = new Function(
  `${fonte.slice(inicio, fim)} return { inteiroAleatorio, embaralhar };`
)();

// inteiroAleatorio devolve sempre um índice válido e cobre toda a faixa.
for (const limite of [1, 2, 3, 5, 7]) {
  const vistos = new Set();
  for (let i = 0; i < limite * 400; i++) {
    const v = inteiroAleatorio(limite);
    assert.ok(Number.isInteger(v) && v >= 0 && v < limite, `${v} fora de [0, ${limite})`);
    vistos.add(v);
  }
  assert.equal(vistos.size, limite, `limite ${limite}: valores nunca sorteados`);
}

// embaralhar preserva os elementos.
const original = [1, 2, 3, 4, 5, 6, 7, 8];
assert.deepEqual([...embaralhar([...original])].sort((a, b) => a - b), original);

// E é uniforme: as 6 permutações de 3 elementos saem com a mesma frequência.
// Um comparador aleatório em sort() erra este teste com folga.
const RODADAS = 60000;
const esperado = RODADAS / 6;
const contagem = new Map();
for (let i = 0; i < RODADAS; i++) {
  const chave = embaralhar(['a', 'b', 'c']).join('');
  contagem.set(chave, (contagem.get(chave) || 0) + 1);
}

assert.equal(contagem.size, 6, `saíram ${contagem.size} permutações, esperadas 6`);
for (const [perm, vezes] of contagem) {
  const desvio = Math.abs(vezes - esperado) / esperado;
  assert.ok(desvio < 0.08, `permutação ${perm}: ${vezes} ocorrências, desvio de ${(desvio * 100).toFixed(1)}%`);
}

console.log('sorteio: aleatoriedade uniforme ✓');
