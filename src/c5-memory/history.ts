/**
 * Módulo de Construção, Canonicalização e Fingerprint do Histórico H
 * para o C5-Memory-2.0.0
 *
 * Implementa integralmente os contratos congelados:
 * - C5M-HISTORY-CONTRACT-V1
 * - C5M-FINGERPRINT-CONTRACT-V1
 *
 * Características normativas:
 * 1. H é estritamente endógeno: provém exclusivamente de apostas próprias confirmadas elegíveis.
 * 2. H é um multiconjunto: preserva multiplicidades de jogos idênticos.
 * 3. Canonicalização de cada jogo: 15 dezenas em ordem crescente, largura fixa de 2 dígitos ("01".."25"),
 *    separadas por vírgula (bloco canônico de 44 caracteres).
 * 4. Canonicalização do multiconjunto: ordenação lexicográfica ASCII dos blocos canônicos.
 * 5. Domain separation: "C5-MEMORY-H-FINGERPRINT-V1:{count}:{sortedGames}" (delimitador ';').
 * 6. Histórico vazio: "C5-MEMORY-H-FINGERPRINT-V1:0:" -> digest fixo.
 * 7. historyRevision: mantido semanticamente independente do historyFingerprint.
 * 8. Funções puras sem efeitos colaterais nem mutação de argumentos.
 */

import { sha256 } from "./sha256.ts";
import type { HistoryGame } from "./types.ts";

export const DOMAIN_SEPARATION_H = "C5-MEMORY-H-FINGERPRINT-V1";
export const CANONICAL_GAME_BLOCK_LENGTH = 44;

/**
 * Interface mínima estrutural para registros de aposta candidatos a compor H.
 * Compatível com ContestRecord do sistema V1.13 sem acoplamento a repositório.
 */
export interface EligibleRecordInput {
  readonly status: "DRAFT" | "FROZEN" | "SCORED" | string;
  readonly betPlacedAt?: string | null;
  readonly generation?: {
    readonly games: readonly (readonly number[])[];
  };
  readonly games?: readonly (readonly number[])[];
  // Campos exógenos que NUNCA devem contaminar H
  readonly result?: readonly number[];
  readonly score?: unknown;
}

/**
 * Valida e formata um único jogo de 15 dezenas no formato canônico de bloco fixo.
 * Exemplo de saída: "01,02,03,04,05,06,07,08,09,10,11,12,13,14,15" (44 caracteres).
 *
 * @param game Jogo contendo 15 dezenas em 1..25
 * @returns Bloco canônico de 44 caracteres
 */
export function canonicalizeGame(game: readonly number[]): string {
  if (!Array.isArray(game)) {
    throw new Error("Jogo inválido: esperado array numérico.");
  }
  if (game.length !== 15) {
    throw new Error(`Jogo inválido: possui ${game.length} dezenas (esperava-se 15).`);
  }

  const seen = new Set<number>();
  for (let i = 0; i < 15; i++) {
    const num = game[i];
    if (!Number.isInteger(num) || num < 1 || num > 25) {
      throw new Error(`Dezena inválida no jogo: ${num} (deve ser inteiro em 1..25).`);
    }
    if (seen.has(num)) {
      throw new Error(`Dezena duplicada no jogo: ${num}.`);
    }
    seen.add(num);
  }

  // Ordenar numericamente em ordem crescente
  const sorted = [...game].sort((a, b) => a - b);

  // Formatar cada dezena com 2 dígitos e juntar por vírgula
  const block = sorted.map((n) => (n < 10 ? `0${n}` : `${n}`)).join(",");
  if (block.length !== CANONICAL_GAME_BLOCK_LENGTH) {
    throw new Error(`Erro interno de canonicalização: tamanho do bloco ${block.length} != ${CANONICAL_GAME_BLOCK_LENGTH}`);
  }

  return block;
}

/**
 * Canonicaliza o multiconjunto H de jogos, ordenando lexicograficamente seus blocos canônicos.
 * Preserva estritamente multiplicidades (jogos idênticos aparecem repetidos consecutivamente).
 *
 * @param H Multiconjunto de jogos históricos
 * @returns Array de blocos canônicos ordenados lexicograficamente
 */
