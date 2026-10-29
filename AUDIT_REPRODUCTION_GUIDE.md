# GUIA DE REPRODUÇÃO TÉCNICA E AUDITORIA INDEPENDENTE
## C5-Memory 2.1.0 — UI 2.0 e Camada de Aplicação

Este guia fornece instruções determinísticas para que uma equipe ou IA coordenadora independente possa extrair, instalar, auditar, testar e executar a aplicação C5-Memory 2.1.0 a partir do pacote auditável.

---

### 1. Requisitos do Sistema

- **Node.js:** Versão `>= 20.0.0` (Ambiente homologado: `v22.23.4`).
- **Gerenciador de Pacotes:** `npm` `>= 9.0.0` (Ambiente homologado: `10.9.9`) ou `bun` `>= 1.1.0`.
- **Sistema Operacional:** Linux, macOS ou Windows (com suporte a ESM/POSIX).

---

### 2. Extração do Pacote de Auditoria

O pacote compactado oficial localiza-se em:
`/app/applet/public/c5-memory-ui2-audit-package.tar.gz`

Para extrair em um diretório limpo de auditoria:

```bash
mkdir -p /tmp/c5-memory-audit
tar -xzf /app/applet/public/c5-memory-ui2-audit-package.tar.gz -C /tmp/c5-memory-audit
cd /tmp/c5-memory-audit
```

---

### 3. Instalação de Dependências

No diretório extraído, execute:

```bash
npm ci
# ou: npm install
```

---

### 4. Execução dos Testes Automatizados

O projeto utiliza `tsx` para execução de testes TypeScript sem etapa prévia de transpilação:

```bash
# 1. Suíte de Verificação das Correções Bloqueantes de Auditoria (Blocos 1 ao 8.20 completos)
npx tsx src/c5-memory/testing/auditFixesVerification.test.ts

# 2. Suíte Integrada do Ciclo de Vida da Aplicação (UI 2.0)
npx tsx src/c5-memory/testing/integratedApplicationLifecycle.test.ts

# 3. Suíte de Hardening e Compatibilidade Semântica (2.0.0 e 2.1.0)
npx tsx src/c5-memory/testing/hardeningVerificationSuite.test.ts

# 4. Suíte de Analytics e Integridade do Painel (UI-1D)
npx tsx src/c5-memory/analytics/tests/ui1dAnalytics.test.ts

# 5. Suíte de Validação de Regras de Negócio e Entrega
npx tsx src/c5-memory/testing/applicationDeliveryValidation.test.ts

# 6. Suíte de Dupla Persistência e Controles Negativos
npx tsx src/storage/tests/crossStoreIntegrity.test.ts

# 7. Controles Negativos Adicionais
npx tsx src/c5-memory/testing/recert02IC0NegativeControls.test.ts
```

*Todos os comandos acima foram executados com saída de código 0 (PASS).*

---

### 5. Verificação de Tipagem Estrita e Compilação

Para auditar que não há erros de tipagem TypeScript ou imports ausentes:

```bash
# Verificação estrita sem emissão
npx tsc --noEmit

# Compilação de Produção com Vite
npm run build
```

---

### 6. Execução da Aplicação Local

Para iniciar o servidor de desenvolvimento:

```bash
npm run dev
```

A aplicação estará acessível em: `http://localhost:3000`.

---

### 7. Verificação dos Principais Fluxos na Interface

1. **Painel Operacional (`/` ou aba "Painel"):**
   - Inicialização limpa: a base de produção inicia zerada (0 concursos fictícios, R$ 0,00 de custo, saldo e prêmios).
   - Dados de demonstração são puramente opt-in através do botão "Carregar Demonstração", devidamente isolados da base canônica e identificados visualmente por banner âmbar.
   - Tarifas e prêmios oficiais da Lotofácil (Caixa Econômica Federal):
     * Aposta simples (15 dezenas): R$ 3,50 (regras 2025/2026) / R$ 3,00 (regras históricas 2024)
     * Conjunto C5 (5 apostas): R$ 17,50 por concurso (regras 2025/2026) / R$ 15,00 (regras 2024)
     * Prêmios fixos: 11 acertos (R$ 7,00 / R$ 6,00), 12 acertos (R$ 14,00 / R$ 12,00), 13 acertos (R$ 35,00 / R$ 30,00) por aposta premiada
     * Prêmios variáveis: 14 e 15 acertos tratados estritamente como Rateio Pendente até confirmação documental oficial, sem inventar valores fictícios.
   - Card de Próxima Ação recomendada (ex: gerar aposta para concurso disponível).
   - Tabela de distribuição completa 0..15 (a soma fecha exatamente no total de jogos apurados).
   - Balanço financeiro consolidado e ROI explicitado.
