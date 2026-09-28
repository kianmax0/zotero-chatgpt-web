import { createWriteStream } from "node:fs";
import { mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import yazl from "yazl";
import { PRODUCT_ID, validateExtensionDirectory } from "./verify-artifacts.mjs";

const root = path.resolve(import.meta.dirname, "..");
const sourceDefault = path.join(root, "build/extension");
// yazl encodes DOS timestamps from local Date fields, so construct local midnight
// to keep the archive bytes stable across time zones.
const fixedTimestamp = new Date(1980, 0, 1, 0, 0, 0, 0);

async function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const relative = prefix ? `${prefix}/${entry.name}` : entry.name;
    if (entry.isDirectory()) files.push(...await listFiles(path.join(directory, entry.name), relative));
    else if (entry.isFile()) files.push(relative);
  }
  return files.sort();
}

function writeArchive(source, output, files) {
  return new Promise((resolve, reject) => {
    const zip = new yazl.ZipFile();
    const stream = createWriteStream(output, { flags: "w" });
    stream.once("close", resolve);
    stream.once("error", reject);
    zip.outputStream.once("error", reject);
    zip.outputStream.pipe(stream);
    for (const file of files) zip.addFile(path.join(source, file), file, { mode: 0o100644, mtime: fixedTimestamp, forceDosTimestamp: true });
    zip.end();
  });
}

export async function packageExtension(source = sourceDefault, output) {
  const files = await listFiles(source);
  const manifest = await validateExtensionDirectory(source, files);
  const destination = output ?? path.join(root, "dist", `zotero-chatgpt-web-${manifest.version}.xpi`);
  await mkdir(path.dirname(destination), { recursive: true });
  await writeArchive(source, destination, files);
  const digest = createHash("sha256").update(await readFile(destination)).digest("hex");
  await writeFile(path.join(path.dirname(destination), "SHA256SUMS"), `${digest}  ${path.basename(destination)}\n`);
  return { path: destination, digest, addonId: PRODUCT_ID, version: manifest.version, files };
}

if (fileURLToPath(import.meta.url) === path.resolve(process.argv[1] ?? "")) {
  const value = name => {
    const index = process.argv.indexOf(name);
    if (index < 0) return undefined;
    const argument = process.argv[index + 1];
    if (!argument || argument.startsWith("--")) throw new Error(`${name} requires a path`);
    return path.resolve(argument);
  };
  packageExtension(value("--source") ?? sourceDefault, value("--output")).then(result => {
    console.log(`Packaged ${path.basename(result.path)} (${result.files.length} files)`);
    console.log(`SHA-256 ${result.digest}`);
  }).catch(error => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
