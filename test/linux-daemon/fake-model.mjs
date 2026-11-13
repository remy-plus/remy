// A fake OpenAI-compatible server for the Linux daemon check. Every request gets a `finish` tool
// call, so a scheduled task ends in one step with no real model and no key.
// Usage: node fake-model.mjs <port>
import { createServer } from 'node:http';

const port = Number(process.argv[2] ?? 8099);
const call = {
  id: 'call_1',
  type: 'function',
  function: {
    name: 'finish',
    arguments: JSON.stringify({ answer: 'Fake model: scheduled run finished.' }),
  },
};
const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 };

createServer((req, res) => {
  let body = '';
  req.on('data', (c) => {
    body += c;
  });
  req.on('end', () => {
    let wantsStream = false;
    try {
      wantsStream = JSON.parse(body).stream === true;
    } catch {}
    console.log(`${new Date().toISOString()} ${req.method} ${req.url} stream=${wantsStream}`);
    if (wantsStream) {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      const send = (o) => res.write(`data: ${JSON.stringify(o)}\n\n`);
      send({
        choices: [
          {
            index: 0,
            delta: { role: 'assistant', tool_calls: [{ index: 0, ...call }] },
            finish_reason: null,
          },
        ],
      });
      send({ choices: [{ index: 0, delta: {}, finish_reason: 'tool_calls' }] });
      send({ choices: [], usage });
      res.end('data: [DONE]\n\n');
    } else {
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(
        JSON.stringify({
          id: 'x',
          model: 'fake',
          choices: [
            {
              index: 0,
              message: { role: 'assistant', content: null, tool_calls: [call] },
              finish_reason: 'tool_calls',
            },
          ],
          usage,
        }),
      );
    }
  });
}).listen(port, '127.0.0.1', () => console.log(`fake model on ${port}`));
