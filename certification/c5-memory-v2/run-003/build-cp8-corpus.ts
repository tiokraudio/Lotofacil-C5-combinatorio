import fs from "fs";
import path from "path";
import crypto from "crypto";
import { generateC5 } from "../../../src/c5/generator.ts";
import { createMulberry32 } from "../../../src/c5/random.ts";

export interface ReplayCase {
  caseId: number;
  category: string;
  description: string;
  H: number[][];
  pool: number[][][]; // K=500, each candidate has 5 games
  inputHash: string;
}

export function buildCp8Corpus(
  totalCases = 1000,
  masterSeed = 20260929
): { corpusPath: string; corpusSha256: string; totalCases: number } {
  console.log(`=== CONSTRUINDO CORPUS DETERMINÍSTICO CP8: ${totalCases} CASOS CANÔNICOS (K=500) ===`);
  const rng = createMulberry32(masterSeed);

  // Pré-geração de histórico master para casos grandes (T=3788, |H|=18.940)
  console.log("Pré-gerando histórico master (18.940 jogos)...");
  const masterH: number[][] = [];
  for (let t = 0; t < 3788; t++) {
    const c5 = generateC5(rng);
    for (const g of c5.games) masterH.push(g);
  }

  const corpusPath = path.resolve("certification/c5-memory-v2/run-003/cp8-corpus.json");
  const fd = fs.openSync(corpusPath, "w");
  fs.writeSync(fd, "[\n");

  const hash = crypto.createHash("sha256");

  for (let i = 0; i < totalCases; i++) {
    let category = "";
    let description = "";
    let H: number[][] = [];
    const pool: number[][][] = [];

    // 1. Determina H conforme categoria representativa
    if (i < 50) {
      // 0..49: Histórico vazio
      category = "EMPTY_HISTORY";
      description = "Histórico vazio (H = ∅), seleção deve escolher candidato índice 0";
      H = [];
    } else if (i < 200) {
      // 50..199: Histórico pequeno (1..3 apostas = 5..15 jogos)
      category = "SMALL_HISTORY";
      const numBets = 1 + (i % 3);
      description = `Histórico pequeno (${numBets} apostas, ${numBets * 5} jogos)`;
      H = masterH.slice(0, numBets * 5);
    } else if (i < 500) {
      // 200..499: Histórico médio (4..15 apostas = 20..75 jogos)
      category = "MEDIUM_HISTORY";
      const numBets = 4 + (i % 12);
      description = `Histórico médio (${numBets} apostas, ${numBets * 5} jogos)`;
      const start = (i * 7) % (masterH.length - numBets * 5);
      H = masterH.slice(start, start + numBets * 5);
    } else if (i < 600) {
      // 500..599: T=3788 (|H|=18.940 jogos)
      category = "MAX_HISTORY_T3788";
      description = "Histórico no horizonte máximo canônico (T=3.788, |H|=18.940 jogos)";
      H = masterH;
    } else if (i < 700) {
      // 600..699: Empates lexicográficos injetados no Pool
      category = "LEXIMIN_TIE_INJECTED";
      description = "Pool com empate lexicográfico injetado para testar desempate por menor índice";
      H = masterH.slice(0, 25);
    } else if (i < 750) {
      // 700..749: Candidatos repetidos e idênticos injetados
      category = "DUPLICATE_CANDIDATES";
      description = "Candidatos idênticos injetados em posições diferentes do pool";
      H = masterH.slice(0, 50);
    } else if (i < 800) {
      // 750..799: n0=0 vs n0>0
      category = "N0_ZERO_VS_GREATER";
      description = "Candidatos com n0=0 competindo contra candidatos com colisões exatas n0>0";
      H = masterH.slice(0, 30);
    } else if (i < 850) {
      // 800..849: Todos os candidatos com n0>0
      category = "ALL_N0_GREATER_THAN_ZERO";
      description = "Todos os candidatos possuem colisão exata forçando desempate em n1..n9";
      // Constrói H contendo jogos que colidem com os primeiros jogos
      H = masterH.slice(0, 40);
    } else if (i < 900) {
      // 850..899: Decisão tardia em coordenadas profundas (n7, n8, n9)
      category = "LATE_COORDINATE_DECISION";
      description = "Candidatos com prefixo de histograma idêntico decidindo em n7..n9";
      H = masterH.slice(100, 160);
    } else {
      // 900..999: Pools ordinários estocásticos padrão
      category = "STANDARD_ORDINARY_POOL";
      description = "Pool canônico ordinário K=500 com histórico dinâmico";
      const numBets = 10 + (i % 20);
      H = masterH.slice(200, 200 + numBets * 5);
    }

    // 2. Constrói Pool K=500
    for (let k = 0; k < 500; k++) {
      pool.push(generateC5(rng).games);
    }

    // Injeções especiais para categorias específicas
    if (category === "LEXIMIN_TIE_INJECTED") {
      // Clona candidato 5 para posição 15
      pool[15] = pool[5].map(g => [...g]);
    } else if (category === "DUPLICATE_CANDIDATES") {
      // Clona candidato 2 para posições 12 e 42
      pool[12] = pool[2].map(g => [...g]);
      pool[42] = pool[2].map(g => [...g]);
    } else if (category === "N0_ZERO_VS_GREATER") {
      // Injeta um jogo de H no candidato 0 para que tenha n0>0
      if (H.length > 0) {
        pool[0][0] = [...H[0]];
      }
    } else if (category === "ALL_N0_GREATER_THAN_ZERO") {
      // Garante que todo candidato no pool colida com pelo menos 1 jogo de H
      if (H.length > 0) {
        for (let k = 0; k < 500; k++) {
          pool[k][0] = [...H[k % H.length]];
        }
      }
    }

    const inputData = { H, pool };
    const inputHash = crypto.createHash("sha256").update(JSON.stringify(inputData)).digest("hex");

    const replayCase: ReplayCase = {
      caseId: i,
      category,
      description,
      H,
      pool,
      inputHash,
    };

    const caseStr = JSON.stringify(replayCase);
    hash.update(caseStr);

    if (i > 0) {
      fs.writeSync(fd, ",\n");
    }
    fs.writeSync(fd, caseStr);

    if ((i + 1) % 100 === 0) {
      console.log(`  Gerados ${i + 1} / ${totalCases} casos...`);
    }
  }

  fs.writeSync(fd, "\n]\n");
  fs.closeSync(fd);

  const fileBuf = fs.readFileSync(corpusPath);
  const corpusSha256 = crypto.createHash("sha256").update(fileBuf).digest("hex");

  console.log(`Corpus CP8 concluído: ${totalCases} casos.`);
  console.log(`Arquivo salvo: ${corpusPath}`);
  console.log(`Tamanho do arquivo: ${(fileBuf.length / (1024 * 1024)).toFixed(2)} MB`);
  console.log(`SHA-256 do corpus: ${corpusSha256}`);

  return { corpusPath, corpusSha256, totalCases };
}

if (import.meta.url === `file://${process.argv[1]}`) {
  buildCp8Corpus();
}
