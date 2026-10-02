import fs from "fs";
import path from "path";
import crypto from "crypto";

/**
 * C5-MEMORY-2.0.0 — PÓS-CERTIFICAÇÃO AÇÃO 001
 * GERADOR PURAMENTE DETERMINÍSTICO DE CONTRATOS NORMATIVOS IC2
 *
 * Correção formal da causa: NONDETERMINISTIC_FROZEN_AT_REGENERATION
 *
 * REGRAS DE DETERMINISMO:
 * 1. Proibido chamar new Date(), Date.now(), performance.now(), Math.random().
 * 2. Proibida consulta a ambiente, relógio, fuso horário ou variáveis voláteis.
 * 3. O valor temporal, se requerido pelo schema, deve ser fornecido explicitamente como entrada congelada.
 * 4. Para as mesmas entradas congeladas: GEN(A) === GEN(A) byte a byte.
 */

export interface GeneratorFrozenInputs {
  frozenTimestamp?: string;
  auditConductedTimestamp?: string;
  contractTimestamps?: {
    prngContract?: string;
    historyContract?: string;
    fingerprintContract?: string;
    draftStaleContract?: string;
    poolIndexContract?: string;
  };
}

export interface GeneratedContractOutput {
  contractName: string;
  fileName: string;
  contentString: string;
  sha256: string;
  byteLength: number;
}

export function buildPrngContract(frozenTimestamp: string): any {
  return {
    contractId: "C5M-CANONICAL-POOL-PRNG-CONTRACT-V1",
    version: "1.0.0",
    frozenAt: frozenTimestamp,
    decisionJustification: {
      selectedAlgorithm: "MULBERRY32",
      technicalCriteria: [
        "Determinismo bit a bit estrito em JavaScript em conformidade com ECMAScript",
        "Aritmética fechada em inteiros não-sinalizados de 32 bits (uint32) via '>>> 0' e Math.imul",
        "Zero dependências externas e implementação compacta e autossuficiente",
        "Compatibilidade e portabilidade comprovada entre Node.js (V8) e Web Browsers (V8, JavaScriptCore, SpiderMonkey)",
        "Custo computacional negligenciável (~0.2ms para gerar as 12.000 palavras do pool de 500 candidatos)",
        "Capacidade de replay exato a partir de uma única semente uint32 de 32 bits",
        "Já presente e auditado no motor C5-1.0.0 (src/c5/random.ts) garantindo coerência arquitetural"
      ],
      nonLotteryPrinciple: "A escolha é estritamente de engenharia de software e reprodutibilidade, sem consideração de resultados lotéricos ou CAIXA."
    },
    mathematicalSpecification: {
      algorithmId: "MULBERRY32",
      stateWidthBits: 32,
      seedWidthBits: 32,
      seedNormalization: "seed >>> 0",
      initialStateFormula: "state = seed >>> 0",
      stateTransitionFormula: "state = (state + 0x6d2b79f5) >>> 0",
      integerOverflowSemantics: "Modulo 2^32 aritmético forçado por unsigned right shift '>>> 0'",
      bitwiseSemantics: "Operadores JavaScript bitwise (^, >>>, |) e multiplicação inteira de 32 bits via Math.imul",
      outputWordCalculation: [
        "s = (s + 0x6d2b79f5) >>> 0",
        "let t = Math.imul(s ^ (s >>> 15), 1 | s)",
        "t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t",
        "outputWord = (t ^ (t >>> 14)) >>> 0"
      ],
      normalizedOutputMapping: "outputWord / 4294967296 (intervalo [0, 1) em ponto flutuante IEEE 754 de precisão dupla)",
      integerRangeMapping: "Math.floor(u * (i + 1)) para passo Fisher-Yates com limite superior exclusivo (i + 1)"
    },
    consumptionContract: {
      wordsPerCandidate: 24,
      shuffleAlgorithm: "Fisher-Yates (Knuth shuffle) em array de 25 elementos (dezenas 1..25)",
      shuffleLoopBounds: "i decrementa de 24 até 1 (exatamente 24 iterações)",
      shuffleIndexSelection: "j = Math.floor(rng() * (i + 1)), swap result[i] e result[j]",
      candidateBuilder: "buildC5FromPermutation(permutation) — atribuição determinística dos 25 slots canônicos em J1..J5",
      poolSizeCandidates: 500,
      totalWordsPerPool: 12000,
      poolCandidateSequence: "Candidato k (0 <= k < 500) consome estritamente as palavras no intervalo [k * 24, k * 24 + 23]",
      forbiddenExtraConsumption: [
        "Proibido qualquer consumo adicional de RNG para desempate, logging, telemetria ou validação.",
        "Proibido rejection sampling adicional além do mapeamento Fisher-Yates.",
        "Proibido consumo condicional ou fora de ordem por threads ou Web Workers."
      ]
    },
    seedContract: {
      domain: "Inteiro não-sinalizado de 32 bits [0, 4294967295]",
      representation: "number (seguro em JavaScript por ser <= Number.MAX_SAFE_INTEGER)",
      serializedFormat: "Número inteiro decimal (ex: 20260929) ou string numérica",
      zeroTreatment: "Semente 0 é estritamente válida (estado inicial 0, primeira palavra 1144304738)",
      replayRule: "Mesma poolMasterSeed + mesmo contrato de consumo = idêntico pool de 500 candidatos bit a bit."
    }
  };
}

