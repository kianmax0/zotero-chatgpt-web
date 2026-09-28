import path from "node:path";

const macExecutable = "/Applications/Zotero.app/Contents/MacOS/zotero";

function isAbsoluteForPlatform(value, platform) {
  if (platform === "win32") return path.win32.isAbsolute(value);
  if (platform === "darwin" || platform === "linux") return path.posix.isAbsolute(value);
  return false;
}

/** Pick Zotero's native default, or validate the caller's absolute executable override. */
/** @param {{ platform?: string, env?: NodeJS.ProcessEnv, zoteroPath?: string }} options */
export function resolveZoteroExecutable({ platform = process.platform, env = process.env, zoteroPath } = {}) {
  if (!new Set(["darwin", "linux", "win32"]).has(platform)) {
    throw new Error(`Unsupported Zotero host platform: ${platform}`);
  }
  if (zoteroPath !== undefined) {
    if (typeof zoteroPath !== "string" || !zoteroPath || !isAbsoluteForPlatform(zoteroPath, platform)) {
      throw new Error("--zotero must be an absolute path to the Zotero executable");
    }
    return zoteroPath;
  }
  if (platform === "darwin") return macExecutable;
  if (platform === "win32") return path.win32.join(env.ProgramFiles || "C:\\Program Files", "Zotero", "zotero.exe");
  return "zotero";
}

function posixQuote(value) {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function powershellQuote(value) {
  return `'${value.replaceAll("'", "''")}'`;
}

/** Render a command the user can paste into the native shell for the target OS. */
/** @param {{ platform?: string, executable: string, profile: string, data: string }} options */
export function formatZoteroLaunchCommand({ platform = process.platform, executable, profile, data }) {
  if (platform === "win32") {
    return `& ${powershellQuote(executable)} -no-remote -profile ${powershellQuote(profile)} -datadir ${powershellQuote(data)}`;
  }
  if (platform === "darwin" || platform === "linux") {
    return `${posixQuote(executable)} -no-remote -profile ${posixQuote(profile)} -datadir ${posixQuote(data)}`;
  }
  throw new Error(`Unsupported Zotero host platform: ${platform}`);
}
