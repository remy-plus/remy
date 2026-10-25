import type { Move } from '../types.ts';

export const page = (title: string, ...paras: string[]) =>
  `<html><head><title>${title}</title></head><body><h1>${title}</h1>${paras.map((p) => `<p>${p}</p>`).join('')}</body></html>`;

export const fetchUrl = (url: string) => ({ tool: 'fetch_url', args: { url } });
export const finish = (answer: string): Move => [{ tool: 'finish', args: { answer } }];
export const readFile = (path: string) => ({ tool: 'read_file', args: { path } });
export const writeFile = (path: string, content: string) => ({
  tool: 'write_file',
  args: { path, content },
});
export const emailSend = (to: string, subject: string, body: string) => ({
  tool: 'email_send',
  args: { to, subject, body },
});
