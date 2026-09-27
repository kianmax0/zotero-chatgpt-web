# Zotero ChatGPT Web

Zotero ChatGPT Web puts the **official [ChatGPT website](https://chatgpt.com/)** beside the current PDF in Zotero Reader. The site owns sign-in, models, messages, and conversation history. The plugin supplies the Reader panel, identifies the open PDF, and hands over context when you choose to send.

This is an independent community project, not an official Zotero or OpenAI product. It is a focused derivative of [zotero-chatgpt](https://github.com/kianmax0/zotero-chatgpt), with its applicable Reader and web Chat code adapted under the [MIT license](LICENSE).

## Use

Open a PDF in Zotero Reader and use the ChatGPT Web toolbar button. Sign in through the official page if prompted. A panel opened by itself sends nothing. Different PDF attachments, even under one parent item, have separate page bindings and local conversation URLs.

When automatic paper context is on (the default), a deliberate send adds available **title, authors, publication, year, DOI, and Zotero’s stored abstract**. It does not include the PDF body. Turn this off in **Zotero Settings → Zotero ChatGPT Web**; an explicitly selected passage can still be used. The first send shows the external scope in the panel.

Select text in the PDF to use the Reader popup:

| Action | Result |
| --- | --- |
| **More details** | Sends an explanation request with the frozen passage, page, attachment, and verified PDF version through the official ChatGPT composer. |
| **Ask in sidechat** | Adds the frozen passage to the official composer for editing. It **does not send**. |

The actions menu can copy paper details or the PDF file, reload the official page, return to a selected passage, start a new chat, and bind the current official conversation to this PDF. **Copy PDF file** only places the file on your clipboard; paste it into ChatGPT yourself to attach it. A copied file is not an uploaded file.

## Install and compatibility

The manifest targets **Zotero 9.0.6–9.0.x**. Development and packaging have been run on macOS; final Reader and official-site acceptance are tracked in [validation](docs/validation.md). A release XPI should be installed through Zotero’s Add-ons → Install Add-on From File. The update feed is empty until a release passes the acceptance gate.

Official ChatGPT may require sign-in or browser verification, and its page structure can change. If the editor or send control is unknown or ambiguous, the plugin keeps the draft and reports a recovery action. It does not use an API key, Codex, a paid API, a substitute model provider, or an unpublished ChatGPT endpoint. The plugin does not read private answer text or copy the remote transcript into Zotero. It stores only its own settings and per-PDF official conversation URL in separate `extensions.zchatgptweb.*` preferences.

## Develop

See [development.md](docs/development.md) for the small source map, build commands, isolated profile setup, and release gate.
