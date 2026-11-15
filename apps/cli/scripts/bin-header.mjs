// The source of release/remy.js, the published bin. It sets NODE_ENV before the bundle (release/main.js)
// loads React, for the same reason as src/main.ts, and hides Node 22's one-line SQLite warning
// ("ExperimentalWarning: SQLite is an experimental feature...") that otherwise printed above the output
// of every command. Only that warning is hidden; Node 24 and later do not print it at all.
export function binSource(main = './main.js') {
  return `#!/usr/bin/env node
process.env.NODE_ENV ??= 'production';
const emitWarning = process.emitWarning;
process.emitWarning = function (warning, ...rest) {
  const type = typeof rest[0] === 'string' ? rest[0] : rest[0]?.type;
  if (type === 'ExperimentalWarning' && /SQLite/.test(String(warning?.message ?? warning))) return;
  return emitWarning.call(this, warning, ...rest);
};
await import('${main}');
`;
}
