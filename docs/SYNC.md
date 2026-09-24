# Public tournaments and sync

Rally started as a one-device app. A tournament can now also be **public**: it
is mirrored on a small sync server, anyone who scans its QR code gets a live
copy, and every copy can record results, add players and start matches. An
optional per-tournament password locks the destructive parts.

This document is the design. The wire contract is in
[`src/sync/protocol.ts`](../src/sync/protocol.ts), the lock rule in
[`src/sync/protection.ts`](../src/sync/protection.ts); both are imported by
the app and by the server, so neither side can drift.

## Principles

- **Local stays local.** A local tournament never talks to a server, exactly as
  before. Public is opt-in per tournament.
- **The UI only ever reads IndexedDB.** Public tournaments are stored in the
  same Dexie tables as local ones. Sync writes into those tables and the
  existing live queries re-render. No screen reads from the network.
- **Offline first, still.** A change to a public tournament is applied locally
  at once and queued. The queue is pushed when there is a connection. On the
  field there often isn't one.
- **The link is the key.** No accounts. The tournament id is a random UUID and
  is the only thing needed to open it. The QR code encodes the link.
- **The server is dumb and small.** It stores one JSON snapshot per tournament
  in SQLite and runs no tournament logic, apart from the pure lock rule. Ratings,
  brackets and pairing are still computed on the phones by the same code as
  before.
- **Tiny footprint.** One container, one SQLite file, no npm dependencies at
  runtime (`node:http` + `node:sqlite`).

## Data model

### On the device

`Tournament.visibility: 'local' | 'public'` is shared data and part of the
snapshot. Dexie schema v2 adds it to existing rows as `'local'`.

Device-only bookkeeping lives in a new Dexie table `sync`, one `SyncRow` per
public tournament (`src/db/db.ts`):

| field | meaning |
|---|---|
| `role` | `owner` (created or published here) or `joined` (opened a link) |
| `revision` | server revision the local copy is based on; `0` = not uploaded yet |
| `pending` | queued `PendingCommand`s, oldest first |
| `protected` | the server has a password for this tournament |
| `adminPassword` | password remembered after creating or unlocking here, else `null` |
| `lastSyncedAt`, `error` | for the status badge |

This row is never uploaded. Backups (`src/db/backup.ts`) do not include it.
Importing a backup always creates **local** tournaments, because ids are
remapped on import anyway.

### On the server

```sql
CREATE TABLE tournaments (
  id            TEXT PRIMARY KEY,   -- = snapshot.tournament.id
  revision      INTEGER NOT NULL,   -- 1 on create, +1 per accepted push
  snapshot      TEXT,               -- JSON TournamentSnapshot; NULL once deleted
  password_hash TEXT,               -- scrypt, NULL = unprotected
  created_at    INTEGER NOT NULL,
  updated_at    INTEGER NOT NULL,
  deleted_at    INTEGER             -- tombstone, so old links answer 410, not 404
);

CREATE TABLE applied_commands (
  tournament_id TEXT NOT NULL,
  command_id    TEXT NOT NULL,
  revision      INTEGER NOT NULL,
  PRIMARY KEY (tournament_id, command_id)
);
```

`applied_commands` makes pushes idempotent. It can be pruned to the latest few
hundred per tournament.

## Commands

Every mutation in `src/db/repo.ts` that can touch a public tournament is a
**command**. The exported function keeps its name and signature, so screens do
not change. It is wrapped so that, for a public tournament:

1. It runs inside **one Dexie transaction** over all tables. Before and after
   it, the transaction reads the tournament's snapshot and runs
   `protectedChanges(before, after)`. If that returns reasons, the tournament
   is protected, and this device holds no password, the wrapper throws
   `SyncError('locked', reasons)`. The transaction rolls back and nothing is
   written. The UI catches this (`isLockedError`), asks for the password and
   calls the same function again.
2. Every id that `makeId()` hands out during the run is recorded, in order.
3. `{ id, name, args, ids }` is appended to `sync.pending` in the same
   transaction, and a sync is scheduled.

