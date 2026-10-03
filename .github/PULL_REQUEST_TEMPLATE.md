## Summary

<!-- What does this PR change and why? Link the related issue (e.g. "Closes #12"). -->

## Type of change

- [ ] `feat` — new feature
- [ ] `fix` — bug fix
- [ ] `docs` — documentation only
- [ ] `refactor` / `perf` / `test` / `build` / `ci` / `chore`
- [ ] Breaking change (use `!` in the PR title, e.g. `feat!: …`)

PR titles follow [Conventional Commits](https://www.conventionalcommits.org/): `type(scope): subject`.

## Testing

- [ ] `npm run lint && npm run typecheck && npm test`
- [ ] `npm run build` (mock data, includes the output secret scan)
- [ ] `npm run test:e2e` (if the UI changed)

## Checklist

- [ ] No credentials, tokens or real organisation data in code, fixtures or snapshots
- [ ] Fixtures are synthetic (`example-org`); golden snapshots regenerated if intended (`npm run fixtures:update`)
- [ ] EN and IT texts updated together (UI strings and docs)
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
