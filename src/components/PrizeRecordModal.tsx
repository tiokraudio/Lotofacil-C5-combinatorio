import React, { useState, useEffect, useRef } from "react";
import { X, DollarSign, Award, AlertCircle, CheckCircle2, TrendingUp, TrendingDown } from "lucide-react";
import type { ContestRecord } from "../c5/types.ts";
import { formatBRLFromCents, formatSignedBRLFromCents, parseBRLToCents } from "../utils/money.ts";

interface PrizeRecordModalProps {
  isOpen: boolean;
  record: ContestRecord | null;
  isLoading: boolean;
  onClose: () => void;
  onRecordPrize: (amountCents: number) => Promise<void>;
}

export const PrizeRecordModal: React.FC<PrizeRecordModalProps> = ({
  isOpen,
  record,
  isLoading,
  onClose,
  onRecordPrize,
}) => {
  const [inputValue, setInputValue] = useState<string>("");
  const [parsedCents, setParsedCents] = useState<number | null>(null);
  const [inputError, setInputError] = useState<string | null>(null);
  const modalRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  // Inicializa o valor com base nas faixas fixas conhecidas da Lotofácil (se aplicável)
  useEffect(() => {
    if (isOpen && record) {
      setInputError(null);
      const score = record.score;
      if (score) {
        // Se todas as cotas tiveram < 11 acertos, o padrão mais comum é zero
        if (!score.has11Plus) {
          setInputValue("0,00");
          setParsedCents(0);
        } else {
          // Calcula valor padrão estimado para faixas fixas se aplicável
          // 11 acertos = R$ 6,00 por jogo premiado; 12 acertos = R$ 12,00; 13 acertos = R$ 30,00
          const hits11 = score.prizeCounts.hits11 || 0;
          const hits12 = score.prizeCounts.hits12 || 0;
          const hits13 = score.prizeCounts.hits13 || 0;
          const hits14 = score.prizeCounts.hits14 || 0;
          const hits15 = score.prizeCounts.hits15 || 0;

          if (hits14 === 0 && hits15 === 0) {
            const estimatedCents = (hits11 * 600) + (hits12 * 1200) + (hits13 * 3000);
            const formatted = (estimatedCents / 100).toFixed(2).replace(".", ",");
            setInputValue(formatted);
            setParsedCents(estimatedCents);
          } else {
            setInputValue("");
            setParsedCents(null);
          }
        }
      } else {
        setInputValue("");
        setParsedCents(null);
      }

      // Foco no input
      setTimeout(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      }, 100);
    }
  }, [isOpen, record]);

  // Teclado (ESC e Focus Trap)
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape" && !isLoading) {
        e.preventDefault();
        onClose();
        return;
      }

      if (e.key === "Tab" && modalRef.current) {
        const focusable = modalRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
        );
        if (focusable.length === 0) return;
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (e.shiftKey) {
          if (document.activeElement === first) {
            e.preventDefault();
            last.focus();
          }
        } else {
          if (document.activeElement === last) {
            e.preventDefault();
            first.focus();
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [isOpen, isLoading, onClose]);

  if (!isOpen || !record) return null;

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setInputValue(val);
    if (!val.trim()) {
      setParsedCents(null);
      setInputError(null);
      return;
    }

    try {
      const cents = parseBRLToCents(val);
      setParsedCents(cents);
      setInputError(null);
    } catch (err: any) {
      setParsedCents(null);
      setInputError(err?.message || "Valor inválido.");
    }
  };

  const handleSetQuickAmount = (cents: number) => {
    const formatted = (cents / 100).toFixed(2).replace(".", ",");
    setInputValue(formatted);
    setParsedCents(cents);
    setInputError(null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isLoading) return;

    try {
      const cents = parseBRLToCents(inputValue);
      await onRecordPrize(cents);
      onClose();
    } catch (err: any) {
      setInputError(err?.message || "Erro ao validar valor.");
    }
  };

  const costCents = 1750; // R$ 17,50
  const netCents = parsedCents !== null ? parsedCents - costCents : null;

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="prize-modal-title"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-xs animate-in fade-in duration-200"
    >
      <div
        ref={modalRef}
        className="w-full max-w-lg bg-zinc-900 border border-zinc-700/80 rounded-2xl shadow-2xl p-6 relative flex flex-col gap-5 max-h-[90vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-start justify-between pb-4 border-b border-zinc-800">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-950/60 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0">
              <DollarSign className="w-5 h-5" />
            </div>
            <div>
              <span className="text-[11px] font-mono uppercase tracking-wider text-emerald-400 block font-semibold">
                Fechamento Financeiro Oficial
              </span>
              <h3 id="prize-modal-title" className="text-lg font-bold text-zinc-100 font-mono">
                Registrar Prêmio • Concurso {record.contestNumber}
              </h3>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isLoading}
            aria-label="Fechar"
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors disabled:opacity-50 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Resumo do Concurso */}
        <div className="p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 text-xs flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
          <div>
            <span className="text-zinc-400 block">Desempenho da Carteira C₅:</span>
            <span className="font-mono font-bold text-zinc-200 text-sm">
              {record.score ? `${record.score.maxHits} acertos (melhor jogo)` : "Sem apuração"}
            </span>
          </div>
          <div className="text-left sm:text-right">
            <span className="text-zinc-400 block">Custo da aposta oficial:</span>
            <span className="font-mono font-semibold text-emerald-400 text-sm">R$ 17,50</span>
          </div>
        </div>

        {/* Formulário de Premiação */}
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label
              htmlFor="prize-amount-input"
              className="block text-xs font-semibold text-zinc-200 mb-1.5"
            >
              Valor Total do Prêmio Recebido (R$):
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-sm font-mono text-zinc-400 font-semibold">
                R$
              </span>
              <input
                ref={inputRef}
                id="prize-amount-input"
                type="text"
                inputMode="decimal"
                placeholder="0,00"
                value={inputValue}
                onChange={handleInputChange}
                disabled={isLoading}
                className={`w-full pl-11 pr-4 py-3 bg-zinc-950 border rounded-xl text-zinc-100 text-base font-mono font-semibold focus:outline-hidden focus:ring-2 transition-all ${
                  inputError
                    ? "border-red-500/80 focus:ring-red-500/30"
                    : "border-zinc-700 focus:border-emerald-500 focus:ring-emerald-500/30"
                } disabled:opacity-50`}
              />
            </div>
            {inputError ? (
              <p className="mt-1.5 text-xs text-red-400 flex items-center gap-1">
                <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                <span>{inputError}</span>
              </p>
            ) : (
              <p className="mt-1.5 text-[11px] text-zinc-400">
                Digite o valor total líquido ou bruto recebido na lotérica para as 5 apostas (ex: 0,00 ou 18,00).
              </p>
            )}
          </div>

          {/* Atalhos Rápidos */}
          <div>
            <span className="text-[11px] text-zinc-400 block font-medium mb-1.5">
              Atalhos rápidos:
            </span>
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => handleSetQuickAmount(0)}
                disabled={isLoading}
                className="px-2.5 py-1 text-xs font-mono rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                R$ 0,00 (Não premiou)
              </button>
              <button
                type="button"
                onClick={() => handleSetQuickAmount(600)}
                disabled={isLoading}
                className="px-2.5 py-1 text-xs font-mono rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                R$ 6,00 (1× 11)
              </button>
              <button
                type="button"
                onClick={() => handleSetQuickAmount(1200)}
                disabled={isLoading}
                className="px-2.5 py-1 text-xs font-mono rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                R$ 12,00 (1× 12 ou 2× 11)
              </button>
              <button
                type="button"
                onClick={() => handleSetQuickAmount(1800)}
                disabled={isLoading}
                className="px-2.5 py-1 text-xs font-mono rounded-lg bg-zinc-800 hover:bg-zinc-700 text-zinc-300 border border-zinc-700 transition-colors cursor-pointer disabled:opacity-50"
              >
                R$ 18,00 (3× 11)
              </button>
            </div>
          </div>

          {/* Pré-visualização do Impacto Financeiro */}
          {parsedCents !== null && (
            <div className="p-3.5 rounded-xl bg-zinc-950/80 border border-zinc-800 text-xs space-y-2">
              <div className="flex items-center justify-between text-zinc-400">
                <span>Prêmio informado:</span>
                <span className="font-mono text-zinc-200 font-semibold">
                  {formatBRLFromCents(parsedCents)}
                </span>
              </div>
              <div className="flex items-center justify-between text-zinc-400">
                <span>Custo das 5 apostas:</span>
                <span className="font-mono text-zinc-400">- R$ 17,50</span>
              </div>
              <div className="flex items-center justify-between pt-2 border-t border-zinc-800 font-semibold">
                <span className="text-zinc-300">Resultado Líquido do Concurso:</span>
                <span
                  className={`font-mono text-sm inline-flex items-center gap-1 ${
                    netCents! > 0
                      ? "text-emerald-400"
                      : netCents! < 0
                      ? "text-rose-400"
                      : "text-zinc-300"
                  }`}
                >
                  {netCents! > 0 ? (
                    <TrendingUp className="w-3.5 h-3.5" />
                  ) : netCents! < 0 ? (
                    <TrendingDown className="w-3.5 h-3.5" />
                  ) : null}
                  <span>{formatSignedBRLFromCents(netCents!)}</span>
                </span>
              </div>
            </div>
          )}

          {/* Aviso de Imutabilidade */}
          <div className="p-3 rounded-xl bg-amber-950/30 border border-amber-500/30 text-[11px] text-amber-200/90 leading-relaxed">
            <strong>Registro Imutável:</strong> Conforme as especificações de auditoria da V1.8, após registrado o prêmio não pode ser alterado ou sobrescrito. Certifique-se de que o valor confere com o comprovante da CAIXA.
          </div>

          {/* Botões de Ação */}
          <div className="flex items-center justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onClose}
              disabled={isLoading}
              className="px-4 py-2 text-xs font-semibold text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
            >
              CANCELAR
            </button>
            <button
              type="submit"
              id="btn-confirm-record-prize"
              disabled={isLoading || parsedCents === null}
              className="px-5 py-2 text-xs font-semibold text-white bg-emerald-600 hover:bg-emerald-500 rounded-xl shadow-md transition-all inline-flex items-center gap-2 cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus:ring-2 focus:ring-emerald-400"
            >
              {isLoading ? (
                <div className="w-3.5 h-3.5 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <CheckCircle2 className="w-3.5 h-3.5" />
              )}
              <span>{isLoading ? "REGISTRANDO..." : "SALVAR PRÊMIO"}</span>
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
