// @eslint-react has no no-unescaped-entities equivalent. Keep the previous
// default four-character check without retaining eslint-plugin-react.
export const noUnescapedEntities = {
  meta: {
    type: "problem",
    docs: { description: "Disallow unescaped special characters in JSX text" },
    schema: [],
    messages: {
      unescaped: 'Unescaped "{{character}}" in JSX text. Use an HTML entity or a JSX expression.',
    },
  },
  create(context) {
    return {
      JSXText(node) {
        // Read source, not decoded node.value: &quot; and &apos; are valid.
        const text = context.sourceCode.getText(node);
        for (const match of text.matchAll(/[>"'}]/gu)) {
          const index = node.range[0] + match.index;
          context.report({
            node,
            loc: {
              start: context.sourceCode.getLocFromIndex(index),
              end: context.sourceCode.getLocFromIndex(index + 1),
            },
            messageId: "unescaped",
            data: { character: match[0] },
          });
        }
      },
    };
  },
};
