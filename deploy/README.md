# Trusted-Friends Deployment

Updated 2026-10-03: the gateway now has an application password and new rooms use
real `opencode/space-bunny-free`. This is an explicitly authorized private,
trusted-friends beta. A password reduces access; it does **not** make generated
engine code a secure sandbox. Do not invite adversarial users or expose the agent.

## Current VM

This deploy reuses the existing hackathon-drive VM. Node 24.21.0, system systemd,
sudo, and user lingering are available. Coshell owns localhost 4096 and its existing
tunnel; neither that service nor its credentials were changed. No VM was created,
no infrastructure credentials were read/copied, no keys rotated, and no commits made.

Public game: https://blank-agent-cards-c8a3daed.style.dev/

Players enter the existing table password, then create or join a room. No Coshell
login is needed. Freestyle supplies DNS and its wildcard HTTPS certificate for
this free, single-label `style.dev` hostname; no custom-domain ownership is assumed.

The authorized Freestyle CLI login is scoped to Trav's Team
(`cd49dbed-0c01-472a-9c74-5f89c729f0ca`). The existing `hackathon-drive` VM is
`vm-6a42b1427fa04e31b3e391db31e71f11` (slug `coshell-54278e5651`). Public HTTP TLS
rule `tls-13698d1d180244fcafc69a2fb2340e50` targets **only port 8080**:

```sh
npx freestyle@latest tls get tls-13698d1d180244fcafc69a2fb2340e50
# Original creation command; do not recreate an existing rule:
npx freestyle@latest tls create --domain blank-agent-cards-c8a3daed.style.dev --from public --to vm=vm-6a42b1427fa04e31b3e391db31e71f11,port=8080
```

Freestyle TLS ingress needs no additional firewall grant. Both existing outbound
firewall rules were preserved, with no public raw-port access added. Only the
password-protected gateway binds `0.0.0.0`; web, game and agent remain loopback-only.
No routes to OpenCode, private workspace files or the raw backend were published.
To unpublish this game only, delete the above TLS rule; do not modify shared routes.

Existing Coshell preview (unchanged):
https://c8a3daedfe446a035a7cf3b0925a707f--8080.coshell.ai/
It still returns **401 without Coshell authentication** at the outer edge. Both
hostnames remain explicitly allowlisted for login and WebSockets. The preview
retains its outer auth; the new hostname uses the application's password gate.

The generated 12-character initial table password is delivered through the private
root-only file `/etc/cards/initial-password`, not logs or source. Retrieve privately
in your terminal with `sudo node -p 'require("node:fs").readFileSync("/etc/cards/initial-password", "utf8").trim()'`.
`/etc/cards/gateway.json` holds a salted scrypt hash and signing key;
`/etc/cards/agent-password` holds an independent random API password. All are mode
0600 under a mode-0700 root-owned directory outside the repository. systemd
credentials give each service only the secret it needs. Provisioning never prints
secrets and exclusive creation refuses accidental overwrites/rotation.

The frontend is a production snapshot at `/var/lib/cards-web/app/web`, not a dev
server. Building copies source outside the workspace, so concurrent Trav edits,
workspace `.next`, and web source remain untouched. Next's webpack build is used.
The snapshot uses the installed workspace dependencies via a read-only mount;
dependency upgrades need a rebuild. The production snapshot uses
`NEXT_PUBLIC_SERVER_URL=same-origin`: HTTP images and WebSockets use the browser's
current origin, preserving host-only sessions on both public and preview hosts.
Local development still defaults to the game server's port 8787.

## Lifecycle

The live services run from a dedicated checkout, `/home/ubuntu/cards-live`
(detached Git baseline), bind-mounted read-only at `/opt/cards`. Work-in-progress
checkouts never go live by accident. The live checkout can contain uncommitted
hotfixes: inspect and integrate them into source before updating its snapshot.
Do not replace the checkout or switch revisions over those fixes. Build from
the integrated live source:

```sh
bash /home/ubuntu/cards-live/deploy/control.sh build
bash /home/ubuntu/cards-live/deploy/control.sh health
```

From the repository root:

```sh
bash deploy/control.sh install  # dedicated users, units, mount, backend + agent
bash deploy/control.sh build    # stops web/preview, copies + builds, starts them
bash deploy/control.sh health
bash deploy/control.sh status
bash deploy/control.sh stop
bash deploy/control.sh start
bash deploy/control.sh restart
bash deploy/control.sh logs cards-game
bash deploy/control.sh logs cards-web
bash deploy/control.sh logs cards-agent
sudo node deploy/verify.mjs
sudo node deploy/login-verify.mjs # login/assets/WS only; no game restart
sudo env CARDS_VERIFY_URL=https://blank-agent-cards-c8a3daed.style.dev node deploy/login-verify.mjs
sudo env CARDS_VERIFY_ORIGIN=https://c8a3daedfe446a035a7cf3b0925a707f--8080.coshell.ai node deploy/login-verify.mjs
sudo node --import tsx deploy/agent-verify.ts
```

