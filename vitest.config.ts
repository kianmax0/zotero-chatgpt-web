import { readFileSync } from "node:fs";
import path from "node:path";
import { defineConfig } from "vitest/config";

const sidebarCss = readFileSync(path.resolve(import.meta.dirname, "assets/sidebar.css"), "utf8");

export default defineConfig({
  define: { __ZCHATGPTWEB_SIDEBAR_CSS__: JSON.stringify(sidebarCss) },
  test: { include: ["tests/**/*.test.ts"] },
});
