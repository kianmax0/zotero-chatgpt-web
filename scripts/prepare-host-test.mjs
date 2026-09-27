#!/usr/bin/env node
import { randomBytes, createHash } from "node:crypto";
import { lstat, mkdir, readFile, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createFixturePdf } from "../tests/fixtures/create-pdf.mjs";
import { verifyXpi } from "./verify-artifacts.mjs";

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const runIdPattern = /^[a-z0-9][a-z0-9-]{0,47}$/u;

function shellQuote(value) {
  return `'${value.replaceAll("'", `'"'"'`)}'`;
}

async function exists(pathname) {
  try { await lstat(pathname); return true; }
  catch (error) { if (error?.code === "ENOENT") return false; throw error; }
}

function parseArgs(argv) {
  const values = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (flag === "--help" || flag === "-h") return { help: true };
    if (!["--xpi", "--run-id"].includes(flag)) throw new Error(`Unknown option: ${flag}`);
    if (values.has(flag)) throw new Error(`Pass ${flag} only once`);
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) throw new Error(`${flag} requires a value`);
    values.set(flag, value);
    index += 1;
  }
  const xpiPath = values.get("--xpi");
  const runId = values.get("--run-id");
  if (!xpiPath || !runId) throw new Error("Usage: node scripts/prepare-host-test.mjs --xpi <final.xpi> --run-id <new-run-id>");
  return { xpiPath: path.resolve(xpiPath), runId };
}

function assertRunId(runId) {
  if (!runIdPattern.test(runId) || runId === "." || runId === "..") {
    throw new Error("--run-id must be a new lowercase name containing only letters, digits, and dashes");
  }
}

async function assertFreshTestRoot(root, runDirectory) {
  if (await exists(root)) {
    const rootInfo = await lstat(root);
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error("Refusing a non-directory or symlink at the dedicated test root");
  }
  if (await exists(runDirectory)) throw new Error(`Refusing to reuse an existing test run: ${runDirectory}`);
}

function makePreferences(dataDirectory) {
  return {
    "extensions.zotero.useDataDir": true,
    "extensions.zotero.dataDir": dataDirectory,
    "extensions.zotero.firstRun2": false,
    "extensions.zotero.sync.autoSync": false,
    "extensions.zotero.httpServer.enabled": false,
    "extensions.zotero.integration.port": 50021,
    "extensions.zoteroMacWordIntegration.skipInstallation": true,
    "extensions.zoteroOpenOfficeIntegration.skipInstallation": true,
    "extensions.enabledScopes": 15,
    "extensions.startupScanScopes": 1,
    "extensions.autoDisableScopes": 0,
    "extensions.update.enabled": false,
    "app.update.enabled": false,
    "toolkit.telemetry.enabled": false,
    "datareporting.healthreport.uploadEnabled": false,
    "browser.shell.checkDefaultBrowser": false,
    "browser.sessionstore.resume_from_crash": false,
  };
}

/** Create one new profile and data directory owned by this repository. Never reuses a profile. */
export async function prepareHostTest({ xpiPath, runId, repositoryRoot = projectRoot }) {
  assertRunId(runId);
  const repo = await realpath(repositoryRoot);
  const testRoot = path.join(repo, ".zotero-chatgpt-web-test");
  const runDirectory = path.join(testRoot, runId);
  const profile = path.join(runDirectory, "profile");
  const data = path.join(runDirectory, "data");
  const fixtures = path.join(runDirectory, "fixtures");
  const absoluteXpi = path.resolve(xpiPath);

  // Validate the exact candidate before creating any state. verifyXpi also checks the adjacent SHA256SUMS.
  const verified = await verifyXpi(absoluteXpi);
  const xpiBytes = await readFile(absoluteXpi);
  const digest = createHash("sha256").update(xpiBytes).digest("hex");
  if (digest !== verified.digest) throw new Error("Candidate XPI changed during validation");
  await assertFreshTestRoot(testRoot, runDirectory);

  await mkdir(testRoot, { recursive: true, mode: 0o700 });
  const testRootInfo = await lstat(testRoot);
  if (!testRootInfo.isDirectory() || testRootInfo.isSymbolicLink() || await realpath(testRoot) !== testRoot) {
    throw new Error("Refusing a changed or ambiguous dedicated test root");
  }
  // mkdir without recursive is the atomic freshness boundary if another process races this run ID.
  await mkdir(runDirectory, { mode: 0o700 });
  try {
    await mkdir(profile, { mode: 0o700 });
    await mkdir(data, { mode: 0o700 });
    await mkdir(fixtures, { mode: 0o700 });

    const addonId = verified.manifest.applications.zotero.id;
    const extensionDirectory = path.join(profile, "extensions");
    await mkdir(extensionDirectory, { mode: 0o700 });
    const installedXpi = path.join(extensionDirectory, `${addonId}.xpi`);
    await writeFile(installedXpi, xpiBytes, { flag: "wx", mode: 0o600 });
    await writeFile(path.join(profile, "user.js"), Object.entries(makePreferences(data))
      .map(([key, value]) => `user_pref(${JSON.stringify(key)}, ${JSON.stringify(value)});`)
      .join("\n") + "\n", { flag: "wx", mode: 0o600 });

    const fixturesManifest = { generatedAt: new Date().toISOString(), runId, xpi: { version: verified.manifest.version, addonId, sha256: digest }, files: [] };
    for (const [filename, title] of [
      ["synthetic-paper-a.pdf", "Synthetic Paper A: Contextual inference"],
      ["synthetic-paper-b.pdf", "Synthetic Paper B: Measurement selection"],
    ]) {
      const token = `ZWEB-${randomBytes(18).toString("hex").toUpperCase()}`;
      const pdfPath = path.join(fixtures, filename);
      const pdf = createFixturePdf(title, token, ["A second page supports page-selection checks."]);
      await writeFile(pdfPath, pdf, { flag: "wx", mode: 0o600 });
      fixturesManifest.files.push({ filename, title, sha256: createHash("sha256").update(pdf).digest("hex"), verificationToken: token });
    }
    await writeFile(path.join(fixtures, "fixture-manifest.json"), `${JSON.stringify(fixturesManifest, null, 2)}\n`, { flag: "wx", mode: 0o600 });

    return {
      runId, runDirectory, profile, data, fixtures,
      xpi: { path: absoluteXpi, addonId, version: verified.manifest.version, sha256: digest },
      launchCommand: `${shellQuote("/Applications/Zotero.app/Contents/MacOS/zotero")} -no-remote -profile ${shellQuote(profile)} -datadir ${shellQuote(data)}`,
    };
  } catch (error) {
    // Only remove the run directory that this invocation atomically created.
    await rm(runDirectory, { recursive: true, force: true });
    throw error;
  }
}

if (path.resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url)) {
  try {
    const args = parseArgs(process.argv.slice(2));
    if (args.help) {
      console.log("Prepare a fresh, isolated Zotero profile with a verified XPI and synthetic PDFs.\nUsage: node scripts/prepare-host-test.mjs --xpi <final.xpi> --run-id <new-run-id>");
    } else {
      const result = await prepareHostTest(args);
      console.log(`Prepared isolated test run: ${result.runDirectory}`);
      console.log(`XPI: ${result.xpi.version} ${result.xpi.sha256}`);
      console.log(`Synthetic PDFs: ${result.fixtures}`);
      console.log("Import the synthetic PDFs into this isolated Zotero library for Reader checks.");
      console.log("Launch only this profile with:");
      console.log(result.launchCommand);
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
