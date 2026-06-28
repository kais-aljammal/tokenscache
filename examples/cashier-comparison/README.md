# Cashier comparison example

Side-by-side demo: a mock coding agent building a TypeScript POS system **with** vs **without** TokenGuard.

## Run

```bash
npm run cashier-compare
```

Output is written to `results/` (gitignored):

- `comparison.json` — token/call savings and quality scores
- `with-tokenguard/` and `without-tokenguard/` — generated code artifacts

No API keys required — uses `MeteredMockProvider` with realistic token metering.

## What it proves

- Duplicate and paraphrased agent prompts hit the cache when `agentArtifactScope` is enabled
- Output artifacts are identical with and without TokenGuard
- Typical savings: ~35% tokens, ~37% fewer upstream LLM calls

For automated proof across 10 task types, see `tests/integration/agent-tasks.test.ts`.
