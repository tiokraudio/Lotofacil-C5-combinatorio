/**
 * Suíte de Testes Unitários do Núcleo Matemático de Integração C5-Memory-2.0.0.
 */
import {
  validateGame,
  popcount32,
  gameToBitmask,
  johnsonDistance,
  computeCandidateHistogram,
  compareHistogramsLeximin,
  selectBestCandidate,
  C5_MEMORY_ALGORITHM_VERSION,
} from "../math.ts";
import type { C5Candidate, HistoryGame, JohnsonHistogram, PoolCandidate } from "../types.ts";

let passedCount = 0;
let totalCount = 0;

function assert(condition: boolean, message: string) {
  totalCount++;
  if (!condition) {
    console.error(`❌ FALHA: ${message}`);
    throw new Error(`Falha no teste: ${message}`);
  }
  passedCount++;
  console.log(`  ✓ ${message}`);
}

console.log("=== EXECUTANDO TESTES UNITÁRIOS C5-MEMORY MATH ===");

// 1. VERSÃO
assert(C5_MEMORY_ALGORITHM_VERSION === "C5-Memory-2.0.0", "C5_MEMORY_ALGORITHM_VERSION é C5-Memory-2.0.0");

// 2. VALIDAÇÃO DE JOGO
const validGame = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const duplicateGame = [1, 1, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const shortGame = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14];
const outOfRangeGame = [0, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 26];

assert(validateGame(validGame) === true, "validateGame aceita jogo válido de 15 dezenas em 1..25");
assert(validateGame(duplicateGame) === false, "validateGame rejeita jogo com dezena duplicada");
assert(validateGame(shortGame) === false, "validateGame rejeita jogo com menos de 15 dezenas");
assert(validateGame(outOfRangeGame) === false, "validateGame rejeita jogo com dezena fora de 1..25");

// 3. DISTÂNCIA JOHNSON
const gameA = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
const gameB = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16]; // d = 1
const gameC = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20]; // d = 5
const gameD = [11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]; // d = 10

assert(johnsonDistance(gameA, gameA) === 0, "dJ(A, A) === 0 (jogos idênticos)");
assert(johnsonDistance(gameA, gameB) === 1, "dJ(A, B) === 1 (interseção 14)");
assert(johnsonDistance(gameA, gameC) === 5, "dJ(A, C) === 5 (interseção 10)");
assert(johnsonDistance(gameA, gameD) === 10, "dJ(A, D) === 10 (interseção mínima 5)");
assert(johnsonDistance(gameA, gameC) === johnsonDistance(gameC, gameA), "Simetria dJ(A, C) === dJ(C, A)");

// 4. HISTOGRAMA E IDENTIDADE \sum nd = 5|H|
const candidate1: C5Candidate = [
  gameA,
  gameB,
  gameC,
  gameD,
  gameA,
];
const historySample: HistoryGame[] = [
  gameA,
  gameB,
  gameC,
];

const hist1 = computeCandidateHistogram(candidate1, historySample);
const sumHist1 = hist1.reduce((acc, v) => acc + v, 0);
assert(sumHist1 === 5 * historySample.length, `Soma do histograma sum(nd) === 5 * |H| (${sumHist1} === 15)`);

// Histórico vazio
const emptyHist = computeCandidateHistogram(candidate1, []);
assert(
  emptyHist.every((v) => v === 0) && emptyHist.length === 11,
  "Histórico vazio produz histograma nulo de 11 posições [0..0]"
);

// 5. COMPARADOR LEXICOGRÁFICO E N10 NÃO-DECISÓRIO
const hBetterN0: JohnsonHistogram = [0, 10, 20, 30, 40, 50, 40, 30, 20, 10, 0];
const hWorseN0: JohnsonHistogram = [1, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
assert(
  compareHistogramsLeximin(hBetterN0, hWorseN0) === -1,
  "LEXMIN: n0=0 é estritamente melhor que n0=1"
);

// Decisão em coordenada profunda (n9)
const hTie0to8_A: JohnsonHistogram = [0, 2, 5, 10, 20, 50, 40, 20, 10, 3, 100];
const hTie0to8_B: JohnsonHistogram = [0, 2, 5, 10, 20, 50, 40, 20, 10, 5, 0];
assert(
  compareHistogramsLeximin(hTie0to8_A, hTie0to8_B) === -1,
  "LEXMIN: Decisão em n9 (3 < 5)"
);

// n10 não decisório: n0..n9 idênticos, n10 diferente
const hEqual0to9_A: JohnsonHistogram = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 50];
const hEqual0to9_B: JohnsonHistogram = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 999];
assert(
  compareHistogramsLeximin(hEqual0to9_A, hEqual0to9_B) === 0,
  "LEXMIN: n10 é estritamente NÃO-DECISÓRIO (retorna 0 para n0..n9 idênticos)"
);

