import { mkdtemp, mkdir, readFile, realpath, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { packageExtension } from "../../scripts/package.mjs";
import { prepareHostTest } from "../../scripts/prepare-host-test.mjs";
import { createFixturePdf } from "../fixtures/create-pdf.mjs";

const addonId = "{c0f56f65-4363-4713-8f48-6bd18593c781}";
const files: Record<string, string> = {
  LICENSE: "MIT test license\n",
  "bootstrap.js": "function startup() {}\n",
  "manifest.json": JSON.stringify({
    manifest_version: 2,
    name: "Zotero ChatGPT Web",
    version: "0.1.0",
    applications: { zotero: { id: addonId, strict_min_version: "9.0.6", strict_max_version: "9.0.*", update_url: "https://raw.githubusercontent.com/kianmax0/zotero-chatgpt-web/main/updates.json" } },
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

describe("isolated Zotero host fixture preparation", () => {
  let temporaryRoot: string;
  let xpiPath: string;

  beforeEach(async () => {
    temporaryRoot = await realpath(await mkdtemp(path.join(os.tmpdir(), "zotero-chatgpt-web-host-test-")));
    const source = path.join(temporaryRoot, "source");
    for (const [relative, contents] of Object.entries(files)) {
      const destination = path.join(source, relative);
      await mkdir(path.dirname(destination), { recursive: true });
      await writeFile(destination, contents);
    }
    xpiPath = path.join(temporaryRoot, "dist", "candidate.xpi");
    await packageExtension(source, xpiPath);
  });

  afterEach(async () => rm(temporaryRoot, { recursive: true, force: true }));

  it("installs the verified candidate into a new isolated tree with unique synthetic PDFs", async () => {
    const result = await prepareHostTest({ repositoryRoot: temporaryRoot, xpiPath, runId: "fresh-reader-run" });
    expect(result.runDirectory).toBe(path.join(temporaryRoot, ".zotero-chatgpt-web-test", "fresh-reader-run"));
    expect(result.launchCommand).toContain("-no-remote -profile");
    expect(result.launchCommand).toContain("-datadir");
    expect(await readFile(path.join(result.profile, "extensions", `${addonId}.xpi`))).toEqual(await readFile(xpiPath));

    const preferences = await readFile(path.join(result.profile, "user.js"), "utf8");
    expect(preferences).toContain('user_pref("extensions.zotero.sync.autoSync", false);');
    expect(preferences).toContain('user_pref("toolkit.telemetry.enabled", false);');
    expect(preferences).toContain(JSON.stringify(result.data));
    expect(preferences).not.toMatch(/auth|cookie|token|password/iu);

    const manifest = JSON.parse(await readFile(path.join(result.fixtures, "fixture-manifest.json"), "utf8")) as {
      files: Array<{ filename: string; verificationToken: string }>;
    };
    expect(manifest.files).toHaveLength(2);
    const tokens = manifest.files.map(fixture => fixture.verificationToken);
    expect(new Set(tokens).size).toBe(2);
    for (const fixture of manifest.files) {
      const pdf = await readFile(path.join(result.fixtures, fixture.filename));
      expect(pdf.subarray(0, 8).toString("ascii")).toBe("%PDF-1.4");
      expect(pdf.toString("latin1")).toContain(fixture.verificationToken);
    }
  });

  it("refuses to reuse an existing named run without changing its contents", async () => {
    const run = path.join(temporaryRoot, ".zotero-chatgpt-web-test", "already-used");
    const sentinel = path.join(run, "profile", "keep.txt");
    await mkdir(path.dirname(sentinel), { recursive: true });
    await writeFile(sentinel, "existing data");
    await expect(prepareHostTest({ repositoryRoot: temporaryRoot, xpiPath, runId: "already-used" })).rejects.toThrow(/Refusing to reuse/u);
    await expect(readFile(sentinel, "utf8")).resolves.toBe("existing data");
  });

  it("rejects traversal run IDs and a symlinked test root", async () => {
    await expect(prepareHostTest({ repositoryRoot: temporaryRoot, xpiPath, runId: "../default" })).rejects.toThrow(/run-id/u);
    const outside = path.join(temporaryRoot, "outside");
    await mkdir(outside);
    await symlink(outside, path.join(temporaryRoot, ".zotero-chatgpt-web-test"));
    await expect(prepareHostTest({ repositoryRoot: temporaryRoot, xpiPath, runId: "fresh" })).rejects.toThrow(/symlink/u);
  });

  it("creates selectable PDF text and rejects malformed verification markers", () => {
    const token = "ZWEB-0123456789ABCDEF0123456789ABCDEF0123";
    const pdf = createFixturePdf("Synthetic title", token);
    expect(pdf.toString("latin1")).toContain(token);
    expect(pdf.toString("latin1")).toContain("/Count 2");
    expect(pdf.toString("latin1")).toContain("%%EOF");
    expect(() => createFixturePdf("Synthetic title", "not-a-random-marker")).toThrow(/unique uppercase/u);
  });
});
