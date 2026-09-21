import React, { useState } from "react";
import { X, ShieldCheck, CheckCircle2, AlertCircle, Copy, Check, Award } from "lucide-react";
import type { ContestRecord } from "../c5/types.ts";
import type { StoredContestVerification } from "../storage/types.ts";
import { formatLocalDate } from "../storage/service.ts";
import { formatBRLFromCents, formatSignedBRLFromCents } from "../utils/money.ts";
import { GamesDisplay } from "./GamesDisplay.tsx";
import { Ball } from "./Ball.tsx";

interface ContestDetailModalProps {
  isOpen: boolean;
  record: ContestRecord | null;
  onClose: () => void;
  onVerify?: (contestNumber: number) => Promise<StoredContestVerification>;
}

export const ContestDetailModal: React.FC<ContestDetailModalProps> = ({
  isOpen,
  record,
  onClose,
  onVerify,
}) => {
  const [copiedHash, setCopiedHash] = useState(false);
  const [verificationResult, setVerificationResult] = useState<StoredContestVerification | null>(null);
  const [isVerifying, setIsVerifying] = useState(false);

  if (!isOpen || !record) return null;

  const handleCopyHash = async () => {
    if (!record.integrityHash) return;
    try {
      await navigator.clipboard.writeText(record.integrityHash);
      setCopiedHash(true);
      setTimeout(() => setCopiedHash(false), 2000);
    } catch {
      // Ignorar fallback
    }
  };

  const handleRunVerify = async () => {
    if (!onVerify) return;
    setIsVerifying(true);
    try {
      const result = await onVerify(record.contestNumber);
      setVerificationResult(result);
    } finally {
      setIsVerifying(false);
    }
  };

  const isScored = record.status === "SCORED";
  const isFrozen = record.status === "FROZEN";

  const statusLabels = {
    DRAFT: "RASCUNHO",
    FROZEN: "CONGELADO",
    SCORED: "CONFERIDO",
  };

  const modalRef = React.useRef<HTMLDivElement>(null);

  React.useEffect(() => {
    if (!isOpen) return;

    // Foco inicial no modal
    const closeBtn = modalRef.current?.querySelector<HTMLButtonElement>('button[aria-label="Fechar"]');
    closeBtn?.focus();

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
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
  }, [isOpen, onClose]);

  const statusBadge = {
    DRAFT: "bg-amber-950/60 border-amber-500/40 text-amber-300",
    FROZEN: "bg-blue-950/60 border-blue-500/40 text-blue-300",
    SCORED: "bg-emerald-950/60 border-emerald-500/40 text-emerald-300",
  }[record.status];

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-6 bg-black/85 backdrop-blur-xs overflow-y-auto animate-in fade-in duration-200"
      role="dialog"
      aria-modal="true"
      aria-labelledby="contest-detail-title"
    >
      <div
        ref={modalRef}
        className="w-full max-w-3xl bg-zinc-900 border border-zinc-800 rounded-2xl shadow-2xl p-5 sm:p-7 max-h-[92vh] flex flex-col"
      >
        {/* Topo do Modal */}
        <div className="flex items-start justify-between gap-4 pb-4 border-b border-zinc-800 shrink-0">
          <div>
            <div className="flex items-center gap-2.5">
              <h2 id="contest-detail-title" className="text-xl font-bold font-mono text-zinc-100">
                CONCURSO {record.contestNumber}
              </h2>
              <span className={`text-xs px-2.5 py-0.5 rounded-full border font-mono font-semibold ${statusBadge}`}>
                {statusLabels[record.status]}
              </span>
            </div>
            <p className="text-xs text-zinc-400 mt-1">
              Registro auditável • Arquitetura {record.algorithmVersion}
            </p>
          </div>

          <button
            type="button"
            id="close-detail-modal-btn"
            onClick={onClose}
            className="p-1.5 rounded-lg text-zinc-400 hover:text-zinc-100 hover:bg-zinc-800 transition-colors"
            aria-label="Fechar modal"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Corpo com Scroll */}
        <div className="overflow-y-auto py-4 space-y-6 pr-1 grow">
          {/* Metadados Técnicos */}
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3 p-3.5 bg-zinc-950 rounded-xl border border-zinc-800/90 text-xs">
            <div>
              <span className="text-zinc-400 block">Generation ID:</span>
              <span className="font-mono text-zinc-200 break-all">{record.generationId}</span>
            </div>
            <div>
              <span className="text-zinc-400 block">Gerado em:</span>
              <span className="text-zinc-200">{formatLocalDate(record.generatedAt)}</span>
            </div>
            <div>
              <span className="text-zinc-400 block">Congelado em:</span>
              <span className="text-zinc-200">{formatLocalDate(record.frozenAt)}</span>
            </div>
            {record.betPlacedAt && (
              <div>
                <span className="text-zinc-400 block">Aposta confirmada em:</span>
                <span className="text-emerald-400 font-medium">{formatLocalDate(record.betPlacedAt)}</span>
              </div>
            )}
            {record.scoredAt && (
              <div>
                <span className="text-zinc-400 block">Pontuado em:</span>
                <span className="text-zinc-200">{formatLocalDate(record.scoredAt)}</span>
              </div>
            )}
            <div>
              <span className="text-zinc-400 block">Versão:</span>
              <span className="text-zinc-200 font-mono">{record.algorithmVersion}</span>
            </div>
            <div>
              <span className="text-zinc-400 block">Custo do Concurso:</span>
              <span className="text-zinc-200 font-mono font-medium">R$ 17,50 (5 apostas)</span>
            </div>
            {record.prize && (
              <div>
                <span className="text-zinc-400 block">Prêmio Oficial:</span>
                <span className="text-emerald-400 font-mono font-medium">
                  {formatBRLFromCents(record.prize.amountCents)}
                </span>
              </div>
            )}
            {record.prize && record.betPlacedAt && (
              <div>
                <span className="text-zinc-400 block">Resultado Líquido:</span>
                <span
                  className={`font-mono font-medium ${
                    record.prize.amountCents >= 1750 ? "text-emerald-400" : "text-rose-400"
                  }`}
                >
                  {formatSignedBRLFromCents(record.prize.amountCents - 1750)}
                </span>
              </div>
            )}
          </div>

          {/* Fechamento Financeiro Oficial (V1.8) */}
          {isScored && record.betPlacedAt && (
            <div
              className={`p-3.5 rounded-xl border text-xs ${
                record.prize
                  ? "bg-emerald-950/20 border-emerald-500/30 text-emerald-200"
                  : "bg-amber-950/20 border-amber-500/30 text-amber-200"
              }`}
            >
              <div className="flex items-center justify-between mb-1">
                <span className="font-mono font-bold uppercase tracking-wider text-[11px]">
                  {record.prize ? "Fechamento Financeiro Concluído" : "Fechamento Financeiro Pendente"}
                </span>
                {record.prize && (
                  <span className="text-[11px] text-zinc-400">
                    Registrado em {formatLocalDate(record.prize.recordedAt)} ({record.prize.source})
                  </span>
                )}
              </div>
              {record.prize ? (
                <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mt-1 text-xs">
                  <span>
                    Prêmio: <strong className="font-mono text-emerald-300">{formatBRLFromCents(record.prize.amountCents)}</strong>
                  </span>
                  <span>
                    Aposta: <strong className="font-mono text-zinc-300">R$ 17,50</strong>
                  </span>
                  <span>
                    Saldo:{" "}
                    <strong
                      className={`font-mono ${
                        record.prize.amountCents >= 1750 ? "text-emerald-400" : "text-rose-400"
                      }`}
                    >
                      {formatSignedBRLFromCents(record.prize.amountCents - 1750)}
                    </strong>
                  </span>
                </div>
              ) : (
                <p className="text-[11px] text-amber-300/80 mt-0.5">
                  Este concurso foi registrado como apostado na lotérica, mas o prêmio obtido ainda não foi registrado pelo Gerador.
                </p>
              )}
            </div>
          )}

          {/* Hash SHA-256 */}
          {record.integrityHash && (
            <div className="p-3 bg-zinc-950 rounded-xl border border-zinc-800 text-xs">
              <div className="flex items-center justify-between mb-1">
                <span className="text-zinc-400 font-medium">Hash Oficial de Congelamento (SHA-256):</span>
                <button
                  type="button"
                  onClick={handleCopyHash}
                  className="inline-flex items-center gap-1 text-[11px] text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 px-2 py-0.5 rounded transition-colors"
                >
                  {copiedHash ? <Check className="w-3 h-3 text-emerald-400" /> : <Copy className="w-3 h-3" />}
                  <span>{copiedHash ? "Copiado" : "Copiar"}</span>
                </button>
              </div>
              <div className="font-mono text-emerald-400 break-all select-all tracking-wide">
                {record.integrityHash}
              </div>
            </div>
          )}

          {/* Resultado Oficial (se SCORED) */}
          {isScored && record.officialResult && (
            <div className="p-4 rounded-xl bg-emerald-950/20 border border-emerald-500/40">
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 mb-3">
                <span className="text-xs font-semibold tracking-wider text-emerald-300 uppercase font-mono">
                  Resultado Oficial Sorteado (15 Dezenas)
                </span>
                {record.score && (
                  <div className="flex items-center gap-2">
                    <span className="text-xs text-zinc-300">Melhor Aposta:</span>
                    <span className="px-2.5 py-0.5 rounded-full bg-emerald-500/20 text-emerald-300 font-mono font-bold text-xs border border-emerald-500/40">
                      {record.score.maxHits} ACERTOS
                    </span>
                  </div>
                )}
              </div>
              <div className="flex flex-wrap gap-1.5 sm:gap-2">
                {record.officialResult.map((num) => (
                  <Ball key={`modal-res-${num}`} number={num} variant="official" size="md" />
                ))}
              </div>

              {/* Resumo de Faixas Premiadas do Concurso */}
              {record.score && (
                <div className="mt-4 pt-3 border-t border-emerald-500/20 flex flex-wrap gap-3 text-xs">
                  {record.score.prizeCounts.hits15 > 0 && (
                    <span className="inline-flex items-center gap-1 font-semibold text-emerald-300">
                      <Award className="w-3.5 h-3.5" />
                      {record.score.prizeCounts.hits15} aposta(s) com 15 acertos
                    </span>
                  )}
                  {record.score.prizeCounts.hits14 > 0 && (
                    <span className="inline-flex items-center gap-1 font-semibold text-emerald-300">
                      <Award className="w-3.5 h-3.5" />
                      {record.score.prizeCounts.hits14} aposta(s) com 14 acertos
                    </span>
                  )}
                  {record.score.prizeCounts.hits13 > 0 && (
                    <span className="inline-flex items-center gap-1 font-semibold text-emerald-300">
                      <Award className="w-3.5 h-3.5" />
                      {record.score.prizeCounts.hits13} aposta(s) com 13 acertos
                    </span>
                  )}
                  {record.score.prizeCounts.hits12 > 0 && (
                    <span className="inline-flex items-center gap-1 font-semibold text-emerald-300">
                      <Award className="w-3.5 h-3.5" />
                      {record.score.prizeCounts.hits12} aposta(s) com 12 acertos
                    </span>
                  )}
                  {record.score.prizeCounts.hits11 > 0 && (
                    <span className="inline-flex items-center gap-1 font-semibold text-emerald-300">
                      <Award className="w-3.5 h-3.5" />
                      {record.score.prizeCounts.hits11} aposta(s) com 11 acertos
                    </span>
                  )}
                  {!record.score.has11Plus && (
                    <span className="text-zinc-400 italic">
                      Nenhuma aposta com premiação (faixas 11 a 15) neste concurso.
                    </span>
                  )}
                </div>
              )}
            </div>
          )}

          {/* Os 5 Jogos Originais */}
          <div>
            <h3 className="text-sm font-semibold text-zinc-200 mb-3 flex items-center justify-between">
              <span>5 Jogos Gerados C₅</span>
              <span className="text-xs text-zinc-400 font-normal">Somente leitura</span>
            </h3>
            <GamesDisplay record={record} />
          </div>

          {/* Painel de Auditoria Individual */}
          {onVerify && (isFrozen || isScored) && (
            <div className="p-4 rounded-xl bg-zinc-950 border border-zinc-800">
              <div className="flex items-center justify-between mb-3">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-4 h-4 text-emerald-400" />
                  <h4 className="text-xs font-semibold text-zinc-200 uppercase font-mono">
                    Auditoria Criptográfica Individual
                  </h4>
                </div>
                <button
                  type="button"
                  id="btn-verify-individual"
                  onClick={handleRunVerify}
                  disabled={isVerifying}
                  className="px-3 py-1.5 text-xs font-medium bg-zinc-800 hover:bg-zinc-700 text-zinc-200 border border-zinc-700 rounded-lg transition-colors inline-flex items-center gap-1.5 disabled:opacity-50"
                >
                  {isVerifying ? (
                    <div className="w-3.5 h-3.5 border-2 border-zinc-400 border-t-zinc-100 rounded-full animate-spin" />
                  ) : (
                    <ShieldCheck className="w-3.5 h-3.5" />
                  )}
                  <span>VERIFICAR INTEGRIDADE</span>
                </button>
              </div>

              {verificationResult && (
                <div className="space-y-2 mt-3 pt-3 border-t border-zinc-800/80 text-xs">
                  <div className="flex items-center gap-2">
                    {verificationResult.valid ? (
                      <CheckCircle2 className="w-4 h-4 text-emerald-400" />
                    ) : (
                      <AlertCircle className="w-4 h-4 text-red-400" />
                    )}
                    <span className={`font-semibold ${verificationResult.valid ? "text-emerald-400" : "text-red-400"}`}>
                      {verificationResult.valid
                        ? "INTEGRIDADE DO CONCURSO CERTIFICADA COM SUCESSO"
                        : "VIOLAÇÃO DE INTEGRIDADE DETECTADA"}
                    </span>
                  </div>

                  {verificationResult.generationIntegrity && (
                    <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1">
                      <span className="font-semibold text-zinc-300 block">Integridade da Geração:</span>
                      <p className="text-zinc-400">
                        SHA-256: {verificationResult.generationIntegrity.hashMatches ? "Conferido (Intacto)" : "Divergente (Corrompido)"} • Invariantes C₅: {verificationResult.generationIntegrity.generationValid ? "Válidas" : "Inválidas"}
                      </p>
                    </div>
                  )}

                  {verificationResult.scoreIntegrity && (
                    <div className="p-2.5 rounded-lg bg-zinc-900 border border-zinc-800 space-y-1">
                      <span className="font-semibold text-zinc-300 block">Integridade da Pontuação:</span>
                      <p className="text-zinc-400">
                        Conferência de Acertos: {verificationResult.scoreIntegrity.scoreMatches ? "Exata e Autêntica" : "Inconsistente"}
                      </p>
                    </div>
                  )}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Rodapé do Modal */}
        <div className="pt-4 border-t border-zinc-800 flex justify-end shrink-0">
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 text-sm bg-zinc-800 hover:bg-zinc-700 text-zinc-200 font-medium rounded-lg border border-zinc-700 transition-colors"
          >
            Fechar
          </button>
        </div>
      </div>
    </div>
  );
};
