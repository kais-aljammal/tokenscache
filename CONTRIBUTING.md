# Contributing to TokensCache

Thank you for your interest in contributing. TokensCache is an MIT-licensed SDK for AI token optimization — we welcome bug fixes, tests, and documentation improvements.

## Development setup

```bash
git clone https://github.com/kais-aljammal/tokenscache.git
cd tokenscache
npm install
npm run typecheck
npm test
npm run build
```

Requires **Node.js 20+**.

## Project structure

| Path | Purpose |
|------|---------|
| `src/core/cache/` | L1/L2/L3 cache, semantic matching, cache router |
| `src/core/optimizer/` | Tool pruning, history compression, output shaping |
| `src/core/budget/` | Pricing, ledger, enforcer, model router |
| `src/core/providers/` | OpenAI, Anthropic, Gemini adapters |
| `scripts/` | Bench, audit, pricing sync utilities |
| `tests/unit/` | Unit tests by module |
| `tests/integration/` | End-to-end agent task scenarios |
| `docs/` | License audit |

## Making changes

1. **Fork and branch** — use descriptive branch names (`fix/l3-eviction`, `docs/readme-config`).
2. **Match existing style** — TypeScript strict mode, minimal scope, no unrelated refactors.
3. **Add tests** when fixing bugs or adding behavior in `src/`.
4. **Run checks** before opening a PR:

   ```bash
   npm run typecheck
   npm test
   npm run build
   ```

5. **License compliance** — read [docs/license-audit.md](docs/license-audit.md). Do not port code from CC BY-NC-ND or PolyForm Noncommercial sources.

## Pull request guidelines

- One logical change per PR when possible.
- Include a clear description and test plan.
- Update README if you change public API or config schema.
- Do not commit secrets, API keys, or local database files.

## Optional dependencies

Heavy deps (`@huggingface/transformers`, `usearch`, provider SDKs) are optional. Tests should pass without them using `HashEmbeddingService` and mocks.

## Questions

Open a GitHub issue for design questions before large refactors. For security concerns, see [SECURITY.md](SECURITY.md).
