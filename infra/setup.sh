#!/usr/bin/env bash
# Turns a fresh Ubuntu 22.04 or 24.04 server (any provider) into an oovi cloud runner. One command, as root:
#
#   sudo bash setup.sh
#
# What it does: installs Docker (from Docker's own packages), the runner (infra/docker-compose.yml, embedded below),
# automatic security updates, a firewall that only lets SSH in, a block on the provider's metadata addresses for the
# runner's container, automatic restarts, and an image update every 6 hours. Then it asks for the two settings that
# only the owner knows (the website's address and RUNNER_SECRET) and starts the runner.
#
# Nothing secret is in this file. The settings are kept in /opt/oovi-runner/runner.env (readable by root only).
# Later: `sudo oovi-runner config | status | logs | update | stop | start | uninstall`.
#
# Without a terminal (cloud-init), it installs everything and waits: run `sudo oovi-runner config` once over SSH.
# OOVI_WEB_URL, RUNNER_SECRET, RUNNER_IMAGE, RUNNER_CONCURRENCY may also be given in the environment.
set -euo pipefail

DIR=/opt/oovi-runner
IMAGE_DEFAULT="ghcr.io/oussasz/oovi-runner:latest"

say() { printf '\n\033[1m%s\033[0m\n' "$*"; }
die() { printf '\n\033[31mStopped: %s\033[0m\n' "$*" >&2; exit 1; }

[ "$(id -u)" -eq 0 ] || die "run it as root: sudo bash setup.sh"
. /etc/os-release
if [ "${ID:-}" != "ubuntu" ] || { [ "${VERSION_ID:-}" != "22.04" ] && [ "${VERSION_ID:-}" != "24.04" ]; }; then
  echo "Warning: made for Ubuntu 22.04 or 24.04; this is ${PRETTY_NAME:-unknown}. Going on."
fi
export DEBIAN_FRONTEND=noninteractive

say "1/7 System packages and automatic security updates"
apt-get update -q
apt-get install -y -q ca-certificates curl gnupg iptables unattended-upgrades ufw >/dev/null
cat > /etc/apt/apt.conf.d/20auto-upgrades <<'CONF'
APT::Periodic::Update-Package-Lists "1";
APT::Periodic::Unattended-Upgrade "1";
APT::Periodic::AutocleanInterval "7";
CONF
cat > /etc/apt/apt.conf.d/52oovi-runner <<'CONF'
// oovi runner: security updates (and Docker's own) are installed every day; the server restarts at 03:30 UTC
// when an update needs it (the runner gives its jobs back to the queue first, and starts again by itself).
Unattended-Upgrade::Origins-Pattern {
  "origin=Ubuntu,archive=${distro_codename}-security";
  "origin=Docker,label=Docker CE";
};
Unattended-Upgrade::Automatic-Reboot "true";
Unattended-Upgrade::Automatic-Reboot-Time "03:30";
CONF
systemctl enable --now unattended-upgrades >/dev/null 2>&1 || true

say "2/7 Docker"
if ! command -v docker >/dev/null || ! docker compose version >/dev/null 2>&1; then
  install -m 0755 -d /etc/apt/keyrings
  curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
  chmod a+r /etc/apt/keyrings/docker.asc
  echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/ubuntu ${VERSION_CODENAME} stable" > /etc/apt/sources.list.d/docker.list
  apt-get update -q
  apt-get install -y -q docker-ce docker-ce-cli containerd.io docker-compose-plugin >/dev/null
fi
systemctl enable --now docker >/dev/null

say "3/7 Firewall: only SSH comes in (the runner only calls out)"
SSH_PORT="$(sshd -T 2>/dev/null | awk '/^port /{print $2; exit}')"
SSH_PORT="${SSH_PORT:-22}"
ufw default deny incoming >/dev/null
ufw default allow outgoing >/dev/null
ufw allow "${SSH_PORT}/tcp" >/dev/null
ufw --force enable >/dev/null
# The cloud provider's metadata services are not for the runner's container (a page a bot reads must never reach them).
cat > /usr/local/sbin/oovi-runner-firewall <<'FW'
#!/bin/sh
for ip in 169.254.169.254 168.63.129.16 100.100.100.200; do
  iptables -C DOCKER-USER -d "$ip" -j DROP 2>/dev/null || iptables -I DOCKER-USER -d "$ip" -j DROP
