# Development boundaries

- Product scope is the current PDF in Zotero Reader plus the official `https://chatgpt.com/` page. Keep the site’s login, composer, models, messages, and history.
- Reader selection actions and manual sends use `src/web/` and `actors/` only. Never substitute Codex, an API, another provider, a private endpoint, or a fabricated answer.
- Freeze attachment key, PDF version, selected text, question, and settings before asynchronous work. Unknown or ambiguous page controls must preserve the draft and fail safely; uncertain submission must not be resent automatically.
- `src/settings/store.ts` owns all `extensions.zchatgptweb.*` preferences. Do not read or migrate the original plugin’s preferences or storage.
- The page actor reads only the state needed for the current operation. Do not read private answers, the remote transcript, or authentication material. User login is performed by the user.
- Test only explicitly named profiles under `.zotero-chatgpt-web-test/` and synthetic PDFs. Never operate a daily profile. One controller owns a test window at a time.
- Run `typecheck`, `lint`, `test:unit`, `package:dev`, and `verify:artifacts` before delivery. Review the actual XPI allowlist and rebuild from a clean checkout.
- A stable Release requires final-XPI Reader checks and a visible official answer using fresh random content from a synthetic selected passage. Record commit, XPI SHA-256, environment, and PASS/FAIL/BLOCKED/NOT RUN evidence. Source and unit-test success do not satisfy this gate.
