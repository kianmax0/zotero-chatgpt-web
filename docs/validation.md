# Validation

The current candidate is `0.2.1`. Final artifact checks and isolated Reader results are being recorded for this version; previous-version results do not establish acceptance of this package.

## Required checks

Run typecheck, lint, unit tests, package creation, and artifact verification. Rebuild the source commit from a clean checkout and compare XPI bytes. Test the final XPI in an explicitly named profile under `.zotero-chatgpt-web-test/` using synthetic PDFs only.

Stable release additionally requires a visible official answer using fresh random content from a synthetic selected passage. Select the passage and send **More details** without repeating the value in the question; verify the answer uses it. Check **Ask in sidechat** stages without sending and context-off sends omit metadata. Login and browser verification are manual. A blocked official-answer check must remain BLOCKED, and the package remains a prerelease.

The new send-control regression covers an explicitly identified `composer-submit-button` in the editor form. The screenshot alone does not reveal the actual DOM identity, so local tests cannot establish that the authenticated-page symptom is resolved.

Older validation reports are retained in Git history and the corresponding [release assets](https://github.com/kianmax0/zotero-chatgpt-web/releases).