Commands on public tournaments run one at a time through a global queue. That
keeps the id recording unambiguous and stops a replay from interleaving with a
new tap.

For a local tournament the wrapper runs the function unchanged.

`deleteTournament` stays a local-only operation, used for "remove from this
device". Deleting for everyone is `deleteTournamentEverywhere` in `src/sync`.

### Replay

When someone else pushed first (HTTP 409), the local copy is rebuilt as the
server's latest snapshot with our pending commands replayed on top:

1. Drop the pending commands the server reports as already `applied`: a
   previous push went through but its response was lost.
2. Fetch the latest snapshot.
3. In one transaction, replace the tournament's rows with the snapshot and run
   each remaining pending command again by name. `makeId()` returns the
   recorded ids, so a match created offline keeps its id and a later command
   that references it still finds it. A command that now throws (for example
   its match was deleted by someone else) is dropped and reported as a
   `dropped` notice.
4. Push again against the new revision.

Because every derived value (ratings, bracket progression, the automatic
"finished") is recomputed by `recalculate()` inside the commands, replaying
raw commands is enough to get a consistent result. There is no field-level
merge.

## Sync loop

Per public tournament, whenever it is triggered (a command was queued,
`online`, the tab became visible, the event stream reported a new revision, a
retry timer fired):

```
if revision == 0:                       # never uploaded
    POST /api/tournaments  (snapshot, adminPassword)
    -> revision = 1, pending = []
elif pending not empty:
    PUT /api/tournaments/:id  (baseRevision = revision, commandIds, snapshot)
    200 -> revision = response.revision, drop the pushed commands
           (commands queued while the request was in flight stay pending)
    409 -> replay (above), loop
    403 -> error = 'locked', notice; keep pending until the user unlocks or discards
    410 -> tournament was deleted for everyone: notice, convert the local copy to local
elif server revision > revision:        # someone else changed it
    GET /api/tournaments/:id -> replace local rows, revision = response.revision
```

The push body is the full snapshot of the local copy. Even a busy evening is
well under 100 kB, and sending it whole keeps the server stateless about
tournament logic.

Failures back off (2 s, 4 s, 8 s ... capped at 60 s) and leave the queue
untouched. `offline` is `navigator.onLine === false` or a network error.
`unavailable` means that no sync server answers at all.

While a tournament screen is mounted, `useLiveSync` holds an `EventSource` on
`/api/tournaments/:id/events`. Each `state` event carries the revision and the
`protected` flag. When the revision moved, the engine pulls, and the screens
update through their live queries.

## The password

- Optional, set when publishing or later. The server stores an scrypt hash with
  a random salt and compares it in constant time.
- The device that sets it remembers it in `sync.adminPassword`. Others unlock
  with `POST /unlock`; on success the app remembers it too. "Sperren" forgets
  it again.
- The app sends `X-Rally-Password` on every push when it has a password. The
  server only checks it when `protectedChanges(stored, incoming)` returns
  reasons.
- Always protected when a password is set: deleting for everyone and changing
  or removing the password.
- Protected by the diff rule (`src/sync/protection.ts`, tests in
  `tests/protection.test.ts`):
  - **delete_player**: removing a player
  - **delete_result**: deleting a played match or clearing its result. A
    result the bracket invalidated because an earlier one was corrected does
    not count.
  - **settings**: Elo rules, points to win, the Turniermodus config, a player's
    start Elo
  - **bracket**: throwing the bracket away, or finishing/reopening by hand. The
    automatic finish when the last match is in does not count.
  - **start**: starting the countdown, committing the draft into a bracket, or
    re-drafting
- Always free: recording and correcting scores, adding players and matches,
  renaming, marking players (un)available, deleting an unplayed match.
- Without a password everything is free, and anyone with the link may set one.
- Wrong passwords are rate limited per client IP and tournament.

### Threat model

