import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";
import prettier from "eslint-config-prettier";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  prettier,
  globalIgnores([
    ".next/**",
    "out/**",
    "build/**",
    "coverage/**",
    "playwright-report/**",
    "test-results/**",
    "next-env.d.ts",
    "src/lib/api/generated/**",
  ]),
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      // Authentication material must never live in script-readable storage. Language preference uses a cookie.
      "no-restricted-globals": [
        "error",
        {
          name: "localStorage",
          message:
            "Do not store tokens or personal data in localStorage. Use the sealed session cookie.",
        },
        {
          name: "sessionStorage",
          message: "Do not store tokens or personal data in sessionStorage.",
        },
      ],
      "no-restricted-properties": [
        "error",
        {
          object: "window",
          property: "localStorage",
          message: "Do not use localStorage for tokens or personal data.",
        },
        {
          object: "window",
          property: "sessionStorage",
          message: "Do not use sessionStorage for tokens or personal data.",
        },
      ],
    },
  },
  {
    // Visual components never talk to the network; data comes from feature services / hooks.
    files: ["src/components/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-globals": [
        "error",
        {
          name: "fetch",
          message: "Components must not call APIs directly. Use a feature service or hook.",
        },
        { name: "XMLHttpRequest", message: "Components must not call APIs directly." },
        { name: "localStorage", message: "Do not store tokens or personal data in localStorage." },
        {
          name: "sessionStorage",
          message: "Do not store tokens or personal data in sessionStorage.",
        },
      ],
    },
  },
  {
    files: ["tests/**", "**/*.test.{ts,tsx}", "*.config.*"],
    rules: { "no-restricted-globals": "off" },
  },
]);

export default eslintConfig;
