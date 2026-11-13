# Remy's own computer

A computer is a machine Remy may run shell commands on, through the `computer_run` tool. Every
command asks for approval and is never retried. Output is untrusted. Machines live in
`remy.config.json` under `computers`; manage them with `remy computer list|add|test|rm`.

| Kind   | Add it                                                                                                                | Good for                                                                                                                       |
| ------ | --------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------ |
| Docker | `remy computer add box --docker debian:stable-slim [--network none]`, or `--container <name>` for one already running | A throwaway Linux on a machine with Docker. Remy keeps one container (`remy-computer-<name>`), no home folder, not privileged. |
| ssh    | `remy computer add home --ssh user@host[:port] [--key <path>]`                                                        | A server you already run. Host key checking stays on, so add the host to `known_hosts` first.                                  |
| Boat   | `remy computer add cloud --boat [--size small\|default\|large\|xlarge]`                                               | A cloud Linux with nothing running on your laptop. Your own Boat account.                                                      |

`remy computer test <name>` runs `uname -a` there, with no model and no card.

## Boat (optional, your own key)

[Boat](https://boat.dev) rents long-lived Linux machines to agents. Remy has no Boat account and
adds nothing to its own bill: you bring your own key and Boat bills you.

- **Cost.** A 7-day trial (card needed, 25 compute hours), then plans from $20 a month; machines
  bill per second only while running. See https://docs.boat.dev/pricing.
- **Region.** Germany, Finland and France only. There is no region setting, so `--region` is
  refused.
- **Key.** Create one with `boat api-key create` (it starts with `boat_`). Save it with
  `remy search key boat` (macOS Keychain, service `remy`, account `boat`) or set `BOAT_API_KEY`.
  The key is read when the first command runs, sent only to `boat.dev`, and removed from every
  error and output.
- **One machine, reused.** On first use Remy looks for a machine labelled `remy-computer=remy-<name>`
  and makes one (named `remy-<name>`) if there is none. A stopped machine is resumed. Remy
  sets Boat's idle stop (`idleStopSeconds`, default 3600; the trial allows at most 7200), after
  which Boat stops it and keeps its disk for at least 14 days.
- **Removing it.** `remy computer rm` only forgets the entry. Delete the machine at boat.dev to stop
  all charges.
- **Errors.** 401 means the key was refused. 402 means the trial or included time is used up and
  billing is needed. 429 means a start or concurrency limit (Remy says how long to wait). 5xx
  means Boat had a problem. A command Boat cannot confirm finished is reported as possibly still
  running and is never resent. A 409 (machine not ready, so the command never began) is resent once.

Config entry:

```json
{ "kind": "boat", "name": "cloud", "size": "default", "idleStopSeconds": 3600 }
```

### Not verified against a real account

Built from Boat's public docs and tested only with a fake server. Not yet confirmed live: the
exact create and resume behaviour, the label filter on `GET /sandboxes`, the state names a fresh
machine passes through, the trial's 2-hour idle-stop limit, and how long a cold start takes.
