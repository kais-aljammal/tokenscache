# Cashier comparison example

Side-by-side demo: a mock coding agent building a TypeScript POS system **with** vs **without** TokensCache.

## Run

```bash
npm run cashier-compare
```

Output is written to `results/` (gitignored):

- `comparison.json` — token/call savings and quality scores
- `with-tokenscache/` and `without-tokenscache/` — generated code artifacts

No API keys required — uses `MeteredMockProvider` with realistic token metering.

## What it proves

- Duplicate and paraphrased agent prompts hit the cache when `agentArtifactScope` is enabled
- Output artifacts are identical with and without TokensCache
- Typical savings: ~35% tokens, ~37% fewer upstream LLM calls

For automated proof across 10 task types, see `tests/integration/agent-tasks.test.ts`.
