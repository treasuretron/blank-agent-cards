#!/usr/bin/env bash
set -euo pipefail
root="$(dirname "$(dirname "$(realpath "$0")")")"
units=(cards-game cards-agent cards-web cards-preview)
case "${1:-status}" in
  install)
    if ! sudo test -f /etc/cards/gateway.json; then sudo node "$root/deploy/provision-auth.mjs"; fi
    for user in cards-game cards-agent cards-web cards-preview; do
      id "$user" >/dev/null 2>&1 || sudo useradd --system --home-dir "/var/lib/$user" --shell /usr/sbin/nologin "$user"
    done
    for unit in "${units[@]}"; do sudo install -m 0644 "$root/deploy/$unit.service" "/etc/systemd/system/$unit.service"; done
    if ! mountpoint -q /opt/cards; then sudo install -d -m 0755 /opt/cards; fi
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
    sudo node --input-type=module -e 'import { readFile } from "node:fs/promises"; const password = (await readFile("/etc/cards/agent-password", "utf8")).trim(); for (let n = 0; n < 15; n++) { try { const r = await fetch("http://127.0.0.1:4097/global/health", { signal: AbortSignal.timeout(2000), headers: { Authorization: "Basic " + Buffer.from("cards-game:" + password).toString("base64") } }); if (r.ok) { console.log(await r.text()); process.exit(0) } } catch {} await new Promise(resolve => setTimeout(resolve, 1000)) } process.exit(1)'
    curl --retry 10 --retry-connrefused --retry-delay 1 --fail --silent --show-error -o /dev/null http://127.0.0.1:8080/
    ;;
  *) exit 2 ;;
esac
