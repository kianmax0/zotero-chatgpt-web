# Development

## Requirements

Node 24 and npm 11.6.1.

```sh
npm ci
npm run typecheck
npm run lint
npm run test:unit
npm run package:dev
npm run verify:artifacts
```

The build creates `dist/zotero-chatgpt-web-<version>.xpi` and `dist/SHA256SUMS`. The XPI contains browser-targeted JavaScript and no platform-specific binary, so one package serves Windows, macOS, and Linux. CI runs the same gates on all three operating systems.

## Host checks

Prepare an isolated test profile with a synthetic PDF:

```sh
npm run host:prepare -- --xpi dist/zotero-chatgpt-web-0.2.1.xpi --run-id <unique-name>
```

Use only the generated `.zotero-chatgpt-web-test/<name>/` profile and PDF. Never use a daily profile or real library.

## Stable releases

Before publishing, build from a clean checkout and complete the Reader acceptance test in [validation.md](validation.md): send a fresh random value from a synthetic PDF passage through the official ChatGPT page and confirm the visible answer uses it. Record the commit, XPI SHA-256, OS, Zotero version, and results. CI success alone does not verify Zotero Reader behavior on each OS.
