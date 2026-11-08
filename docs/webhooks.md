# Webhooks

A webhook lets another program start a Remy task by sending an HTTP request. You save a prompt under a name, and each request to that name runs the prompt once in the background. The answer is never sent back to the caller; you see the result with `remy review`.

## Set up

1. Save a hook: `remy webhook add deploys "Summarise the deploy event in one line."`
2. Turn listening on: `remy webhook enable`
3. Start the listener. It runs inside `remy daemon run`, or by hand with `remy webhook start`. Restart the daemon after `enable`.
4. Read your token: `remy webhook token`
5. Try it without the network: `remy webhook test deploys --data event.json`

`remy webhook list` shows the hooks and whether listening is on. `remy webhook rm <name>` removes one. `remy webhook disable` turns listening off.

## Call it

```
curl -X POST http://127.0.0.1:7788/hook/deploys \
  -H "Authorization: Bearer $(remy webhook token)" \
  -H "Content-Type: application/json" \
  -d '{"event":"deploy","status":"ok"}'
```

A started run answers `202` with `{"run":"<task id>"}` and nothing else. The default port is 7788; change it with `--port` or `REMY_WEBHOOK_PORT`. The body must be `application/json` or `text/*`.

## The token

The shared token is 32 random bytes, made on first use and kept in `webhook-token` in your Remy folder, readable only by you. `remy webhook token --rotate` replaces it, and the old one stops working at once. `remy webhook token <name>` makes a token for one hook that opens only that hook. It is shown once and only its hash is saved; `--shared` puts the hook back on the shared token. A wrong token and an unknown hook get the same answer. The token is never written to the log.

## Limits

- Bodies over 64 KB are refused, and a body must arrive within 10 seconds.
- One run per hook every 10 seconds, and at most 3 webhook runs going at once. Beyond that the answer is `429`.
- Five wrong tokens from one address in a minute block that address for five minutes.
- Only the first 8,000 characters of a payload reach the model.
- The log holds the hook name, status, address, and the payload's size and a short hash, never the payload.

## Payloads are untrusted

Whatever a webhook sends is data, not instructions. Remy removes control and hidden characters, cuts it short, and puts it after your saved prompt marked as untrusted. The run starts tainted and at trust level `ask`, whatever you set for chat, with no always-allow approvals. It may read. Writing a file, sending a message, running a command or anything else that changes something waits for a card, and a webhook run has nobody to answer it until you open `remy review`. The task is not marked done while a card is waiting.

## Use a private network, not an open port

Do not forward a port from your router. The listener has no TLS, and a token over plain HTTP can be read on the way. If a sender is on another machine, put both on a private network such as Tailscale and bind to that address with `--bind <tailscale address>`.

Binding anything other than loopback is refused unless you set `REMY_WEBHOOK_ALLOW_REMOTE=on`. That variable removes the check and nothing else; there is still no TLS.

## What has not been tested

The listener has only been run on loopback. It has not been exposed beyond 127.0.0.1 and has not been tested against a real sender such as GitHub or Stripe. Senders that sign their requests instead of sending a bearer token are not supported yet.
