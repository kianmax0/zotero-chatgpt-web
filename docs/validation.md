# Validation record

Statuses: **PASS**, **FAIL**, **BLOCKED**, **NOT RUN**. Every result here belongs to the new add-on. The original project’s reports do not count for this XPI.

Source commit: `d2b5ec3d21753af9724111f7df5c1cdf88e452a8`. Candidate: `zotero-chatgpt-web-0.1.0.xpi`, SHA-256 `44e6fb828141e415c55178af4bf63931404a31fe76e7ed3363ea5c4e99f3a0cb`. Environment: macOS 26.6.2 arm64, Node 24.11.0, npm 11.6.1, Zotero 9.0.6.

| Gate | Status | Evidence |
| --- | --- | --- |
| TypeScript, ESLint, unit tests | PASS | [Local gates](reports/local-gates.json): 23 Vitest + 20 actor tests, zero failures/skips. |
| XPI packaging and allowlist | PASS | 11 files; no runtime, Node dependency, test profile, or authentication material. |
| Clean-checkout rebuild and byte comparison | PASS | [Local gates](reports/local-gates.json); clean checkout produced the same SHA-256 and bytes. |
| Candidate active in isolated Zotero | PASS | [Host preflight](reports/host-preflight.json), hash-bound add-on active check and two synthetic PDFs under one parent. |
| Automated Reader focus check | FAIL | [Host preflight](reports/host-preflight.json): unfocused Reader body changed to its PDF iframe. This measurement does not establish that the plugin took focus; the test was corrected, then left unrun when the user took over acceptance. |
| Visual layouts, themes, enlarged text, keyboard/IME, anchors, multiple windows | NOT RUN | User-owned manual acceptance. No prior product report is inherited. |
| Official page accepts selected passage | NOT RUN | User-owned final-XPI acceptance. |
| Visible official answer uses hidden random passage content | NOT RUN | User-owned final-XPI acceptance; required for Release. |
| Cold-start plugin process observation and old/new coexistence | NOT RUN | Manual isolated-profile checks remain. The artifact has no Codex code or binary. |
| Desktop UI automation | BLOCKED | Computer Use was not approved for Zotero; no UI-control workaround was used. |

## Failure baseline and review

[Actor baseline](reports/actor-baseline.json) records the original implementation failing to recognize one controlled ProseMirror editor. The new regression passes. The original checkout remained at `9d7ac0e` with its two local commits and two modified documents preserved.

Independent source review was performed. Actor ownership, transaction binding, single-marker insertion, first-send disclosure, and duplicate-click handling were checked and corrected where needed. The host report is preserved as a failed test observation; it is not promoted to a full Reader or official-answer PASS.

## Manual handoff

The user chose to perform acceptance on 2026-09-28. Automated test instances were stopped. Use a dedicated profile created by `host:prepare`, import its synthetic PDFs, and test this exact XPI. Select the line containing the fresh random verification content, click **More details**, and check that the visible answer in that same official conversation uses it. The question itself must not repeat the random value. Separately check **Ask in sidechat** inserts without sending, context-off sends omit bibliography/abstract, PDF identities stay separate, and the layout/focus/IME checks above.

No tag or stable GitHub Release has been created. The update feed remains empty until these gates pass.