2. **Gerador C5-Memory (Aba "Gerador C5"):**
   - Clicar em "Gerar C5 (Memory-2.1.0)".
   - Observar a transição para `PREVIEW` com avaliação de K=500 candidatos e perfil MAX-LEXIMIN.
   - Clicar em "Confirmar e Congelar Aposta (SHA-256)".
   - Observar o status `FROZEN`, o hash SHA-256 gerado e os botões "Copiar Jogos", "Baixar TXT" e "Imprimir".
3. **Conferência Oficial (Aba "Conferência"):**
   - Selecionar o concurso congelado ou apurado.
   - Selecionar 15 dezenas no grid de 25 bolas (ou clicar em "Buscar Resultado Online").
   - Campo explícito para identificação do conferente/operador (`operatorId`) e checkbox mandatório de confirmação humana.
   - Clicar em "Salvar Apuração Oficial".
   - Conferir a indicação correta da procedência (`API_TERCEIROS`, `API_LOTERIAS` ou `MANUAL_CONFERENCE`). APIs intermediárias de terceiros são estritamente categorizadas como `API_TERCEIROS`, nunca como API Caixa Oficial.
   - Rateios de 14 e 15 acertos são mantidos como `pendingRateio: true` e não compõem prêmio confirmado até homologação comprovada.
   - Tratamento financeiro de rateios mistos:
     * Concurso 3104 (vetor de acertos [15, 14, 13, 11, 9]): Preserva integralmente R$ 36,00 em prêmios fixos oficiais históricos confirmados (R$ 30,00 por 13 acertos + R$ 6,00 por 11 acertos), R$ 1.200,00 de prêmio com confirmação manual auditada para 14 acertos (`MANUAL_ENTRY`), e R$ 500.000,00 para 15 acertos informados preliminarmente, porém estritamente pendentes de comprovação oficial (`pendingRateio: true`), excluídos do total auditado confirmado (R$ 1.236,00), do saldo oficial (+R$ 21,00) e do saldo consolidado (+R$ 1.221,00). Custo histórico preservado em R$ 15,00.
     * Concurso 3100 (vetor [15, 13, 12, 11, 10]): Preserva integralmente R$ 48,00 em prêmios fixos históricos confirmados (R$ 30,00 por 13 + R$ 12,00 por 12 + R$ 6,00 por 11). A aposta de 15 acertos permanece pendente de rateio (`pendingRateio: true`). Saldo líquido confirmado: +R$ 33,00 (R$ 48,00 - R$ 15,00); ROI confirmado: +220,00%. Distingue-se expressamente de concursos com apenas 15 acertos isolados sem bilhetes fixos (que confirmam R$ 0,00 até homologação).
   - Recálculo Autoritativo e Imunidade a Acertos Persistidos Inconsistentes (`getAuthoritativeHits`):
     * Valida rigorosamente que apostas e resultado contêm 15 dezenas inteiras, únicas e no intervalo [1, 25].
     * Na presença de qualquer invalidade, retorna erro estrito (`MISSING_GAMES`, `INVALID_GAME_STRUCTURE`, `MISSING_OFFICIAL_RESULT`, `INVALID_OFFICIAL_RESULT_STRUCTURE`, `UNVERIFIED_PROVENANCE`, `UNCONFIRMED_THIRD_PARTY_RESULT`, `UNCONFIRMED_MANUAL_RESULT`, `UNCONFIRMED_RESULT`), nunca recorrendo a dados persistidos adulterados.
   - Validação documental rigorosa e isolamento estrito de fixtures (`verifyOfficialCaixaProof`):
     * Fixtures históricas (`isFixture === true`): sumariamente rejeitadas por `verifyOfficialCaixaProof()` com código `HISTORICAL_FIXTURE_REJECTED`. O repositório canônico de fixtures (`CAIXA_HISTORICAL_FIXTURE_REGISTRY`) destina-se exclusivamente a testes automatizados com mocks.
     * Repositório Oficial de Produção (`CAIXA_OFFICIAL_PROOF_REGISTRY`): inicializado estritamente como objeto congelado vazio (`Object.freeze({})`). Provas oficiais autênticas nunca são criadas de forma estática no código-fonte.
     * Autenticação Documental: a ausência de infraestrutura externa independente com validação de assinatura digital ICP-Brasil classifica qualquer documento de portal como `OFFICIAL_SOURCE_RETRIEVED_UNVERIFIED`, mantendo o rateio de 14 e 15 acertos estritamente PENDENTE (`pendingRateio: true`).
     * Fixtures em `prizeBreakdown`: nunca inflam `totalPrize`, saldo ou ROI confirmados.
     * Tentativas de elevação indevida (ex: adulteração local de `isFixture: false` ou `isAutonomousOriginProven: true`) são sumariamente barradas (`UNVERIFIED_OFFICIAL_CLAIM`).
     * Entradas manuais válidas operam legitimamente sob `MANUAL_ENTRY` com operador e data de conferência, sem qualquer confusão com prova oficial da Caixa.
   - Bloqueio Transacional Pré-Persistência e Homologação Financeira (`scoreContestAtomic210`):
     * Para resultados de intermediários de terceiros (`API_TERCEIROS`, `API_LOTERIAS`) e conferência manual (`MANUAL_CONFERENCE`), a transação no IndexedDB valida prévia e atomicamente antes de qualquer escrita ou homologação:
       1. `resultConfirmed === true` na operação atual (`options`), sem aceitar silenciosamente flags antigas do registro;
       2. `resultConfirmedBy` não nulo, não vazio após `trim()`;
       3. `resultConfirmedAt` string ISO 8601 com formato rigoroso e timestamp numérico válido;
       4. Cada uma das 15 dezenas do resultado oficial deve ser inteira no intervalo [1, 25] sem repetição;
       5. Cada aposta no concurso deve ser validada por `validateLotofacilBet` (exatamente 15 dezenas inteiras [1..25] sem duplicatas);
       6. **Distinção Explícita de Estado Financeiro**: Se o resultado não estiver homologado (`resultConfirmed !== true` ou metadados ausentes), o concurso é gravado com status `COMPLETED`, porém com `financialStatus: "PENDING_HOMOLOGATION"` (em oposição a `"HOMOLOGATED"`), `hasPendingVariableRateio: true`, `resultConfirmed: false`, `totalPrize = 0.00` e cada faixa premiada no breakdown com `pendingRateio: true`, `unitValue: undefined` e `totalValue: 0.00`. Nenhum prêmio (nem fixo nem variável) é somado ao balanço confirmado. Quando devidamente homologado posteriormente, transiciona para `financialStatus: "HOMOLOGATED"` preservando o custo histórico sem qualquer duplicação;
       7. **Vínculo Mandatório de Identificadores**: Para cada entrada manual de rateio (`MANUAL_ENTRY`), exige obrigatoriamente `contestNumber === contestNumber` do concurso em apuração e `tier === h` correspondendo à faixa exata. Campos ausentes, `undefined`, tipos incorretos ou divergências são categoricamente rejeitados com rollback total. O valor financeiro é estritamente recalculado a partir das apostas reais (`count * validatedUnitValue`), sem confiar em `totalValue`, `count` ou `totalPrize` legados;
       8. **Eliminação de Rota Alternativa**: A rota legada `options.prizeValues[h]` para faixas variáveis de rateio é categoricamente rejeitada (`LEGACY_PRIZE_VALUES_REJECTED`), exigindo submissão pelo canal validado com metadados completos;
       9. **Auditoria Transacional no Mesmo Store**: Toda operação bem-sucedida de `scoreContestAtomic210()` grava um evento de auditoria no store `auditEvents` na mesma transação IndexedDB (`["contests", "auditEvents"]`). Em caso de falha ou abortamento (`tx.abort()`), ambos os stores sofrem rollback atômico e nada é persistido;
       10. **Validação Estrita de ISO 8601**: Validação por expressão regular rigorosa (`^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?(Z|[+-]\d{2}:\d{2})$`) além de verificação de timestamp numérico válido em `Date.parse()`.
     * `isHumanConferenceValid()` é exportada como função canônica única compartilhada entre persistência e analytics.
     * **Semântica Formal de `financialStatus: "HOMOLOGATED"` vs Rateio Pendente**:
       `financialStatus: "HOMOLOGATED"` certifica exclusivamente que as 15 dezenas sorteadas foram verificadas e conferidas por operador humano autêntico com timestamp válido. A liquidação de rateios variáveis é governada por indicadores dedicados e independentes: `hasPendingVariableRateio: boolean` e `hasPendingOfficialProof: boolean`.
