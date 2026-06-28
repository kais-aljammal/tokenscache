# TokensCache License Audit

**Audit date:** 2026-06-29  
**Auditor role:** Security Reviewer (Phase 1, blocking gate)  
**Status:** Complete — zero unresolved flags

## Summary

| Repo | SPDX / License Found | Determination | Notes |
|------|---------------------|---------------|-------|
| [zilliztech/GPTCache](https://github.com/zilliztech/GPTCache) | **MIT** | **COPY-ALLOWED** | PRD stated Apache 2.0; actual LICENSE is MIT. Both are permissive. Extract eviction-policy and cache-manager patterns. |
| [vcache-project/vCache](https://github.com/vcache-project/vCache) | **CC BY-NC-ND 3.0** | **PATTERNS-ONLY — NO COPY** | NonCommercial + NoDerivatives. Cannot port source into MIT TokensCache. v1.1 `VerifiedDecisionPolicy` must be reimplemented from published paper (arXiv:2502.03771), not from repo code. |
| [AgentBudget/agentbudget](https://github.com/AgentBudget/agentbudget) | **Apache-2.0** | **PATTERNS-ONLY** | Python-only. No TypeScript to port. Design session/ledger/budget-enforcement pattern in TS from understanding. |
| [messkan/prompt-cache](https://github.com/messkan/prompt-cache) | **MIT** | **PATTERNS-ONLY** | Go server. Study dual-layer hash+semantic architecture; reimplement in TypeScript. |
| [chopratejas/headroom](https://github.com/chopratejas/headroom) | **Apache-2.0** | **COPY-ALLOWED (dependency)** | Confirmed in-repo and on npm (`headroom-ai@0.22.4` → Apache-2.0). Use as runtime dependency for compression primitives. |
| [muratcankoylan/Agent-Skills-for-Context-Engineering](https://github.com/muratcankoylan/Agent-Skills-for-Context-Engineering) | **MIT** | **PATTERNS-ONLY** | Documentation/skills collection, not a code library. |
| [alexgreensh/token-optimizer](https://github.com/alexgreensh/token-optimizer) | **PolyForm Noncommercial 1.0.0** | **PATTERNS-ONLY — NO COPY** | Confirmed restrictive. Study compaction timing, quality scoring concepts only. Do not paste, port, or closely paraphrase source. |
| [pleasedodisturb/awesome-llm-token-optimization](https://github.com/pleasedodisturb/awesome-llm-token-optimization) | **CC BY 4.0** | **REFERENCE-ONLY** | Curated link list. Attribution if cited in README; no code extraction. |

## npm Runtime Dependencies (checked 2026-06-29)

| Package | License | Determination |
|---------|---------|---------------|
| `headroom-ai@0.22.4` | Apache-2.0 | ALLOWED — direct runtime dependency |
| `@huggingface/transformers` | Apache-2.0 | ALLOWED |
| `usearch` | Apache-2.0 | ALLOWED |
| `better-sqlite3` | MIT | ALLOWED |
| `sql.js` | MIT | ALLOWED |
| `idb` | ISC | ALLOWED |

## Security Reviewer Sign-off

- **[SECURITY-OK]** All primary source repos audited against actual LICENSE files (not PRD assumptions).
- **Reclassification applied:** vCache downgraded from "verify at clone" to **PATTERNS-ONLY** due to CC BY-NC-ND 3.0 (more restrictive than assumed).
- **Reclassification applied:** GPTCache corrected from Apache 2.0 to MIT (still COPY-ALLOWED).
- **Reclassification applied:** token-optimizer confirmed PolyForm Noncommercial — NO COPY.

No unresolved flags. Phase 1 may proceed with code extraction per determinations above.
