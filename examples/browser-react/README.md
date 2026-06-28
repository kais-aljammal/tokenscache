# TokenGuard Browser / React Usage

TokenGuard ships a browser-safe entry point at `tokenguard/browser` for client-side agents and React apps.

## Install

```bash
npm install tokenguard
```

For local development from this monorepo:

```bash
npm run build
# import from ../dist/browser.js in your bundler
```

## Import

```tsx
import {
  TokenGuard,
  TokenGuardConfigSchema,
  checkBudgetLimits,
} from "tokenguard/browser";
```

Node-only modules (`better-sqlite3`, filesystem-backed L3) are excluded from the browser bundle. Use **L1 in-memory** and **L2 IndexedDB** caches in the browser.

## Minimal React hook pattern

```tsx
import { useMemo, useRef } from "react";
import { TokenGuard } from "tokenguard/browser";

export function useTokenGuard() {
  const ref = useRef<TokenGuard | null>(null);

  return useMemo(() => {
    if (!ref.current) {
      ref.current = new TokenGuard({
        config: TokenGuardConfigSchema.parse({
          providers: { openai: { apiKey: import.meta.env.VITE_OPENAI_API_KEY } },
          cache: {
            l1: { maxEntries: 200 },
            l2: { dbName: "my-app-tokenguard", maxSizeMB: 50 },
          },
        }),
      });
    }
    return ref.current;
  }, []);
}
```

## L2 IndexedDB notes

- Cache keys are SHA-256 hashes of normalized prompts — keys are validated to prevent injection.
- Set `cache.l2.maxSizeMB` to cap storage; oldest entries evict under pressure.
- L2 is async; warm L1 on hits via `CacheRouter` (Phase 2) for sub-millisecond repeat lookups.

## Security

- **Never embed provider API keys in client bundles** for production. Prefer a backend proxy or short-lived tokens.
- IndexedDB data is origin-scoped; cached responses may contain sensitive model output — encrypt at rest if required.

## Bundler requirements

- Target **ES2022+** with `import` support (Vite, Webpack 5, esbuild).
- `@huggingface/transformers` (optional, for local embeddings) is large; use dynamic import or `HashEmbeddingService` for lightweight semantic matching in dev.

## Testing in the browser

```bash
npm run build
# serve dist/ from your app and verify L1 hits in DevTools → Application → IndexedDB
```

See the main [README](../../README.md) for full configuration reference.
