import React, { useState } from "react";
import { Ball } from "./Ball.tsx";
import { CheckCircle2, RotateCcw, AlertCircle } from "lucide-react";
import { ConfirmDialog } from "./ConfirmDialog.tsx";
import { pad2 } from "../storage/service.ts";

interface ResultInputGridProps {
  contestNumber: number;
  isLoading?: boolean;
  onSubmitResult: (result: number[]) => Promise<void>;
}

export const ResultInputGrid: React.FC<ResultInputGridProps> = ({
  contestNumber,
  isLoading = false,
  onSubmitResult,
}) => {
  const [selectedNumbers, setSelectedNumbers] = useState<number[]>([]);
  const [showConfirmModal, setShowConfirmModal] = useState(false);

  const toggleNumber = (num: number) => {
    if (selectedNumbers.includes(num)) {
      setSelectedNumbers((prev) => prev.filter((n) => n !== num));
    } else {
      if (selectedNumbers.length < 15) {
        setSelectedNumbers((prev) => [...prev, num].sort((a, b) => a - b));
      }
    }
  };

  const handleClear = () => {
    setSelectedNumbers([]);
  };

  const isComplete = selectedNumbers.length === 15;

  const handleConfirmScore = async () => {
    if (!isComplete) return;
    await onSubmitResult(selectedNumbers);
    setShowConfirmModal(false);
  };

  const all25 = Array.from({ length: 25 }, (_, i) => i + 1);

  return (
    <div className="p-5 rounded-xl border border-zinc-800 bg-zinc-900/90 shadow-lg">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 mb-4 pb-3 border-b border-zinc-800">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100 flex items-center gap-2">
            <span>REGISTRAR RESULTADO OFICIAL</span>
            <span className="text-xs px-2 py-0.5 rounded-md bg-zinc-800 border border-zinc-700 text-zinc-300 font-mono">
              Concurso {contestNumber}
            </span>
          </h3>
          <p className="text-xs text-zinc-400 mt-0.5">
            Clique nas 15 dezenas sorteadas pela Lotofácil oficial da CAIXA.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <div
            id="result-counter-badge"
            className={`px-3 py-1 rounded-lg border text-xs font-mono font-bold ${
              isComplete
                ? "bg-emerald-950/80 border-emerald-500/80 text-emerald-300"
                : "bg-zinc-800 border-zinc-700 text-zinc-300"
            }`}
          >
            Selecionadas: {selectedNumbers.length}/15
          </div>
          {selectedNumbers.length > 0 && (
            <button
              type="button"
              id="clear-selected-btn"
              onClick={handleClear}
              disabled={isLoading}
              className="text-xs text-zinc-400 hover:text-zinc-200 flex items-center gap-1 py-1 px-2 rounded-md hover:bg-zinc-800 transition-colors disabled:opacity-50"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Limpar</span>
            </button>
          )}
        </div>
      </div>

      {/* Grade 01 a 25 */}
      <div
        className="grid grid-cols-5 gap-2 sm:gap-2.5 max-w-md mx-auto my-4 p-3 bg-zinc-950 rounded-xl border border-zinc-800/80"
        role="group"
        aria-label="Grade de dezenas oficiais de 01 a 25"
      >
        {all25.map((num) => {
          const isSelected = selectedNumbers.includes(num);
          const isDisabled = !isSelected && selectedNumbers.length >= 15;
          return (
            <div key={`grid-cell-${num}`} className="flex justify-center">
              <Ball
                number={num}
                variant="selectable"
                selected={isSelected}
                disabled={isDisabled}
                onClick={() => toggleNumber(num)}
                size="md"
              />
            </div>
          );
        })}
      </div>

      {/* Exibição das 15 selecionadas em ordem crescente */}
      <div className="mt-4 p-3 rounded-lg bg-zinc-950/60 border border-zinc-800">
        <span className="text-xs font-medium text-zinc-400 block mb-2">
          Dezenas Selecionadas (Ordem Crescente):
        </span>
        {selectedNumbers.length === 0 ? (
          <p className="text-xs text-zinc-400 italic">Nenhuma dezena selecionada ainda.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {selectedNumbers.map((num) => (
              <Ball key={`selected-badge-${num}`} number={num} variant="official" size="sm" />
            ))}
          </div>
        )}
      </div>

      {/* Botão de Conferência */}
      <div className="mt-5 flex items-center justify-end">
        <button
          type="button"
          id="btn-check-result"
          onClick={() => setShowConfirmModal(true)}
          disabled={!isComplete || isLoading}
          className={`px-5 py-2.5 rounded-lg text-sm font-semibold tracking-wide flex items-center gap-2 transition-all ${
            isComplete && !isLoading
              ? "bg-emerald-600 hover:bg-emerald-500 text-white shadow-md hover:shadow-emerald-900/30 cursor-pointer focus:ring-2 focus:ring-emerald-400"
              : "bg-zinc-800 border border-zinc-700 text-zinc-400 cursor-not-allowed"
          }`}
        >
          <CheckCircle2 className="w-4 h-4" />
          <span>CONFERIR RESULTADO</span>
        </button>
      </div>

      {/* Modal de Confirmação do Resultado Oficial */}
      <ConfirmDialog
        isOpen={showConfirmModal}
        title="Confirmar Resultado Oficial"
        description={`Confirma que estas são as 15 dezenas oficiais sorteadas para o concurso ${contestNumber}?`}
        confirmLabel="CONFIRMAR E PONTUAR"
        cancelLabel="VOLTAR"
        variant="primary"
        isLoading={isLoading}
        onConfirm={handleConfirmScore}
        onCancel={() => setShowConfirmModal(false)}
      >
        <div className="p-3 bg-zinc-950 rounded-lg border border-zinc-800 mt-2">
          <span className="text-xs text-zinc-400 block mb-2">15 Dezenas Sorteadas:</span>
          <div className="flex flex-wrap gap-1.5">
            {selectedNumbers.map((num) => (
              <Ball key={`confirm-ball-${num}`} number={num} variant="official" size="sm" />
            ))}
          </div>
          <p className="text-xs text-zinc-400 mt-3 italic">
            A pontuação é imutável e será gravada de forma permanente no registro auditado.
          </p>
        </div>
      </ConfirmDialog>
    </div>
  );
};