The lock is there to stop a friend deleting last week's results by accident,
or on purpose while holding the organiser's phone. It is not there to resist
a determined attacker. Anyone with the link can still enter nonsense scores,
and the password travels in a header (HTTPS is the deployment's job). What it
does guarantee is that nothing destructive is accepted by the server without
the password, whatever a client sends, because the server re-runs the rule on
the snapshots it is given.

## Joining

The share link is `<app origin><base>/t/<id>`, the same URL the tournament has
on the owner's device. Opening it on a device that does not know the
tournament calls `joinTournament(id)`, stores the snapshot and shows it. The
home screen also has "Turnier beitreten" for pasting a link. This matters on
iOS, where a home-screen PWA has separate storage from Safari, so a scanned
link opens in the browser rather than in the installed app.

## Deployment

The Docker image runs one Node process that serves the built PWA and the API
on port 8080 and keeps its SQLite file in `/data`, a volume. The GitHub Pages
build still works but has no API: `useServerAvailable()` is false there, so
only local tournaments are offered. Building with `VITE_SYNC_URL=https://…`
points any static build at a sync server elsewhere; the server then needs
`RALLY_CORS_ORIGIN` set to that build's origin.

| variable | default | |
|---|---|---|
| `PORT` | `8080` | |
| `RALLY_DATA_DIR` | `/data` (image), `./.data` (dev) | SQLite file location |
| `RALLY_STATIC_DIR` | `./dist` | built PWA; unset/missing = API only |
| `RALLY_CORS_ORIGIN` | unset | allowed cross-origin app origin, `*` for any |
| `RALLY_RETENTION_DAYS` | `365` | tournaments untouched this long are deleted |
| `RALLY_TRUST_PROXY` | unset (`0`) | number of trusted reverse-proxy hops in front of the server; see below |
| `RALLY_CONNECT_SRC` | unset | extra origin(s) added to the static pages' CSP `connect-src`; see below |

### `RALLY_TRUST_PROXY`

The password rate limiter (below) keys its counters on the caller's address.
Behind a reverse proxy that address is always the proxy's, unless the server
is told to read it from `X-Forwarded-For` instead - and only the *proxy's own*
entry in that header is trustworthy, because a client can put anything it
likes in the header itself.

`RALLY_TRUST_PROXY=1` trusts exactly one hop: the server reads the *rightmost*
entry of `X-Forwarded-For`, which - for a well-behaved proxy directly in front
of the server - is the address the proxy itself saw connecting to it, not
whatever the client claimed further left in the header. A chain of more than
one trusted proxy (for example a CDN in front of a load balancer) can be
named as `RALLY_TRUST_PROXY=2`, and so on; the server then reads that many
entries in from the right.

**Set this only when the port is reachable exclusively through that many
proxies.** If a client can reach the server directly - the proxy is not the
only path in, or a misconfigured firewall leaves the port open - it can send
its own `X-Forwarded-For` and make itself look like any address it likes,
which defeats the rate limiter entirely (the original point of this option).

Left unset (or `0`), the header is ignored and every request is keyed on the
raw socket address, which behind a proxy is the *proxy's* address for every
client. In that configuration the rate limiter's failure budget for wrong
passwords is effectively shared by everyone behind the proxy: one client
guessing wrong repeatedly can lock out the whole budget for everyone else on
the same proxy, until the window (10 minutes) or the process restarts. That
is safe (no one can bypass the limit) but coarse; setting `RALLY_TRUST_PROXY`
correctly gives each real client its own budget instead.

### `RALLY_CONNECT_SRC`

The static server's Content-Security-Policy locks `connect-src` to `'self'`,
which is right when this server both serves the built PWA and answers its own
API calls. A build made with `VITE_SYNC_URL=https://other-server` points its
`fetch`/`EventSource` calls at a *different* origin; if that same build is
then also served from here, the browser blocks those calls unless that other
origin is also allowed. `RALLY_CONNECT_SRC=https://other-server` adds it to
the policy. Most deployments don't need this: `VITE_SYNC_URL` is normally
either unset (same-origin) or used for a static-only build (GitHub Pages) that
this server never serves.
