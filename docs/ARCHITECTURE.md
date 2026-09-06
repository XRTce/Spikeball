# Architecture

Rally is a static bundle with no backend. The whole app is a local database
with a UI on top, so most of the design follows from one decision: **derived
state is never stored.**

```
┌──────────────────────────────────────────────────────────┐
│  screens/                     what the tournament master │
│  components/                  taps                       │
├──────────────────────────────────────────────────────────┤
│  ui/            design system (tokens, primitives)       │
│  state/         read model, theme, player colours        │
├──────────────────────────────────────────────────────────┤
│  db/            Dexie repository  ← the only mutations   │
├──────────────────────────────────────────────────────────┤
│  domain/        pure functions: Elo, pairing, standings  │
└──────────────────────────────────────────────────────────┘
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

## Two phases

A tournament starts in `phase: 'casual'` — an open queue where the app suggests
the next fair match. Switching to `phase: 'tournament'` freezes the current
ratings, picks the participants and generates a schedule. Casual results are
kept and keep counting; discarding the tournament (`backToCasual`) removes only
the generated matches.

Elimination formats additionally build fixed teams at that moment and store them
in `tournament.bracket`, because a knockout needs something stable to eliminate.
See [ALGORITHMS.md](ALGORITHMS.md).

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
- **`pairing.test.ts`** — the round-robin partner-coverage property (in an
  8-player field every pair partners exactly once), bye fairness, Swiss
  partner-repeat avoidance, casual queue fairness.
- **`elimination.test.ts`** — seeding order, bye propagation through the losers
  bracket, `2(n-1)` matches for any double-elimination field, decider handling,
  and that correcting an early result invalidates the right downstream scores.
- **`repo.test.ts`** — the database layer end to end against `fake-indexeddb`,
  including cloning between tournaments and backup round-trips.
