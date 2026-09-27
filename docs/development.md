# Development

## Source map

```text
src/index.ts             Reader lifecycle, selection actions, official page wiring
src/host/               Zotero Reader dock, toolbar, geometry, clipboard
src/context/            Attachment metadata, frozen selection, PDF version
src/web/                Official browser surface, prompt, actor registration, URL binding
actors/                 Narrow ChatGPT page actor and DOM recognition
src/ui/ + assets/       Reader shell and responsive styling
src/settings/           Preference owner and Zotero settings pane
tests/                  Context, Reader routing, actor, packaging, host-prep regressions
scripts/                Build, deterministic XPI, audit, isolated host preparation
```

The request path is `renderTextSelectionPopup` → `captureSelection` / `freezeSelectionVersion` → `selectionAction` in `src/index.ts` → `ChatEmbedSurface` → `ChatGPTWebChild` → the **visible official composer**. A manual send starts in the content actor and calls back to `prepareContext` in `src/index.ts`. The actor has no Zotero write capability. `SettingsStore` is the preference owner; each attachment key is part of its binding.

## Commands

Use Node 24 and npm 11.6.1:

```sh
npm ci
npm run typecheck
npm run lint
npm run test:unit
npm run package:dev
npm run verify:artifacts
```

`package:dev` produces `dist/zotero-chatgpt-web-<manifest-version>.xpi` and `dist/SHA256SUMS`. `verify:artifacts` checks the exact file allowlist, add-on identity, checksum, forbidden names, and Node imports. CI runs the same checks. Node is only a build dependency; the XPI has no Node runtime or Codex binary.

For a fresh host profile after packaging:

```sh
npm run host:prepare -- --xpi dist/zotero-chatgpt-web-0.1.0.xpi --run-id <new-run-name>
```

The command validates the XPI, then creates `.zotero-chatgpt-web-test/<run-name>/` with dedicated `profile`, `data`, and randomly generated synthetic PDFs. It refuses an existing run. Use only the printed `-no-remote -profile … -datadir …` command; import those synthetic PDFs into that profile. Never point the test at a daily Zotero profile or real literature library.

## Publication gate

Build the final XPI from a clean checkout. Before a stable GitHub Release, record the commit, manifest version, XPI SHA-256, Zotero/macOS environment, local gates, and final-XPI Reader checks in [validation.md](validation.md). A synthetic PDF passage must contain a fresh random value that is omitted from the question itself; **More details** must deliver that passage to the same official conversation, and a visible answer must use the value. Record frozen selection, page acceptance, and actual answer separately. Browser challenges, login, or an unsupported editor are `BLOCKED` or `FAIL`, never a substituted pass. Do not tag or publish a stable XPI without this gate.
