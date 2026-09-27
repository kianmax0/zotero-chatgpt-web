import eslint from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["build/**", "coverage/**", "dist/**", "node_modules/**"] },
  {
    files: ["**/*.mjs"],
    languageOptions: { ecmaVersion: "latest", globals: globals.node, sourceType: "module" },
    rules: eslint.configs.recommended.rules,
  },
  ...tseslint.configs.recommendedTypeChecked.map(config => ({ ...config, files: ["**/*.ts"] })),
  {
    files: ["**/*.ts"],
    languageOptions: { parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname } },
  },
);
