import { createHash } from "node:crypto";
import { builtinModules } from "node:module";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yauzl from "yauzl";

export const PRODUCT_ID = "{c0f56f65-4363-4713-8f48-6bd18593c781}";
export const UPDATE_URL = "https://raw.githubusercontent.com/kianmax0/zotero-chatgpt-web/main/updates.json";
export const REQUIRED_FILES = [
  "LICENSE", "bootstrap.js", "manifest.json", "content/zotero-chatgpt-web.js",
  "content/assets/sidebar.css", "content/assets/icon.svg",
  "content/actors/ChatGPTWebChild.mjs", "content/actors/ChatGPTWebParent.mjs", "content/actors/chatgpt-dom.mjs",
];
const requiredActors = new Set(REQUIRED_FILES.filter(file => file.startsWith("content/actors/")));
const allowedExact = new Set(REQUIRED_FILES);
const forbiddenNames = new Set(["auth.json", "auth.json.enc", "credentials.json", "token.json", "cookies.sqlite", "logins.json", "key4.db", "prefs.js", ".env", "profile.ini"]);
const nodeBuiltins = new Set(builtinModules.map(name => name.replace(/^node:/u, "").split("/")[0]));
const importSpecifier = /(?:\bfrom\s+|\bimport\s*(?:\(\s*)?|\brequire\s*\(\s*)["']([^"']+)["']/gu;
const textExtensions = new Set([".js", ".mjs", ".json", ".css", ".xhtml", ".ftl", ".txt", ".md", ".svg"]);
const projectRoot = path.resolve(import.meta.dirname, "..");

export async function resolveDefaultXpiPath(root = projectRoot) {
  const manifest = JSON.parse(await readFile(path.join(root, "manifest.json"), "utf8"));
  if (typeof manifest.version !== "string" || !manifest.version) throw new Error("Manifest version is missing");
  return path.join(root, "dist", `zotero-chatgpt-web-${manifest.version}.xpi`);
}

async function listFiles(directory, prefix = "") {
  const result = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) result.push(...await listFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) result.push(relative);
  }
  return result.sort();
}

function allowed(file) {
  if (allowedExact.has(file)) return true;
  return /^locale\/[a-z]{2,3}(?:-[A-Z]{2})?\/[A-Za-z0-9_-]+\.ftl$/u.test(file);
}

function validateNames(files) {
  if (new Set(files).size !== files.length) throw new Error("Product file list contains duplicate paths");
  for (const file of files) {
    const base = file.split("/").at(-1) ?? file;
    if (forbiddenNames.has(base) || /(?:^|\/)(?:runtime|codex|node_modules|profiles?|test-data|fixtures?)(?:\/|$)/iu.test(file)) {
      throw new Error(`Forbidden product asset: ${file}`);
    }
    if (file.startsWith("content/actors/") && !requiredActors.has(file)) throw new Error(`Unexpected actor asset: ${file}`);
    if (/^(?:driver|.+-driver)\.(?:js|mjs)$/u.test(base) || /(?:^|\/)(?:tests?|reports?)\//u.test(file)) throw new Error(`Test-only asset in product package: ${file}`);
    if (!allowed(file)) throw new Error(`File is outside the product allowlist: ${file}`);
  }
}

function validateText(file, text) {
  if ([".js", ".mjs"].includes(path.extname(file))) {
    for (const match of text.matchAll(importSpecifier)) {
      const specifier = match[1].replace(/^node:/u, "").split("/")[0];
      if (nodeBuiltins.has(specifier)) throw new Error(`Production executable imports Node builtin ${match[1]}: ${file}`);
    }
    if (/\/Users\/|\/home\/|[A-Za-z]:\\Users\\/u.test(text)) throw new Error(`Production executable contains an absolute user path: ${file}`);
  }
  if (/Codex App Server|codex-aarch64-apple-darwin|auth\.json/iu.test(text)) throw new Error(`Legacy runtime or authentication reference in product asset: ${file}`);
}

export async function validateExtensionDirectory(directory, providedFiles) {
  const files = providedFiles ?? await listFiles(directory);
  validateNames(files);
  for (const required of REQUIRED_FILES) if (!files.includes(required)) throw new Error(`Missing product file: ${required}`);
  let manifest;
  try { manifest = JSON.parse(await readFile(path.join(directory, "manifest.json"), "utf8")); }
  catch (error) { throw new Error("Invalid extension manifest", { cause: error }); }
  validateManifest(manifest);
  for (const file of files) {
    if (textExtensions.has(path.extname(file).toLowerCase())) validateText(file, await readFile(path.join(directory, file), "utf8"));
  }
  return manifest;
}

function validateManifest(manifest) {
  if (manifest?.applications?.zotero?.id !== PRODUCT_ID) throw new Error("Manifest add-on ID does not match this product");
  if (manifest?.name !== "Zotero ChatGPT Web" || !/^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/u.test(manifest?.version ?? "")) throw new Error("Manifest name/version is invalid");
  if (manifest?.applications?.zotero?.strict_min_version !== "9.0.6") throw new Error("Manifest minimum Zotero version must be 9.0.6");
  if (manifest?.applications?.zotero?.update_url !== UPDATE_URL) throw new Error("Manifest update URL is missing or points outside this repository");
  return manifest;
}

async function readArchive(filePath) {
  const archive = await yauzl.openPromise(filePath);
  const entries = [];
  for await (const entry of archive.eachEntry()) {
    if (entry.fileName.endsWith("/")) continue;
    const stream = await archive.openReadStreamPromise(entry);
    const chunks = [];
    for await (const chunk of stream) chunks.push(chunk);
    entries.push({ name: entry.fileName, text: Buffer.concat(chunks).toString("utf8") });
  }
  return entries;
}

export async function verifyXpi(filePath) {
  const siblingSums = path.join(path.dirname(filePath), "SHA256SUMS");
  const sums = await readFile(siblingSums, "utf8");
  const name = path.basename(filePath);
  const sum = sums.split("\n").find(line => line.endsWith(`  ${name}`));
  if (!sum || sum.slice(0, 64) !== createHash("sha256").update(await readFile(filePath)).digest("hex")) throw new Error("XPI checksum is missing or invalid");
  const entries = await readArchive(filePath);
  const files = entries.map(entry => entry.name).sort();
  validateNames(files);
  for (const required of REQUIRED_FILES) if (!files.includes(required)) throw new Error(`Missing product file in XPI: ${required}`);
  const manifestEntry = entries.find(entry => entry.name === "manifest.json");
  if (!manifestEntry) throw new Error("XPI has no manifest.json");
  let manifest;
  try { manifest = JSON.parse(manifestEntry.text); }
  catch (error) { throw new Error("Invalid XPI manifest", { cause: error }); }
  validateManifest(manifest);
  for (const entry of entries) if (textExtensions.has(path.extname(entry.name).toLowerCase())) validateText(entry.name, entry.text);
  return { files, manifest, digest: sum.slice(0, 64) };
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const argIndex = process.argv.indexOf("--xpi");
  const suppliedPath = argIndex < 0 ? undefined : process.argv[argIndex + 1];
  if (argIndex >= 0 && (!suppliedPath || suppliedPath.startsWith("--"))) {
    console.error("--xpi requires a path");
    process.exitCode = 1;
  } else {
    const archive = suppliedPath ? path.resolve(suppliedPath) : await resolveDefaultXpiPath();
    verifyXpi(archive).then(result => console.log(`Verified XPI (${result.files.length} files; SHA-256 ${result.digest})`)).catch(error => {
      console.error(error instanceof Error ? error.message : error);
      process.exitCode = 1;
    });
  }
}