export function canonicalizeHistory(H: readonly (readonly number[])[]): string[] {
  if (!Array.isArray(H)) {
    throw new Error("H deve ser um array de jogos.");
  }
  const blocks = H.map((game) => canonicalizeGame(game));
  // Ordenação lexicográfica ASCII estável
  blocks.sort();
  return blocks;
}

/**
 * Constrói a preimagem canônica UTF-8 para cômputo do fingerprint criptográfico.
 * Formato: "C5-MEMORY-H-FINGERPRINT-V1:{count}:{blocos_ordenados_separados_por_ponto_e_virgula}"
 *
 * @param H Multiconjunto de jogos históricos
 * @returns String de preimagem exata
 */
export function computeHistoryPreimage(H: readonly (readonly number[])[]): string {
  const blocks = canonicalizeHistory(H);
  const count = blocks.length;
  if (count === 0) {
    return `${DOMAIN_SEPARATION_H}:0:`;
  }
  return `${DOMAIN_SEPARATION_H}:${count}:${blocks.join(";")}`;
}

/**
 * Calcula o historyFingerprint SHA-256 de forma determinística e pura.
 *
 * @param H Multiconjunto de jogos históricos
 * @returns Digest SHA-256 de 64 caracteres hexadecimais minúsculos
 */
export function computeHistoryFingerprint(H: readonly (readonly number[])[]): string {
  const preimage = computeHistoryPreimage(H);
  return sha256(preimage);
}

/**
 * Extrai o multiconjunto endógeno H de apostas próprias confirmadas e elegíveis.
 *
 * Regras de elegibilidade:
 * - Registros DRAFT são terminantemente EXCLUÍDOS.
 * - Registros com status FROZEN ou SCORED e com confirmação própria (betPlacedAt definido ou legado confirmado) são incluídos.
 * - Dados CAIXA (sorteios oficiais, acertos, scores, premiações) são rigorosamente ignorados.
 * - Cada aposta C5 contribui com seus 5 jogos.
 * - A ordem física dos registros não altera a identidade do multiconjunto.
 *
 * @param records Coleção de registros de concursos/apostas
 * @returns Array de HistoryGame contendo exclusivamente os jogos elegíveis
 */
export function buildHistoryFromRecords(records: readonly EligibleRecordInput[]): HistoryGame[] {
  if (!Array.isArray(records)) {
    return [];
  }

  const H: HistoryGame[] = [];

  for (const rec of records) {
    // 1. Exclusão estrita de DRAFT
    if (!rec || rec.status === "DRAFT") {
      continue;
    }

    // 2. Elegibilidade: FROZEN ou SCORED
    if (rec.status !== "FROZEN" && rec.status !== "SCORED") {
      continue;
    }

    // 3. Verificação de aposta própria confirmada
    // Se o registro possui betPlacedAt como string válida, ou é um registro confirmado legado
    const isConfirmed = typeof rec.betPlacedAt === "string" && rec.betPlacedAt.trim().length > 0;
    // Também aceita registros legados em SCORED ou FROZEN que possuam jogos válidos
    const hasGames = (rec.generation?.games && rec.generation.games.length === 5) ||
      (rec.games && rec.games.length === 5);

    if (!isConfirmed && rec.betPlacedAt === undefined) {
      // Registros legados V1.13 sem o campo betPlacedAt mas com status FROZEN ou SCORED são elegíveis
      if (!hasGames) {
        continue;
      }
    } else if (!isConfirmed) {
      continue;
    }

    // 4. Extração exclusiva dos 5 jogos C5 gerados
    const sourceGames = rec.generation?.games ?? rec.games;
    if (sourceGames && sourceGames.length === 5) {
      for (const game of sourceGames) {
        // Validação leve de estrutura: cópia defensiva para imutabilidade
        H.push([...game]);
      }
    }
  }

  return H;
}
