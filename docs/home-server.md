# Remy on a home server

`remy serve` runs Remy as one process on one port (7790). It serves the web app and the API together, so a phone or a laptop on your network can use it. The Docker image runs exactly that and nothing else: no database server, no queue, no proxy. Everything it keeps is in one folder, `/data`.

## Build and run

You need Docker. From the repository folder:

```
docker compose up -d --build
```

Or without compose:

```
docker build -t remy .
docker run -d --name remy --restart unless-stopped \
  -e REMY_PROFILE=openrouter -e REMY_MODEL=<model id> -e OPENROUTER_API_KEY \
  -p 127.0.0.1:7790:7790 -v remy-data:/data remy
```

Remy needs a model. On a server you can also add one from the web app once you are signed in (Settings, Model and keys). Or set `REMY_PROFILE`, `REMY_MODEL` and the profile's key variable (for example `OPENROUTER_API_KEY`) in a file named `.env` next to `docker-compose.yml`. Do not commit that file. Run `remy doctor` inside the container (`docker exec -it remy remy doctor`) to see which profiles are ready.

Check that it is up:

```
curl http://127.0.0.1:7790/api/health
```

The image shows `healthy` in `docker ps` once that answers.

## The sign-in token

The first start makes a token. A container's log is kept, so the token is not printed there: it is written to a private file (mode 0600) in `/data`, and the log says where. Only its hash is kept besides. Read it, sign in, then delete the file.

```
docker exec remy cat /data/serve-token-first-run.txt
docker exec remy rm /data/serve-token-first-run.txt
```

The API takes it as `Authorization: Bearer <token>`. The web app at `http://127.0.0.1:7790/` has a sign-in screen for it; the screens are still being wired to the API, so some show sample data for now. If you missed it, or want a new one, make one with:

```
docker exec remy remy serve token --rotate
```

The old token stops working at once, and so does every browser signed in with a link (below). The running server does not need a restart.

### Signing in on the same machine

When you run `remy serve` in a terminal on the machine itself, it prints a one-time link such as `http://127.0.0.1:7790/#/sign-in?code=...`; `remy serve --open` also opens it in your browser. Run `remy serve --open` and that is all: it starts Remy and opens the link. With no model set up yet, the server still starts, and the web app asks for a provider and a key (checked with one tiny test message, then saved in the Keychain on a Mac or a private file in `REMY_HOME`, and never shown again). The link signs one browser in without copying the token. It works once and expires after ten minutes, and the code stays after the `#`, so a browser never sends it in a request. The web app trades it for its own session token and removes it from the address bar. The link is not printed when the output is not a terminal (a container's log is kept). If it has expired, run `remy serve link` in another terminal (below) or paste the token.

### Signing in on your phone with a QR code

On your home Wi-Fi, start Remy so it listens on every interface, and scan the code it draws:

```
REMY_SERVE_ALLOW_REMOTE=on remy serve --host 0.0.0.0
```

For each address a phone can reach (your laptop's Wi-Fi address, say `192.168.1.20`), the terminal prints a QR code and, under it, the same link as text. Open the phone's camera, point it at the code and tap the link. The page signs the phone in and removes the code from the address bar. You can also run `remy serve --host 192.168.1.20` to listen on that one address.

Each code works once, expires after ten minutes, and is counted by the lockout like a wrong token (five wrong tries lock an address out for a minute). Scanning one code does not use up the others. The code sits after the `#` in the link, so the phone's browser never sends it in a request line or a Referer header; the page posts it in the body of one request to `/api/session/exchange` and gets its own session token back. The server still checks the Host and Origin of that request: the address in the phone's address bar is one of this machine's own addresses, so it passes, and a page on another site or a made-up name does not.

If a code has expired, or you closed the page, make another while the server runs:

```
remy serve link
```

Run it in a terminal (it prints nothing where the output could be kept). It makes the code in its own process and gives the server only the code's SHA-256 hash, through a file in `REMY_HOME` that only you can read (mode 0600); the server picks it up within a second and deletes it. The code itself is never written to a file or a log, and there is no new network route. In Docker, run it as `docker exec -it remy remy serve link --url http://192.168.1.20:7790` (the container does not know your Wi-Fi address, so give the one your phone opens, and add its name to `REMY_SERVE_HOSTS` if it is not an IP address).

**What this protects, and what it does not.** The network is not encrypted, so anyone who can read your Wi-Fi traffic can read what the phone sends. A one-time code is no weaker than the alternative, typing the 43-character access token, which the phone would send in the clear on every request. With the code, the phone sends the code once, then a session token of its own on every request. Someone reading the traffic sees both, so over plain HTTP the code does not make an eavesdropper's job any harder, and it does not make it easier: the access token itself never crosses the network, each phone has its own session (at most ten are kept), and `remy serve token --rotate` signs every phone out at once. What the code protects is a link left on a screen or in a screenshot: after one use, or ten minutes, it opens nothing. That is why this is for a home network you trust. On a public network (a cafe, a hotel, a school) do not do this: use Tailscale or WireGuard, or put a reverse proxy with TLS in front, as described below.

## Reaching it from a phone

By default the compose file publishes the port on `127.0.0.1` only, so nothing else can reach it. To use it from a phone, publish it on a private network address instead, by changing the `ports` line, for example `"100.64.0.5:7790:7790"` for a Tailscale address.

**There is no TLS.** The token and everything you type cross the network as plain text. Use only a private network you trust, such as Tailscale or WireGuard, or put a reverse proxy with TLS in front (Caddy and nginx both do this in a few lines) and keep the port itself on `127.0.0.1`. Do not publish the port on the open internet.

The static web files need no token, because they hold no data. Everything under `/api` does, and five wrong tokens lock an address out for a minute.

The server also checks the name in the address bar (the Host header) and answers 421 to any name it does not know. It accepts loopback, this machine's own addresses and its host name (and `name.local`), read when it starts. For any other name, such as a Tailscale MagicDNS name or a reverse proxy name, set `REMY_SERVE_HOSTS=name1,name2`. This check is what stops a web page from reaching the server through DNS rebinding.

## Backups

Everything is in the `remy-data` volume: the task history, notes, schedules, saved settings and the token hash. To back it up, stop the container so no write is half done, then copy the volume out:

```
docker stop remy
docker run --rm -v remy-data:/data -v "$PWD":/backup alpine tar czf /backup/remy-data.tgz -C /data .
docker start remy
```

To restore, put the archive back into an empty volume with the same command in reverse (`tar xzf`). Model keys passed as environment variables are not in the volume; keep them where you keep your other secrets.

A task that is running when the container stops carries on from its saved events when the container starts again. An action that may have already happened is checked before it is repeated, never blindly run twice.

## Updating

```
git pull
docker compose up -d --build
```

The volume is kept, so your history and token stay. Running tasks resume after the restart.

## Notes

- The container runs as an ordinary user (`remy`), not root.
- Remy's local browser (`playwright-core`) is installed but no browser is in the image, to keep it small. Tasks that need a browser on that machine will not work in the container.
- To stop and remove it: `docker compose down`. Add `-v` only if you also want to delete the data.
