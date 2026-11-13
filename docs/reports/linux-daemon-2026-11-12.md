# Linux daemon on real systemd, 2026-11-12

`remy daemon install` on Linux writes a systemd user unit. It was generated and unit-tested but never
installed anywhere. This run installs it on real systemd (Debian trixie, systemd as PID 1, Node 24.11.1,
pnpm 12.15.0) inside Docker on colima, as a normal user with linger on. No real API key was used.

## Re-run it

```
test/linux-daemon/run.sh            # about 8 minutes; removes its container at the end
KEEP=1 test/linux-daemon/run.sh     # leaves container remyd up
```

Files: `test/linux-daemon/Dockerfile` (image `remy-linux-daemon`), `run.sh` (the whole check, 12 asserts),
`fake-model.mjs` (an OpenAI-compatible server that answers every call with a `finish` tool call). Not part
of `pnpm check`.

## How the container is run

```
docker build -t remy-linux-daemon test/linux-daemon
docker run -d --name remyd --privileged --cgroupns=host \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock remy-linux-daemon
docker exec remyd loginctl enable-linger remy      # user manager starts, /run/user/1000/bus appears
```

That worked first time under colima (system state `degraded`, which is normal in a container; the user
manager runs). The repo is copied in with `tar | docker exec -i ... tar -x` (node_modules, .git excluded),
then `pnpm install --frozen-lockfile` as the user. Corepack's pnpm shim failed in the container
(`pnpm.cjs` not found), so the image installs pnpm with `npm i -g pnpm@12.15.0`. The model is a
`remy.config.json` in `~/.remy` pointing `baseUrl` at the fake server on 127.0.0.1:8099.

## What was observed (final run, `passed 12, failed 0`)

```
== remy daemon install
The daemon is on and keeps running when you log out.
[Service]
Type=simple
ExecStart="/usr/local/bin/node" "--conditions=@remy/source" "/home/remy/remy/apps/cli/src/main.ts" "daemon" "run"
Environment="PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin"
Restart=on-failure
RestartSec=5
[Install]
WantedBy=default.target
PASS  unit file exists / unit is enabled / unit is active
● remy.service - Remy daemon: runs your schedules
     Loaded: loaded (/home/remy/.config/systemd/user/remy.service; enabled; preset: enabled)
     Active: active (running) ...
             └─274 /usr/local/bin/node --conditions=@remy/source .../main.ts daemon run
-- remy daemon status
The daemon is on.
== install again: the daemon restarts on the new unit
pid before 241, after 346           PASS  a second install restarted the daemon
== kill -9 the daemon
pid before 346, after 367; NRestarts=1    PASS  systemd restarted it, active again
== a schedule fires (every 5 minutes, the shortest allowed)
Scheduled sched_de015313. Next run: 11/13/2026, 4:06:53 AM.
task_207d593b2684  bg done  2026-11-13 04:07  say hi from schedule
fake model log: 2026-11-13T04:07:21.144Z POST /chat/completions stream=false
PASS  the daemon started the scheduled task
== remy daemon uninstall
The daemon is off.
PASS  unit file is gone / unit is not active / no process left (0 unit files listed)
```

The shortest schedule is every 5 minutes (`MIN_MINUTES`), so the run waits for one fire. The daemon ticks
every 30 s, so the task started at 04:07:21 for a run due at 04:06:53.

An earlier first pass (before the fixes) on the same image showed the bugs below.

## Bugs found and fixed (`apps/cli/src/service.ts`, commit 592faeb)

1. **A second `remy daemon install` did not restart a running daemon.** `enable --now` does nothing to a
   unit that is already active, so after rewriting the unit (a new Remy version, a moved install) the old
   process kept running old code. Observed: same MainPID before and after (399 and 399), and
   `RestartUSec` still 5 s after the unit file said 7 s. Install now runs `enable` then `restart`.
2. **The linger line was always printed, said "yourself", and named no user.** It now asks
   `loginctl show-user <user> --property=Linger --value`. With linger on it says the daemon keeps
   running after logout; otherwise it prints `loginctl enable-linger <user>` with the real login name.
   It is only printed, never run.
3. **`REMY_HOME` did not reach the service.** The unit carried only PATH, so a person with a custom
   `REMY_HOME` had a daemon reading `~/.remy` while the CLI wrote schedules elsewhere. The unit now
   gets `Environment="REMY_HOME=..."` when it was set at install time (nothing extra when it was not).

Unit tests added in `apps/cli/src/service.test.ts` for each (restart not `enable --now`, linger on and
off with the user name, REMY_HOME present and absent); the old "enable --now" and enable-failure tests
were updated.

## Checked and fine

ExecStart quoting (every word double-quoted), full path to node, node flags kept, PATH carried,
`Restart=on-failure` (a `kill -9` counts as a failure, restart after 5 s), `WantedBy=default.target`,
uninstall (`disable --now`, file removed, daemon-reload, no process left), `remy daemon status`.

## Not done, worth knowing

- The unit path is fixed at `~/.config/systemd/user`; a set `XDG_CONFIG_HOME` is ignored (systemd would
  look elsewhere). Not hit here.
- `After=network-online.target` is harmless but means nothing in a user unit.
- Real reboot or logout/login with linger off was not tested (a container has no logout). Linger on and
  the user manager running was.
- Tested on aarch64 Debian trixie only, from source (`node --conditions=@remy/source`), not the npm bundle.
- The daemon on a machine with a display session, WSL, and Ubuntu were not tried.
