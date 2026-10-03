# Copilot instructions — Engineering Project Hub

Static, read-only portal: a TypeScript collector (GitHub Actions) writes sanitised JSON
snapshots; an Astro static site renders them for GitHub Pages. See `README.md` and
`docs/architecture.md`.

- The browser never calls the GitHub API; no tokens in frontend code or storage.
- `shared/model/` (Zod) is the only contract between collector and site. Snapshot schemas are
  `.strict()` and act as the publication allowlist — add fields there deliberately.
- Never publish raw API payloads, secret values, logs, headers or stack traces. Route free
  text through `scrubText` and links through `sanitizeUrl`.
- Unknown is never 0: use `null` counts and explicit control states.
- The portal is read-only: no write calls, alert dismissals or workflow triggers.
- UI strings live in `src/i18n/en.ts` and `src/i18n/it.ts` (same keys); docs have EN and IT versions.
- Fixtures are synthetic (`example-org`). Add tests with every change; keep `npm run lint`,
  `npm run typecheck`, `npm test` and `npm run build` green.
