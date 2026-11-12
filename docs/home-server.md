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

Remy needs a model. Set `REMY_PROFILE`, `REMY_MODEL` and the profile's key variable (for example `OPENROUTER_API_KEY`) in a file named `.env` next to `docker-compose.yml`. Do not commit that file. Run `remy doctor` inside the container (`docker exec -it remy remy doctor`) to see which profiles are ready.

Check that it is up:

```
curl http://127.0.0.1:7790/api/health
```

The image shows `healthy` in `docker ps` once that answers.

## The sign-in token

The first start makes a token and prints it once in the log. Only its hash is kept in `/data`.

```
docker logs remy
```

The API takes it as `Authorization: Bearer <token>`. The web app at `http://127.0.0.1:7790/` has a sign-in screen for it; the screens are still being wired to the API, so some show sample data for now. If you missed it, or want a new one, make one with:

```
docker exec remy remy serve token --rotate
```

The old token stops working at once. The running server does not need a restart.

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