4. **Histórico de Concursos (Aba "Histórico"):**
   - Filtrar por status ("Todos", "Em andamento", "Apurados") ou por mês (YYYY-MM).
   - Toggle para visualização opcional de registros de demonstração (ocultos por padrão).
   - Clicar em "Exportar CSV" para baixar planilha com dados contábeis.
   - Clicar em "Copiar Relatório" para copiar demonstrativo em formato texto para clipboard.
5. **Auditoria Criptográfica (Aba "Auditoria"):**
   - Clicar em "Recalcular Auditoria".
   - Observar a recomputação do hash SHA-256 de todas as apostas em banco e conferência da memória cumulativa H.

---

### 8. Hashes Criptográficos Oficiais (SHA-256) — Décima Sexta Rodada de Auditoria

| Arquivo / Artefato | Tamanho (Bytes) | SHA-256 Oficial |
| :--- | :--- | :--- |
| `src/storage/storageManager210.ts` | 62.603 | `d95510e8fa37cf8e5c96eab20d3ebf3f5748c457e77062f612ea2b41cc5055c9` |
| `src/c5-memory/types.ts` | 6.971 | `71edbbfe5792f9f8a7d5d247b4ff7428c940683cbb204d65a36d5c8aa80c7f8d` |
| `src/c5-memory/analytics/types.ts` | 5.086 | `73df427a14abb98e703ae344c72046e3c4dd6cd3a9a25b4253d72ea7a120a25b` |
| `src/c5-memory/analytics/c5Analytics.ts` | 43.360 | `ab8cbb0313d5a5e5193c1fada03306941e996ac2fc77cdbab752635a482465e1` |
| `src/components/C5DashboardView.tsx` | 49.498 | `5b273f710c1e1f05b3386612bdf732da4cefcebd80c542de5dea9b7475ada71d` |
| `src/components/HistoryView.tsx` | 36.562 | `5dfd47879ec1f46b1c4aefa161e391dbd3b51f51a8a6d07ec4125f260245b6d9` |
| `src/c5-memory/testing/isolatedTestProofHarness.ts` | 29.291 | `a7fe77cba50f2ec4f41dd8b20bfa66dd1c6120c3b9641d5239af01018c12f679` |
| `src/c5-memory/testing/auditFixesVerification.test.ts` | 373.370 | `05e975fe0cc1012d2cea4d88eee39ea562a4fd23c2880e8b6a212ac93a8cdaef` |
| `public/c5-memory-ui2-audit-package.tar.gz` | 321.891 | `6423bb9d6d325a584f30a7c572f6a129d530115afd210bda56fd45c05eb0f51f` |
| `public/c5-memory-ui2-audit-manifest.json` | 21.406 | `521faebed50661fc9c8635d069d570b93d916fb8fa0bd9b02014e02ff56756aa` |

