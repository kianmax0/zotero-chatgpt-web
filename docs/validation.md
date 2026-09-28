# Validation

Source: `368de968e2b175ef9a49cfabcb76b08a872daa26`.
XPI: `zotero-chatgpt-web-0.3.0.xpi`.
SHA-256: `0567362caa599da3154ace37ff4c85d75f82ab8268ead8d865ae5ac75672a3a4`.
Environment: macOS 26.6.2 arm64, Zotero 9.0.6, Node 24.11.0, npm 11.6.1.

| Check | Result | Evidence |
| --- | --- | --- |
| Typecheck, lint, tests, packaging, artifact verification | PASS | 32 Vitest + 36 actor tests; 9 allowlisted product files. |
| Clean checkout | PASS | All five gates pass; rebuilt XPI matches byte for byte. |
| Windows, macOS, Linux CI | PASS | [CI run](https://github.com/kianmax0/zotero-chatgpt-web/actions/runs/36367809139); all three downloaded XPIs match the final package. |
| Final-XPI macOS Reader | PASS | 27 checks in `release-v030-0928`: icon-only row, grayscale controls/status, widths, focus/anchor preservation, rich-editor insertion, native DOM send recognition and ambiguity rejection. |
| Visible official answer to fresh synthetic selected passage | BLOCKED | The dedicated profile reached ChatGPT browser verification; no authentication or question was automated. |
| Native dark mode, trusted mouse capture, Windows/Linux Reader | NOT RUN | Native coverage is limited to the recorded macOS checks. |

The send regression reproduces an explicitly identified `composer-submit-button` with submit semantics inside the editor form. Stop and voice controls retain native behavior; ambiguous or unknown controls retain the draft. The screenshot does not reveal its DOM identity, so local and synthetic tests do not establish that the user's exact authenticated-page symptom is resolved.

This package is a prerelease. Stable release requires selecting fresh random content from a synthetic PDF, sending **More details** without repeating the value in the question, and verifying that the visible official answer uses it. Also check **Ask in sidechat** stages without sending and context-off sends omit metadata. Login and browser verification are manual. The automatic update feed remains empty.

[Current evidence](reports/release-0.3.0.json). Older reports remain in Git history and prior [release assets](https://github.com/kianmax0/zotero-chatgpt-web/releases).
