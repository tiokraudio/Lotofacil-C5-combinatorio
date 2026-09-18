import React from "react";
import type { ContestRecord } from "../c5/types.ts";
import { formatLocalDate } from "../storage/service.ts";

interface PrintSheetProps {
  record: ContestRecord | null;
}

export const PrintSheet: React.FC<PrintSheetProps> = ({ record }) => {
  if (!record) return null;

  const formatNumbers = (nums: number[]) =>
    [...nums]
      .sort((a, b) => a - b)
      .map((n) => String(n).padStart(2, "0"))
      .join(" ");

  const isDraft = record.status === "DRAFT";
  const isFrozen = record.status === "FROZEN";
  const isScored = record.status === "SCORED";

  return (
    <div id="print-sheet" className="font-mono text-black">
      {/* Cabeçalho */}
      <div className="border-b-2 border-black pb-4 mb-4">
        <h1 className="text-2xl font-bold tracking-wider uppercase">
          C₅ LOTOFÁCIL
        </h1>
        <p className="text-xs text-gray-700">
          Gerador Combinatório Oficial de 25 Dezenas em 5 Jogos Simples
        </p>
      </div>

      {/* Identificação do Concurso e Status */}
      <div className="flex justify-between items-center border-b border-black pb-3 mb-4">
        <div>
          <span className="text-xs text-gray-600 uppercase block">Concurso:</span>
          <span className="text-2xl font-extrabold">{record.contestNumber}</span>
        </div>
        <div className="text-right">
          <span className="text-xs text-gray-600 uppercase block">Status:</span>
          <span
            className={`text-sm font-extrabold uppercase px-2 py-0.5 border ${
              isDraft
                ? "border-black text-black bg-gray-100"
                : "border-black text-black font-black"
            }`}
          >
            {isDraft
              ? "RASCUNHO — NÃO CONGELADO"
              : isFrozen
              ? "JOGOS OFICIAIS CONGELADOS"
              : "CONFERIDO COM RESULTADO OFICIAL"}
          </span>
        </div>
      </div>

      {/* 5 Jogos Oficiais */}
      <div className="mb-6">
        <h2 className="text-xs font-bold uppercase tracking-wider mb-2 border-b border-gray-300 pb-1">
          5 Apostas (15 dezenas cada):
        </h2>
        <div className="space-y-2 text-sm">
          {record.generation.games.map((game: number[], index: number) => (
            <div
              key={`print-game-${index}`}
              className="flex items-center justify-between p-2 border border-gray-400"
            >
              <span className="font-bold w-16">Jogo {index + 1}:</span>
              <span className="tracking-widest font-semibold">
                {formatNumbers(game)}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* Resultado Oficial se SCORED */}
      {isScored && record.officialResult && (
        <div className="mb-6 border border-black p-3">
          <span className="text-xs font-bold uppercase block mb-1">
            Resultado Oficial CAIXA:
          </span>
          <span className="tracking-widest font-bold">
            {formatNumbers(record.officialResult)}
          </span>
          {record.score && (
            <div className="mt-2 text-xs">
              <span>Melhor resultado: </span>
              <strong>{record.score.maxHits} acertos</strong>
            </div>
          )}
        </div>
      )}

      {/* Metadados e Rastreabilidade Criptográfica */}
      <div className="border-t border-black pt-3 text-[11px] text-gray-800 space-y-1">
        <div className="flex justify-between">
          <span>Versão C₅:</span>
          <span className="font-bold">{record.algorithmVersion}</span>
        </div>
        <div className="flex justify-between">
          <span>Generation ID:</span>
          <span>{record.generationId}</span>
        </div>
        <div className="flex justify-between">
          <span>Gerado em:</span>
          <span>{formatLocalDate(record.generatedAt)}</span>
        </div>
        {record.frozenAt && (
          <div className="flex justify-between">
            <span>Congelado em:</span>
            <span>{formatLocalDate(record.frozenAt)}</span>
          </div>
        )}
        {record.scoredAt && (
          <div className="flex justify-between">
            <span>Conferido em:</span>
            <span>{formatLocalDate(record.scoredAt)}</span>
          </div>
        )}
        {record.integrityHash && (
          <div className="flex justify-between pt-1 border-t border-gray-300">
            <span>Hash SHA-256 Resumido:</span>
            <span className="font-bold">
              {record.integrityHash.slice(0, 16)}...{record.integrityHash.slice(-16)}
            </span>
          </div>
        )}
      </div>

      {/* Aviso de Não Comprovação Financeira */}
      <div className="mt-6 pt-2 border-t border-gray-400 text-[9px] text-gray-600 text-center uppercase">
        Registro de geração combinatória. Não constitui comprovante de aposta registrada em casa lotérica.
      </div>
    </div>
  );
};
