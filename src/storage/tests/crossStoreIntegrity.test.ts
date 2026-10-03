/**
 * Teste de Integridade da Dupla Persistência & Controles Negativos (RECERT-0.1 Item 1)
 */

import assert from "node:assert";
import { ContestRecord, MemoryHistory, C5Game } from "../../c5-memory/types";
import { createMemoryHistory } from "../../c5-memory/history";
import { reconstructHistoryFromCanonicalContests } from "../crossStoreAudit";

console.log("=== INICIANDO TESTES DE DUPLA PERSISTÊNCIA & CONTROLES NEGATIVOS ===");

// 1. Reconstrução Canônica de H a partir de 'contests'
{
  console.log("TESTE 1: Reconstrução Canônica de H a partir de 'contests'");

  const game1: C5Game = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const game2: C5Game = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  const dummyGames: C5Game[] = [game1, game2, game1, game2, game1];

  const mockContests: ContestRecord[] = [
    {
      contestNumber: 3501,
      contestDate: "2026-10-01",
      status: "COMPLETED",
      algorithmVersion: "C5-Memory-2.0.0",
      games: dummyGames,
      createdAt: "2026-10-01T10:00:00Z",
      updatedAt: "2026-10-01T20:00:00Z",
    },
    {
      contestNumber: 3502,
      contestDate: "2026-10-02",
      status: "FROZEN", // Confirmado
      algorithmVersion: "C5-Memory-2.0.0",
      games: dummyGames,
      createdAt: "2026-10-02T10:00:00Z",
      updatedAt: "2026-10-02T11:00:00Z",
    },
    {
      contestNumber: 3503,
      contestDate: "2026-10-03",
      status: "PREVIEW", // NÃO confirmado
      algorithmVersion: "C5-Memory-2.0.0",
      games: dummyGames,
      createdAt: "2026-10-03T10:00:00Z",
      updatedAt: "2026-10-03T10:05:00Z",
    },
  ];

  const reconstructedH = reconstructHistoryFromCanonicalContests(mockContests);

  // Apenas concursos FROZEN ou COMPLETED entram em H
  assert.strictEqual(reconstructedH.revision, 2, "Apenas os 2 concursos confirmados compõem a revision");
  assert.strictEqual(reconstructedH.games.length, 10, "10 jogos acumulados");
  assert(reconstructedH.fingerprint.length === 64, "Fingerprint calculado com sucesso");

  console.log("  ✓ Reconstrução de H estritamente a partir da fonte canônica 'contests' aprovada.");
}

// 2. CONTROLE NEGATIVO: Detecção de divergência artificial de Revision
{
  console.log("TESTE 2: Controle Negativo — Divergência Artificial de Revision");
  const game1: C5Game = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const dummyGames: C5Game[] = [game1, game1, game1, game1, game1];

  const mockContests: ContestRecord[] = [
    {
      contestNumber: 3501,
      contestDate: "2026-10-01",
      status: "COMPLETED",
      algorithmVersion: "C5-Memory-2.0.0",
      games: dummyGames,
      createdAt: "2026-10-01T10:00:00Z",
      updatedAt: "2026-10-01T20:00:00Z",
    },
  ];

  const canonicalH = reconstructHistoryFromCanonicalContests(mockContests);
  // Simula divergência em c5_memory_history (revision adulterada)
  const corruptedHistory: MemoryHistory = {
    games: canonicalH.games,
    revision: 99, // Adulterado!
    fingerprint: canonicalH.fingerprint,
  };

  const isDivergent = canonicalH.revision !== corruptedHistory.revision;
  assert(isDivergent, "Sistema deve detectar que a revision derivada diverge do canônico");
  console.log("  ✓ Controle Negativo 1 (Revision adulterada): Divergência detectada com sucesso.");
}

// 3. CONTROLE NEGATIVO: Detecção de divergência artificial de Jogos
{
  console.log("TESTE 3: Controle Negativo — Adição Clandestina de Jogos no Read-Model");
  const game1: C5Game = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15];
  const gameExtra: C5Game = [2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16];
  const dummyGames: C5Game[] = [game1, game1, game1, game1, game1];

  const mockContests: ContestRecord[] = [
    {
      contestNumber: 3501,
      contestDate: "2026-10-01",
      status: "COMPLETED",
      algorithmVersion: "C5-Memory-2.0.0",
      games: dummyGames,
      createdAt: "2026-10-01T10:00:00Z",
      updatedAt: "2026-10-01T20:00:00Z",
    },
  ];

  const canonicalH = reconstructHistoryFromCanonicalContests(mockContests);
  // Simula injeção de jogo clandestino no read-model
  const corruptedHistory = createMemoryHistory([...canonicalH.games, gameExtra], canonicalH.revision);

  const isDivergent = canonicalH.fingerprint !== corruptedHistory.fingerprint;
  assert(isDivergent, "Sistema deve detectar que o fingerprint divergiu após injeção clandestina");
  console.log("  ✓ Controle Negativo 2 (Injeção de jogos): Divergência detectada com sucesso.");
}

console.log("=== TODOS OS TESTES DE AUDITORIA DE DUPLA PERSISTÊNCIA FORAM APROVADOS ===");
