/**
 * Gerador de Vetores Dourados Pós-Incidente (POST_INCIDENT_GOLDEN_VECTORS_V1)
 * RECERT-0 Requisito 6
 */

import { generateC5Draft, freezeDraft } from "../draft";
import { createMemoryHistory, formatGameCanonical } from "../history";
import { C5Game } from "../types";
import * as fs from "node:fs";
import * as path from "node:path";

export interface GoldenVectorEntry {
  readonly milestone: string;
  readonly contestNumber: number;
  readonly historyRevision: number;
  readonly historyFingerprint: string;
  readonly poolMasterSeed: string;
  readonly selectedPoolIndex: number;
  readonly leximinProfile: readonly number[];
  readonly selectedC5Games: readonly (readonly number[])[];
  readonly frozenPayloadSha256: string;
}

export function generatePostIncidentGoldenVectors(): GoldenVectorEntry[] {
  const entries: GoldenVectorEntry[] = [];
  const accumulatedGames: C5Game[] = [];
  let revision = 0;

  for (let c = 3500; c <= 3505; c++) {
    const history = createMemoryHistory(accumulatedGames, revision);
    const draft = generateC5Draft(c, history);
    const frozen = freezeDraft(draft);

    entries.push({
      milestone: `MILESTONE_H${revision}_CONTEST_${c}`,
      contestNumber: c,
      historyRevision: revision,
      historyFingerprint: history.fingerprint,
      poolMasterSeed: draft.poolMasterSeed,
      selectedPoolIndex: draft.poolIndex,
      leximinProfile: draft.leximinProfile,
      selectedC5Games: draft.games,
      frozenPayloadSha256: frozen.sha256,
    });

    // Avança acumulando os 5 jogos no histórico canônico
    for (const g of draft.games) {
      accumulatedGames.push(g);
    }
    revision++;
  }

  return entries;
}

// Quando executado via CLI
if (process.argv[1]?.endsWith("generatePostIncidentGoldenVectors.ts")) {
  const vectors = generatePostIncidentGoldenVectors();
  const dir = path.resolve("certification");
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  const targetFile = path.join(dir, "post-incident-golden-vectors-v1.json");
  fs.writeFileSync(targetFile, JSON.stringify(vectors, null, 2), "utf-8");
  console.log(`Vetores Dourados POST_INCIDENT_GOLDEN_VECTORS_V1 gerados com sucesso em ${targetFile}`);
  console.log(`Total de marcos gerados: ${vectors.length}`);
}
