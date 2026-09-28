# Validation

Source: `11f8af2893d6afc690a8fada027ea45fc773ced2`.
XPI: `zotero-chatgpt-web-0.1.0.xpi`.
SHA-256: `a71b6ec1b8b1cc9e221777cc8abdd901b543b918f12a97e64f3fa83c76fa8420`.
Local environment: macOS 26.6.2 arm64, Zotero 9.0.6, Node 24.11.0, npm 11.6.1.

| Check | Result | Evidence |
| --- | --- | --- |
| Typecheck, lint, unit tests | PASS | 30 Vitest + 24 actor tests; no failures or skips. |
| XPI allowlist and checksum | PASS | 11 product files; no test profile, driver, authentication data, Node runtime, or native binary. |
| Clean-checkout build | PASS | Worktree at the source commit; rebuilt XPI matches byte for byte. |
| Windows, Linux, macOS CI | PASS | [CI run](https://github.com/kianmax0/zotero-chatgpt-web/actions/runs/36361812318): all five gates on all three systems; XPI byte comparison passed. |
| Final-XPI Reader checks on macOS | PASS | [Reader report](reports/reader-0.1.0.json): isolated profile, two synthetic PDFs, identity, focus, 8 px resize handle, pointer-event and keyboard width changes, remembered widths, clamps, page and vertical reading position. |
| Native mouse drag across embedded page | NOT RUN | Pointer-event tests do not establish trusted Gecko pointer capture. |
| Horizontal reading position, dark mode, enlarged text, IME, multiple windows | NOT RUN | Centered-page horizontal margins change with page-width zoom. |
| Windows and Linux native Reader checks | NOT RUN | CI validates the universal package; native Zotero checks remain separate. |
| Selected passage produces a visible official answer | BLOCKED | Official ChatGPT requests browser verification in the isolated profile. User verification/sign-in is required. |

Stable release requires the last check to pass with this exact XPI: select a fresh random value from a synthetic PDF, send **More details**, and verify that the visible official answer uses it. The question must not repeat the value. Also check **Ask in sidechat** stages without sending and context-off sends omit paper metadata.

Until then, the first release is a prerelease and the automatic update feed remains empty. Previous baseline evidence is retained in `reports/host-preflight.json`; it does not validate this package.
