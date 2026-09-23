import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import {
  addPlayer,
  backToCasual,
  clearMatchResult,
  createTournament,
  deleteMatch,
  deletePlayer,
  finishTournament,
  listMatches,
  recordCasualResult,
  renameTournament,
  reopenTournament,
  scheduleCasualMatch,
  setMatchResult,
  startDraftedBracket,
  startFreePlayTimer,
  updatePlayer,
  updateTournament,
} from '../src/db/repo';
import { protectedChanges, type ProtectionInput } from '../src/sync/protection';

/**
 * The rule is exercised through the real repo functions, so a refactor of a
 * mutation that suddenly touches a protected field (or stops touching one)
 * fails here rather than on a friend's phone.
 */

beforeEach(async () => {
  await db.delete();
  await db.open();
});

async function snapshot(tournamentId: string): Promise<ProtectionInput> {
  const tournament = await db.tournaments.get(tournamentId);
  if (!tournament) throw new Error('missing tournament');
  return {
    tournament,
    players: await db.players.where('tournamentId').equals(tournamentId).toArray(),
    matches: await db.matches.where('tournamentId').equals(tournamentId).toArray(),
  };
}

/** Runs a mutation and returns what it would need the password for. */
async function reasonsFor(tournamentId: string, mutate: () => Promise<unknown>) {
  const before = await snapshot(tournamentId);
  await mutate();
  return protectedChanges(before, await snapshot(tournamentId));
}

async function seed(playerCount: number, timed = false) {
  const tournamentId = await createTournament({
    name: 'Grillabend',
    timedMode: timed ? { freePlayMinutes: 60, draftSize: 4 } : null,
  });
  const playerIds: string[] = [];
  for (let i = 1; i <= playerCount; i += 1) {
    playerIds.push(await addPlayer(tournamentId, `Spieler ${i}`));
  }
  return { tournamentId, playerIds };
}

function pairs(ids: string[]) {
  const teams: { playerIds: string[] }[] = [];
  for (let i = 0; i + 1 < ids.length; i += 2) teams.push({ playerIds: [ids[i]!, ids[i + 1]!] });
  return teams;
}

async function playOne(tournamentId: string) {
  const open = (await listMatches(tournamentId)).find(
    (match) => match.status === 'scheduled' && match.teamA.length > 0 && match.teamB.length > 0,
  );
  if (!open) throw new Error('nothing to play');
  await setMatchResult(open.id, 21, 15);
  return open.id;
}

describe('everyday actions need no password', () => {
  it('adding players, playing and correcting scores, renaming', async () => {
    const { tournamentId, playerIds: [a, b, c, d] } = await seed(4);

    expect(await reasonsFor(tournamentId, () => addPlayer(tournamentId, 'Neu'))).toEqual([]);
    expect(
      await reasonsFor(tournamentId, () => recordCasualResult(tournamentId, [a!, b!], [c!, d!], 21, 17)),
    ).toEqual([]);

    const matchId = await scheduleCasualMatch(tournamentId, [a!, c!], [b!, d!]);
    expect(await reasonsFor(tournamentId, () => setMatchResult(matchId, 21, 10))).toEqual([]);
    // Correcting a score is recording it again, not deleting it.
    expect(await reasonsFor(tournamentId, () => setMatchResult(matchId, 10, 21))).toEqual([]);

    expect(await reasonsFor(tournamentId, () => renameTournament(tournamentId, 'Neu'))).toEqual([]);
    expect(await reasonsFor(tournamentId, () => updatePlayer(a!, { active: false }))).toEqual([]);
    expect(await reasonsFor(tournamentId, () => updatePlayer(a!, { name: 'Anna' }))).toEqual([]);
  });

  it('deleting a match that was never played', async () => {
    const { tournamentId, playerIds: [a, b, c, d] } = await seed(4);
    const matchId = await scheduleCasualMatch(tournamentId, [a!, b!], [c!, d!]);
    expect(await reasonsFor(tournamentId, () => deleteMatch(matchId))).toEqual([]);
  });

  it('playing a bracket to the end, including the automatic finish', async () => {
    const { tournamentId, playerIds } = await seed(8);
    await startDraftedBracket({ tournamentId, teams: pairs(playerIds), thirdPlaceMatch: true });

    for (let guard = 0; guard < 20; guard += 1) {
      const open = (await listMatches(tournamentId)).some(
        (match) => match.status === 'scheduled' && match.teamA.length > 0 && match.teamB.length > 0,
      );
      if (!open) break;
      expect(await reasonsFor(tournamentId, () => playOne(tournamentId))).toEqual([]);
    }
    expect((await db.tournaments.get(tournamentId))?.status).toBe('finished');
  });

  it('correcting an early bracket result that re-routes later rounds', async () => {
    // 16 players = 8 teams: quarter-finals, semi-finals, final.
    const { tournamentId, playerIds } = await seed(16);
    await startDraftedBracket({ tournamentId, teams: pairs(playerIds), thirdPlaceMatch: false });
    // Play the four quarter-finals explicitly: "first open match" follows
    // random ids and could pick a semi-final as soon as one is filled.
    const quarters = (await listMatches(tournamentId))
      .filter((match) => match.round === 1 && !match.bye)
      .sort((a, b) => a.order - b.order);
    expect(quarters).toHaveLength(4);
    for (const quarter of quarters) await setMatchResult(quarter.id, 21, 15);
    const first = quarters[0]!.id;

    // Play the semi-final the first quarter-final's winner went into.
    const quarter = (await listMatches(tournamentId)).find((match) => match.id === first)!;
    const semi = (await listMatches(tournamentId)).find(
      (match) => match.id === quarter.feedsWinnerTo?.matchId,
    );
    expect(semi?.teamA.length).toBeGreaterThan(0);
    await setMatchResult(semi!.id, 21, 12);

    // Flipping a quarter-final changes who is in the semi-final, which
    // invalidates its result. That follows from an allowed correction.
    expect(await reasonsFor(tournamentId, () => setMatchResult(first, 5, 21))).toEqual([]);
    const after = (await listMatches(tournamentId)).find((match) => match.id === semi!.id);
    expect(after?.status).not.toBe('done');
  });
});

