/**
 * Auditoria Causal Completa H0..H5 (RECERT-0.2 Requisito 2)
 */

import { generateC5Draft, freezeDraft } from "../draft";
import { createMemoryHistory, formatGameCanonical } from "../history";
import { DeterministicPRNG } from "../prng";
import { syncSha256 } from "../sha256";
import { C5Game } from "../types";

export interface MilestoneCausalDetail {
  contestNumber: number;
  historyRevision: number;
  inputGamesCount: number;
  inputGamesSummary: string;
  fingerprintPreimage: string;
  historyFingerprint: string;
  seedDerivationPreimage: string;
  poolMasterSeed: string;
  prngSeedConsumed: string;
  k: number;
  fullPoolSha256: string;
  selectedPoolIndex: number;
  leximinProfile: number[];
  selectedC5: readonly C5Game[];
  frozenPayloadPreimage: string;
  frozenPayloadSha256: string;
}

export function computeCausalMilestones(): MilestoneCausalDetail[] {
  const details: MilestoneCausalDetail[] = [];
  const accumulatedGames: C5Game[] = [];
  let revision = 0;

  for (let c = 3500; c <= 3505; c++) {
    // 1. Entrada H
    const inputGamesCount = accumulatedGames.length;
    const inputGamesSummary = accumulatedGames.length === 0
      ? "EMPTY"
      : `${accumulatedGames.length} jogos acumulados (${accumulatedGames.length / 5} concursos)`;

    // 2. Fingerprint Preimage
    let fingerprintPreimage = "";
    if (accumulatedGames.length === 0) {
      fingerprintPreimage = "H0-REV0-EMPTY";
    } else {
      const serial = accumulatedGames.map(formatGameCanonical).join("|");
      fingerprintPreimage = `H-REV${revision}:${serial}`;
    }
    const historyFingerprint = syncSha256(fingerprintPreimage);
    const history = createMemoryHistory(accumulatedGames, revision);

    // 3. Seed Derivation Preimage
    const seedDerivationPreimage = `C5-POOL-MASTER:${c}:${historyFingerprint}`;
    const poolMasterSeed = syncSha256(seedDerivationPreimage);
    const prngSeedConsumed = poolMasterSeed;

    // 4. Full Pool SHA-256 (K=500)
    const prng = new DeterministicPRNG(poolMasterSeed);
    const poolGamesSerialized: string[] = [];
    for (let k = 0; k < 500; k++) {
      const cand = prng.generateCandidate5();
      poolGamesSerialized.push(cand.map(formatGameCanonical).join(","));
    }
    const fullPoolSha256 = syncSha256(poolGamesSerialized.join("||"));

    // 5. Geração de Draft oficial
    const draft = generateC5Draft(c, history);
    const frozen = freezeDraft(draft);

    const frozenPayloadPreimage = `C5-FROZEN:${draft.contestNumber}:${draft.poolIndex}:${draft.poolMasterSeed}:${draft.historyFingerprint}:${draft.historyRevision}:${draft.games.map(formatGameCanonical).join("|")}`;

    details.push({
      contestNumber: c,
      historyRevision: revision,
      inputGamesCount,
      inputGamesSummary,
      fingerprintPreimage,
      historyFingerprint,
      seedDerivationPreimage,
      poolMasterSeed,
      prngSeedConsumed,
      k: 500,
      fullPoolSha256,
      selectedPoolIndex: draft.poolIndex,
      leximinProfile: [...draft.leximinProfile],
      selectedC5: draft.games,
      frozenPayloadPreimage,
      frozenPayloadSha256: frozen.sha256,
    });

    for (const g of draft.games) {
      accumulatedGames.push(g);
    }
    revision++;
  }

  return details;
}

if (process.argv[1]?.endsWith("recert02CausalAudit.ts")) {
  const details = computeCausalMilestones();
  console.log(JSON.stringify(details, null, 2));
}
