# Remy's own computer through a container: live check, 2026-11-12

Docker 29 through colima on a Mac (aarch64). Everything ran against real Docker and a real sshd, with a
throwaway REMY_HOME and a throwaway key in a temp folder. Containers and temp files were removed after.

## Through the CLI

```
$ remy computer list
No machines yet. Add one with remy computer add <name> --docker debian:stable-slim.
$ remy computer add box --docker debian:stable-slim
Added box: docker container remy-computer-box (debian:stable-slim). Check it with remy computer test box.
$ remy computer test box
Testing box (docker container remy-computer-box (debian:stable-slim)).
Linux f75b0549ebda 6.8.0-117-generic #117-Ubuntu SMP PREEMPT_DYNAMIC Thu May  7 17:26:37 UTC 2026 aarch64 GNU/Linux
box works.
```

The first test created the container (3.4 s including the image that was already local). A second test
printed the same hostname, so the container was reused. `docker inspect` showed no mounts, not
privileged, network `bridge`, label `remy.computer=box`.

## Through the providers (small script)

```
docker echo          {"exitCode":0,"stdout":"hello from ff7b50231c02\nPRETTY_NAME=\"Debian GNU/Linux 13 (trixie)\"..."}
docker exit 3        {"exitCode":3,"stdout":"","stderr":"err\n"}
docker timeout       {"exitCode":0,"stdout":"","stderr":"","timedOut":true}
docker stdin closed  {"exitCode":0,"stdout":"done\n","stderr":""}        (cat got end-of-file, no hang)
docker network none  {"exitCode":0,"stdout":"    lo\n"}                  (only loopback)
ssh uname            {"exitCode":0,"stdout":"Linux 91cbd3a69dfc 6.8.0-117-generic ... aarch64 GNU/Linux\n"}
ssh unknown host key {"exitCode":255,"stderr":"No ED25519 host key is known for [127.0.0.1]:2222 and you have requested strict checking.\r\nHost key verification failed.\r\n"}
```

ssh ran against `lscr.io/linuxserver/openssh-server` (published on 127.0.0.1:2222) with a generated
ed25519 key and a temp known_hosts from `ssh-keyscan` passed as `knownHostsPath`
(`-o UserKnownHostsFile=`). With an empty known_hosts file the same call is refused, so strict host key
checking holds. This is the first time `sshComputer` has run against a real host.

## Errors, run for real

```
DOCKER_HOST=unix:///nonexistent.sock remy computer test box
Docker is not running. Start Docker Desktop or `colima start`, then try again.
(docker missing from PATH)
Docker is not installed on this computer. Install Docker Desktop or colima, then try again.
```

## Found and fixed by the live run

- A timed-out `docker exec` was reported as success: docker exits 0 when its client is stopped, so
  Node saw no error. The runner now treats its own kill as a timeout.
- Stopping the docker client does not stop the command inside the container (a `sleep 30` was still
  running afterwards). After a timeout, a container Remy owns is restarted (files stay); a container the
  person runs is left alone. Checked: no stray process after the restart.
- This Docker version words "daemon down" as "failed to connect to the docker API"; the check now
  matches it.

## Not done

- `remy computer add --ssh` has no `--known-hosts` flag; `knownHostsPath` is settable in
  remy.config.json only. The person's own known_hosts is the default.
- A timed-out command in a container the person runs keeps running there.
- The web Machines screen still only adds ssh machines; it lists docker ones.
