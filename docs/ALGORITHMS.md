# Algorithms

Everything in this document lives in `src/domain/` and is covered by
`tests/`. None of it touches React or IndexedDB, so it can be reasoned about
and tested on its own.

---

## Elo

`src/domain/elo.ts`

Roundnet is played 2v2 with rotating partners, so ratings are kept **per player**
and a team is represented by the arithmetic mean of its members. This is the
standard "team = average rating" extension of Elo used by most team ladders.

**Expected score** — the probability that A beats B:

```
E_A = 1 / (1 + 10^((R_B - R_A) / 400))
```

**Rating change** for every member of team A:

```
Δ = K_player · MOV · (S_A - E_A)
```

where `S_A` is 1 for a win and 0 for a loss (roundnet has no draws), and both
members of a team receive the same result term scaled by their own K.

### K-factor

FIDE-style tiering: a player who has not yet played `provisionalMatches`
(default 8) rated matches uses `kFactorProvisional` (default 40), everyone else
uses `kFactor` (default 24). New players therefore converge on their real
strength within an evening instead of over a season.

### Margin of victory

A 21:3 says more than a 21:19, but naively scaling by the margin inflates
ratings, because strong teams win by more *because* they are strong. The
multiplier is FiveThirtyEight's autocorrelation-corrected form:

```
MOV = ln(|margin| + 1) · 2.2 / (0.001 · edge + 2.2)
```

`edge` is the winning team's rating advantage. A blowout by the favourite is
damped; the same blowout by the underdog is not. It can be switched off per
tournament.

### Replay, not increments

The app **never** adjusts a rating in place. Every rating is derived by
replaying the whole match log from the players' base ratings:

```
ratings = replayElo(players, matches, settings)
```

Correcting a score entered an hour ago, changing someone's starting rating, or
deleting a player therefore repairs the entire tournament rather than leaving
the rest inconsistent. With a few hundred matches the replay costs well under a
millisecond, so it simply runs after every mutation and on every render that
needs numbers.

Ordering matters for Elo, so a match takes its sequence number when its **result
is recorded**, not when it is scheduled — and it keeps that number when the
score is later corrected, so a correction never reshuffles the history after it.

> References: A. Elo, *The Rating of Chessplayers, Past and Present* (1978);
> FIDE handbook B.02 (K-factor tiers); FiveThirtyEight's NBA/NFL Elo
> methodology (margin-of-victory multiplier).

---

## Pairing

### Team balance — `pairing/balance.ts`

Four players can be split into two pairs in exactly three ways. All three are
evaluated and the cheapest wins, where cost is the rating gap between the teams
plus a penalty for partnerships and match-ups that already happened. Because the
search space is enumerated in full, the result is optimal for that cost — there
is no heuristic to get wrong.

### Free play — `pairing/casual.ts`

A rest-fairness queue. Players are ordered by matches played, then by how long
they have been waiting, then randomly; the first four go on. Teams are then
formed by `balancedSplit`, so the match is close and partners rotate. This is
the heuristic social formats such as **Americano** use.

### Round robin — `pairing/roundRobin.ts`

A *whist tournament* schedule for rotating partners:

1. The **circle method** (Berger tables) generates every possible partnership
   exactly once across `n-1` rounds. An odd field gets a ghost entry whose
   partner sits out.
2. Within each round, those partnerships are matched against each other by
   minimum-cost pairing, weighting rating balance against how often the two
   sides have already met.

Result: everybody partners everybody exactly once, and opponents repeat as late
as possible. When the number of pairs in a round is odd, the pair that has sat
out least takes the bye, which spreads rest time evenly.

Singles collapses to the plain circle method.

### Swiss — `pairing/swiss.ts`

Players are ranked (by rating in round 1, by standings afterwards) and cut into
consecutive groups of four. Each group is split by the **Mexicano** rule — rank
1 partners rank 4 against ranks 2 and 3 — which keeps every match close while
rotating partners continuously. A split that would repeat an existing
partnership is passed over in favour of one that would not.

Singles falls back to **Monrad** pairing: adjacent ranks meet, sliding down the
table to avoid a rematch.

Byes go to whoever has sat out least, lowest-ranked first on a tie.

### Elimination — `pairing/elimination.ts`

Knockouts need a stable entity to eliminate, which rotating partners are not. So
for `single_elim` and `double_elim` the participants are first frozen into
**fixed teams** by snake pairing (strongest with weakest, and so on inwards),
the standard way to build evenly matched pairs from a ranked pool. Individual
Elo keeps updating from every match either way.

**Seeding** uses the standard bracket order, built by repeatedly mirroring the
previous round's seed list — `[1,2]` → `[1,4,2,3]` → `[1,8,4,5,2,7,3,6]`. Top
seeds can only meet in the final, and a field that is not a power of two gives
the top seeds byes.

**Double elimination** adds an alternating losers bracket: a *minor* round in
which survivors play each other, then a *major* round in which they meet the
fresh dropdowns from the winners bracket. A bracket of `2^k` produces `2k-2`
losers rounds. Dropdowns from odd winners rounds are reversed before placement —
the usual cross-seeding trick that delays rematches. If the losers-bracket
finalist wins the grand final, a decider is appended automatically, and removed
again if that result is later corrected.

### Bracket resolution

Like the Elo replay, bracket progression is a **re-derivation, not an update**.
`resolveBracket()` clears every slot that is fed by another match and pushes
teams forward again from the completed results, in topological order. Two
consequences fall out for free:

- Correcting an early result repairs the whole downstream bracket.
- A score that no longer belongs to the teams now standing in that match is
  discarded instead of being silently mis-attributed.

Byes propagate as walkovers: a match whose opponent slot can never be filled
resolves to a walkover for the team that is there, all the way down the losers
bracket.

---

## Standings

`src/domain/standings.ts`

Ranked by wins, then point difference, then points scored, then rating, then
name — the usual club order, with a deterministic final tiebreak so the table
never jitters between renders.
