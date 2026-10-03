import { C5Game, MemoryHistory } from "./types";
import { syncSha256 } from "./sha256";

/**
 * Normaliza um jogo em string canônica "01-02-...-25"
 */
export function formatGameCanonical(game: readonly number[]): string {
  return game.map(n => n.toString().padStart(2, "0")).join("-");
}

/**
 * Calcula a fingerprint canônica do histórico H
 */
export function computeHistoryFingerprint(games: readonly C5Game[], revision: number): string {
  if (games.length === 0) {
    return syncSha256(`H0-REV0-EMPTY`);
  }
  const serialized = games.map(formatGameCanonical).join("|");
  return syncSha256(`H-REV${revision}:${serialized}`);
}

/**
 * Cria uma estrutura canônica de MemoryHistory
 */
export function createMemoryHistory(games: readonly C5Game[], revision: number): MemoryHistory {
  const fingerprint = computeHistoryFingerprint(games, revision);
  return {
    games,
    revision,
    fingerprint,
  };
}
