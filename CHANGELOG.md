# Changes

## 0.3.0

- Use one compact row of icon-only tools: copy paper details, copy PDF, return to source, link conversation, and reload.
- Remove the plugin title, New, Settings, and close buttons, plus the settings page and its packaged code.
- Use neutral black, white, and gray for every plugin state, including errors, focus, and selection actions.
- Recognize the explicit `composer-submit-button` control inside the official editor form, preserving ambiguity checks and single-send behavior.
- Remove obsolete local profiles, previews, and reports. Keep the current validation record; earlier evidence remains in Git history and prior release assets.

## 0.2.0

- Recognize the official **Send message** control as well as the previous send controls, within the current editor's form.
- Accept browser paragraph spacing when staging or submitting multiline PDF context. Changes to words or ordinary spaces still stop submission.
- Replace the overflow menu with directly visible actions: new chat, reload, settings, close, copy details, copy PDF, return to source, and link conversation.
- Remove the redundant paper and PDF headings from the sidebar.
- Use black, white, and gray, with red errors and blue focus/action accents in light and dark themes.
- Show status and recovery text directly. Reload recovery requires confirmation to protect unsent drafts.
- Verify the current manifest version's package by default, including when an older XPI remains in `dist/`.

Release acceptance evidence is in [validation](docs/validation.md). A stable release requires a visible official answer to a fresh synthetic selected passage with the final XPI.
