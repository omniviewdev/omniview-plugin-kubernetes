import { describe, it } from "node:test";
import { RuleTester } from "eslint";
import { reactWithPropAllowance } from "./react-prop-allowance.mjs";

RuleTester.describe = describe;
RuleTester.it = it;

new RuleTester({
  languageOptions: {
    ecmaVersion: "latest",
    sourceType: "module",
    parserOptions: { ecmaFeatures: { jsx: true } },
  },
}).run("no-nested-component-definitions with allowAsProps", reactWithPropAllowance.rules["no-nested-component-definitions"], {
  valid: [
    "function Child() { return <div />; } function Parent() { return <Child />; }",
    "function Parent() { return <Table Cell={function Cell() { return <div />; }} />; }",
    "function Parent() { const columns = [{ Cell: () => <div /> }]; return <Table columns={columns} />; }",
    "function Parent() { const columns = [{ Cell() { return <div />; } }]; return <Table columns={columns} />; }",
  ],
  invalid: [
    {
      code: "function Parent() { function Child() { return <div />; } return <Child />; }",
      errors: [{ messageId: "default" }],
    },
    {
      code: "function Parent() { const Child = () => <div />; return <Child />; }",
      errors: [{ messageId: "default" }],
    },
  ],
});
