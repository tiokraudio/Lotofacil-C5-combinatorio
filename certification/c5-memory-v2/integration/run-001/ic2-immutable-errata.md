# C5-MEMORY-2.0.0 — INTEGRATION RUN 001
# ERRATA IMUTÁVEL DE CONTRATOS NORMATIVOS (IC2)

**Identificador da Run:** `C5M-INTEGRATION-RUN-001`  
**Data da Errata:** 2026-10-01T16:54:20.244Z  
**Causa Formal:** `NONDETERMINISTIC_FROZEN_AT_REGENERATION`  
**Status da Errata:** CONGELADA E AUDITADA  

---

## 1. Contexto e Motivação
Durante a revisão adversarial do relatório forense IC12, constatou-se que cinco contratos normativos estruturados em JSON no checkpoint IC2 possuíam hashes registrados no `manifest.json` divergentes dos hashes contidos nos arquivos físicos materializados e selados no ledger `checksums.sha256`.

Esta errata formaliza de maneira imutável, aditiva e transparente as quatro perspectivas criptográficas de cada contrato, comprovando que nenhum artefato foi adulterado a posteriori e que a linhagem de integração a jusante (IC3 a IC12) permaneceu 100% íntegra.

---

## 2. Inventário Quádruplo dos Contratos Afetados

| Contrato | (A) Declaração Preliminar T0 | (B) Materialização Física | (C) Selagem no Ledger | (D) Consumo a Jusante (IC3–IC12) | SAME_FILE | HISTORICAL_MATCH |
| :--- | :---: | :---: | :---: | :---: | :---: | :---: |
| **ic2-canonical-pool-prng-contract.json** | `68954cc7...` | `756e8d5d...` | `756e8d5d...` | `756e8d5d...` | **true** | **false** |
| **ic2-history-contract.json** | `7a9522a1...` | `5e0b9a15...` | `5e0b9a15...` | `5e0b9a15...` | **true** | **false** |
| **ic2-fingerprint-contract.json** | `d925aa72...` | `70dd8840...` | `70dd8840...` | `70dd8840...` | **true** | **false** |
| **ic2-draft-stale-contract.json** | `fcb69061...` | `163ad22b...` | `163ad22b...` | `163ad22b...` | **true** | **false** |
| **ic2-pool-index-contract.json** | `2b418788...` | `bb266a13...` | `bb266a13...` | `bb266a13...` | **true** | **false** |

### Hashes Completos de 64 Caracteres:
1. **Pool PRNG Contract:**
   - T0: `68954cc71222efff5a236924a1e893d0de9396026fd18c2f2038c5456668edc3`
   - Materializado / Ledger: `756e8d5d44d7bd8f616e220badf6131c8e630fa4e6ce4ab70528bac5d8ecd4f3`
2. **History Contract:**
   - T0: `7a9522a135d575b56b7b9fa9b1e195faf2bc08088d64dd19c3e3b867be5a2576`
   - Materializado / Ledger: `5e0b9a15ba6b602d48fd6401d5d94306cb4254c72f0335b97dededaa13fda5a5`
3. **Fingerprint Contract:**
   - T0: `d925aa72d056e9097a7effe54d8b9534c86d95b61034dad9c564e9cc6d923fb2`
   - Materializado / Ledger: `70dd8840edacde3f02f0cd2707bba9c668057c8b4b5af4a065886c25a8cce72b`
4. **Draft / Stale Contract:**
   - T0: `fcb690614bc9eaf41e173cf0e21fc4ca8070de50ec5284e981b693fe9d4486a6`
   - Materializado / Ledger: `163ad22b662da2d8e1a33903a3a04b50a761dc9c3b8dbbce685296f50e7dd1e8`
5. **Pool Index Contract:**
   - T0: `2b41878815c6d8275e2f73ca6827835f8e0fe968b00385c74307ad9b430b38bb`
   - Materializado / Ledger: `bb266a135a23cfd48a1783a246b5ff28f63c4ed37e0fd4fd31ccad9145cb9368`

---

## 3. Disposição Normativa
A errata comprova que:
- Não houve substituição maliciosa ou pós-fato;
- A discrepância é 100% decorrente da regeneração não determinística pelo campo `frozenAt`;
- Toda a execução de IC3 a IC12 ocorreu contra a versão materializada constante do ledger;
- Os artefatos históricos permanecem byte a byte preservados.
