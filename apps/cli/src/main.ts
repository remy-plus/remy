#!/usr/bin/env node
// Entry point. React picks its slow development build unless NODE_ENV says production, and it
// reads NODE_ENV when it first loads, so this is set before the app (and React) is imported.
process.env.NODE_ENV ??= 'production';
await import('./run.ts');
