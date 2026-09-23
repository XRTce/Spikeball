# Architecture

Rally's app is a local database with a UI on top, so most of the design
follows from one decision: **derived state is never stored.** A tournament can
optionally be mirrored on a small sync server (see [SYNC.md](SYNC.md)), but
the UI still only ever reads IndexedDB - the server is a peer of the local
copy, not a backend the app depends on.

```
┌──────────────────────────────────────────────────────────┐
│  screens/                     what the tournament master │
│  components/                  taps                       │
├──────────────────────────────────────────────────────────┤
│  ui/            design system (tokens, primitives)       │
│  state/         read model, theme, player colours        │
├──────────────────────────────────────────────────────────┤
│  db/            Dexie repository  ← the only mutations   │
│  sync/          wire protocol + push/pull loop (SYNC.md) │
├──────────────────────────────────────────────────────────┤
│  domain/        pure functions: Elo, pairing, standings  │
└──────────────────────────────────────────────────────────┘

server/            sync server: SQLite, HTTP, no tournament logic
```

`domain/` has no imports from anything above it. It is plain TypeScript over
plain data, which is why it can be exhaustively unit-tested.

## Stored vs. derived

Only three things are stored:

| Table | What it holds |
|---|---|
| `tournaments` | Name, phase, format, Elo and play settings, bracket metadata |
| `players` | Name, **base rating**, active flag, and a denormalised current rating |
| `matches` | Teams, scores, stage/round/order, bracket wiring |

Everything else — current ratings, standings, who has partnered whom, bracket
progression, the podium — is computed on demand from
`(players.baseElo, matches, settings)`.

`players.elo` is the one exception: it is a cached copy of the last replay so
the tournament list can show ratings without loading every match. It is written
by `recalculate()` and never trusted as a source of truth.

### Why replay instead of increments

Results get corrected. Someone types 21:19 when it was 19:21, a player is added
late, a base rating turns out to be wrong. With incremental updates each of
those needs its own careful inverse, and any missed case leaves the tournament
quietly inconsistent for the rest of the evening.

Replaying is one code path that is correct by construction:

```ts
// src/db/repo.ts
export async function recalculate(tournamentId: string) {
  //  1. re-derive bracket progression from the recorded results
  //  2. add or remove the double-elimination decider as needed
  //  3. replay every rating from the base ratings
  //  4. write back only what actually changed
}
```

It runs after every mutation inside a Dexie transaction. The cost is linear in
the number of matches, which for a garden tournament is a few hundred at most.

## Reading

`useTournament(id)` is the single read model. It runs one Dexie live query and
derives ratings, standings and pairing history in a `useMemo`. Every screen
consumes the same object, so no two screens can disagree about a number, and a
correction is reflected everywhere at once.

```ts
const view = useTournamentView();
view.standings          // ranked table
view.replay.ratings     // current rating per player
view.replay.perMatch    // what each match did to each rating
view.history            // who partnered/faced whom, for the planner
```

## Two modes, two phases

A tournament starts in `phase: 'casual'` — an open queue where the app suggests
the next fair match (or the organiser assigns teams manually). Whether it ever
leaves that phase depends on the mode, stored as `tournament.timedMode`:

- **Liga-Modus** (`timedMode: null`) stays in `phase: 'casual'` forever - a
  running Elo ladder with no bracket.
- **Turniermodus** (`timedMode` set) free-plays for a configured duration,
  then the organiser drafts fixed teams from the best players (see
  [ALGORITHMS.md](ALGORITHMS.md)) and `phase` switches to `'tournament'`,
  freezing the current ratings into a single-elimination bracket stored in
  `tournament.bracket`. Discarding it (`backToCasual`) removes only the
  generated matches; casual results are kept and keep counting.

## Storage durability

IndexedDB is not guaranteed to survive. The app therefore:

- requests `navigator.storage.persist()` on start-up, which installed PWAs are
  normally granted without a prompt;
- shows the actual grant status and quota usage in Settings;
- offers a full JSON export/import. Imports always land as **new** tournaments
  with fresh ids, so an import can never overwrite what is already on the device.

## Rendering choices worth knowing

**Charts are hand-written SVG** (`ui/Charts.tsx`). A charting library would have
cost more than the rest of the app; two chart types did not justify it.

**The share image is painted onto a canvas** (`export/shareCard.ts`) rather than
rasterised from the DOM. DOM-to-image libraries go through an SVG
`foreignObject`, which drops web fonts, mishandles CSS custom properties and
fails outright in some mobile browsers. Drawing by hand means the output is
identical everywhere and never half-rendered.

**Brackets are shown as rounds, not as a drawn tree.** On a phone a round list
is readable without pinch-zooming, and every undecided slot names its source
("Sieger WB1.2"), so where a team comes from stays explicit. A drawn tree would
need connector lines whose geometry breaks down in the losers bracket, which is
exactly where a rendering bug would be least noticeable and most confusing.

**No web fonts.** The system stack renders instantly, matches the platform and
removes an entire class of layout shift.

## Deployment targets

The same source builds for two places, which differ in where the app lives on
the host and whether a sync server is available at all.

| | Docker / Node | GitHub Pages |
|---|---|---|
| Served from | `/` | `/Spikeball/` |
| Deep links | server-side SPA fallback (`server/static.ts`) | `404.html` copy of the shell |
| Headers | cache policy + self-only CSP, ported from the old nginx config | whatever Pages sends |
| Sync server | same process, same origin, port 8080 | none - `useServerAvailable()` is false, so only local tournaments are offered |

The Docker image runs one Node process (`server/main.ts`, built to
`dist-server/server.mjs`) that serves the built PWA from `dist/` and the sync
API from the same port, backed by one SQLite file in the `/data` volume. See
[SYNC.md](SYNC.md#deployment) for the environment variables. Pointing a
Pages build at a sync server hosted elsewhere is `VITE_SYNC_URL` at build
time; that server then needs `RALLY_CORS_ORIGIN` set to the Pages origin.

`BASE_PATH` at build time is the single input for where the app itself lives.
`vite.config.ts` derives the
asset prefix, the manifest's `start_url`/`scope`/icon paths and the service
worker's navigation fallback from it, and `main.tsx` derives the router
basename from `import.meta.env.BASE_URL`. The trailing slash is stripped there:
React Router will not match `/Spikeball` against a basename of `/Spikeball/`,
and the stripped form matches the path with or without it.

## Internationalisation

All copy sits in `src/i18n/de.ts` as one nested object with `as const`. Screens
read `strings.play.enterResult` rather than inlining text. Adding a locale means
adding a second file with the same shape and switching the export in
`src/i18n/index.ts`; the types make an incomplete translation a compile error.

## Testing

`tests/` covers what would be expensive to get wrong:

- **`elo.test.ts`** — expected scores against reference values, symmetry,
  zero-sum behaviour, provisional K, and that replay order does not depend on
  storage order.
- **`pairing.test.ts`** — casual queue fairness, the hard partner-repeat cap,
  and team balancing.
- **`draft.test.ts`** — the captain's draft split and turn order.
- **`elimination.test.ts`** — seeding order, bye propagation, that a
  third-place match only appears with at least 4 teams, and that correcting an
  early result invalidates the right downstream scores.
- **`repo.test.ts`** — the database layer end to end against `fake-indexeddb`,
  including cloning between tournaments, the timed-mode draft bracket, and
  backup round-trips.
- **`server.test.ts`** — the sync server end to end over real HTTP, against an
  in-memory SQLite database: every endpoint, the compare-and-swap push with
  idempotent retry, the password lock, SSE, static file serving and CORS.
