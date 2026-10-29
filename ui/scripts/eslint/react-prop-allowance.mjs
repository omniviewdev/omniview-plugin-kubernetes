import react from "@eslint-react/eslint-plugin";

function isAllowedPropDefinition(node) {
  // Preserve react/no-unstable-nested-components' allowAsProps: true.
  // ColumnDef render callbacks are object properties, not component definitions.
  if (node.parent?.type === "Property" && node.parent.parent.type === "ObjectExpression") return true;
  for (let parent = node.parent; parent; parent = parent.parent) {
    if (parent.type === "JSXAttribute" && parent.value?.type === "JSXExpressionContainer") return true;
  }
  return false;
}

const nestedComponents = react.rules["no-nested-component-definitions"];

export const reactWithPropAllowance = {
  ...react,
  rules: {
    ...react.rules,
    "no-nested-component-definitions": {
      ...nestedComponents,
      create(context) {
        // The replacement has no allowAsProps option. Filter only that existing
        // allowance, while retaining upstream component detection and messages.
        const allowedContext = Object.create(context, {
          report: {
            value(descriptor) {
              if (!isAllowedPropDefinition(descriptor.node)) context.report(descriptor);
            },
          },
        });
        return nestedComponents.create(allowedContext);
      },
    },
  },
};
