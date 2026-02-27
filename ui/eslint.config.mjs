import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import react from "eslint-plugin-react";
import reactHooks from "eslint-plugin-react-hooks";
import reactPerf from "eslint-plugin-react-perf";
import jsxA11y from "eslint-plugin-jsx-a11y";
import importX from "eslint-plugin-import-x";
import reactRefresh from "eslint-plugin-react-refresh";
import storybook from "eslint-plugin-storybook";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";

export default tseslint.config(
  // Global ignores
  { ignores: ["dist/**", "node_modules/**", ".storybook/**", "src/**/*.js"] },

  // Base configs
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  react.configs.flat.recommended,
  react.configs.flat["jsx-runtime"], // React 17+ JSX transform (no import React)
  reactHooks.configs.flat["recommended-latest"],
  jsxA11y.flatConfigs.recommended,
  ...storybook.configs["flat/recommended"],
  prettierConfig,

  // Main config for all TS/TSX files
  {
    files: ["src/**/*.{ts,tsx}"],
    languageOptions: {
      globals: { ...globals.browser },
      parserOptions: {
        projectService: true,
        tsconfigRootDir: import.meta.dirname,
      },
    },
    plugins: {
      "react-perf": reactPerf,
      "import-x": importX,
      "react-refresh": reactRefresh,
    },
    settings: {
      react: { version: "detect" },
      "import-x/resolver": { typescript: true },
    },
    rules: {
      // --- TypeScript ---
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
      "@typescript-eslint/no-explicit-any": "warn",
      "@typescript-eslint/no-floating-promises": "error",
      "@typescript-eslint/no-misused-promises": "error",
      "@typescript-eslint/await-thenable": "error",

      // --- React Performance ---
      // Compiler handles function/array/jsx memoization automatically.
      // Keep object rule to flag sx resolver overhead in hot paths.
      "react-perf/jsx-no-new-object-as-prop": "warn",
      "react-perf/jsx-no-new-array-as-prop": "off",
      "react-perf/jsx-no-new-function-as-prop": "off",
      "react-perf/jsx-no-jsx-as-prop": "off",

      // --- React ---
      "react/prop-types": "off", // TypeScript handles this
      "react/display-name": "off",
      // Table cell renderers in ColumnDef are passed as config props, not defined during render
      "react/no-unstable-nested-components": ["warn", { allowAsProps: true }],
      "react/jsx-no-constructed-context-values": "warn",
      "react/jsx-no-useless-fragment": ["warn", { allowExpressions: true }],
      "react/no-array-index-key": "warn",
      "react/self-closing-comp": "warn", // autofix

      // --- React Refresh (Vite HMR) ---
      "react-refresh/only-export-components": [
        "warn",
        { allowConstantExport: true },
      ],

      // --- Import ordering (autofix) ---
      "import-x/order": [
        "warn",
        {
          groups: [
            "builtin",
            "external",
            "internal",
            "parent",
            "sibling",
            "index",
          ],
          "newlines-between": "always",
          alphabetize: { order: "asc", caseInsensitive: true },
        },
      ],
      "import-x/no-duplicates": "warn",

      // --- General quality ---
      "no-console": ["warn", { allow: ["warn", "error"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "no-var": "error",
      "prefer-const": "warn", // autofix
    },
  },

  // Relax type-checked rules for config and test files
  {
    files: ["*.config.{js,mjs,ts}", "vite.config.ts"],
    ...tseslint.configs.disableTypeChecked,
  },
  {
    files: ["src/**/*.test.{ts,tsx}", "src/test-setup.ts"],
    ...tseslint.configs.disableTypeChecked,
  }
);
