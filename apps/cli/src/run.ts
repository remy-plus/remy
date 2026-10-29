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

/** Reads one line from the terminal without echoing it (Backspace edits, Ctrl+C gives up). */
function askSecret(question: string): Promise<string | null> {
  if (!process.stdin.isTTY) return Promise.resolve(null);
  return new Promise((resolve) => {
    let value = '';
    const done = (result: string | null) => {
      process.stdin.off('data', onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write('\n');
      resolve(result);
    };
    const onData = (chunk: Buffer) => {
      for (const ch of chunk.toString('utf8')) {
        if (ch === '\r' || ch === '\n') return done(value);
        if (ch === '\u0003' || ch === '\u0004') return done(null);
        if (ch === '\u007f' || ch === '\b') value = value.slice(0, -1);
        else if (ch >= ' ') value += ch;
      }
    };
    process.stdout.write(question);
    process.stdin.setRawMode(true);
    process.stdin.resume();
    process.stdin.on('data', onData);
  });
}

process.exitCode = await cli(process.argv.slice(2), {
  env: process.env,
  cwd: process.cwd(),
  out: (s) => process.stdout.write(s),
  err: (s) => process.stderr.write(s),
  isTTY: tty,
  ask,
  askSecret,
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