export function buildHistoryContract(frozenTimestamp: string): any {
  return {
    contractId: "C5M-HISTORY-CONTRACT-V1",
    version: "1.0.0",
    frozenAt: frozenTimestamp,
    concepts: {
      historyRevision: {
        type: "uint32 monotonic sequence integer",
        purpose: "Controle de concorrência otimista (OCC). Incrementado a cada mutação de aposta confirmada.",
        initialValue: 0
      },
      historyFingerprint: {
        type: "SHA-256 hex string (64 characters lowercase)",
        purpose: "Identidade criptográfica do conteúdo do multiconjunto de jogos elegíveis de H.",
        preimageSpecification: "C5-MEMORY-H-FINGERPRINT-V1:{count}:{sortedGames}"
      }
    },
    cardinalityRule: "Mesma contagem de jogos (|H|) NÃO implica mesmo historyFingerprint. O digest criptográfico tem precedência de integridade."
  };
}

export function buildFingerprintContract(frozenTimestamp: string): any {
  return {
    contractId: "C5M-FINGERPRINT-CONTRACT-V1",
    version: "1.0.0",
    frozenAt: frozenTimestamp,
    domainSeparation: "C5-MEMORY-H-FINGERPRINT-V1",
    canonicalizationRules: [
      "1. Cada jogo contém exatamente 15 dezenas em ordem crescente [1..25].",
      "2. Cada dezena é formatada com 2 dígitos com zeros à esquerda ('01'..'25') separadas por vírgula (largura fixa 44 caracteres).",
      "3. Multiplicidades de jogos idênticos são estritamente preservadas no multiconjunto.",
      "4. Os blocos de jogos são ordenados lexicograficamente em ordem crescente ASCII.",
      "5. Header de domínio e contagem no formato: 'C5-MEMORY-H-FINGERPRINT-V1:{count}:'.",
      "6. Jogos serializados são concatenados com delimitador ';'.",
      "7. Cômputo do digest via SHA-256 padrão (Web Crypto / Node.js crypto), saída em 64 caracteres hexadecimais minúsculos."
    ],
    compatibilityWithIc1Goldens: "100% idêntico às pre-imagens e digests certificados em GV-I02..GV-I06."
  };
}

export function buildDraftStaleContract(frozenTimestamp: string): any {
  return {
    contractId: "C5M-DRAFT-STALE-CONTRACT-V1",
    version: "1.0.0",
    frozenAt: frozenTimestamp,
    draftMetadata: {
      requiredFields: [
        "draftHistoryRevision",
        "draftHistoryFingerprint",
        "poolMasterSeed",
        "selectedPoolIndex",
        "algorithmVersion"
      ],
      algorithmVersionValue: "C5-Memory-2.0.0"
    },
    confirmationCondition: {
      rule: "currentStoreState.historyRevision === draft.draftHistoryRevision && currentStoreState.historyFingerprint === draft.draftHistoryFingerprint",
      onMatch: "ALLOW_CONFIRMATION_AND_PERSIST",
      onMismatch: "REJECT_TRANSACTION",
      rejectionReason: "STALE_REVISION_REJECTED",
      silentRecomputeAllowed: false
    },
    antiToctouGuarantee: "A validação deve ocorrer no escopo atômico da transação IndexedDB no momento do commit."
  };
}

