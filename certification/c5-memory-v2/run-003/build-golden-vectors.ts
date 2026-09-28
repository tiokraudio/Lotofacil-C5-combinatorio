import fs from "fs";
import path from "path";
import { generateC5 } from "../../../src/c5/generator.ts";
import { validateC5 } from "../../../src/c5/validator.ts";
import type { C5Generation } from "../../../src/c5/types.ts";

export function dJ(g1: number[], g2: number[]): number {
  const s2 = new Set(g2);
  let inter = 0;
  for (const n of g1) if (s2.has(n)) inter++;
  return 15 - inter;
}

export function computeHistogram(cand: number[][], H: number[][]): number[] {
  const hist = new Array(11).fill(0);
  for (const g of cand) {
    for (const h of H) {
      const dist = dJ(g, h);
      hist[dist]++;
    }
  }
  return hist;
}

export function compareLeximin(h1: number[], h2: number[]): { winnerIndex: number; firstDiffCoord: number } {
  for (let i = 0; i <= 9; i++) {
    if (h1[i] < h2[i]) return { winnerIndex: 0, firstDiffCoord: i };
    if (h1[i] > h2[i]) return { winnerIndex: 1, firstDiffCoord: i };
  }
  return { winnerIndex: 0, firstDiffCoord: -1 };
}

function cloneGames(games: number[][]): number[][] {
  return games.map((g) => [...g].sort((a, b) => a - b));
}

