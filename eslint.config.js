import js from "@eslint/js";

export default [
  { ignores: ["node_modules/", "package-lock.json"] },
  js.configs.recommended,
  {
    files: ["src/**/*.mjs", "test/**/*.mjs", "eslint.config.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        process: "readonly",
        console: "readonly",
        setTimeout: "readonly",
        globalThis: "readonly",
        fetch: "readonly",
        AbortSignal: "readonly",
        Buffer: "readonly",
      },
    },
  },
];
