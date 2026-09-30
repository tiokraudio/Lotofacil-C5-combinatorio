/**
 * Testes unitários para o módulo de Histórico H, Canonicalização e Fingerprint de C5-Memory.
 */
import {
  canonicalizeGame,
  canonicalizeHistory,
  computeHistoryPreimage,
  computeHistoryFingerprint,
  buildHistoryFromRecords,
  DOMAIN_SEPARATION_H,
  CANONICAL_GAME_BLOCK_LENGTH,
  type EligibleRecordInput,
} from "../history.ts";
import { selectBestCandidate } from "../math.ts";
import { generatePool } from "../pool.ts";

function assert(condition: boolean, msg: string) {
  if (!condition) {
    throw new Error(`FALHA NA ASSERÇÃO: ${msg}`);
  }
  console.log(`  ✓ ${msg}`);
}

console.log("=== EXECUTANDO TESTES UNITÁRIOS C5-MEMORY HISTORY ===");

// 1. Canonicalização de Jogo Individual
const g1 = [15, 1, 14, 2, 13, 3, 12, 4, 11, 5, 10, 6, 9, 7, 8];
const canonG1 = canonicalizeGame(g1);
assert(canonG1 === "01,02,03,04,05,06,07,08,09,10,11,12,13,14,15", "Dezenas são ordenadas numericamente e formatadas com 2 dígitos");
assert(canonG1.length === CANONICAL_GAME_BLOCK_LENGTH, `Bloco canônico possui comprimento fixo de ${CANONICAL_GAME_BLOCK_LENGTH} caracteres`);

// 2. Rejeição de Jogos Inválidos
let threwInvalidCount = false;
try {
  canonicalizeGame([1, 2, 3]);
} catch {
  threwInvalidCount = true;
}
assert(threwInvalidCount, "Rejeita jogo com menos de 15 dezenas");

let threwDuplicate = false;
try {
  canonicalizeGame([1, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14]);
} catch {
  threwDuplicate = true;
}
assert(threwDuplicate, "Rejeita jogo com dezenas duplicadas");

let threwOutOfRange = false;
try {
  canonicalizeGame([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 26]);
} catch {
  threwOutOfRange = true;
}
assert(threwOutOfRange, "Rejeita jogo com dezena fora de 1..25");

// 3. GV-I02: Histórico Vazio (H = [])
const emptyPreimage = computeHistoryPreimage([]);
const emptyDigest = computeHistoryFingerprint([]);
assert(emptyPreimage === "C5-MEMORY-H-FINGERPRINT-V1:0:", "Preimagem do histórico vazio é 'C5-MEMORY-H-FINGERPRINT-V1:0:'");
assert(emptyDigest === "77a0ea80168e96d83782c03b08e6155078b3d9e7477b966afc95bda0bb1a93fa", "Digest de histórico vazio é 77a0ea80...93fa (GV-I02)");

// 4. GV-I03: Histórico Concreto com 2 Jogos
const gv03Games = [
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 16, 17, 18, 19, 20],
];
const gv03Preimage = computeHistoryPreimage(gv03Games);
const gv03Digest = computeHistoryFingerprint(gv03Games);
assert(
  gv03Preimage === "C5-MEMORY-H-FINGERPRINT-V1:2:01,02,03,04,05,06,07,08,09,10,11,12,13,14,15;01,02,03,04,05,06,07,08,09,10,16,17,18,19,20",
  "Preimagem GV-I03 coincide exatamente com a especificação"
);
assert(gv03Digest === "6d68b02584a1c274a4c6ae2d555cfef573961bae4ccae88c261b88066e39273f", "Digest GV-I03 coincide exatamente (6d68b025...)");

// 5. GV-I04: Invariância de Reordenação no Histórico
const seqA = [
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
  [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
];
const seqB = [
  [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
];
assert(computeHistoryPreimage(seqA) === computeHistoryPreimage(seqB), "Preimagens de sequências permutadas são rigorosamente idênticas");
assert(computeHistoryFingerprint(seqA) === computeHistoryFingerprint(seqB), "Digests de sequências permutadas são rigorosamente idênticos");
assert(computeHistoryFingerprint(seqA) === "9a71864a594f4990302f9ba45a29c9f76bc02f834d8ee75f6caf8b918dd4c833", "Digest GV-I04 confere (9a71864a...)");

// 6. GV-I05: Sensibilidade a Dezena Única (Anti-colisão)
const origG = [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]];
const mutG = [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16]];
assert(computeHistoryFingerprint(origG) === "429db719fc5efd701a93a119228c8857c1e4bc7bf6f4bb19d9403ba6fbdae875", "Digest do jogo original coincide (GV-I05)");
assert(computeHistoryFingerprint(mutG) === "81a1d5489210cfae4d9f777e74f2496923101d760f5157b37bc607b1789cae62", "Digest do jogo com mutação coincide (GV-I05)");
assert(computeHistoryFingerprint(origG) !== computeHistoryFingerprint(mutG), "Mutação de dezena única altera completamente o digest (avalanche)");

