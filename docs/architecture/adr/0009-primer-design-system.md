# ADR 0009: GitHub Primer as the design system (tokens and Octicons, no React, never passing as GitHub)

- **Status:** Accepted
- **Date:** 2026-11-03
- **Italian version:** [docs/it/architecture/adr/0009-primer-design-system.md](../../it/architecture/adr/0009-primer-design-system.md)

## Context

The hub fills a gap in GitHub: no dashboard published by GitHub, and no GitHub App, gives a
project-level view of delivery, versions, security and controls across many repositories (GitHub
Apps provide authentication and API access, not a UI). Until v0.9.0 the hub had its own look,
"Warm Graphite" (IBM Plex fonts, warm neutrals, oklch tints). On 2026-11-02 the owner decided that
the hub must look like GitHub (colours, icons, structure), so people who live in GitHub read it as a
natural extension of the tools they already use. It must not pretend to be GitHub.

The site is static Astro with a strict CSP (`script-src 'self'`, no CDN, no web fonts) and server-side
rendering of every page ([ADR 0001](0001-static-first-github-native.md)). Login stays outside the
site: Cloudflare Access with GitHub login today, GitHub's own private Pages / SSO when the hub moves
into a company organisation.

## Decision

1. **Primer tokens, not a Primer UI library.** `@primer/primitives` (11.10.0, exact pin) provides the
   CSS variables: functional colours, sizes, radii and type. Components use the functional tokens
   directly (`--fgColor-*`, `--bgColor-*`, `--borderColor-*`, `--base-size-*`, `--borderRadius-*`).
   No React, no Primer React, no `@primer/css`: the hub's Astro components get the Primer look
   (Box, Label, Button, UnderlineNav, Flash, FormControl) from their own CSS.
2. **Octicons, rendered at build time.** `@primer/octicons` (19.40.0) through a small `octiconSvg()`
   helper and an `Octicon.astro` component: no client icon code. Every symbol set moves to Octicons
   with distinct shapes (control symbols, health icons, navigation, external links).
3. **Primer colour modes.** `<html data-color-mode data-light-theme data-dark-theme>` replaces the
   hub's `data-theme`; the saved preference keeps its `eph-theme` key, so a choice made before the
   upgrade still applies.
4. **System fonts.** Primer's system stack; IBM Plex is removed and nothing is downloaded.
5. **The hub's meaning rules stay.** Unknown is never zero (no fill, dashed outline, muted text);
   status is never colour alone; severity always carries its word; the score, its confidence and the
   charts keep their data and rules.
6. **Never passing as GitHub.** No Octocat or GitHub mark, no "GitHub" as the product name, no
   "official". The brand mark is the Octicon `stack`, and the footer says "Not affiliated with GitHub
   · built with Primer".
7. **Optional identity.** Builds behind Cloudflare Access can show the signed-in user's initials
   (`PUBLIC_IDENTITY_SOURCE=cloudflare-access`); GitHub Pages builds have no slot and no request.

## Alternatives considered

- **Primer React.** Rejected: it would add React and hydration to a static site that ships almost no
  JavaScript, and fight the CSP and the server-rendered pages.
- **`@primer/css`.** Rejected: in maintenance mode, a large global stylesheet whose class names
  collide with the hub's tested hooks.
- **Keeping Warm Graphite.** Rejected by the owner: the hub must read as part of GitHub.
- **A GitHub App with its own UI.** Not possible: a GitHub App has no UI surface inside GitHub; the
  hub's pages are needed either way.

## Consequences

- Warm Graphite is retired in v0.10.0; its tokens and fonts are gone, and a test fails on any legacy
  token, colour literal or old theme selector under `src/`.
- Contrast is tested on Primer's own values in both themes (WCAG AA for text, 3:1 for marks); no
  substitution was needed.
- Upgrading Primer means re-running the contrast test; a renamed token fails the build early.
- Later UI work (supply chain providers, v0.11.0) is built directly in Primer.
- The page structure is not yet rethought: phase 2 will revisit it after the owner has tried the
  restyle at work. Moving the login to GitHub's own private Pages / SSO is a separate project.
