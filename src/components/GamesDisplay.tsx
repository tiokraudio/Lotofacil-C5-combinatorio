import React from "react";
import { Ball } from "./Ball.tsx";
import type { ContestRecord } from "../c5/types.ts";
import { Award, Hash } from "lucide-react";

interface GamesDisplayProps {
  record: ContestRecord;
}

export const GamesDisplay: React.FC<GamesDisplayProps> = ({ record }) => {
  const isScored = record.status === "SCORED";
  const officialResult = record.officialResult ? new Set(record.officialResult) : null;
  const gamesList = record.score?.games;

  return (
    <div className="space-y-4">
      {record.generation.games.map((game, gameIdx) => {
        const gameNumber = gameIdx + 1;
        const scoreInfo = isScored && gamesList ? gamesList[gameIdx] : null;
        const hits = scoreInfo ? scoreInfo.hits : null;
        const isPrize = hits !== null && hits >= 11;

        return (
          <div
            key={`game-${gameNumber}`}
            id={`game-card-${gameNumber}`}
            className={`p-4 rounded-xl border transition-all ${
              isPrize
                ? "bg-emerald-950/20 border-emerald-500/50 shadow-xs"
                : "bg-zinc-900/80 border-zinc-800"
            }`}
          >
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
              <div className="flex items-center gap-2">
                <span className="flex items-center justify-center w-6 h-6 rounded-md bg-zinc-800 border border-zinc-700 text-xs font-mono font-bold text-zinc-300">
                  {gameNumber}
                </span>
                <span className="text-sm font-semibold tracking-wider text-zinc-200 uppercase font-mono">
                  JOGO {gameNumber}
                </span>
                <span className="text-xs text-zinc-400">
                  (15 dezenas)
                </span>
              </div>

              {/* Se for SCORED, exibe contagem oficial de acertos e selo de premiação */}
              {isScored && hits !== null && (
                <div className="flex items-center gap-2">
                  {isPrize && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 border border-emerald-500/30">
                      <Award className="w-3.5 h-3.5" />
                      <span>Faixa {hits} acertos</span>
                    </span>
                  )}
                  <span
                    className={`text-xs sm:text-sm font-mono font-bold px-2.5 py-1 rounded-lg border ${
                      isPrize
                        ? "bg-emerald-900/60 border-emerald-500/60 text-emerald-200"
                        : "bg-zinc-800 border-zinc-700 text-zinc-300"
                    }`}
                  >
                    {hits} ACERTOS
                  </span>
                </div>
              )}
            </div>

            {/* Dezenas do Jogo */}
            <div className="flex flex-wrap gap-1.5 sm:gap-2">
              {game.map((num) => {
                let variant: "default" | "hit" | "miss" = "default";
                if (isScored && officialResult) {
                  variant = officialResult.has(num) ? "hit" : "miss";
                }

                return (
                  <Ball
                    key={`g${gameNumber}-num-${num}`}
                    number={num}
                    variant={variant}
                    size="md"
                  />
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
};
