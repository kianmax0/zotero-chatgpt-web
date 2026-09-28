import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packageExtension } from "../../scripts/package.mjs";
import { verifyXpi } from "../../scripts/verify-artifacts.mjs";

const productId = "{c0f56f65-4363-4713-8f48-6bd18593c781}";
const updateURL = "https://raw.githubusercontent.com/kianmax0/zotero-chatgpt-web/main/updates.json";
const fixtureFiles: Record<string, string> = {
  LICENSE: "MIT test license\n",
  "bootstrap.js": "function startup() {}\n",
  "manifest.json": JSON.stringify({
    manifest_version: 2,
    name: "Zotero ChatGPT Web",
    version: "0.1.0",
    applications: { zotero: { id: productId, strict_min_version: "9.0.6", strict_max_version: "9.0.*", update_url: updateURL } },
  }),
  "content/zotero-chatgpt-web.js": "(() => {})();\n",
  "content/preferences.js": "(() => {})();\n",
  "content/preferences/preferences.xhtml": "<window/>\n",
  "content/assets/sidebar.css": ":root {}\n",
  "content/assets/icon.svg": "<svg/>\n",
  "content/actors/ChatGPTWebChild.mjs": "export {};\n",
  "content/actors/ChatGPTWebParent.mjs": "export {};\n",
  "content/actors/chatgpt-dom.mjs": "export {};\n",
};

describe("XPI packaging", () => {
  let temporaryRoot: string;
  let source: string;
  let output: string;

  beforeEach(async () => {
    temporaryRoot = await mkdtemp(path.join(os.tmpdir(), "zotero-chatgpt-web-build-"));
    source = path.join(temporaryRoot, "extension");
    output = path.join(temporaryRoot, "dist", "addon.xpi");
    for (const [relative, contents] of Object.entries(fixtureFiles)) {
      const destination = path.join(source, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, contents);
    }
  });

  afterEach(async () => rm(temporaryRoot, { recursive: true, force: true }));

  it("creates a deterministic, checksum-verified XPI from allowlisted files", async () => {
    const first = await packageExtension(source, output);
    const bytes = await readFile(output);
    const second = await packageExtension(source, output);
    expect(await readFile(output)).toEqual(bytes);
    expect(second.digest).toBe(first.digest);

    const verified = await verifyXpi(output);
    expect(verified.manifest.applications.zotero.id).toBe(productId);
    expect(verified.files).toContain("content/actors/ChatGPTWebChild.mjs");
    expect(verified.files.some(file => file.includes("runtime"))).toBe(false);
  });

  it("produces identical XPI bytes when packaged under different time zones", async () => {
    const packageScript = fileURLToPath(new URL("../../scripts/package.mjs", import.meta.url));
    const archives: Buffer[] = [];
    for (const timezone of ["UTC", "Asia/Shanghai"]) {
      const destination = path.join(temporaryRoot, timezone.replaceAll("/", "-"), "addon.xpi");
      const result = spawnSync(process.execPath, [packageScript, "--source", source, "--output", destination], {
        encoding: "utf8",
        env: { ...process.env, TZ: timezone },
      });
      expect(result.status, result.stderr || result.stdout).toBe(0);
      archives.push(await readFile(destination));
    }
    expect(archives[1]).toEqual(archives[0]);
  });

  it("rejects runtime assets before packaging", async () => {
    await mkdir(path.join(source, "content/runtime"), { recursive: true });
    await writeFile(path.join(source, "content/runtime/codex"), "binary-placeholder");
    await expect(packageExtension(source, output)).rejects.toThrow(/Forbidden product asset|allowlist/u);
  });

  it("rejects files outside the package allowlist", async () => {
    await mkdir(path.join(source, "extra"), { recursive: true });
    await writeFile(path.join(source, "extra/host.json"), "{}\n");
    await expect(packageExtension(source, output)).rejects.toThrow(/allowlist/u);
  });

  it("rejects a mismatched add-on identity", async () => {
    await writeFile(path.join(source, "manifest.json"), fixtureFiles["manifest.json"]!.replace(productId, "{90909501-7b5b-4985-9f55-566e9890746c}"));
    await expect(packageExtension(source, output)).rejects.toThrow(/add-on ID/u);
  });

  it("requires its own update feed", async () => {
    const feed = JSON.parse(await readFile(new URL("../../updates.json", import.meta.url), "utf8")) as { addons: Record<string, { updates: unknown[] }> };
    expect(Array.isArray(feed.addons[productId]?.updates)).toBe(true);
    await writeFile(path.join(source, "manifest.json"), fixtureFiles["manifest.json"]!.replace(updateURL, "https://example.invalid/other.json"));
    await expect(packageExtension(source, output)).rejects.toThrow(/update URL/u);
  });

  it("rejects an XPI whose bytes no longer match SHA256SUMS", async () => {
    await packageExtension(source, output);
    const bytes = await readFile(output);
    bytes[0] = bytes[0]! ^ 0xff;
    await writeFile(output, bytes);
    await expect(verifyXpi(output)).rejects.toThrow(/checksum/u);
  });
});