// 6. DESEMPATE POR MENOR POOLINDEX
const poolTie: PoolCandidate[] = [
  { poolIndex: 42, games: candidate1 },
  { poolIndex: 12, games: candidate1 }, // Mesmo candidato, poolIndex menor
  { poolIndex: 99, games: candidate1 },
];
const tieResult = selectBestCandidate(poolTie, historySample);
assert(tieResult.winnerIndex === 1, "Desempate: winnerIndex seleciona o elemento com menor poolIndex");
assert(tieResult.winnerPoolIndex === 12, "Desempate: winnerPoolIndex é estritamente 12 (mínimo entre 42, 12, 99)");

// 7. HISTÓRICO COM MULTIPLICIDADE PRESERVADA (MULTICONJUNTO)
const histSingle: HistoryGame[] = [gameA];
const histDouble: HistoryGame[] = [gameA, gameA];
const hSingle = computeCandidateHistogram(candidate1, histSingle);
const hDouble = computeCandidateHistogram(candidate1, histDouble);
assert(hDouble[0] === 2 * hSingle[0], "Multiplicidade de jogos no histórico é rigorosamente preservada");

// 8. INVARIÂNCIA CONTRA PERMUTAÇÃO DE H
const histPermuted: HistoryGame[] = [gameC, gameA, gameB];
const histOriginal: HistoryGame[] = [gameA, gameB, gameC];
const hOrig = computeCandidateHistogram(candidate1, histOriginal);
const hPerm = computeCandidateHistogram(candidate1, histPermuted);
assert(
  JSON.stringify(hOrig) === JSON.stringify(hPerm),
  "Invariância: permutar a ordem física dos jogos em H não altera o histograma"
);

// 9. IMUTABILIDADE DE INPUTS
const historyFrozenCopy = historySample.map((g) => [...g]);
const poolFrozenCopy = poolTie.map((p) => ({
  poolIndex: p.poolIndex,
  games: p.games.map((g) => [...g]) as any,
}));

selectBestCandidate(poolTie, historySample);

// Checar se histórico foi alterado
assert(
  JSON.stringify(historySample) === JSON.stringify(historyFrozenCopy),
  "Imutabilidade: histórico não sofre mutação durante a seleção"
);
// Checar se pool foi alterado
assert(
  JSON.stringify(poolTie) === JSON.stringify(poolFrozenCopy),
  "Imutabilidade: pool não sofre mutação durante a seleção"
);

// 10. ADVERSARIAL CONTRA SCORE PONDERADO
// Candidato X tem n0=0, n1=10, soma total das distâncias menor
// Candidato Y tem n0=1, n1=0, mas tem média ponderada que poderia enganar score ad-hoc
const candX: C5Candidate = [gameC, gameC, gameC, gameC, gameC];
const candY: C5Candidate = [gameA, gameC, gameC, gameC, gameC];
const poolAdv: PoolCandidate[] = [
  { poolIndex: 0, games: candY }, // Colide em d=0 com gameA (n0 = 1)
  { poolIndex: 1, games: candX }, // Não colide em d=0 com gameA (n0 = 0)
];
const advResult = selectBestCandidate(poolAdv, [gameA]);
assert(
  advResult.winnerIndex === 1 && advResult.winnerPoolIndex === 1,
  "Adversarial: LEXMIN seleciona candidato com n0=0 em vez de candidato com colisão n0=1"
);

console.log(`\n🎉 Todos os ${passedCount}/${totalCount} testes unitários de C5-Memory Math passaram com SUCESSO!\n`);
