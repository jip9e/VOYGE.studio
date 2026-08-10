# Security Policy

## Reporting a Vulnerability

If you discover a security vulnerability in VOYGE.studio, please report it responsibly:

1. **Do not** open a public GitHub issue for security vulnerabilities.
2. Email the maintainer directly or open a private GitHub security advisory.
3. Include a description of the vulnerability and steps to reproduce.

## Secrets & API Keys

This repository uses several external API keys. **Never commit real API keys.**

- All secrets must be stored in `.env.local` (git-ignored).
- See `.env.example` for the full list of required environment variables.
- The Firebase client config in `src/lib/firebase.ts` contains only **public project identifiers** — these are safe to commit. See [Firebase docs](https://firebase.google.com/docs/projects/api-keys) for why.

## Supported Versions

| Version | Supported |
|---------|-----------|
| 1.x     | ✅ Yes    |

## Dependencies

Keep dependencies up to date with `npm audit` and `npm update` regularly.