---

### 9. Diferenciação de Ambientes e Distinção entre Testes

- **Testes Executados no Ambiente Original:**
  1. `auditFixesVerification.test.ts` (Blocos 1 ao 8.20 completos):
     - **Bloco 8.18:** Teste 8.18.1 atacando todas as 9 funções de produção para injeção de registros e Testes 8.18.2 a 8.18.11 cobrindo a Matriz Completa de 10 Cenários Financeiros (com Teste 8.18.6 reproduzindo exatamente o Concurso Histórico 3104 com R$ 36,00 fixo, R$ 1.200,00 manual auditado e R$ 500.000,00 pendente em 15 acertos, provando imunidade e anti-contaminação).
     - **Bloco 8.19:**
       * **Teste 8.19.1:** Ciclo de vida completo de persistência (Criação FROZEN -> Apuração scoreContestAtomic210 -> Commit atômico -> Recarga do banco -> Recálculo financeiro -> Re-apuração com allowCorrection -> Relatório Mensal -> Exportação CSV -> Cópia texto formatada), validando as 9 condições invariantes através de todas as etapas.
       * **Teste 8.19.2:** Demonstração formal de que `financialStatus: "HOMOLOGATED"` reflete a conferência humana válida das dezenas sorteadas, enquanto rateios variáveis pendentes são regidos pelo indicador dedicado e independente `hasPendingVariableRateio: boolean`.
       * **Teste 8.19.3:** Bateria de testes adversariais e de conflito (conflito prizeBreakdown vs confirmedVariablePrizes com prevalência canônica e sem dupla contagem; prêmio astronômico não homologado de R$ 100.000.000,00 mantendo total confirmado em zero; record.totalPrize corrompido de R$ 7.777.777,00 ignorado e recalculado a partir das apostas reais; prova oficial com contestNumber divergente rejeitada; entrada manual com falhas de operador, timestamp ou notas rejeitada; segregação estrita multi-faixas 11 a 15; registros legados tratados com defaults seguros).
     - **Bloco 8.20 (Décima Sexta Rodada):**
       * **Teste 8.20.1 (Caso 1):** Registro legado sem qualquer prêmio variável (apenas 11, 12, 13 acertos e sem acertos) validado como encerrado e financeiramente consolidado (`hasPendingVariableRateio: false`, R$ 48,00 de prêmios fixos, saldo +R$ 33,00, ROI +220,0%).
       * **Teste 8.20.2 (Caso 2):** Registro legado com `prizeBreakdown` indicando rateio pendente sem flag `hasPendingVariableRateio` no topo deriva dinamicamente a pendência (`hasPendingVariableRateio: true`, prêmios confirmados R$ 0,00).
       * **Teste 8.20.3 (Caso 3):** Registro legado com valor variável informado (R$ 1.500,00) sem prova nem auditoria: preservado em `manualInformedPrize` (R$ 1.500,00) e excluído de `manualConfirmedPrize`, `totalAuditedPrize` e de saldo/ROI confirmados.
       * **Teste 8.20.4 (Caso 4):** Registro legado com `pendingRateio` ausente ou indefinido em faixa com bilhete premiado adota postura conservadora derivando `hasPendingVariableRateio: true`.
       * **Teste 8.20.5 (Caso 5):** Registro legado com campos parcialmente preenchidos ou corrompidos (`totalPrize: 77777`, `officialConfirmedPrize: 999`) é reconciliado autoritativamente sem contaminação.
       * **Teste 8.20.6 (Contratos e Assinaturas):** Verificação rigorosa dos contratos de `verifyOfficialCaixaProof`, `validateRateioConfirmation`, `calculateContestFinancialBreakdown`, `calculateContestPrize` e `calculateContestOfficialPrize`. Rejeição por concurso incorreto (`PROOF_CONTEST_MISMATCH`), faixa incorreta (`PROOF_TIER_MISMATCH`), valor divergente (`RATEIO_PROOF_VALUE_MISMATCH`), valores não-finitos ou strings (`INVALID_MONETARY_VALUE`) e faixas não-variáveis (`INVALID_VARIABLE_TIER`).
       * **Teste 8.20.7 (Matriz de Consistência por Fluxo):** Concurso Histórico 3104 confrontado entre os 8 fluxos (Cálculo Financeiro, Funções de Prêmio, Persistência, Painel, Histórico, Relatório Mensal, Exportação CSV e Relatório Textual), comprovando identidade matemática e custo de R$ 15,00 em todos os fluxos.
     - **Resultado:** **EXECUTADO (PASS, 100% de sucesso, código de retorno 0)**
  2. `integratedApplicationLifecycle.test.ts` (Blocos 1 ao 5 completos) — **EXECUTADO (PASS, código 0)**
  3. `hardeningVerificationSuite.test.ts` (Testes 1 ao 4) — **EXECUTADO (PASS, código 0)**
  4. `applicationDeliveryValidation.test.ts` (Testes 1 ao 4) — **EXECUTADO (PASS, código 0)**
  5. `recert02IC0NegativeControls.test.ts` (Controles Negativos 1 ao 8) — **EXECUTADO (PASS, código 0)**
  6. `npx tsc --noEmit` (tipagem estrita TypeScript sem erros) — **EXECUTADO (PASS, 0 erros)**
  7. `npm run build` (build Vite de produção com verificação de tree-shaking do test harness: 0 ocorrências em `dist/assets/*.js`) — **EXECUTADO (PASS, compilação bem-sucedida)**

