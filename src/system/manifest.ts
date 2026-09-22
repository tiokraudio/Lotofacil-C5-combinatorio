/**
 * Manifesto Canônico de Integridade e Estrutura da Aplicação (C₅ Lotofácil).
 *
 * Expõe as versões oficiais em execução e os certificados matemáticos
 * combinatórios imutáveis do motor C₅.
 *
 * IMPORTANTE:
 * O manifesto é exclusivamente descritivo. O validador (validator.ts)
 * e o motor (generator.ts) não dependem desta camada ('system').
 * A camada system pode depender de c5.
 * O núcleo c5 nunca depende de system.
 */
import { C5_SLOTS } from "../c5/constants.ts";
import { C5_ALGORITHM_VERSION } from "../c5/version.ts";

export const APP_VERSION = "1.9.0";
export const APP_NAME = "Lotofácil C5 Combinatório";

export interface StructuralCertificates {
  readonly gameCount: 5;
  readonly gameSize: 15;
  readonly numbers: 25;
  readonly occurrencesPerNumber: 3;
  readonly pairwiseIntersections: readonly [
    7, 7, 7, 7, 7,
    8, 8, 8, 8, 8
  ];
  readonly coverage11Plus: 1626630;
  readonly coverage12Plus: 297380;
  readonly coverage13Plus: 24380;
  readonly coverage14Plus: 755;
  readonly coverage15: 5;
  readonly totalCombinations: 3268760;
}

export interface ApplicationManifest {
  appName: string;
  appVersion: string;
  algorithmVersion: string;
  backupSchemaVersion: 3;
  canonicalSlots: readonly string[];
  structuralCertificates: StructuralCertificates;
}

export const APPLICATION_MANIFEST: ApplicationManifest = {
  appName: APP_NAME,
  appVersion: APP_VERSION,
  algorithmVersion: C5_ALGORITHM_VERSION,
  backupSchemaVersion: 3,
  canonicalSlots: C5_SLOTS,
  structuralCertificates: {
    gameCount: 5,
    gameSize: 15,
    numbers: 25,
    occurrencesPerNumber: 3,
    pairwiseIntersections: [
      7, 7, 7, 7, 7,
      8, 8, 8, 8, 8,
    ],
    coverage11Plus: 1626630,
    coverage12Plus: 297380,
    coverage13Plus: 24380,
    coverage14Plus: 755,
    coverage15: 5,
    totalCombinations: 3268760,
  },
} as const;