describe('destructive actions need the password', () => {
  it('deleting a player', async () => {
    const { tournamentId, playerIds: [a] } = await seed(4);
    expect(await reasonsFor(tournamentId, () => deletePlayer(a!))).toEqual(['delete_player']);
  });

  it('deleting a played match or clearing its result', async () => {
    const { tournamentId, playerIds: [a, b, c, d] } = await seed(4);
    const one = await recordCasualResult(tournamentId, [a!, b!], [c!, d!], 21, 17);
    const two = await recordCasualResult(tournamentId, [a!, c!], [b!, d!], 21, 17);

    expect(await reasonsFor(tournamentId, () => clearMatchResult(one))).toEqual(['delete_result']);
    expect(await reasonsFor(tournamentId, () => deleteMatch(two))).toEqual(['delete_result']);
  });

  it("changing a player's start Elo or the rules", async () => {
    const { tournamentId, playerIds: [a] } = await seed(4, true);
    expect(await reasonsFor(tournamentId, () => updatePlayer(a!, { baseElo: 1300 }))).toEqual([
      'settings',
    ]);

    const tournament = (await db.tournaments.get(tournamentId))!;
    expect(
      await reasonsFor(tournamentId, () =>
        updateTournament(tournamentId, { elo: { ...tournament.elo, kFactor: 32 } }),
      ),
    ).toEqual(['settings']);
    expect(
      await reasonsFor(tournamentId, () =>
        updateTournament(tournamentId, { play: { ...tournament.play, pointsToWin: 15 } }),
      ),
    ).toEqual(['settings']);
    expect(
      await reasonsFor(tournamentId, () =>
        updateTournament(tournamentId, {
          timedMode: { ...tournament.timedMode!, draftSize: 8 },
        }),
      ),
    ).toEqual(['settings']);
  });

  it('starting the countdown and committing the draft', async () => {
    const { tournamentId, playerIds } = await seed(4, true);
    expect(await reasonsFor(tournamentId, () => startFreePlayTimer(tournamentId))).toEqual(['start']);
    expect(
      await reasonsFor(tournamentId, () =>
        startDraftedBracket({ tournamentId, teams: pairs(playerIds) }),
      ),
    ).toEqual(['start']);
  });

  it('re-drafting a running bracket', async () => {
    const { tournamentId, playerIds } = await seed(8);
    await startDraftedBracket({ tournamentId, teams: pairs(playerIds) });
    expect(
      await reasonsFor(tournamentId, () =>
        startDraftedBracket({ tournamentId, teams: pairs([...playerIds].reverse()) }),
      ),
    ).toContain('start');
  });

  it('throwing the bracket away', async () => {
    const { tournamentId, playerIds } = await seed(8);
    await startDraftedBracket({ tournamentId, teams: pairs(playerIds) });
    await playOne(tournamentId);
    expect(await reasonsFor(tournamentId, () => backToCasual(tournamentId))).toEqual([
      'delete_result',
      'bracket',
    ]);
  });

  it('finishing or reopening by hand', async () => {
    const { tournamentId, playerIds } = await seed(8);
    await startDraftedBracket({ tournamentId, teams: pairs(playerIds) });
    // Finishing before the last match is in overrides the bracket.
    expect(await reasonsFor(tournamentId, () => finishTournament(tournamentId))).toEqual(['bracket']);
    expect(await reasonsFor(tournamentId, () => reopenTournament(tournamentId))).toEqual([]);

    // Reopening a bracket that finished on its own is the protected case.
    const done = await seed(4);
    await startDraftedBracket({ tournamentId: done.tournamentId, teams: pairs(done.playerIds) });
    await playOne(done.tournamentId);
    expect((await db.tournaments.get(done.tournamentId))?.status).toBe('finished');
    expect(await reasonsFor(done.tournamentId, () => reopenTournament(done.tournamentId))).toEqual([
      'bracket',
    ]);

    // Liga mode has no bracket to derive the status from.
    const liga = await seed(4);
    expect(await reasonsFor(liga.tournamentId, () => finishTournament(liga.tournamentId))).toEqual([
      'bracket',
    ]);
  });
});
