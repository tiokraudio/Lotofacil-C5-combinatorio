import { ContestRecord, MemoryHistory, C5Game } from "../c5-memory/types";
import { calculateHits } from "../c5-memory/math";
import { syncSha256 } from "../c5-memory/sha256";
import { formatGameCanonical, createMemoryHistory } from "../c5-memory/history";
import { getAllContestRecords, saveContestRecord, saveStoredMemoryHistory } from "./db";

export async function initializeSeedData(): Promise<void> {
  const existing = await getAllContestRecords();
  if (existing.length > 0) return;

  const demoContests: Array<{
    contestNumber: number;
    contestDate: string;
    games: number[][];
    officialResult?: number[];
    status: "COMPLETED" | "FROZEN" | "AVAILABLE";
  }> = [
    {
      contestNumber: 3501,
      contestDate: "2026-10-01",
      status: "COMPLETED",
      games: [
        [1, 2, 4, 5, 7, 9, 11, 13, 14, 16, 18, 19, 21, 23, 25],
        [2, 3, 5, 6, 8, 10, 11, 12, 15, 17, 18, 20, 22, 24, 25],
        [1, 3, 4, 6, 7, 9, 10, 13, 15, 16, 17, 19, 21, 22, 24],
        [2, 4, 5, 8, 9, 11, 12, 14, 15, 18, 20, 21, 23, 24, 25],
        [1, 2, 3, 6, 7, 8, 10, 12, 13, 16, 17, 19, 20, 22, 25],
      ],
      officialResult: [1, 2, 3, 4, 5, 7, 9, 10, 11, 13, 16, 18, 19, 21, 25],
    },
    {
      contestNumber: 3502,
      contestDate: "2026-10-02",
      status: "COMPLETED",
      games: [
        [1, 3, 5, 7, 8, 10, 11, 13, 14, 16, 18, 20, 21, 23, 25],
        [2, 4, 6, 7, 9, 11, 12, 14, 15, 17, 19, 21, 22, 24, 25],
        [1, 2, 4, 6, 8, 9, 11, 13, 15, 17, 18, 20, 22, 23, 25],
        [3, 4, 5, 7, 8, 10, 12, 13, 16, 18, 19, 21, 22, 24, 25],
        [1, 2, 5, 6, 8, 10, 11, 14, 15, 16, 19, 20, 21, 23, 24],
      ],
      officialResult: [1, 3, 5, 6, 7, 8, 10, 11, 13, 14, 16, 18, 20, 21, 25],
    },
    {
      contestNumber: 3503,
      contestDate: "2026-10-03",
      status: "COMPLETED",
      games: [
        [2, 3, 4, 6, 8, 9, 11, 12, 14, 16, 17, 19, 21, 23, 24],
        [1, 4, 5, 7, 8, 10, 11, 13, 15, 17, 18, 20, 22, 24, 25],
        [2, 3, 5, 6, 9, 10, 12, 13, 15, 16, 18, 20, 21, 23, 25],
        [1, 2, 4, 7, 8, 10, 11, 14, 15, 17, 19, 21, 22, 23, 25],
        [3, 5, 6, 7, 9, 11, 12, 13, 16, 18, 19, 20, 22, 24, 25],
      ],
      officialResult: [2, 3, 4, 6, 8, 9, 11, 12, 14, 15, 16, 17, 19, 21, 23],
    },
    {
      contestNumber: 3504,
      contestDate: "2026-10-05",
      status: "COMPLETED",
      games: [
        [1, 2, 3, 5, 7, 9, 10, 12, 14, 16, 17, 19, 21, 22, 25],
        [2, 4, 6, 8, 9, 11, 13, 15, 17, 18, 20, 22, 23, 24, 25],
        [1, 3, 4, 6, 7, 10, 11, 13, 14, 16, 18, 20, 21, 24, 25],
        [2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19, 21, 22, 23, 25],
        [1, 4, 5, 6, 8, 9, 11, 12, 15, 16, 18, 20, 22, 24, 25],
      ],
      officialResult: [1, 2, 3, 5, 7, 8, 10, 12, 14, 15, 17, 19, 21, 22, 25],
    },
  ];

  const accumulatedGames: C5Game[] = [];
  let revision = 0;

  for (const c of demoContests) {
    const gamesSerial = c.games.map(formatGameCanonical).join("|");
    const fingerprintBefore = syncSha256(`H-REV${revision}:${accumulatedGames.map(formatGameCanonical).join("|")}`);
    const poolSeed = syncSha256(`C5-POOL-MASTER:${c.contestNumber}:${fingerprintBefore}`);
    const sha256Hash = syncSha256(`C5-FROZEN:${c.contestNumber}:12:${poolSeed}:${fingerprintBefore}:${revision}:${gamesSerial}`);

    let gameHits: number[] | undefined = undefined;
    let bestHits: number | undefined = undefined;
    let bestHitsCount: number | undefined = undefined;

    if (c.officialResult) {
      gameHits = c.games.map(g => calculateHits(g, c.officialResult!));
      bestHits = Math.max(...gameHits);
      bestHitsCount = gameHits.filter(h => h === bestHits).length;
    }

    const rec: ContestRecord = {
      contestNumber: c.contestNumber,
      contestDate: c.contestDate,
      status: c.status,
      algorithmVersion: "C5-Memory-2.0.0",
      games: c.games,
      draft: {
        contestNumber: c.contestNumber,
        games: c.games,
        poolIndex: 12,
        poolMasterSeed: poolSeed,
        historyFingerprint: fingerprintBefore,
        historyRevision: revision,
        leximinProfile: [4, 4, 5, 5, 6],
        generatedAt: `${c.contestDate}T10:00:00.000Z`,
      },
      frozenPayload: {
        contestNumber: c.contestNumber,
        games: c.games,
        poolIndex: 12,
        poolMasterSeed: poolSeed,
        historyFingerprint: fingerprintBefore,
        historyRevision: revision,
        sha256: sha256Hash,
        frozenAt: `${c.contestDate}T11:00:00.000Z`,
      },
      officialResult: c.officialResult,
      gameHits,
      bestHits,
      bestHitsCount,
      createdAt: `${c.contestDate}T10:00:00.000Z`,
      updatedAt: `${c.contestDate}T20:00:00.000Z`,
    };

    await saveContestRecord(rec);

    // Adiciona jogos de concursos COMPLETED ao histórico H
    for (const g of c.games) {
      accumulatedGames.push(g);
    }
    revision++;
  }

  // Cria a memória persistida
  const finalHistory = createMemoryHistory(accumulatedGames, revision);
  await saveStoredMemoryHistory(finalHistory);
}
