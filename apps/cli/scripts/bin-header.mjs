// The source of release/remy.js, the published bin. It sets NODE_ENV before the bundle (release/main.js)
// loads React, for the same reason as src/main.ts, and hides Node 22's one-line SQLite warning
// ("ExperimentalWarning: SQLite is an experimental feature...") that otherwise printed above the output
// of every command. Only that warning is hidden; Node 24 and later do not print it at all. It also stops
// early, with one plain sentence, on a Node older than 22.18 (the bundle needs node:sqlite, and Node 20
// died with "No such built-in module: node:sqlite" and a stack trace).
export function binSource(main = './main.js') {
  return `#!/usr/bin/env node
process.env.NODE_ENV ??= 'production';
const [major, minor] = process.versions.node.split('.').map(Number);
if (major < 22 || (major === 22 && minor < 18)) {
  console.error(\`Remy needs Node 22.18 or newer, and this computer has Node \${process.versions.node}. Install a newer Node from nodejs.org, then run remy again.\`);
  process.exit(1);
}
const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type;
  if (type === 'ExperimentalWarning' && /SQLite/.test(String(warning?.message ?? warning))) return;
  return emitWarning.call(this, warning, ...rest);
};
await import('${main}');
`;
}