// 7. GV-I06: Semântica de Multiconjunto e Preservação de Multiplicidade
const singleSet = [[1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15]];
const doubleSet = [
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
];
assert(computeHistoryFingerprint(doubleSet) === "d0a1585e5653b8897d8f48fda97b87886dbaf40f1d870985d4d22056f1cb15e9", "Digest com multiplicidade dupla coincide (GV-I06)");
assert(computeHistoryFingerprint(singleSet) !== computeHistoryFingerprint(doubleSet), "Multiplicidade duplicada altera a identidade criptográfica de H");

// 8. Construção de H: Exclusão estrita de DRAFT e Dados CAIXA
const mockRecords: EligibleRecordInput[] = [
  {
    status: "DRAFT",
    betPlacedAt: "2026-09-29T10:00:00Z",
    games: [
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 18],
      [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 19],
    ],
  },
  {
    status: "FROZEN",
    betPlacedAt: "2026-09-29T11:00:00Z",
    games: [
      [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16],
      [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 17],
      [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 18],
      [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 19],
      [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 20],
    ],
    result: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15], // Dado CAIXA
    score: { maxHits: 15, prize: 5000000 },                        // Dado CAIXA
  },
  {
    status: "SCORED",
    betPlacedAt: "2026-09-29T12:00:00Z",
    generation: {
      games: [
        [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17],
        [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 18],
        [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 19],
        [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 20],
        [3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 21],
      ],
    },
    result: [2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 1, 3, 5],
  },
];

const builtH = buildHistoryFromRecords(mockRecords);
assert(builtH.length === 10, "Exatamente 10 jogos extraídos (2 apostas elegíveis × 5 jogos; DRAFT excluído)");
// Verificar que nenhum dado CAIXA entrou em H
const hasCaixaDraw = builtH.some(
  (g) => g.join(",") === "1,2,3,4,5,6,7,8,9,10,11,12,13,14,15" && g.length === 15
);
assert(!hasCaixaDraw, "Dados de sorteio da CAIXA não ingressam em H em hipótese alguma");

// 9. Não-mutação dos Argumentos
const recordsSnapshot = JSON.stringify(mockRecords);
buildHistoryFromRecords(mockRecords);
assert(JSON.stringify(mockRecords) === recordsSnapshot, "buildHistoryFromRecords não mutaciona registros de entrada");

const hSnapshot = JSON.stringify(builtH);
computeHistoryFingerprint(builtH);
canonicalizeHistory(builtH);
assert(JSON.stringify(builtH) === hSnapshot, "Funções de canonicalização e fingerprint não mutacionam H");

// 10. Independência entre historyRevision e historyFingerprint
// Dois estados com mesma contagem mas conteúdos diferentes possuem fingerprints diferentes
const H_State1 = [
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16],
];
const H_State2 = [
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
  [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 17],
];
assert(H_State1.length === H_State2.length, "Ambos os estados possuem mesmo |H| = 2");
assert(
  computeHistoryFingerprint(H_State1) !== computeHistoryFingerprint(H_State2),
  "Mesma contagem de jogos com conteúdo divergente gera fingerprints diferentes"
);

// 11. Invariância da Seleção MAX-LEXIMIN sob Permutação de H
const pool = generatePool(20260929, 50);
const permutedH1 = [seqA[0], seqA[1], seqA[2]];
const permutedH2 = [seqA[2], seqA[0], seqA[1]];
const selRes1 = selectBestCandidate(pool, permutedH1);
const selRes2 = selectBestCandidate(pool, permutedH2);
assert(
  selRes1.winnerPoolIndex === selRes2.winnerPoolIndex,
  "Seleção MAX-LEXIMIN é rigorosamente invariante à permutação de H"
);
assert(
  JSON.stringify(selRes1.winnerHistogram) === JSON.stringify(selRes2.winnerHistogram),
  "Histograma do vencedor é idêntico sob permutação de H"
);

console.log("🎉 Todos os testes unitários de C5-Memory History passaram com SUCESSO!");
