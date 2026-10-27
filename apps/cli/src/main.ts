#!/usr/bin/env node
import { createInterface } from 'node:readline/promises';
import { cli } from './cli.ts';

const tty = Boolean(process.stdin.isTTY && process.stdout.isTTY);

async function ask(question: string): Promise<string | null> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on('SIGINT', () => process.emit('SIGINT'));
  try {
    return await rl.question(question);
  } catch {
    return null;
  } finally {
    rl.close();
  }
}

process.exitCode = await cli(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
  isTTY: tty,
  ask,
  readStdin: async () => {
    const chunks: Buffer[] = [];
    for await (const c of process.stdin) chunks.push(c as Buffer);
    return Buffer.concat(chunks).toString('utf8');
  },
  onInterrupt: (handler) => {
    const onSigint = () => void handler().finally(() => process.exit(130));
    process.once('SIGINT', onSigint);
    return () => void process.off('SIGINT', onSigint);
  },
});
