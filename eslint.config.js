import js from "@eslint/js";
import reactHooks from "eslint-plugin-react-hooks";
import { defineConfig } from "eslint/config";
import globals from "globals";
import tseslint from "typescript-eslint";

export default defineConfig(
  { ignores: ["**/dist/**", "**/node_modules/**", "test-results/**", "playwright-report/**"] },
  js.configs.recommended,
  tseslint.configs.recommended,
  {
    languageOptions: { globals: globals.browser },
    rules: {
      // Payment code must never log: a stray console.log(values) is how card numbers leak.
      "no-console": ["error", { allow: ["warn"] }],
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["packages/checkout-app/**/*.{ts,tsx}"],
    plugins: { "react-hooks": reactHooks },
    rules: reactHooks.configs.recommended.rules,
  },
  {
    files: ["scripts/**", "e2e/**", "**/*.config.{js,ts}"],
    languageOptions: { globals: globals.node },
    rules: { "no-console": "off" },
  },
);