- **Testes Apenas Preparados (E2E de Navegador e Auditoria Independente Externa):**
  - Testes E2E com navegador real automatizado (Puppeteer / Playwright) continuam **apenas preparados**, pois o ambiente de sandbox não dispõe de binários de navegador (`chromium` / `google-chrome`). Toda a validação da camada web foi realizada via montagem de componentes React, testes de ciclo de vida e renderização de DTOs.
  - **AVISO FORMAL DE AUDITORIA: STATUS OBRIGATÓRIO — AUDITORIA ABERTA.** A auditoria independente **NÃO foi declarada encerrada** por este agente. As declarações deste relatório constituem evidências técnicas submetidas e a auditoria externa permanece **ABERTA** para validação e conferência autônoma pela equipe independente a partir do pacote e manifesto criptografados disponibilizados para transferência manual.

- **Limitação de Oráculo ICP-Brasil:**
  - A homologação autônoma de fontes externas oficiais Caixa depende de verificação criptográfica de cadeia de confiança ICP-Brasil que não existe localmente; por esse motivo de integridade, rateios oficiais sem prova externa verificada permanecem estritamente identificados como pendentes (`hasPendingVariableRateio: true`), confirmando R$ 0,00 no saldo e ROI oficial até comprovação documental independente ou registro manual auditado.