async function main() {
  console.log("=== MATERIALIZANDO GOLDEN VECTORS C5-MEMORY RUN-003 ===");

  // 1. Johnson Distance Vectors
  const baseGame = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const jd_d0 = [...baseGame];
  const jd_d1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16];
  const jd_d2 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17];
  const jd_d3 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 16, 17, 18];
  const jd_d4 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 16, 17, 18, 19];
  const jd_d10 = [1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];

  const johnsonVectors = [
    { id: "JD_0", gameA: baseGame, gameB: jd_d0, expectedDistance: 0, description: "Distância d=0 (identidade total, 15 dezenas em comum)" },
    { id: "JD_1", gameA: baseGame, gameB: jd_d1, expectedDistance: 1, description: "Distância d=1 (14 dezenas em comum)" },
    { id: "JD_2", gameA: baseGame, gameB: jd_d2, expectedDistance: 2, description: "Distância d=2 (13 dezenas em comum)" },
    { id: "JD_3", gameA: baseGame, gameB: jd_d3, expectedDistance: 3, description: "Distância d=3 (12 dezenas em comum)" },
    { id: "JD_4", gameA: baseGame, gameB: jd_d4, expectedDistance: 4, description: "Distância d=4 (11 dezenas em comum)" },
    { id: "JD_10", gameA: baseGame, gameB: jd_d10, expectedDistance: 10, description: "Distância d=10 (5 dezenas em comum, limite de dispersão máxima)" },
    { id: "JD_SYM", gameA: jd_d3, gameB: baseGame, expectedDistance: 3, description: "Simetria Johnson: dJ(A, B) = dJ(B, A)" },
  ];

  // 2. Generate a valid C5 pool for C5-admissible vectors
  const c5Pool: { gen: C5Generation; games: number[][] }[] = [];
  while (c5Pool.length < 80) {
    const gen = generateC5();
    if (validateC5(gen).valid) {
      c5Pool.push({ gen, games: cloneGames(gen.games) });
    }
  }
  console.log(`Pool de ${c5Pool.length} gerações C5 válidas gerado.`);

  const leximinVectors: any[] = [];

  // n0: cB has a game identical to h, cA does not
  {
    const candA = c5Pool[0];
    const candB = c5Pool[1];
    const H = [candB.games[0]];
    const hA = computeHistogram(candA.games, H);
    const hB = computeHistogram(candB.games, H);
    const comp = compareLeximin(hA, hB);
    if (comp.firstDiffCoord !== 0 || comp.winnerIndex !== 0) {
      throw new Error("Falha ao configurar vetor n0");
    }
    leximinVectors.push({
      id: "LEX_N0",
      targetCoord: "n0",
      description: "Divergência em n0: Candidate A tem n0=0 e Candidate B tem n0=1; Candidate A vence",
      isC5Admissible: true,
      c5Generations: [candA.gen, candB.gen],
      candidates: [candA.games, candB.games],
      historicalGames: H,
      expectedHistograms: [hA, hB],
      expectedWinnerIndex: 0,
      expectedDecidingCoord: 0,
      justification: "Candidate A não possui colisão exata (n0=0), enquanto Candidate B possui (n0=1)."
    });
  }

  // n1: cB has distance 1 with h, cA has distance >= 2 with h, neither has d=0
  {
    const candA = c5Pool[2];
    const candB = c5Pool[3];
    const g0 = candB.games[0];
    const g0Set = new Set(g0);
    const outG0 = [];
    for (let i = 1; i <= 25; i++) if (!g0Set.has(i)) outG0.push(i);

    let foundH: number[] | null = null;
    let foundHA: number[] | null = null;
    let foundHB: number[] | null = null;

    for (let r = 0; r < 15 && !foundH; r++) {
      for (const repl of outG0) {
        const testH = [...g0];
        testH[r] = repl;
        testH.sort((a, b) => a - b);
        const hA = computeHistogram(candA.games, [testH]);
        const hB = computeHistogram(candB.games, [testH]);
        if (hA[0] === 0 && hB[0] === 0 && hA[1] === 0 && hB[1] > 0) {
          foundH = testH;
          foundHA = hA;
          foundHB = hB;
          break;
        }
      }
    }
    if (!foundH) throw new Error("Falha ao configurar vetor n1");

    leximinVectors.push({
      id: "LEX_N1",
      targetCoord: "n1",
      description: "Divergência em n1: n0 são iguais (0), Candidate A tem n1=0 e Candidate B tem n1>0; Candidate A vence",
      isC5Admissible: true,
      c5Generations: [candA.gen, candB.gen],
      candidates: [candA.games, candB.games],
      historicalGames: [foundH],
      expectedHistograms: [foundHA, foundHB],
      expectedWinnerIndex: 0,
      expectedDecidingCoord: 1,
      justification: "Ambos têm n0=0, mas Candidate A tem n1=0 contra n1=1 do Candidate B."
    });
  }

  // n2..n7: Search in C5 pool
  for (let targetD = 2; targetD <= 7; targetD++) {
    let found = false;
    for (let i = 0; i < c5Pool.length && !found; i++) {
      const cA = c5Pool[i];
      for (let j = i + 1; j < c5Pool.length && !found; j++) {
        const cB = c5Pool[j];

        // Try single games
        for (let k = 0; k < c5Pool.length && !found; k++) {
          const H = [c5Pool[k].games[0]];
          const hA = computeHistogram(cA.games, H);
          const hB = computeHistogram(cB.games, H);
          const comp = compareLeximin(hA, hB);
          if (comp.firstDiffCoord === targetD) {
            const winner = comp.winnerIndex;
            leximinVectors.push({
              id: `LEX_N${targetD}`,
              targetCoord: `n${targetD}`,
              description: `Divergência em n${targetD}: coordenadas n0..n${targetD - 1} são rigorosamente iguais, primeira diferença em n${targetD}`,
              isC5Admissible: true,
              c5Generations: [cA.gen, cB.gen],
              candidates: [cA.games, cB.games],
              historicalGames: H,
              expectedHistograms: [hA, hB],
              expectedWinnerIndex: winner,
              expectedDecidingCoord: targetD,
              justification: `Todas as coordenadas n0..n${targetD - 1} coincidem; o candidato ${winner === 0 ? "A" : "B"} possui menor valor em n${targetD}.`
            });
            found = true;
          }
        }

        // Try 2 games if targetD is 7
        if (!found && targetD === 7) {
          for (let k = 0; k < 20 && !found; k++) {
            const H = [c5Pool[k].games[0], c5Pool[(k + 3) % c5Pool.length].games[1]];
            const hA = computeHistogram(cA.games, H);
            const hB = computeHistogram(cB.games, H);
            const comp = compareLeximin(hA, hB);
            if (comp.firstDiffCoord === targetD) {
              const winner = comp.winnerIndex;
              leximinVectors.push({
                id: `LEX_N${targetD}`,
                targetCoord: `n${targetD}`,
                description: `Divergência em n${targetD}: coordenadas n0..n${targetD - 1} são rigorosamente iguais, primeira diferença em n${targetD}`,
                isC5Admissible: true,
                c5Generations: [cA.gen, cB.gen],
                candidates: [cA.games, cB.games],
                historicalGames: H,
                expectedHistograms: [hA, hB],
                expectedWinnerIndex: winner,
                expectedDecidingCoord: targetD,
                justification: `Todas as coordenadas n0..n${targetD - 1} coincidem; o candidato ${winner === 0 ? "A" : "B"} possui menor valor em n${targetD}.`
              });
              found = true;
            }
          }
        }
      }
    }
    if (!found) {
      throw new Error(`Falha ao encontrar testemunha C5 para n${targetD}`);
    }
    console.log(`Testemunha C5 para n${targetD} localizada com sucesso.`);
  }

  // n8: Constructive witness with real valid 15-number games
  {
    const h = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const g_c1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 17, 18, 19, 20, 21]; // inter=9 => dist=6
    const g_c2 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 16, 17, 18, 19, 20, 22]; // inter=9 => dist=6
    const g_c3 = [1, 2, 3, 4, 5, 6, 7, 8, 16, 17, 18, 19, 20, 21, 22]; // inter=8 => dist=7
    const g_d8 = [1, 2, 3, 4, 5, 6, 7, 16, 17, 18, 19, 20, 21, 22, 23]; // inter=7 => dist=8
    const g_d9_1 = [1, 2, 3, 4, 5, 6, 16, 17, 18, 19, 20, 21, 22, 23, 24]; // inter=6 => dist=9
    const g_d9_2 = [7, 8, 9, 10, 11, 12, 16, 17, 18, 19, 20, 21, 22, 23, 25]; // inter=6 => dist=9
    const g_d10 = [1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]; // inter=5 => dist=10

    const candA_n8 = [g_c1, g_c2, g_c3, g_d8, g_d10];
    const candB_n8 = [g_c1, g_c2, g_c3, g_d9_1, g_d9_2];
    const H = [h];

    const hA = computeHistogram(candA_n8, H);
    const hB = computeHistogram(candB_n8, H);
    const comp = compareLeximin(hA, hB);

    if (comp.firstDiffCoord !== 8 || comp.winnerIndex !== 1) {
      throw new Error("Falha ao configurar vetor n8");
    }

    leximinVectors.push({
      id: "LEX_N8",
      targetCoord: "n8",
      description: "Divergência em n8: n0..n7 são exatamente iguais [0,0,0,0,0,0,2,1], n8(A)=1 e n8(B)=0; Candidate B vence",
      isC5Admissible: false,
      candidates: [candA_n8, candB_n8],
      historicalGames: H,
      expectedHistograms: [hA, hB],
      expectedWinnerIndex: 1,
      expectedDecidingCoord: 8,
      justification: "n0..n7 coincidem perfeitamente; Candidate B possui menor contagem em n8 (0 contra 1) e vence na coordenada n8."
    });
    console.log("Testemunha realizável para n8 configurada.");
  }

  // n9: Constructive witness with real valid 15-number games
  {
    const h = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const g_d9 = [1, 2, 3, 4, 5, 6, 16, 17, 18, 19, 20, 21, 22, 23, 24]; // inter=6 => dist=9
    const g_d10 = [1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25]; // inter=5 => dist=10
    const g_c1 = [1, 2, 3, 4, 5, 6, 7, 8, 16, 17, 18, 19, 20, 21, 22]; // inter=8 => dist=7
    const g_c2 = [1, 2, 3, 4, 5, 6, 7, 8, 16, 17, 18, 19, 20, 21, 23]; // inter=8 => dist=7
    const g_c3 = [1, 2, 3, 4, 5, 6, 7, 16, 17, 18, 19, 20, 21, 22, 23]; // inter=7 => dist=8

    const candA_games = [g_c1, g_c2, g_c3, g_d10, g_d10];
    const candB_games = [g_c1, g_c2, g_c3, g_d9, g_d10];
    const H = [h];

    const hA = computeHistogram(candA_games, H);
    const hB = computeHistogram(candB_games, H);
    const comp = compareLeximin(hA, hB);

    if (comp.firstDiffCoord !== 9 || comp.winnerIndex !== 0) {
      throw new Error("Falha ao configurar vetor n9");
    }

    leximinVectors.push({
      id: "LEX_N9",
      targetCoord: "n9",
      description: "Divergência em n9: n0..n8 são exatamente iguais [0,0,0,0,0,0,0,2,1], n9(A)=0 e n9(B)=1; Candidate A vence",
      isC5Admissible: false,
      candidates: [candA_games, candB_games],
      historicalGames: H,
      expectedHistograms: [hA, hB],
      expectedWinnerIndex: 0,
      expectedDecidingCoord: 9,
      justification: "n0..n8 são estritamente iguais; Candidate A tem n9=0 e Candidate B tem n9=1; Candidate A vence na coordenada n9."
    });
    console.log("Testemunha realizável para n9 configurada.");
  }

  // 3. Control Vectors
  const controlVectors: any[] = [];

  // CTRL_EXACT_TIE
  {
    const candA = c5Pool[4];
    const candB_games = [candA.games[1], candA.games[0], candA.games[2], candA.games[3], candA.games[4]];
    const H = [c5Pool[5].games[0]];
    const hA = computeHistogram(candA.games, H);
    const hB = computeHistogram(candB_games, H);
    controlVectors.push({
      id: "CTRL_EXACT_TIE",
      description: "Empate integral de histogramas entre dois candidatos distintos: desempate por menor índice (vence 0)",
      candidates: [candA.games, candB_games],
      historicalGames: H,
      expectedHistograms: [hA, hB],
      expectedWinnerIndex: 0,
      expectedDecidingCoord: -1,
      justification: "Histogramas são estritamente idênticos; a regra canônica desempata pelo menor índice no pool (índice 0)."
    });
  }

  // CTRL_MULTIPLE_TIE
  {
    const candA = c5Pool[6];
    const candB_games = [candA.games[1], candA.games[2], candA.games[0], candA.games[3], candA.games[4]];
    const candC_games = [candA.games[4], candA.games[3], candA.games[2], candA.games[1], candA.games[0]];
    const H = [c5Pool[7].games[0]];
    const hA = computeHistogram(candA.games, H);
    const hB = computeHistogram(candB_games, H);
    const hC = computeHistogram(candC_games, H);
    controlVectors.push({
      id: "CTRL_MULTIPLE_TIE",
      description: "Múltiplo empate: 3 candidatos com histogramas idênticos; vence o menor índice (0)",
      candidates: [candA.games, candB_games, candC_games],
      historicalGames: H,
      expectedHistograms: [hA, hB, hC],
      expectedWinnerIndex: 0,
      expectedDecidingCoord: -1,
      justification: "Três candidatos com histogramas idênticos; desempate escolhe rigorosamente o índice 0."
    });
  }

  // CTRL_EMPTY_HISTORY
  {
    const candA = c5Pool[8];
    const candB = c5Pool[9];
    const H: number[][] = [];
    const hA = computeHistogram(candA.games, H);
    const hB = computeHistogram(candB.games, H);
    controlVectors.push({
      id: "CTRL_EMPTY_HISTORY",
      description: "Histórico vazio H=[]: todos os nd=0, desempate por menor índice (0)",
      candidates: [candA.games, candB.games],
      historicalGames: H,
      expectedHistograms: [hA, hB],
      expectedWinnerIndex: 0,
      expectedDecidingCoord: -1,
      justification: "Com histórico vazio, todas as distâncias são zero; desempate pelo menor índice do pool."
    });
  }

  // CTRL_N0_ZERO_VS_NONZERO
  {
    const candA = c5Pool[10];
    const candB = c5Pool[11];
    const H = [candB.games[2]];
    const hA = computeHistogram(candA.games, H);
    const hB = computeHistogram(candB.games, H);
    controlVectors.push({
      id: "CTRL_N0_ZERO_VS_NONZERO",
      description: "Não repetição condicional: candidato com n0=0 estritamente preferido a candidato com n0>0",
      candidates: [candA.games, candB.games],
      historicalGames: H,
      expectedHistograms: [hA, hB],
      expectedWinnerIndex: 0,
      expectedDecidingCoord: 0,
      justification: "Candidate A evita qualquer repetição exata no histórico (n0=0), vencendo Candidate B (n0=1)."
    });
  }

  // CTRL_ALL_N0_NONZERO
  {
    const candA = c5Pool[12];
    const candB = c5Pool[13];
    const H = [candA.games[0], candB.games[0], candB.games[1]];
    const hA = computeHistogram(candA.games, H);
    const hB = computeHistogram(candB.games, H);
    controlVectors.push({
      id: "CTRL_ALL_N0_NONZERO",
      description: "Todos os candidatos com n0>0: vence o de menor n0 (n0=1 vs n0=2)",
      candidates: [candA.games, candB.games],
      historicalGames: H,
      expectedHistograms: [hA, hB],
      expectedWinnerIndex: 0,
      expectedDecidingCoord: 0,
      justification: "Mesmo com colisões em ambos, Candidate A tem 1 colisão enquanto Candidate B tem 2; Candidate A vence."
    });
  }

  // CTRL_ADVERSARIAL_WEIGHTS
  {
    const h = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
    const g_d1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 16];
    const g_d10_1 = [1, 2, 3, 4, 5, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];
    const g_d10_2 = [1, 2, 3, 4, 6, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];
    const g_d10_3 = [1, 2, 3, 4, 7, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];
    const g_d10_4 = [1, 2, 3, 4, 8, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25];
    const candA_adv = [g_d1, g_d10_1, g_d10_2, g_d10_3, g_d10_4];

    const g_d2_1 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 17];
    const g_d2_2 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 18];
    const g_d2_3 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 19];
    const g_d2_4 = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 16, 20];
    const candB_adv = [g_d2_1, g_d2_2, g_d2_3, g_d2_4, g_d10_1];

    const H = [h];
    const hA = computeHistogram(candA_adv, H);
    const hB = computeHistogram(candB_adv, H);
    controlVectors.push({
      id: "CTRL_ADVERSARIAL_WEIGHTS",
      description: "Caso adversarial contra funções de soma ponderada: Candidate B tem menor distância média mas evita colisão crítica n1; MAX-LEXIMIN escolhe Candidate B",
      candidates: [candA_adv, candB_adv],
      historicalGames: H,
      expectedHistograms: [hA, hB],
      expectedWinnerIndex: 1,
      expectedDecidingCoord: 1,
      justification: "Candidate B vence porque n1(B)=0 < n1(A)=1, provando obediência estrita ao LEXMIN sem colapso para soma de distâncias."
    });
  }

  // CTRL_REPEATED_HISTORY
  {
    const candA = c5Pool[14];
    const candB = c5Pool[15];
    const hSingle = c5Pool[16].games[0];
    const H_rep = [hSingle, hSingle];
    const hA = computeHistogram(candA.games, H_rep);
    const hB = computeHistogram(candB.games, H_rep);
    const comp = compareLeximin(hA, hB);
    controlVectors.push({
      id: "CTRL_REPEATED_HISTORY",
      description: "Histórico com repetição: jogos repetidos em H produzem histogramas consistentes com a multiplicidade",
      candidates: [candA.games, candB.games],
      historicalGames: H_rep,
      expectedHistograms: [hA, hB],
      expectedWinnerIndex: comp.winnerIndex,
      expectedDecidingCoord: comp.firstDiffCoord,
      justification: "Histórico com repetição mantém coerência matemática de histograma e integridade do comparador."
    });
  }

  // CTRL_PERMUTED_HISTORY
  {
    const candA = c5Pool[17];
    const h1 = c5Pool[18].games[0];
    const h2 = c5Pool[19].games[1];
    const H_ord = [h1, h2];
    const H_perm = [h2, h1];
    const hA_ord = computeHistogram(candA.games, H_ord);
    const hA_perm = computeHistogram(candA.games, H_perm);
    controlVectors.push({
      id: "CTRL_PERMUTED_HISTORY",
      description: "Permutação do histórico: ordem dos jogos em H não altera o histograma",
      candidate: candA.games,
      historicalGamesOrder1: H_ord,
      historicalGamesOrder2: H_perm,
      expectedHistogram1: hA_ord,
      expectedHistogram2: hA_perm,
      justification: "Histograma contra H é invariante sob qualquer permutação da ordem dos sorteios históricos."
    });
  }

  // CTRL_REPEATED_CANDIDATE
  {
    const candA = c5Pool[20];
    const H = [c5Pool[21].games[0]];
    const hA = computeHistogram(candA.games, H);
    controlVectors.push({
      id: "CTRL_REPEATED_CANDIDATE",
      description: "Candidatos repetidos no pool: índice 0 vence rigorosamente pelo critério de desempate canônico",
      candidates: [candA.games, candA.games],
      historicalGames: H,
      expectedHistograms: [hA, hA],
      expectedWinnerIndex: 0,
      expectedDecidingCoord: -1,
      justification: "Candidatos com jogos idênticos empatam em todas as coordenadas; o menor índice (0) é retornado."
    });
  }

  // CTRL_N10_IDENTITY
  {
    const candA = c5Pool[22];
    const candB_sameHist = [candA.games[2], candA.games[1], candA.games[0], candA.games[3], candA.games[4]];
    const H = [c5Pool[23].games[0]];
    const hA = computeHistogram(candA.games, H);
    const hB = computeHistogram(candB_sameHist, H);
    controlVectors.push({
      id: "CTRL_N10_IDENTITY",
      description: "Controle n10: Se n0..n9 são iguais, n10 é matematicamente idêntico por sum(nd) = 5|H|; n10 nunca decide",
      candidates: [candA.games, candB_sameHist],
      historicalGames: H,
      expectedHistograms: [hA, hB],
      expectedWinnerIndex: 0,
      expectedDecidingCoord: -1,
      sumEquation: "sum(n0..n10) = 5 * |H|",
      proof: "n10 = 5|H| - sum_{d=0..9}(nd). Portanto, se n0..n9 coincidem entre dois candidatos, n10 é obrigatoriamente idêntico. A decisão ocorre em n9 ou resulta em empate.",
      justification: "Demonstração concreta e matemática de que n10 é reduntante e jamais pode atuar como coordenada decisória."
    });
  }

  const goldenDataset = {
    metadata: {
      algorithm: "C5-Memory-2.0.0",
      protocol: "C5M-CERT-1.0",
      generatedForRun: "run-003",
      generatedAt: new Date().toISOString(),
      distanceMetric: "dJ(A,B) = 15 - |A ∩ B|",
      objective: "LEXMIN(n0,...,n9)",
      tieBreaker: "menor índice no pool",
      universeSize: 25,
      gameSize: 15,
      gamesPerC5: 5
    },
    johnsonVectors,
    leximinVectors,
    controlVectors
  };

  const outputPath = path.resolve("certification/c5-memory-v2/run-003/golden-vectors.json");
  fs.writeFileSync(outputPath, JSON.stringify(goldenDataset, null, 2), "utf8");
  console.log(`\nGolden vectors salvos com sucesso em: ${outputPath}`);
  console.log(`- Johnson distance vectors: ${johnsonVectors.length}`);
  console.log(`- MAX-LEXIMIN n0..n9 vectors: ${leximinVectors.length}`);
  console.log(`- Control vectors: ${controlVectors.length}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