Installation is scoped to this VM/path and requires sudo. Services are enabled at
boot and restart on failure. `stop` does not disable boot startup or remove data.
To disable: `sudo systemctl disable --now cards-preview cards-web cards-game cards-agent`.
Logs are in journald; applications do not log image query strings or seat tokens.
Do not enable request/query logging at a future proxy. Verification restarts the
game server twice and removes only its own test room; run between demo games.
If build fails, backend and agent remain deployed; web/preview stay stopped until
a successful build. Re-run after frontend changes to publish a new snapshot.

| Service | Binding | Purpose |
| --- | --- | --- |
| `cards-game` | host `127.0.0.1:8787` | Space Bunny game, `/health`, `/ws`, `/rooms/` |
| `cards-web` | host `127.0.0.1:3001` | production Next frontend |
| `cards-preview` | host `0.0.0.0:8080` | password-protected same-origin public/preview gateway |
| `cards-agent` | host `127.0.0.1:4097` | private API-password-protected OpenCode with provider egress |
| `opt-cards.mount` | read-only `/opt/cards` | source access without home access |

Integration: public `/health`, `wss://blank-agent-cards-c8a3daed.style.dev/ws`,
and authenticated `/rooms/:code/cards/:id`. Local integration uses
`http://127.0.0.1:8080` with matching WebSocket Origin. Missing/foreign Origins fail
upgrade; nonbrowser clients must supply the allowlisted Origin. Origin checking is
not authentication; the outer edge, application session, and seat tokens are
separate access controls. The login page is public at the application gateway;
all other HTTP routes (including health, assets and image URLs) and WebSocket
upgrades require a valid session. Images still require the correct seat token.
Sessions are HMAC-signed, expire after 12 hours, and use host-only `Secure`,
`HttpOnly`, `SameSite=Strict` cookies. Upgrades also check Origin and disconnect
at session expiry. Secure cookies require HTTPS in browsers; the localhost test
harness passes the cookie explicitly and is not a plain-HTTP browser login demo.
Login POSTs require allowlisted Origin, a bounded form, and globally at most ten
attempts/minute with one password hash at a time. This global throttle can deny
legitimate logins during abuse. Logout clears the browser cookie, but a stolen
copy remains valid until expiry; session revocation is not per-user.

Password forms (including wrong-password retry responses) use
`Referrer-Policy: same-origin`. `no-referrer` makes browser form POST navigations
send `Origin: null`, which correctly fails the CSRF allowlist and previously caused
the deployed `/login` 403. Other gateway responses retain `no-referrer`. Login,
logout and WebSocket checks use the fixed canonical Origin allowlist, never values
derived from `Host`, `X-Forwarded-Host` or `X-Forwarded-Proto`; missing, null and
foreign Origins stay rejected. `npm test` includes isolated gateway regressions
using disposable credentials and an ephemeral localhost port.

## Protections

The launcher selects Space Bunny for new rooms and the game service explicitly
sets `CARDS_ALLOW_GENERATED_ENGINE=trusted-local`. Existing rooms retain their
stored provider; old mock rooms do not silently migrate. Oversized rooms are
rejected. Generated engine code is accepted only through the existing validated,
bounded child-process pipeline, never in the game-server process. Each service has its
own nonlogin OS user, no capabilities, no privilege elevation, a read-only system
and home denial, private temp files, cgroup memory/CPU/task bounds, and private
mode-0700 state directories. These are defense-in-depth service controls, **not a
hardened hostile-code engine sandbox**.

The optional server protection profile allows 20 persisted rooms, 48 sockets,
6 players/room, 8 cards/player, hand size 8, target score 1000, and 300 history
entries. History exhaustion rejects further game/chat mutations instead of growing
forever; start a new room or perform operator cleanup. Message bursts allow 20
initial messages and refill 1/second, with at most four queued messages/socket.
Excess closes the connection with 1008. A heartbeat removes dead connections;
slow readers with over 8 MB pending output are disconnected. Existing PNG limits
and protocol validation remain in force. This is not global/IP-based abuse
prevention, a disk quota, or a secure arbitrary-code sandbox.

Seat tokens authenticate reconnect and private images. They are 32 random bytes,
persisted only in private room files and the recipient browser, and cannot be
recovered from a room code. Tokens do not expire/rotate, host transfer is absent,
and localStorage can be compromised by XSS. Use the protected demo with trusted
players; revoke a room by stopping the server and removing that room's private
file, then restarting. Do not disclose or back up room files to a public location.

## Persistence

`/var/lib/cards-game/rooms` contains atomic mode-0600 room files. Seats, chat,
PNG images, deck, hands, score, turn, rules, engine and thread survive service
restart. Exactly one process owns this directory. Interrupted turns follow the
M1 explicit failed-play recovery policy. Invalid persistence fails startup.
There is no fsync/power-loss guarantee, encryption, automatic retention/expiry,
disk quota, database, or off-VM backup. Stop the game before a consistent private
backup; preserve owner/modes. Room cleanup is an operator action while stopped.

## Private Agent

OpenCode 1.18.18 uses its own HOME/XDG profile under `/var/lib/cards-agent` and
enables only the `opencode` provider. No provider credentials were supplied.
Space Bunny's credential-free image inference was actually exercised, not merely
inferred from catalog metadata. Free access, quotas and availability can change.

