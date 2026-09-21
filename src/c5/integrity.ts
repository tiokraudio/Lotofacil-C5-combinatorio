/**
 * Módulo de serialização canônica determinística, cômputo de SHA-256 e auditoria de integridade.
 * Utiliza a Web Crypto API nativa (crypto.subtle.digest) padrão no navegador e no Node.js.
 */
import { C5_SLOTS } from "./constants.ts";
import { validateC5 } from "./validator.ts";
import type {
  C5Generation,
  ContestRecord,
  FrozenC5Payload,
  IntegrityVerification,
} from "./types.ts";

/**
 * Constrói o payload canônico para congelamento e verificação de integridade.
 * O payload inclui estritamente os campos imutáveis do registro e da geração.
 */
export function buildCanonicalPayload(
  contestNumber: number,
  generationId: string,
  algorithmVersion: string,
  generatedAt: string,
  frozenAt: string,
  generation: C5Generation
): FrozenC5Payload {
  const slotAssignmentsOrdered: Record<string, number> = {};
  for (const slot of C5_SLOTS) {
    if (slot in generation.slotAssignments) {
      slotAssignmentsOrdered[slot] = generation.slotAssignments[slot];
    }
  }

  return {
    contestNumber,
    generationId,
    algorithmVersion,
    generatedAt,
    frozenAt,
    permutation: [...generation.permutation],
    slotAssignments: slotAssignmentsOrdered,
    games: [
      [...generation.games[0]].sort((a, b) => a - b),
      [...generation.games[1]].sort((a, b) => a - b),
      [...generation.games[2]].sort((a, b) => a - b),
      [...generation.games[3]].sort((a, b) => a - b),
      [...generation.games[4]].sort((a, b) => a - b),
    ],
  };
}

/**
 * Serializa deterministicamente o payload canônico em string unívoca.
 *
 * Garante que a ordem dos campos, a ordem dos slots em C5_SLOTS e a ordem
 * das dezenas em J1..J5 não dependam de convenções do interpretador.
 */
export function serializeCanonicalPayload(payload: FrozenC5Payload): string {
  const lines: string[] = [
    `"contestNumber":${payload.contestNumber}`,
    `"generationId":"${payload.generationId}"`,
    `"algorithmVersion":"${payload.algorithmVersion}"`,
    `"generatedAt":"${payload.generatedAt}"`,
    `"frozenAt":"${payload.frozenAt}"`,
    `"permutation":[${payload.permutation.join(",")}]`,
    `"slotAssignments":{${C5_SLOTS.map(
      (slot) => `"${slot}":${payload.slotAssignments[slot] ?? "null"}`
    ).join(",")}}`,
    `"games":[${payload.games
      .map((game) => `[${[...game].sort((a, b) => a - b).join(",")}]`)
      .join(",")}]`,
  ];

  return `{${lines.join(",")}}`;
}

/**
 * Calcula o hash criptográfico SHA-256 de uma string de entrada utilizando a Web Crypto API nativa.
 * Retorna exatamente 64 caracteres hexadecimais em lowercase.
 */
export async function computeSHA256(canonicalString: string): Promise<string> {
  const data = new TextEncoder().encode(canonicalString);
  const hashBuffer = await globalThis.crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Audita a integridade de um registro nos estados FROZEN ou SCORED.
 *
 * 1. Reconstitui o payload canônico;
 * 2. Serializa canonicamente;
 * 3. Recalcula o SHA-256 via Web Crypto API nativa;
 * 4. Compara com o integrityHash armazenado;
 * 5. Revalida a geração C5 frente a todas as 9 invariantes A até I.
 *
 * @param record Registro em estado FROZEN ou SCORED.
 * @returns Relatório de auditoria detalhado.
 */
export async function verifyContestIntegrity(record: ContestRecord): Promise<IntegrityVerification> {
  const errors: string[] = [];

  if (record.status !== "FROZEN" && record.status !== "SCORED") {
    errors.push(
      `Registro em estado inválido para auditoria de integridade: status '${record.status}'. Requer FROZEN ou SCORED.`
    );
    return {
      valid: false,
      hashMatches: false,
      generationValid: false,
      storedHash: record.integrityHash ?? "",
      calculatedHash: "",
      errors,
    };
  }

  if (!record.frozenAt) {
    errors.push("Campo 'frozenAt' ausente no registro congelado.");
  }

  if (!record.integrityHash) {
    errors.push("Campo 'integrityHash' ausente no registro congelado.");
  }

  if (record.betPlacedAt !== undefined) {
    if (typeof record.betPlacedAt !== "string" || isNaN(Date.parse(record.betPlacedAt))) {
      errors.push("Campo 'betPlacedAt' não é uma data ISO válida.");
    } else if (record.frozenAt && Date.parse(record.betPlacedAt) < Date.parse(record.frozenAt)) {
      errors.push("Violação de ordem temporal: 'betPlacedAt' é anterior a 'frozenAt'.");
    }
  }

  // 1. Validação estrutural das invariantes matemáticas C5
  const genValidation = validateC5(record.generation);
  const generationValid = genValidation.valid;
  if (!generationValid) {
    errors.push(
      `Invariantes C5 violadas na geração auditada: ${genValidation.errors.join("; ")}`
    );
  }

  // 2. Reconstituição canônica e recálculo de hash via Web Crypto
  let calculatedHash = "";
  let hashMatches = false;

  try {
    const payload = buildCanonicalPayload(
      record.contestNumber,
      record.generationId,
      record.algorithmVersion,
      record.generatedAt,
      record.frozenAt ?? "",
      record.generation
    );

    const serialized = serializeCanonicalPayload(payload);
    calculatedHash = await computeSHA256(serialized);
    hashMatches = calculatedHash === (record.integrityHash ?? "");

    if (!hashMatches) {
      errors.push(
        `Divergência de hash de integridade: armazenado '${record.integrityHash}', recalculado '${calculatedHash}'.`
      );
    }
  } catch (err: any) {
    errors.push(`Erro durante a serialização canônica: ${err?.message ?? String(err)}`);
  }

  const valid = generationValid && hashMatches && errors.length === 0;

  return {
    valid,
    hashMatches,
    generationValid,
    storedHash: record.integrityHash ?? "",
    calculatedHash,
    errors,
  };
}
