#!/usr/bin/env node
import { createHash } from "node:crypto";
import { createWriteStream } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import yazl from "yazl";
import { verifyXpi } from "./verify-artifacts.mjs";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const addonId = "zotero-chatgpt-web-host-test@local";
const runIdPattern = /^[a-z0-9][a-z0-9-]{0,47}$/u;
const allowedDriverFiles = ["manifest.json", "bootstrap.js", "driver.js", "config.json"];

async function exists(pathname) {
  try { await lstat(pathname); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") return { help: true };
    if (!["--run-id", "--xpi"].includes(flag)) throw new Error(`Unknown option: ${flag}`);
    if (values.has(flag)) throw new Error(`Pass ${flag} only once`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    values.set(flag, value);
    index += 1;
  }
  const runId = values.get("--run-id");
  const xpiPath = values.get("--xpi");
  if (!runId || !xpiPath) throw new Error("Usage: node scripts/prepare-host-driver.mjs --run-id <dedicated-run-id> --xpi <final.xpi>");
  if (!runIdPattern.test(runId)) throw new Error("--run-id must be a lowercase name containing only letters, digits, and dashes");
  return { runId, xpiPath: path.resolve(xpiPath) };
}

async function requireDirectory(directory, label) {
  const info = await lstat(directory);
  if (!info.isDirectory() || info.isSymbolicLink() || await realpath(directory) !== directory) throw new Error(`Refusing ambiguous ${label} directory`);
}

async function requireRegularFile(filename, label) {
  const info = await lstat(filename);
  if (!info.isFile() || info.isSymbolicLink() || await realpath(filename) !== filename) throw new Error(`Refusing ambiguous ${label} file`);
}

function writeDriverArchive(entries, destination) {
  return new Promise((resolve, reject) => {
    const archive = new yazl.ZipFile();
    const output = createWriteStream(destination, { flags: "wx", mode: 0o600 });
    output.once("close", resolve);
    output.once("error", reject);
    archive.outputStream.once("error", reject);
    archive.outputStream.pipe(output);
    for (const [name, contents] of entries) {
      if (!allowedDriverFiles.includes(name)) return reject(new Error(`Driver file is outside the test-only allowlist: ${name}`));
      archive.addBuffer(Buffer.from(contents), name, { mode: 0o100600, mtime: new Date("1980-01-01T00:00:00.000Z"), forceDosTimestamp: true });
    }
    archive.end();
  });
}

/** Prepare the ignored test-only XPI for one fresh, stopped, dedicated run. */
export async function prepareHostDriver({ runId, xpiPath, repositoryRoot = root }) {
  if (!runIdPattern.test(runId)) throw new Error("Invalid dedicated run ID");
  const repo = await realpath(repositoryRoot);
  const testRoot = path.join(repo, ".zotero-chatgpt-web-test");
  const runDirectory = path.join(testRoot, runId);
  const profile = path.join(runDirectory, "profile");
  const data = path.join(runDirectory, "data");
  const fixturesDirectory = path.join(runDirectory, "fixtures");
  const reportPath = path.join(runDirectory, "host-report.json");
  const driverXpi = path.join(profile, "extensions", `${addonId}.xpi`);
  const absoluteXpi = path.resolve(xpiPath);
  if (path.extname(absoluteXpi).toLowerCase() !== ".xpi") throw new Error("--xpi must point to a product XPI");

  await requireDirectory(testRoot, "test root");
  await requireDirectory(runDirectory, "test run");
  await requireDirectory(profile, "test profile");
  await requireDirectory(data, "test data");
  await requireDirectory(fixturesDirectory, "fixture");
  if (await exists(path.join(profile, ".parentlock"))) throw new Error("Zotero still holds this dedicated profile; stop that test instance before preparing the driver");
  if (await exists(reportPath)) throw new Error("A host report already exists for this run; prepare a fresh dedicated run instead");
  if (await exists(driverXpi)) throw new Error("A host driver XPI already exists in this run; refusing replacement");

  const product = await verifyXpi(absoluteXpi);
  const extensionDirectory = path.join(profile, "extensions");
  await requireDirectory(extensionDirectory, "profile extensions");
  const fixtureManifestPath = path.join(fixturesDirectory, "fixture-manifest.json");
  await requireRegularFile(fixtureManifestPath, "fixture manifest");
  const fixtureManifest = JSON.parse(await readFile(fixtureManifestPath, "utf8"));
  if (fixtureManifest.runId !== runId || fixtureManifest.xpi?.sha256 !== product.digest
    || fixtureManifest.xpi?.addonId !== product.manifest.applications.zotero.id
    || fixtureManifest.xpi?.version !== product.manifest.version) {
    throw new Error("Fixture manifest does not bind this run to the requested product XPI");
  }
  const installedProductPath = path.join(profile, "extensions", `${product.manifest.applications.zotero.id}.xpi`);
  await requireRegularFile(installedProductPath, "installed product XPI");
  const installedProduct = await readFile(installedProductPath);
  const installedProductHash = createHash("sha256").update(installedProduct).digest("hex");
  if (installedProductHash !== product.digest) throw new Error("The dedicated profile does not contain the requested final product XPI");

  const allowedFixtures = new Set(["synthetic-paper-a.pdf", "synthetic-paper-b.pdf"]);
  const fixtureFiles = [];
  for (const item of fixtureManifest.files ?? []) {
    if (!allowedFixtures.has(item.filename) || fixtureFiles.some(file => file.filename === item.filename)) throw new Error("Fixture manifest contains an unexpected synthetic document");
    const filename = path.join(fixturesDirectory, item.filename);
    await requireRegularFile(filename, "synthetic fixture");
    const bytes = await readFile(filename);
    if (createHash("sha256").update(bytes).digest("hex") !== item.sha256) throw new Error(`Synthetic fixture checksum mismatch: ${item.filename}`);
    fixtureFiles.push({ filename, title: String(item.title), sha256: item.sha256 });
  }
  if (fixtureFiles.length !== 2 || allowedFixtures.size !== fixtureFiles.length) throw new Error("This host driver requires the two generated synthetic PDFs");

  const source = await readFile(path.join(root, "tests/host/driver.js"), "utf8");
  const sourceHash = createHash("sha256").update(source).digest("hex");
  const config = {
    runId,
    profile,
    data,
    reportPath,
    installedProductPath,
    product: { addonId: product.manifest.applications.zotero.id, version: product.manifest.version, sha256: product.digest },
    fixtures: fixtureFiles,
    driverSourceSha256: sourceHash,
  };
  const configText = `${JSON.stringify(config, null, 2)}\n`;
  const bootstrap = `function startup(data) {\n  Zotero.initializationPromise.then(async () => {\n    const scope = { Zotero, ChromeUtils, PathUtils, IOUtils, Services, URL, setTimeout, clearTimeout };\n    Services.scriptloader.loadSubScriptWithOptions(data.rootURI + "driver.js", { target: scope, ignoreCache: true });\n    await scope.runHostInspection(${JSON.stringify(config)});\n  }).catch(error => Zotero.logError(error));\n}\nfunction shutdown() {}\nfunction install() {}\nfunction uninstall() {}\n`;
  const driverManifest = {
    manifest_version: 2,
    name: "Zotero ChatGPT Web isolated host test driver",
    version: "1.0.0",
    applications: { zotero: { id: addonId, strict_min_version: "9.0.6", strict_max_version: "9.0.*", update_url: "https://zotero-chatgpt-web-test.invalid/updates.json" } },
  };
  const entries = [
    ["manifest.json", JSON.stringify(driverManifest)],
    ["bootstrap.js", bootstrap],
    ["driver.js", source],
    ["config.json", configText],
  ];
  await writeDriverArchive(entries, driverXpi);
  const bytes = await readFile(driverXpi);
  const driverHash = createHash("sha256").update(bytes).digest("hex");
  const summary = {
    runId, profile, data, reportPath, driverXpi,
    product: config.product,
    driver: { addonId, sourceSha256: sourceHash, xpiSha256: driverHash, files: allowedDriverFiles },
    launchCommand: `'/Applications/Zotero.app/Contents/MacOS/zotero' -no-remote -profile '${profile.replaceAll("'", `'"'"'`)}' -datadir '${data.replaceAll("'", `'"'"'`)}'`,
  };
  return summary;
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log("Prepare the test-only host driver for a stopped dedicated Zotero run.\nUsage: node scripts/prepare-host-driver.mjs --run-id <dedicated-run-id> --xpi <final.xpi>");
    } else {
      const result = await prepareHostDriver(args);
      console.log(`Prepared test-only driver: ${result.driverXpi}`);
      console.log(`Product XPI: ${result.product.version} ${result.product.sha256}`);
      console.log(`Driver XPI SHA-256: ${result.driver.xpiSha256}`);
      console.log(`Sanitized report: ${result.reportPath}`);
      console.log("Launch only this stopped dedicated profile:");
      console.log(result.launchCommand);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