The previous offline namespace was removed to permit provider HTTPS egress.
The listener remains localhost-only with a generated independent API password;
only the game service receives that password (root can administer it). The public
gateway has no agent route, and unauthenticated local API requests return 401.
Tools, plugins, external skills, sharing, snapshots, formatters and LSP remain
disabled, with deny-all session permissions. Service users, privilege restrictions,
filesystem protection, cgroups and engine Node permission/VM/kill deadlines remain
in place. These controls are not a hostile-code sandbox. Providers receive card
images, game state/history and player names; use no sensitive data in game cards.

Changing OpenCode configuration requires restarting `cards-agent`; changing the
model/launcher requires restarting `cards-game`. Config is not hot-reloaded.

## Verification And Gaps

### Integrated Release (2026-10-03)

The M7 workspace now includes the integrated card-writing and end-game features,
the larger selected-hand preview, and the previously live-only timeout fixes.
Card writing uses one 90-second deadline across one malformed-output retry,
propagates cancellation, retains valid siblings, and reports partial additions.
The tool-free referee uses `steps: 2` to avoid the first-inference maximum-steps
instruction; permissions and tools remain denied.

Checks: 73 server, 7 shared, 21 web tests and the gateway regression pass, along
with shared/server/web typechecks. The generated web typecheck cache is not a
release input. Credentials and room state remain outside source snapshots.

The supported live webpack snapshot build passed. Public HTTPS login, ten
protected assets, WSS and CSRF checks passed before and after cleanup. Space
Bunny wrote all four requested cards in 39.7 seconds; protected PNGs, persistence,
two-player join/deal, end-game and seat resume passed. Cleanup waited for idle
inference and removed only its own room; all three other room files were
byte-identical. The backend already matched the integrated source, so the agent
was not restarted and its loaded configuration/password were preserved.

```sh
sudo node --import tsx deploy/generate-verify.ts 4
sudo node deploy/generate-service-verify.mjs
sudo node deploy/cleanup-verify.mjs TEST # use only the printed verification code
```

The public service check creates its own room, checks four real agent cards,
protected PNGs, a second player, dealing, end-game and seat resume without
restarting services. It prints only the test room code and metrics. Remove only
that room while the game is stopped, after active inference has drained.

Current live verification passes application HTTP/WS authentication, secure cookie
attributes/signatures/expiry, foreign/missing Origin rejection, logout, login
throttling, config/flood/seat limits, protected images, two-player real Space Bunny
turns, persistence through game and gateway restarts, and interrupted-turn recovery.
The dedicated vision check sends seven circles without naming the count in card
text and confirms a schema-valid seven-point ruling. Unit tests exercise provider
failures, bounded timeout/cancellation, malformed code, rollback and recovery.
Config validates against the authoritative OpenCode schema. The public-route
change rebuilt the production snapshot with same-origin connections, preserving
concurrent frontend source edits. All 44 current backend tests, the gateway
regression, 17 frontend tests and shared/server typechecks pass, including the
private API credential regression. Timeout/cancellation checks are unit tests;
interrupted-turn recovery and persistence also ran against the live services.
Anonymous public HTTPS returns the password form with 200. Anonymous Coshell
preview HTTPS still returns its original outer 401.

The login fix was also verified with Chromium through a temporary loopback HTTPS
ingress at the canonical external hostname: wrong-password retry, correct-password
303, secure browser cookie, frontend rendering and static assets all passed. The
live login-only script checks the external Origin with forwarded HTTPS host,
protected frontend/assets, health, upstream WebSocket, CSRF rejection and logout.
This does not verify the actual Coshell edge header transformations: anonymous
external access is blocked before reaching the application, and no Coshell/chat
credentials were reused. Only `cards-preview` was restarted for this fix; the
existing production frontend snapshot and concurrent web edits were preserved.

The real public TLS route was verified without any Coshell credentials: password
form, actual login POST/303, host-only secure cookie, frontend, ten authenticated
static assets, health, WSS, foreign/null HTTP Origins, and missing/foreign or
unauthenticated WebSocket rejection. Chromium at 1440px and 390px passed browser
login, rendering with no page errors or homepage horizontal overflow, same-origin
WSS, room creation/join, seat resume and card submission. A protected PNG returned
200 with session+seat, 404 without seat, and 401 without session. Only the temporary
verification room was removed, with a game-service restart for cleanup. The table
password was read privately for verification and never logged; no signing keys or
infrastructure auth files were read. The existing preview Origin also passes the
local gateway login/assets/health/WS checks.

This remains a single development VM, not an autoscaled production host. Availability
depends on keeping the shared VM running; stopping it also stops the game services.

Remaining: hostile-code engine sandboxing, seat token expiry/rotation, automated backups,
retention, moderation, stronger abuse controls, and dependency/security lifecycle.

**Key rotation remains pending.** Do not rotate the shared Freestyle API key:
it may power existing Coshell infrastructure. The owner must explicitly confirm
which exposed credential to replace and which infrastructure consumers will be
updated before any scoped rotation is performed. No old chat keys are reused.
