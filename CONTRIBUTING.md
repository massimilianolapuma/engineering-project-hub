# Contributing

Thanks for your interest in Engineering Project Hub!

## Getting started

```bash
npm ci
npm run collect:mock && npm run dev
```

Requirements and commands are in the [README](README.md) ([Italiano](README.it.md)).

## Workflow

1. Open an issue to discuss significant changes first.
2. Branch from `main`: `feat/<short-description>`, `fix/<…>`, `docs/<…>`, `chore/<…>`.
3. Use [Conventional Commits](https://www.conventionalcommits.org/) for commits and PR titles
   (`type(scope): subject`, `!` for breaking changes). The PR title is checked in CI and becomes
   the squash-merge message.
4. Keep CI green: `npm run lint`, `npm run format:check`, `npm run typecheck`, `npm test`,
   `npm run build` (mock data + output secret scan), `npm run test:e2e` for UI changes.
5. Update `CHANGELOG.md` (`[Unreleased]`) and the EN **and** IT docs/UI strings together.

## Rules of the road

- **Read-only by design**: never add calls that write to repositories, alerts or workflows.
- **Security first**: publish only through the strict snapshot schemas; no raw API payloads,
  secret values, logs, headers or stack traces. Add a canary test for any new free-text field.
- **Unknown is not zero**: keep missing data explicit (`null`, control states, classified errors).
- **Synthetic data only** in fixtures and tests — no real organisations, people, URLs,
  vulnerabilities or credentials.
- **Configuration over code**: projects and health policies live in `config/*.yaml`.
- Significant architectural decisions get an ADR in `docs/architecture/adr/` (EN + `docs/it/`).

## Reporting security issues

Do not open public issues for vulnerabilities — see [SECURITY.md](SECURITY.md).