export function buildPoolIndexContract(frozenTimestamp: string): any {
  return {
    contractId: "C5M-POOL-INDEX-CONTRACT-V1",
    version: "1.0.0",
    frozenAt: frozenTimestamp,
    poolIndexDefinition: "Índice inteiro canônico ordinal no intervalo [0, 499] atribuído sequencialmente durante a geração determinística do pool.",
    immutabilityRule: "O poolIndex de um candidato é estritamente imutável durante avaliação, paralelização em Web Workers e resolução assíncrona.",
    tieBreakerRule: "MIN_POOL_INDEX — Em caso de empate integral em todas as coordenadas de distância (n0..n9), o candidato com o menor poolIndex vence obrigatoriamente.",
    forbiddenDerivations: [
      "Worker ID",
      "Timestamp / Tempo de resposta",
      "Ordem de resolução de Promises",
      "Ordem de término assíncrono"
    ]
  };
}

/**
 * Geração determinística dos 5 contratos normativos a partir de entradas congeladas puras.
 */
export function generateDeterministicContracts(
  inputs: GeneratorFrozenInputs,
  outDir?: string
): GeneratedContractOutput[] {
  const prngTime = inputs.contractTimestamps?.prngContract ?? inputs.frozenTimestamp;
  const historyTime = inputs.contractTimestamps?.historyContract ?? inputs.frozenTimestamp;
  const fingerprintTime = inputs.contractTimestamps?.fingerprintContract ?? inputs.frozenTimestamp;
  const draftStaleTime = inputs.contractTimestamps?.draftStaleContract ?? inputs.frozenTimestamp;
  const poolIndexTime = inputs.contractTimestamps?.poolIndexContract ?? inputs.frozenTimestamp;

  if (
    !prngTime || !prngTime.trim() ||
    !historyTime || !historyTime.trim() ||
    !fingerprintTime || !fingerprintTime.trim() ||
    !draftStaleTime || !draftStaleTime.trim() ||
    !poolIndexTime || !poolIndexTime.trim()
  ) {
    throw new Error("DETERMINISM_VIOLATION: timestamps explícitos para todos os 5 contratos são obrigatórios.");
  }

  const rawContracts = [
    {
      name: "Pool PRNG Contract",
      file: "ic2-canonical-pool-prng-contract.json",
      obj: buildPrngContract(prngTime)
    },
    {
      name: "History Contract",
      file: "ic2-history-contract.json",
      obj: buildHistoryContract(historyTime)
    },
    {
      name: "Fingerprint Contract",
      file: "ic2-fingerprint-contract.json",
      obj: buildFingerprintContract(fingerprintTime)
    },
    {
      name: "Draft / Stale Contract",
      file: "ic2-draft-stale-contract.json",
      obj: buildDraftStaleContract(draftStaleTime)
    },
    {
      name: "Pool Index Contract",
      file: "ic2-pool-index-contract.json",
      obj: buildPoolIndexContract(poolIndexTime)
    }
  ];

  const results: GeneratedContractOutput[] = [];

  for (const rc of rawContracts) {
    const formatted = JSON.stringify(rc.obj, null, 2) + "\n";
    const sha256 = crypto.createHash("sha256").update(formatted, "utf8").digest("hex");
    const byteLength = Buffer.byteLength(formatted, "utf8");

    if (outDir) {
      if (!fs.existsSync(outDir)) {
        fs.mkdirSync(outDir, { recursive: true });
      }
      fs.writeFileSync(path.join(outDir, rc.file), formatted, "utf8");
    }

    results.push({
      contractName: rc.name,
      fileName: rc.file,
      contentString: formatted,
      sha256: sha256,
      byteLength: byteLength
    });
  }

  return results;
}
