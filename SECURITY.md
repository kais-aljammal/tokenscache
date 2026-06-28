# Security Policy

## Supported versions

| Version | Supported |
|---------|-----------|
| 1.0.x   | Yes       |

## Reporting a vulnerability

**Do not open public GitHub issues for security vulnerabilities.**

Report vulnerabilities via [GitHub Security Advisories](https://github.com/kais-aljammal/tokenscache/security/advisories/new) (preferred). Do not open public issues for security reports.

Include:

- Description of the issue and impact
- Steps to reproduce
- Affected versions and configuration
- Suggested fix (if any)

We aim to acknowledge reports within 72 hours.

## Security practices

### API keys

- Store provider API keys in environment variables or secret managers — never commit them.
- Browser integrations should use a backend proxy; do not ship production keys in client bundles.

### Cache data

- Cached LLM responses may contain sensitive content. Treat SQLite and IndexedDB files as confidential.
- L2 cache keys are SHA-256 hashes with validation to reduce injection risk.

### Dependencies

- All source-repo licenses are audited in [docs/license-audit.md](docs/license-audit.md).
- Run `npm audit` periodically; optional native deps (`better-sqlite3`) require platform-specific builds.

### Pricing and budget

- `config/pricing.json` is a snapshot — run `npm run sync-pricing` to verify freshness (30-day threshold).
- Budget limits are advisory unless `action: "block"` is configured.

## License boundary

Code from **vCache** (CC BY-NC-ND) and **token-optimizer** (PolyForm Noncommercial) must not be copied into this repository. Patterns-only reimplementation is documented in the license audit.

## License compliance

Third-party license review is documented in [docs/license-audit.md](docs/license-audit.md).
