# Zotero ChatGPT Web

Open the official [ChatGPT website](https://chatgpt.com/) beside a PDF in Zotero Reader and send selected text or paper details.

## Install

Download the XPI from [Releases](https://github.com/kianmax0/zotero-chatgpt-web/releases), then install it in Zotero via **Tools → Add-ons → Install Add-on From File**.

One XPI for Zotero 9.0.6–9.0.x on Windows, macOS, and Linux. CI checks all three systems; native Reader checks are tracked in [validation](docs/validation.md).

## Use

Open a PDF in Reader and select **ChatGPT Web**. Sign in at chatgpt.com. Select text to ask about a passage. Paper details are included on send when enabled in Zotero settings; PDF body text is never sent automatically.

## Scope

ChatGPT handles sign-in, models, messages, and history. This add-on uses the official website and does not use an API or another provider. It is an independent community project, not affiliated with Zotero or OpenAI. Adapted from [zotero-chatgpt](https://github.com/kianmax0/zotero-chatgpt) under the [MIT License](LICENSE).
