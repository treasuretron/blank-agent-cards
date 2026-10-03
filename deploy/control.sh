#!/usr/bin/env bash
set -euo pipefail
root="$(dirname "$(dirname "$(realpath "$0")")")"
units=(cards-game cards-agent cards-web cards-preview)
case "${1:-status}" in
  install)
    for user in cards-game cards-agent cards-web; do
      id "$user" >/dev/null 2>&1 || sudo useradd --system --home-dir "/var/lib/$user" --shell /usr/sbin/nologin "$user"
    done
    for unit in "${units[@]}"; do sudo install -m 0644 "$root/deploy/$unit.service" "/etc/systemd/system/$unit.service"; done
    sudo install -d -m 0755 /opt/cards
    sudo install -m 0644 "$root/deploy/opt-cards.mount" /etc/systemd/system/opt-cards.mount
    sudo systemctl daemon-reload
    sudo systemctl enable --now opt-cards.mount
    sudo systemctl reset-failed cards-game cards-agent
    sudo systemctl enable --now cards-game cards-agent
    sudo systemctl restart cards-game cards-agent
    ;;
  start|stop|restart) sudo systemctl "$1" "${units[@]}" ;;
  build)
    sudo systemctl stop cards-preview cards-web
    sudo node "$root/deploy/snapshot.mjs"
    sudo chown -R cards-web:cards-web /var/lib/cards-web
    sudo systemctl enable --now cards-web cards-preview
    ;;
  status) systemctl status "${units[@]}" --no-pager ;;
  logs) journalctl -u "${2:-cards-game}" -n 80 --no-pager ;;
  health)
    curl --retry 10 --retry-connrefused --retry-delay 1 --fail --silent --show-error http://127.0.0.1:8787/health
    pid="$(systemctl show cards-agent -p MainPID --value)"
    sudo nsenter -t "$pid" -n curl --fail --silent --show-error http://127.0.0.1:4097/global/health
    curl --retry 10 --retry-connrefused --retry-delay 1 --fail --silent --show-error -o /dev/null http://127.0.0.1:8080/
    ;;
  *) exit 2 ;;
esac
