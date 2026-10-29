import eslint from "@eslint/js";
import tseslint from "typescript-eslint";
import stylistic from "@stylistic/eslint-plugin";
import reactHooks from "eslint-plugin-react-hooks";
import jsxA11y from "eslint-plugin-jsx-a11y-x";
import importX from "eslint-plugin-import-x";
import reactRefresh from "eslint-plugin-react-refresh";
import storybook from "eslint-plugin-storybook";
import prettierConfig from "eslint-config-prettier";
import globals from "globals";
import { noUnescapedEntities } from "./scripts/eslint/jsx-text-rule.mjs";
import { reactWithPropAllowance } from "./scripts/eslint/react-prop-allowance.mjs";

export default tseslint.config(
  // Global ignores
  { ignores: ["dist/**", "node_modules/**", ".storybook/**", "src/**/*.js"] },

  // Base configs
  eslint.configs.recommended,
  {
    files: ["**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommended],
  },
  {
    files: ["src/**/*.{ts,tsx}"],
    extends: [...tseslint.configs.recommendedTypeChecked],
  },
  {
    ...reactHooks.configs.flat["recommended-latest"],
    files: ["src/**/*.{ts,tsx}"],
  },
  jsxA11y.configs.recommended,
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
      "@eslint-react": reactWithPropAllowance,
      "@stylistic": stylistic,
      "omniview-react": { rules: { "no-unescaped-entities": noUnescapedEntities } },
      "import-x": importX,
      "react-refresh": reactRefresh,
    },
    settings: {
      "react-x": { version: "detect" },
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

      // --- React ---
      // Explicit equivalents of react/recommended, not a broader React preset.
      // TypeScript checks duplicate/undefined JSX props, removed string refs,
      // isMounted, and class render return types; its parser tracks JSX bindings.
      // Keep prop-types and display-name disabled as before.
      "@eslint-react/no-missing-key": "error",
      "@eslint-react/jsx-no-comment-textnodes": "error",
      "@eslint-react/dom-no-unsafe-target-blank": "error",
      "@eslint-react/jsx-no-children-prop": "error",
      "@eslint-react/jsx-no-children-prop-with-children": "error",
      "@eslint-react/dom-no-dangerously-set-innerhtml-with-children": "error",
      "@eslint-react/no-component-will-mount": "error",
      "@eslint-react/no-component-will-receive-props": "error",
      "@eslint-react/no-component-will-update": "error",
      "@eslint-react/no-direct-mutation-state": "error",
      "@eslint-react/dom-no-find-dom-node": "error",
      "@eslint-react/dom-no-render-return-value": "error",
      "@eslint-react/dom-no-render": "error",
      "@eslint-react/dom-no-hydrate": "error",
      "@eslint-react/dom-no-unknown-property": "error",
      "omniview-react/no-unescaped-entities": "error",
      // Local adapter preserves allowAsProps: true for ColumnDef render props.
      "@eslint-react/no-nested-component-definitions": "warn",
      "@eslint-react/no-unstable-context-value": "warn",
      "@eslint-react/jsx-no-useless-fragment": ["warn", { allowExpressions: true }],
      "@eslint-react/no-array-index-key": "warn",
      "@stylistic/jsx-self-closing-comp": "warn", // autofix

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
