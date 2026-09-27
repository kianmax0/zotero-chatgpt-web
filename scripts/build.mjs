import { cp, mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const root = path.resolve(import.meta.dirname, "..");
const output = path.join(root, "build/extension");
const actorFiles = ["ChatGPTWebChild.mjs", "ChatGPTWebParent.mjs", "chatgpt-dom.mjs"];

function requireSupportedNode() {
  const major = Number(process.versions.node.split(".")[0]);
  if (major !== 24) throw new Error(`Build requires Node 24; found ${process.versions.node}`);
}

async function copyInputs(destination) {
  const files = [
    [path.join(root, "manifest.json"), path.join(destination, "manifest.json")],
    [path.join(root, "bootstrap.js"), path.join(destination, "bootstrap.js")],
    [path.join(root, "LICENSE"), path.join(destination, "LICENSE")],
    [path.join(root, "assets/sidebar.css"), path.join(destination, "content/assets/sidebar.css")],
    [path.join(root, "assets/icon.svg"), path.join(destination, "content/assets/icon.svg")],
    [path.join(root, "preferences/preferences.xhtml"), path.join(destination, "content/preferences/preferences.xhtml")],
    ...actorFiles.map(name => [path.join(root, "actors", name), path.join(destination, "content/actors", name)]),
  ];
  await Promise.all(files.map(async ([source, target]) => {
    await mkdir(path.dirname(target), { recursive: true });
    await cp(source, target);
  }));

  const localeSource = path.join(root, "locale");
  try {
    await cp(localeSource, path.join(destination, "locale"), { recursive: true, filter: source => !source.endsWith(".DS_Store") });
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return;
    throw error;
  }
}

export async function buildExtension(destination = output) {
  requireSupportedNode();
  await rm(destination, { recursive: true, force: true });
  await mkdir(path.join(destination, "content"), { recursive: true });
  await copyInputs(destination);

  const css = await readFile(path.join(root, "assets/sidebar.css"), "utf8");
  const shared = {
    bundle: true,
    format: "iife",
    platform: "browser",
    target: ["firefox128"],
    sourcemap: false,
    define: { __ZCHATGPTWEB_SIDEBAR_CSS__: JSON.stringify(css) },
  };
  await Promise.all([
    build({ ...shared, entryPoints: [path.join(root, "src/index.ts")], globalName: "ZoteroChatGPTWeb", outfile: path.join(destination, "content/zotero-chatgpt-web.js") }),
    build({ ...shared, entryPoints: [path.join(root, "src/settings/entry.ts")], globalName: "ZoteroChatGPTWebSettings", outfile: path.join(destination, "content/preferences.js") }),
  ]);
  return destination;
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const index = process.argv.indexOf("--outdir");
  const argument = index < 0 ? undefined : process.argv[index + 1];
  if (index >= 0 && (!argument || argument.startsWith("--"))) throw new Error("--outdir requires a path");
  const destination = argument ? path.resolve(argument) : output;
  buildExtension(destination).then(() => console.log(`Built extension at ${destination}`)).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
