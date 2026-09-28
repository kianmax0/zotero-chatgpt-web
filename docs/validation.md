# Validation

Source: `e4c955df84e406c2377f639aa43d317f8ad6d0ba`.
XPI: `zotero-chatgpt-web-0.2.0.xpi`.
SHA-256: `bc2687b497482bd73d8c0a40ed7cbbd9a9b7db83aba869530773f1651f5b1664`.
Local environment: macOS 26.6.2 arm64, Zotero 9.0.6, Node 24.11.0, npm 11.6.1.

| Check | Result | Evidence |
| --- | --- | --- |
| Typecheck, lint, unit tests | PASS | 32 Vitest + 30 actor tests; no failures or skips. |
| XPI allowlist and checksum | PASS | 11 product files; no test profile, driver, authentication data, Node runtime, or native binary. |
| Clean-checkout build | PASS | All five gates at the source commit; rebuilt XPI matches byte for byte. |
| Windows, Linux, macOS CI | PASS | [CI run](https://github.com/kianmax0/zotero-chatgpt-web/actions/runs/36364608536): all five gates on all three systems; XPI byte comparison passed. |
| Final-XPI Reader checks on macOS | PASS | [Reader report](reports/reader-0.2.0.json): 21 checks passed, no failures; isolated profile, synthetic PDFs, current-PDF binding, 8 direct actions, no redundant headings, focus, resize, remembered widths, clamps, page and vertical reading position. |
| Final-XPI rich-editor insertion in Gecko | PASS | Browser paragraph markup accepts the entire synthetic multiline draft; word-spacing changes are rejected. This verifies insertion, not an official submission. |
| Light and dark UI preview | PASS | Isolated Chromium local preview: gray palette with red/blue accents, visible error text, actions fit at 312/352/472/712 CSS px. This is distinct from native Zotero theme acceptance. |
| Native mouse drag across embedded page | NOT RUN | Synthetic pointer events do not establish trusted Gecko pointer capture. |
| Horizontal reading position, native dark mode, enlarged text, IME, multiple windows | NOT RUN | These checks remain separate from default-theme Reader checks and the local preview. |
| Windows and Linux native Reader checks | NOT RUN | CI validates the universal package; native Zotero checks remain separate. |
| Selected passage produces a visible official answer | BLOCKED | Official ChatGPT requests browser verification in the dedicated profile. Sign-in/verification and final answer acceptance are manual. |

The reported **Send unavailable. Draft kept; not sent.** path was reproduced with an explicitly identified **Send message** button in the recognized rich editor's form. Its recognition, trusted manual-click routing, rich-editor submission with one click, full-draft staging, and strict textarea blank-line checks now have regression coverage. The user's exact authenticated page has not been inspected or automatically tested.

Stable release requires the last check to pass with this exact XPI: select a fresh random value from a synthetic PDF, send **More details**, and verify that the visible official answer uses it. The question must not repeat the value. Also check **Ask in sidechat** stages without sending and context-off sends omit paper metadata.

The user selected a second prerelease while this gate is blocked. The automatic update feed remains empty. [Release evidence](reports/release-0.2.0.json) records source, artifact, environment, and check status. Previous evidence is retained in [0.1.0](reports/release-0.1.0.json).