done
FW
chmod 755 /usr/local/sbin/oovi-runner-firewall
cat > /etc/systemd/system/oovi-runner-firewall.service <<'UNIT'
[Unit]
Description=oovi runner: block metadata addresses for containers
After=docker.service
Requires=docker.service
[Service]
Type=oneshot
ExecStart=/usr/local/sbin/oovi-runner-firewall
RemainAfterExit=yes
[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now oovi-runner-firewall >/dev/null

say "4/7 The runner's files in ${DIR}"
install -d -m 0755 "$DIR"
# --- infra/docker-compose.yml (kept identical by tests/unit/runner-infra.test.mts) ---
cat > "$DIR/docker-compose.yml" <<'COMPOSE'
# oovi's cloud runner on one server (infra/setup.sh installs this as /opt/oovi-runner/docker-compose.yml).
# No public port: the runner only calls out to the website. Its settings are in runner.env next to this file
# (written on the server by `sudo oovi-runner config`, never committed).
services:
  runner:
    image: ${RUNNER_IMAGE:-ghcr.io/oussasz/oovi-runner:latest}
    env_file: runner.env
    init: true
    restart: unless-stopped
    # SIGTERM: running jobs get RUNNER_DRAIN_MS to finish, then their leases go back to the queue.
    stop_grace_period: 60s
    read_only: true
    tmpfs:
      - /tmp:size=2g,mode=1777
    security_opt:
      - no-new-privileges:true
    cap_drop:
      - ALL
    mem_limit: ${RUNNER_MEM_LIMIT:-1600m}
    pids_limit: 512
    logging:
      driver: json-file
      options:
        max-size: "10m"
        max-file: "5"
COMPOSE
# --- end of infra/docker-compose.yml ---
[ -f "$DIR/.env" ] || printf 'RUNNER_IMAGE=%s\n' "${RUNNER_IMAGE:-$IMAGE_DEFAULT}" > "$DIR/.env"

say "5/7 The oovi-runner command"
cat > /usr/local/bin/oovi-runner <<'CMD'
#!/usr/bin/env bash
# oovi-runner config | start | stop | status | logs | update | uninstall
set -euo pipefail
DIR=/opt/oovi-runner
[ "$(id -u)" -eq 0 ] || { echo "Use sudo: sudo oovi-runner $*"; exit 1; }
cd "$DIR"
compose() { docker compose -p oovi-runner "$@"; }
get() { [ -f runner.env ] && sed -n "s/^$1=//p" runner.env | head -1 || true; }
configured() { [ -n "$(get RUNNER_SECRET)" ] && [ -n "$(get OOVI_WEB_URL)" ]; }

wait_healthy() {
  for _ in $(seq 1 40); do
    st="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}{{.State.Status}}{{end}}' oovi-runner-runner-1 2>/dev/null || echo missing)"
    [ "$st" = "healthy" ] && { echo "The runner is running and healthy."; return 0; }
    sleep 3
  done
  echo "The runner is not healthy yet ($st). Its last log lines (they never contain chat text):"
  compose logs --tail 20 runner || true
  return 1
}

case "${1:-status}" in
  config)
    web="${OOVI_WEB_URL:-$(get OOVI_WEB_URL)}"; web="${web:-https://oovi.conuron.com}"
    if [ -t 0 ]; then
      read -r -p "Website address [$web]: " a; web="${a:-$web}"
      echo "RUNNER_SECRET: the same value as in the website's settings (32+ letters, digits, - or _). It is not shown."
      read -r -s -p "RUNNER_SECRET: " secret; echo
      conc="$(get RUNNER_CONCURRENCY)"; conc="${conc:-2}"
      read -r -p "Jobs at the same time [$conc]: " a; conc="${a:-$conc}"
      read -r -p "If the image is private: GitHub user name (Enter if it is public): " ghu
      if [ -n "$ghu" ]; then read -r -s -p "GitHub token with read:packages only (not shown): " ght; echo; printf '%s' "$ght" | docker login ghcr.io -u "$ghu" --password-stdin; fi
    else
      secret="${RUNNER_SECRET:-}"; conc="${RUNNER_CONCURRENCY:-2}"
    fi
    case "$web" in https://*|http://localhost*|http://127.0.0.1*) ;; *) echo "The website address must start with https://"; exit 1;; esac
    [[ "$secret" =~ ^[A-Za-z0-9_-]{32,}$ ]] || { echo "RUNNER_SECRET must be 32+ letters, digits, - or _ (make one with: openssl rand -hex 32)."; exit 1; }
    [[ "$conc" =~ ^[0-9]+$ ]] || conc=2
    umask 077
    {
      echo "OOVI_WEB_URL=$web"
      echo "RUNNER_SECRET=$secret"
      echo "RUNNER_ID=$(hostname | tr -c 'A-Za-z0-9_\n-' '-' | cut -c1-40)"
      echo "RUNNER_CONCURRENCY=$conc"
    } > runner.env.new
    mv runner.env.new runner.env
    chmod 600 runner.env
    echo "Saved. Starting the runner…"
    compose pull -q && compose up -d --remove-orphans && wait_healthy
    ;;
  start) configured || { echo "Run: sudo oovi-runner config"; exit 1; }; compose up -d && wait_healthy ;;
  stop) compose stop ;;
  status)
    configured || { echo "Not configured yet. Run: sudo oovi-runner config"; exit 0; }
    compose ps
    docker exec oovi-runner-runner-1 node /app/runner/health.cjs 2>/dev/null || true
    ;;
  logs) compose logs --tail "${2:-100}" -f runner ;;
  update) configured || exit 0; compose pull -q && compose up -d --remove-orphans && docker image prune -f >/dev/null ;;
  uninstall)
    compose down || true
    systemctl disable --now oovi-runner-update.timer oovi-runner-firewall 2>/dev/null || true
    rm -rf "$DIR" /etc/systemd/system/oovi-runner-update.* /etc/systemd/system/oovi-runner-firewall.service /usr/local/sbin/oovi-runner-firewall
    rm -f /usr/local/bin/oovi-runner
    systemctl daemon-reload
    echo "Removed. (Docker stays installed.)"
    ;;
  *) echo "Use: oovi-runner config | start | stop | status | logs | update | uninstall"; exit 1 ;;
esac
CMD
chmod 755 /usr/local/bin/oovi-runner

say "6/7 Image updates every 6 hours (a new image restarts the runner; running jobs are handed back first)"
cat > /etc/systemd/system/oovi-runner-update.service <<'UNIT'
[Unit]
Description=oovi runner: pull a newer image and restart with it
After=docker.service network-online.target
Wants=network-online.target
[Service]
Type=oneshot
ExecStart=/usr/local/bin/oovi-runner update
UNIT
cat > /etc/systemd/system/oovi-runner-update.timer <<'UNIT'
[Unit]
Description=oovi runner: image updates
[Timer]
OnCalendar=*-*-* 00/6:00:00
RandomizedDelaySec=30m
Persistent=true
[Install]
WantedBy=timers.target
UNIT
systemctl daemon-reload
systemctl enable --now oovi-runner-update.timer >/dev/null

say "7/7 Settings"
if [ -t 0 ] || [ -n "${RUNNER_SECRET:-}" ]; then
  /usr/local/bin/oovi-runner config
else
  echo "Installed. One step left, over SSH:  sudo oovi-runner config"
  echo "(It asks for the website's address and RUNNER_SECRET, then starts the runner.)"
fi
