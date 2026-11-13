# Debian with systemd as PID 1 and Node, to run `remy daemon install` on a real systemd.
FROM debian:trixie
ARG NODE_VERSION=24.11.1
ENV container=docker DEBIAN_FRONTEND=noninteractive
RUN apt-get update && apt-get install -y --no-install-recommends \
      systemd systemd-sysv dbus dbus-user-session libpam-systemd procps curl ca-certificates xz-utils sudo \
    && rm -rf /var/lib/apt/lists/* \
    && ARCH=$(dpkg --print-architecture | sed 's/amd64/x64/') \
    && curl -fsSL "https://nodejs.org/dist/v${NODE_VERSION}/node-v${NODE_VERSION}-linux-${ARCH}.tar.xz" | tar -xJ -C /usr/local --strip-components=1 \
    && npm i -g pnpm@12.15.0 \
    && useradd -m -s /bin/bash remy
STOPSIGNAL SIGRTMIN+3
CMD ["/lib/systemd/systemd"]
