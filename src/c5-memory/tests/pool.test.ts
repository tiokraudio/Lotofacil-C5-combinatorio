/**
 * Testes unitários para o gerador determinístico de pool C5-Memory.
 */
import { createMulberry32, normalizePoolMasterSeed } from "../prng.ts";
import {
  generatePool,
  replayPool,
  generateCandidatePermutation,
  serializePool,
  deserializePool,
  canonicalizePoolString,
  WORDS_PER_CANDIDATE,
  DEFAULT_POOL_SIZE,
  TOTAL_WORDS_PER_POOL,
} from "../pool.ts";
import { validateC5 } from "../../c5/validator.ts";
import { buildC5FromPermutation } from "../../c5/canonicalBuilder.ts";
import { selectBestCandidate } from "../math.ts";
import type { PoolCandidate } from "../types.ts";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`FALHA NA ASSERÇÃO: ${msg}`);
  }
  console.log(`  ✓ ${msg}`);
}

console.log("=== EXECUTANDO TESTES UNITÁRIOS C5-MEMORY POOL ===");

// 1. Normalização de Semente uint32
assert(normalizePoolMasterSeed(0) === 0, "Seed 0 é preservada");
assert(normalizePoolMasterSeed(1) === 1, "Seed 1 é preservada");
assert(normalizePoolMasterSeed(4294967295) === 4294967295, "Seed uint32 max é preservada");
assert(normalizePoolMasterSeed("20260929") === 20260929, "Seed numérica em string é convertida para número");
assert(typeof normalizePoolMasterSeed("ALPHA-SEED") === "number", "Seed arbitrária em string produz uint32");

// 2. PRNG Golden Words (Seed 0)
const rng0 = createMulberry32(0);
const expectedWords0 = [1144304738, 1416247, 958946056, 627933444];
for (let i = 0; i < expectedWords0.length; i++) {
  const w = rng0.nextWord();
  assert(w === expectedWords0[i], `Mulberry32 Seed 0: palavra ${i} é ${expectedWords0[i]}`);
}

// 3. Consumo de Palavras: 24 por candidato
const rngCandidate = createMulberry32(100);
const perm = generateCandidatePermutation(rngCandidate);
assert(perm.length === 25, "Permutação tem 25 elementos");
assert(rngCandidate.getWordsConsumed() === WORDS_PER_CANDIDATE, "Exatamente 24 palavras consumidas por permutação");
const sortedPerm = [...perm].sort((a, b) => a - b);
assert(sortedPerm[0] === 1 && sortedPerm[24] === 25, "Permutação contém exatamente 1..25");

// 4. Geração do Pool: K = 500, total palavras = 12.000
const testSeed = 20260929;
const pool = generatePool(testSeed);
assert(pool.length === DEFAULT_POOL_SIZE, `Pool contém exatamente ${DEFAULT_POOL_SIZE} candidatos`);

// Verificar poolIndex 0..499
let indicesCorrect = true;
for (let i = 0; i < pool.length; i++) {
  if (pool[i].poolIndex !== i) {
    indicesCorrect = false;
    break;
  }
}
assert(indicesCorrect, "poolIndex é estritamente sequencial 0..499");

// 5. Validação dos candidatos C5 e conformidade com C5-1.0.0
for (let i = 0; i < 20; i++) {
  const cand = pool[i];
  assert(cand.games.length === 5, `Candidato ${i} tem 5 jogos`);
  const frequencies: Record<number, number> = {};
  for (let g = 0; g < 5; g++) {
    const game = cand.games[g];
    assert(game.length === 15, `Candidato ${i}, jogo ${g} tem 15 dezenas`);
    const s = new Set(game);
    assert(s.size === 15, `Candidato ${i}, jogo ${g} tem 15 dezenas distintas`);
    assert(game.every((n) => n >= 1 && n <= 25), `Candidato ${i}, jogo ${g} está em 1..25`);
    for (const num of game) {
      frequencies[num] = (frequencies[num] || 0) + 1;
    }
  }
  for (let n = 1; n <= 25; n++) {
    assert(frequencies[n] === 3, `Candidato ${i}: dezena ${n} aparece exatamente 3 vezes`);
  }
}

// Validar geração completa C5 via validateC5
const rngTestVal = createMulberry32(777);
const permTestVal = generateCandidatePermutation(rngTestVal);
const c5TestGen = buildC5FromPermutation(permTestVal);
const valRes = validateC5(c5TestGen);
assert(valRes.valid && valRes.errors.length === 0, "C5 completo gerado a partir de permutação é 100% válido segundo validateC5 (C5-1.0.0)");

// 6. Determinismo A → A
const poolA1 = generatePool(testSeed);
const poolA2 = generatePool(testSeed);
assert(
  canonicalizePoolString(poolA1) === canonicalizePoolString(poolA2),
  "Determinismo A → A: pools gerados com mesma seed são 100% idênticos"
);

// 7. Isolamento A → B → A (ERR-POOL05)
const poolA = generatePool(101);
const poolB = generatePool(202);
const poolA_replay = generatePool(101);
assert(
  canonicalizePoolString(poolA) === canonicalizePoolString(poolA_replay),
  "Isolamento A → B → A: geração intermediária de B não altera replay de A"
);
assert(
  canonicalizePoolString(poolA) !== canonicalizePoolString(poolB),
  "Seeds distintas produzem pools distintos"
);

// 8. Replay do Pool
const replayed = replayPool(testSeed);
assert(
  canonicalizePoolString(pool) === canonicalizePoolString(replayed),
  "replayPool reproduz o pool original de forma determinística"
);

// 9. Serialização / Deserialização
const serialized = serializePool(pool);
const deserialized = deserializePool(serialized);
assert(
  canonicalizePoolString(pool) === canonicalizePoolString(deserialized),
  "Serializar e deserializar o pool preserva candidatos, jogos e poolIndex perfeitamente"
);

// 10. Ordem Assíncrona / Imutabilidade do poolIndex
const shuffledPool: PoolCandidate[] = [...pool].sort(() => 0.5 - Math.random());
const dummyH = [pool[0].games[0]];
const resOriginal = selectBestCandidate(pool, dummyH);
const resShuffled = selectBestCandidate(shuffledPool, dummyH);
assert(
  resOriginal.winnerPoolIndex === resShuffled.winnerPoolIndex,
  "Ordem de avaliação física / assíncrona não altera o winnerPoolIndex"
);

// 11. Não-mutação do pool durante seleção
const snapBefore = canonicalizePoolString(pool);
selectBestCandidate(pool, dummyH);
const snapAfter = canonicalizePoolString(pool);
assert(snapBefore === snapAfter, "Seleção MAX-LEXIMIN não mutaciona a estrutura do pool");

console.log("🎉 Todos os testes unitários de C5-Memory Pool passaram com SUCESSO!");
