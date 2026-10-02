import React from "react";
import type { ContestRepository } from "../storage/contestRepository.ts";
import { C5MemoryView } from "./C5MemoryView.tsx";

export interface GeneratorViewProps {
  onRecordUpdated?: () => void;
  repository?: ContestRepository;
  initialContestNumber?: number;
}

/**
 * Visualização do Gerador Oficial C5.
 * A partir da etapa UI-1C, utiliza EXCLUSIVAMENTE a arquitetura C5-Memory para novas apostas.
 * Toda a geração ativa do legado C5-1.0.0 foi definitivamente removida da experiência ativa.
 */
export const GeneratorView: React.FC<GeneratorViewProps> = ({
  onRecordUpdated,
  repository,
  initialContestNumber,
}) => {
  return (
    <C5MemoryView
      onRecordUpdated={onRecordUpdated}
      repository={repository}
      initialContestNumber={initialContestNumber}
    />
  );
};
