# M5 Deployment

## Current VM

This deploy reuses the existing hackathon-drive VM. Node 24.21.0, system systemd,
sudo, and user lingering are available. Coshell owns localhost 4096 and its existing
tunnel; neither that service nor its credentials were changed. No VM was created,
no credential files were read/copied, no keys rotated, and no commits made.

Preview: https://c8a3daedfe446a035a7cf3b0925a707f--8080.coshell.ai/

The edge returns **401 without Coshell authentication**. Open this in the existing
Coshell browser preview on port 8080 or an authenticated browser. An anonymously
public URL is not enabled or verified. This is a protected friends/demo deployment,
not production-grade public hosting. No tunnel secrets are needed by these scripts.

The frontend is a production snapshot at `/var/lib/cards-web/app/web`, not a dev
server. Building copies source outside the workspace, so concurrent Trav edits,
workspace `.next`, and web source remain untouched. Next's webpack build is used.
The snapshot uses the installed workspace dependencies via a read-only mount;
dependency upgrades need a rebuild. The compiled server URL is the preview origin.

## Lifecycle

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
| `cards-game` | host `127.0.0.1:8787` | mock-only game, `/health`, `/ws`, `/rooms/` |
| `cards-web` | host `127.0.0.1:3001` | production Next frontend |
| `cards-preview` | host `127.0.0.1:8080` | same-origin frontend/game gateway |
| `cards-agent` | isolated network namespace `127.0.0.1:4097` | offline private OpenCode |
| `opt-cards.mount` | read-only `/opt/cards` | source access without home access |

Integration: preview `/health`, `wss://c8a3daedfe446a035a7cf3b0925a707f--8080.coshell.ai/ws`,
and authenticated `/rooms/:code/cards/:id`. Local integration uses
`http://127.0.0.1:8080` with matching WebSocket Origin. Missing/foreign Origins fail
upgrade; nonbrowser clients must supply the allowlisted Origin. Origin checking is
not authentication; the edge gate and seat tokens provide the access controls.

## Protections

The deployment launcher forces mock regardless of the root agent config, removes
the generated-engine opt-in, and rejects persisted generated/oversized rooms.
Generated engine code is never accepted by this deployment. Each service has its
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

The independently credential-free OpenCode 1.18.18 runtime is healthy inside a
`PrivateNetwork=yes` namespace. It has **no external network**, so provider/model
inference is intentionally unavailable. Neither the host tunnel nor the public
gateway can connect to this listener, even if a port-4097 preview is attempted.
Health is checked with root `nsenter`, never by exposing the API. There is no API
password in this namespace; only privileged local namespace access can reach it.
No OpenCode configuration was changed for M5.

For real-agent experimentation, use the existing M4 independent runner and normal
human provider login from `server/README.md`, only on a private trusted-local
environment. Do not point this public/mock launcher at generated rooms or remove
the namespace restriction just to make inference work. A network-capable private
runtime and robust per-engine OS/container filesystem/network/syscall isolation
need a separately reviewed design before public generated engines can be enabled.

## Verification And Gaps

All 46 existing shared/server/web tests and workspace typechecks passed before
deployment; server's 29 tests/typecheck passed after protection changes, including
the new deployment-profile regression test (47 total workspace tests).
Production snapshot build passed. Live verification exercises frontend HTTP,
health, foreign-origin rejection, config caps, flood closure, invalid seat token,
two-player mock play, protected images, and chat/card/hand/score/turn persistence
through actual systemd restarts. Agent namespace health passes; host 4097 is closed.
Anonymous edge HTTP returns 401; authenticated external HTTP/WebSocket/browser
rendering is not verified here because no existing secrets were reused. Existing
frontend browser checks are documented in the milestone handoff, not claimed as
a new M5 browser run.

Remaining: anonymously public sharing policy, authenticated external browser demo,
real-agent secure execution/networking, token expiry/rotation, automated backups,
retention, moderation, stronger abuse controls, and dependency/security lifecycle.

**Key rotation remains pending.** Do not rotate the shared Freestyle API key:
it may power existing Coshell infrastructure. The owner must explicitly confirm
which exposed credential to replace and which infrastructure consumers will be
updated before any scoped rotation is performed. No old chat keys are reused.
