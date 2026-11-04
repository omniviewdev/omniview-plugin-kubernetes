import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import vm from 'node:vm';
import ts from 'typescript';

// Production builds externalize the runtime, so TypeScript can accept APIs that
// exist in the dependency declarations but no longer exist in the desktop host.
// Inspect the actual System.register setters, without executing plugin modules.
const directory = resolve(process.argv[2] ?? resolve(process.env.OMNIVIEW_BUILD_OUTPUT_DIRECTORY || 'dist', 'assets'));
let runtimeImports = 0;
let inspected = 0;
for (const entry of await readdir(directory, { withFileTypes: true })) {
  if (!entry.isFile() || !entry.name.endsWith('.js')) continue;
  const filename = resolve(directory, entry.name);
  const source = await readFile(filename, 'utf8');
  const context = vm.createContext({
    System: {
      register(dependencies, declare) {
        const registration = declare(() => {}, { meta: { url: `file://${filename}` } });
        dependencies.forEach((dependency, index) => {
          if (dependency !== '@omniviewdev/runtime') return;
          runtimeImports++;
          const setter = registration.setters?.[index];
          // Rollup emits null setters for side-effect-only dependencies.
          if (setter == null) return;
          inspected++;
          setter(new Proxy({}, {
            get(_target, property) {
              if (property === 'useSnackbar') {
                throw new Error(`${filename}: imports retired @omniviewdev/runtime.useSnackbar; use @omniviewdev/runtime.useNotifications instead`);
              }
              return undefined;
            },
          }));
        });
      },
    },
  });
  const parsed = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS);
  for (const statement of parsed.statements) {
    if (!ts.isExpressionStatement(statement) || !ts.isCallExpression(statement.expression)) continue;
    const call = statement.expression;
    if (call.expression.getText(parsed) !== 'System.register') continue;
    // Vite may prepend CSS DOM injection. Inspect only the registration, not
    // unrelated top-level browser code surrounding it.
    vm.runInContext(call.getText(parsed), context, { filename, timeout: 5000 });
  }
}
if (runtimeImports === 0) throw new Error(`No runtime System.register imports found in ${directory}`);
console.log(`Checked ${inspected} production runtime import setters across ${runtimeImports} runtime dependencies for retired notification APIs.`);
