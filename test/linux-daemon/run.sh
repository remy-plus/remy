#!/usr/bin/env bash
# Proves `remy daemon install` on a real systemd (Debian in Docker, systemd as PID 1).
# Not part of `pnpm check`. Needs Docker and network (Node tarball, pnpm install). Takes about 8 minutes,
# most of it waiting for a schedule (the shortest is every 5 minutes). No API key is used: a fake
# OpenAI-compatible server answers every model call with a `finish` tool call.
#
#   test/linux-daemon/run.sh            # run the whole check, then remove the container
#   KEEP=1 test/linux-daemon/run.sh     # leave the container (remyd) up to look around
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../.." && pwd)"
IMAGE=remy-linux-daemon
NAME=remyd
PASS=0
FAIL=0

# Run as the normal user with a working `systemctl --user`.
as_user() {
  docker exec -u remy "$NAME" bash -c "export XDG_RUNTIME_DIR=/run/user/1000 DBUS_SESSION_BUS_ADDRESS=unix:path=/run/user/1000/bus; cd ~/remy; $1"
}
remy() { as_user "node --conditions=@remy/source apps/cli/src/main.ts $* 2>&1 | grep -v -e ExperimentalWarning -e trace-warnings"; }
check() { # check <label> <command...>
  local label="$1"
  shift
  if "$@" >/dev/null 2>&1; then
    echo "PASS  $label"
    PASS=$((PASS + 1))
  else
    echo "FAIL  $label"
    FAIL=$((FAIL + 1))
  fi
}
cleanup() {
  [ "${KEEP:-}" = 1 ] || docker rm -f "$NAME" >/dev/null 2>&1 || true
}
trap cleanup EXIT

docker rm -f "$NAME" >/dev/null 2>&1 || true
docker build -q -t "$IMAGE" "$HERE"
docker run -d --name "$NAME" --privileged --cgroupns=host \
  -v /sys/fs/cgroup:/sys/fs/cgroup:rw --tmpfs /run --tmpfs /run/lock "$IMAGE" >/dev/null

echo "== systemd as PID 1"
for _ in $(seq 1 30); do
  state="$(docker exec "$NAME" systemctl is-system-running 2>/dev/null || true)"
  case "$state" in running | degraded) break ;; esac
  sleep 1
done
echo "system state: $state"
docker exec "$NAME" loginctl enable-linger remy
for _ in $(seq 1 30); do
  docker exec "$NAME" test -S /run/user/1000/bus && break
  sleep 1
done
check "user manager is up (systemctl --user works)" as_user "systemctl --user show-environment"

echo "== copy the repo in (no Mac home mount) and install"
docker exec "$NAME" mkdir -p /home/remy/remy
(cd "$ROOT" && COPYFILE_DISABLE=1 tar --exclude=node_modules --exclude=.git --exclude=.claude \
  --exclude=evals/results --exclude=release -cf - .) | docker exec -i "$NAME" tar -xf - -C /home/remy/remy 2>/dev/null
docker exec "$NAME" chown -R remy:remy /home/remy/remy
as_user "pnpm install --frozen-lockfile 2>&1 | tail -2"

echo "== fake model (no real key)"
docker cp "$HERE/fake-model.mjs" "$NAME":/home/remy/fake-model.mjs
docker exec -u remy "$NAME" bash -c 'mkdir -p ~/.remy; echo "{\"baseUrl\":\"http://127.0.0.1:8099\",\"model\":\"fake\"}" > ~/.remy/remy.config.json; nohup node ~/fake-model.mjs 8099 > ~/fake.log 2>&1 &'
sleep 1

echo "== remy daemon install"
remy daemon install
check "unit file exists" as_user "test -f ~/.config/systemd/user/remy.service"
as_user "cat ~/.config/systemd/user/remy.service"
check "unit is enabled" as_user "systemctl --user is-enabled remy.service"
check "unit is active" as_user "systemctl --user is-active remy.service"
as_user "systemctl --user status remy.service --no-pager | head -12"
echo "-- remy daemon status"
remy daemon status
check "remy daemon status says on" bash -c "$(declare -f as_user remy); NAME=$NAME; remy daemon status | grep -q 'The daemon is on'"

echo "== install again: the daemon restarts on the new unit"
OLD="$(as_user 'systemctl --user show -p MainPID --value remy.service')"
remy daemon install
NEW="$(as_user 'systemctl --user show -p MainPID --value remy.service')"
echo "pid before $OLD, after $NEW"
check "a second install restarted the daemon" test "$OLD" != "$NEW"

echo "== kill -9 the daemon"
OLD="$NEW"
as_user "kill -9 $OLD"
sleep 8
NEW="$(as_user 'systemctl --user show -p MainPID --value remy.service')"
echo "pid before $OLD, after $NEW; NRestarts=$(as_user 'systemctl --user show -p NRestarts --value remy.service')"
check "systemd restarted it" test "$OLD" != "$NEW" -a "$NEW" != 0
check "it is active again" as_user "systemctl --user is-active remy.service"

echo "== a schedule fires (every 5 minutes, the shortest allowed)"
remy schedule add '"every 5 minutes"' '"say hi from schedule"'
for i in $(seq 1 40); do
  if as_user "node --conditions=@remy/source apps/cli/src/main.ts list 2>&1" | grep -q "say hi from schedule"; then break; fi
  sleep 10
done
remy list
remy schedule list
docker exec -u remy "$NAME" cat /home/remy/fake.log
check "the daemon started the scheduled task" bash -c "$(declare -f as_user); NAME=$NAME; as_user 'node --conditions=@remy/source apps/cli/src/main.ts list 2>&1' | grep -q 'say hi from schedule'"

echo "== remy daemon uninstall"
remy daemon uninstall
check "unit file is gone" bash -c "! docker exec -u remy $NAME test -e /home/remy/.config/systemd/user/remy.service"
check "unit is not active" bash -c "! docker exec -u remy $NAME bash -c 'XDG_RUNTIME_DIR=/run/user/1000 systemctl --user is-active remy.service'"
as_user "systemctl --user list-unit-files 'remy*' --no-pager" || true # exits 1 when none are listed
check "no process left" bash -c "! docker exec $NAME pgrep -f 'main.ts daemon run'"

echo
echo "passed $PASS, failed $FAIL"
[ "$FAIL" = 0 ]
