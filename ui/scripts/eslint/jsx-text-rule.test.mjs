import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { noUnescapedEntities } from "./jsx-text-rule.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
}).run("no-unescaped-entities", noUnescapedEntities, {
  valid: [
    "<p>plain text</p>",
    "<p>&quot;&apos;&gt;&#125;</p>",
    '<p>{"don\'t"}</p>',
    '<p title="quoted text" />',
  ],
  invalid: [
    { code: "<p>don't</p>", errors: [{ messageId: "unescaped", data: { character: "'" }, line: 1, column: 7 }] },
    { code: '<p>"quoted"</p>', errors: [{ messageId: "unescaped" }, { messageId: "unescaped" }] },
    { code: "<p>line one\nsecond 'line</p>", errors: [{ messageId: "unescaped", line: 2, column: 8 }] },
  ],
});
