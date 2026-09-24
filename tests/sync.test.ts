import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { db } from '../src/db/db';
import {
  addPlayer,
  clearMatchResult,
  createTournament,
  deletePlayer,
  listMatches,
  recordCasualResult,
  scheduleCasualMatch,
  setMatchResult,
  startFreePlayTimer,
} from '../src/db/repo';
import {
  changeTournamentPassword,
  deleteTournamentEverywhere,
  discardPendingChanges,
  isLockedError,
  joinTournament,
  leaveTournament,
  lockTournament,
  onSyncNotice,
  parseJoinInput,
  publishTournament,
  shareUrl,
  syncNow,
  SyncError,
  unlockTournament,
  type SyncNotice,
} from '../src/sync/index';
import { configureSync } from '../src/sync/config';
import type { Player } from '../src/domain/types';
import { setupSyncTest, type SyncTestEnv } from './support/testEnv';

let env: SyncTestEnv;

beforeEach(async () => {
  await db.delete();
  await db.open();
  env = setupSyncTest();
});

async function seedTournament(playerCount = 4): Promise<{ tournamentId: string; playerIds: string[] }> {
  const tournamentId = await createTournament({ name: 'Grillabend' });
  const playerIds: string[] = [];
  for (let i = 1; i <= playerCount; i += 1) playerIds.push(await addPlayer(tournamentId, `Spieler ${i}`));
  return { tournamentId, playerIds };
}

/* ------------------------------------------------------------------------ */

describe('a local tournament', () => {
  it('never gets a sync row and behaves exactly as before', async () => {
    const { tournamentId, playerIds } = await seedTournament();
    const [a, b, c, d] = playerIds;
    await recordCasualResult(tournamentId, [a!, b!], [c!, d!], 21, 15);
    const matchId = await scheduleCasualMatch(tournamentId, [a!, c!], [b!, d!]);
    await setMatchResult(matchId, 21, 10);

    expect(await db.sync.get(tournamentId)).toBeUndefined();
    expect((await listMatches(tournamentId)).filter((m) => m.status === 'done')).toHaveLength(2);
    expect(env.server.has(tournamentId)).toBe(false);
  });
});

/* ------------------------------------------------------------------------ */

describe('publishing', () => {
  it('creates the tournament on the server, then pushes further changes', async () => {
    const { tournamentId } = await seedTournament(2);

    await publishTournament(tournamentId, null);
    await syncNow(tournamentId);

    let sync = await db.sync.get(tournamentId);
    expect(sync?.revision).toBe(1);
    expect(sync?.pending).toEqual([]);
    expect(sync?.role).toBe('owner');
    expect(env.server.getRevision(tournamentId)).toBe(1);
    expect((await db.tournaments.get(tournamentId))?.visibility).toBe('public');

    await addPlayer(tournamentId, 'Spieler 3');
    await syncNow(tournamentId);

    sync = await db.sync.get(tournamentId);
    expect(sync?.revision).toBe(2);
    expect(sync?.pending).toEqual([]);
    expect(env.server.getRevision(tournamentId)).toBe(2);
    expect(env.server.getSnapshot(tournamentId)?.players).toHaveLength(3);
  });

  it('works offline: the upload is queued until a connection appears', async () => {
    const { tournamentId } = await seedTournament(1);
    env.online.value = false;

    await publishTournament(tournamentId, null);
    await syncNow(tournamentId);

    let sync = await db.sync.get(tournamentId);
    expect(sync?.revision).toBe(0);
    expect(sync?.error).toBe('offline');
    expect(env.server.has(tournamentId)).toBe(false);

    env.online.value = true;
    await syncNow(tournamentId);

    sync = await db.sync.get(tournamentId);
    expect(sync?.revision).toBe(1);
    expect(sync?.error).toBeNull();
    expect(env.server.has(tournamentId)).toBe(true);
  });
});

/* ------------------------------------------------------------------------ */

describe('the admin password', () => {
  it('lets free changes through without it, and blocks destructive ones until unlocked', async () => {
    const { tournamentId, playerIds } = await seedTournament(4);
    await publishTournament(tournamentId, 'geheim');
    await syncNow(tournamentId);
    expect(env.server.isProtected(tournamentId)).toBe(true);

    // A free change needs no password even while protected.
    await addPlayer(tournamentId, 'Spieler 5');
    await syncNow(tournamentId);
    expect(env.server.getRevision(tournamentId)).toBe(2);

    // Simulate a device that does not know the password.
    await lockTournament(tournamentId);
    let status = await db.sync.get(tournamentId);
    expect(status?.adminPassword).toBeNull();

    await expect(deletePlayer(playerIds[0]!)).rejects.toThrow(SyncError);
    try {
      await deletePlayer(playerIds[0]!);
      throw new Error('expected deletePlayer to throw');
    } catch (err) {
      expect(isLockedError(err)).toBe(true);
    }
    // Nothing was written: the transaction rolled back.
    expect(await db.players.get(playerIds[0]!)).toBeDefined();
    expect(env.server.getRevision(tournamentId)).toBe(2);

    const unlocked = await unlockTournament(tournamentId, 'geheim');
    expect(unlocked).toBe(true);

    await deletePlayer(playerIds[0]!);
    await syncNow(tournamentId);
    expect(await db.players.get(playerIds[0]!)).toBeUndefined();
    expect(env.server.getRevision(tournamentId)).toBe(3);
  });

  it('throws locked with nothing written for deletePlayer, clearMatchResult and startFreePlayTimer', async () => {
    const tournamentId = await createTournament({
      name: 'Turniermodus',
      timedMode: { freePlayMinutes: 30, draftSize: 4 },
    });
    const a = await addPlayer(tournamentId, 'A');
    const b = await addPlayer(tournamentId, 'B');
    const matchId = await recordCasualResult(tournamentId, [a], [b], 21, 10);

    await publishTournament(tournamentId, 'geheim');
    await syncNow(tournamentId);
    await lockTournament(tournamentId);

    await expect(deletePlayer(a)).rejects.toMatchObject({ code: 'locked' });
    await expect(clearMatchResult(matchId)).rejects.toMatchObject({ code: 'locked' });
    await expect(startFreePlayTimer(tournamentId)).rejects.toMatchObject({ code: 'locked' });

    expect(await db.players.get(a)).toBeDefined();
    expect((await db.matches.get(matchId))?.status).toBe('done');
    expect((await db.tournaments.get(tournamentId))?.timedMode?.timerStartedAt).toBeNull();
    expect(env.server.getRevision(tournamentId)).toBe(1);

    expect(await unlockTournament(tournamentId, 'geheim')).toBe(true);
    await clearMatchResult(matchId);
    await startFreePlayTimer(tournamentId);
    await deletePlayer(a);
    await syncNow(tournamentId);

    expect(await db.players.get(a)).toBeUndefined();
    expect((await db.matches.get(matchId))?.status).not.toBe('done');
    expect((await db.tournaments.get(tournamentId))?.timedMode?.timerStartedAt).not.toBeNull();
  });

  it('unlockTournament returns false for a wrong password without remembering it', async () => {
    const { tournamentId } = await seedTournament(1);
    await publishTournament(tournamentId, 'geheim');
    await syncNow(tournamentId);
    await lockTournament(tournamentId);

    expect(await unlockTournament(tournamentId, 'falsch')).toBe(false);
    expect((await db.sync.get(tournamentId))?.adminPassword).toBeNull();
  });

  it('changeTournamentPassword sets, changes and removes the password', async () => {
    const { tournamentId } = await seedTournament(1);
    await publishTournament(tournamentId, null);
    await syncNow(tournamentId);
    expect(env.server.isProtected(tournamentId)).toBe(false);

    await changeTournamentPassword(tournamentId, 'neu');
    expect(env.server.isProtected(tournamentId)).toBe(true);
    expect((await db.sync.get(tournamentId))?.adminPassword).toBe('neu');

    await changeTournamentPassword(tournamentId, null);
    expect(env.server.isProtected(tournamentId)).toBe(false);
    expect((await db.sync.get(tournamentId))?.adminPassword).toBeNull();
  });
});

/* ------------------------------------------------------------------------ */

describe('offline queueing', () => {
  it('queues commands while offline and pushes them all in one go once online', async () => {
    const { tournamentId } = await seedTournament(1);
    await publishTournament(tournamentId, null);
    await syncNow(tournamentId);

    env.online.value = false;

    await addPlayer(tournamentId, 'Spieler B');
    await syncNow(tournamentId);
    let sync = await db.sync.get(tournamentId);
    expect(sync?.pending).toHaveLength(1);
    expect(sync?.error).toBe('offline');

    await addPlayer(tournamentId, 'Spieler C');
    await syncNow(tournamentId);
    sync = await db.sync.get(tournamentId);
    expect(sync?.pending).toHaveLength(2);
    expect(sync?.error).toBe('offline');
    expect(env.server.has(tournamentId)).toBe(true); // created before we went offline
    expect(env.server.getRevision(tournamentId)).toBe(1); // but neither addPlayer reached it yet

    env.online.value = true;
    await syncNow(tournamentId);

    sync = await db.sync.get(tournamentId);
    expect(sync?.pending).toEqual([]);
    expect(sync?.error).toBeNull();
    // Both queued commands went up in the one push.
    expect(env.server.getRevision(tournamentId)).toBe(2);
    expect(env.server.getSnapshot(tournamentId)?.players).toHaveLength(3);
  });
});

/* ------------------------------------------------------------------------ */

describe('conflicts and replay', () => {
  it('replays local pending commands on top of another device‘s push', async () => {
    const { tournamentId, playerIds } = await seedTournament(2);
    const [a, b] = playerIds;
    await publishTournament(tournamentId, null);
    await syncNow(tournamentId);

    const otherPlayer: Player = {
      id: 'other-player',
      tournamentId,
      name: 'Von anderem Geraet',
      baseElo: 1000,
      elo: 1000,
      createdAt: Date.now(),
      active: true,
      inTournament: false,
      origin: null,
    };
    env.server.pushAsOtherDevice(tournamentId, (snapshot) => ({
      ...snapshot,
      players: [...snapshot.players, otherPlayer],
    }));
    expect(env.server.getRevision(tournamentId)).toBe(2);

    // Locally we are still on revision 1 when we record a result.
    const matchId = await recordCasualResult(tournamentId, [a!], [b!], 21, 15);
    await syncNow(tournamentId);

    const sync = await db.sync.get(tournamentId);
    expect(sync?.pending).toEqual([]);
    expect(sync?.revision).toBe(3);
    expect(env.server.getRevision(tournamentId)).toBe(3);

    const players = await db.players.where('tournamentId').equals(tournamentId).toArray();
    expect(players.some((p) => p.id === 'other-player')).toBe(true);
    expect((await db.matches.get(matchId))?.status).toBe('done');
    expect(env.server.getSnapshot(tournamentId)?.matches.some((m) => m.id === matchId)).toBe(true);
  });

  it('a 403-locked push keeps pending and reports a notice; discardPendingChanges resets to the server', async () => {
    const { tournamentId, playerIds } = await seedTournament(4);
    await publishTournament(tournamentId, 'geheim');
    await syncNow(tournamentId);

    // Go offline first so the command's own auto-triggered sync cannot race
    // ahead and push it with the password still in place.
    env.online.value = false;
    // Queue a protected change while still unlocked (allowed - this device
    // holds the password at command time)...
    await deletePlayer(playerIds[0]!);
    // Wait out the command's own auto-triggered sync attempt (it fails
    // offline and leaves the command queued) before changing anything else,
    // so the next steps are not racing it.
    await syncNow(tournamentId);
    // ...then forget the password before it gets a chance to push. The push
    // itself then goes out without X-Rally-Password and the server 403s it.
    await lockTournament(tournamentId);
    env.online.value = true;

    const notices: SyncNotice[] = [];
    const unsubscribe = onSyncNotice((notice) => notices.push(notice));
    await syncNow(tournamentId);
    unsubscribe();

    let sync = await db.sync.get(tournamentId);
    expect(sync?.error).toBe('locked');
    expect(sync?.pending).toHaveLength(1);
    expect(notices).toContainEqual({
      kind: 'locked',
      tournamentId,
      reasons: ['delete_player'],
    });
    // The server never accepted the deletion.
    expect(env.server.getSnapshot(tournamentId)?.players.some((p) => p.id === playerIds[0])).toBe(true);

    await discardPendingChanges(tournamentId);
    sync = await db.sync.get(tournamentId);
    expect(sync?.pending).toEqual([]);
    expect(sync?.error).toBeNull();
    expect(sync?.revision).toBe(env.server.getRevision(tournamentId));
    // Discarding resets the local copy to the server's state: the player is back.
    expect(await db.players.get(playerIds[0]!)).toBeDefined();
  });
});

/* ------------------------------------------------------------------------ */

describe('the id tape', () => {
  it('keeps a match created offline at the same id through a conflict replay', async () => {
    const { tournamentId, playerIds } = await seedTournament(2);
    const [a, b] = playerIds;
    await publishTournament(tournamentId, null);
    await syncNow(tournamentId);

    env.online.value = false;
    const matchId = await scheduleCasualMatch(tournamentId, [a!], [b!]);
    await syncNow(tournamentId);
    await setMatchResult(matchId, 21, 18);
    await syncNow(tournamentId);

    let sync = await db.sync.get(tournamentId);
    expect(sync?.pending).toHaveLength(2);

    // The server moved on while we were offline.
    env.server.pushAsOtherDevice(tournamentId, (snapshot) => snapshot);
    expect(env.server.getRevision(tournamentId)).toBe(2);

    env.online.value = true;
    await syncNow(tournamentId);

    sync = await db.sync.get(tournamentId);
    expect(sync?.pending).toEqual([]);
    expect(sync?.revision).toBe(3);

    const match = await db.matches.get(matchId);
    expect(match).toBeDefined();
    expect(match?.scoreA).toBe(21);
    expect(match?.scoreB).toBe(18);
    expect(env.server.getSnapshot(tournamentId)?.matches.find((m) => m.id === matchId)?.scoreA).toBe(21);
  });
});

/* ------------------------------------------------------------------------ */

describe('a push whose response is lost', () => {
  it('does not record the command twice on retry', async () => {
    const { tournamentId, playerIds } = await seedTournament(2);
    const [a, b] = playerIds;
    await publishTournament(tournamentId, null);
    await syncNow(tournamentId);

    const realFetch = env.server.fetch;
    let dropNextPushResponse = true;
    configureSync({
      fetch: async (input, init) => {
        const url = new URL(typeof input === 'string' ? input : input.toString());
        const isPush = (init?.method ?? 'GET').toUpperCase() === 'PUT' && /\/tournaments\/[^/]+$/.test(url.pathname);
        if (isPush && dropNextPushResponse) {
          dropNextPushResponse = false;
          await realFetch(input, init); // the server applies it...
          throw new TypeError('simulated network failure'); // ...but we never see the response.
        }
        return realFetch(input, init);
      },
    });

    const matchId = await recordCasualResult(tournamentId, [a!], [b!], 21, 9);
    await syncNow(tournamentId);
    let sync = await db.sync.get(tournamentId);
    expect(sync?.error).toBe('offline');
    expect(sync?.pending).toHaveLength(1); // still queued locally - we never saw the 200

    await syncNow(tournamentId); // retry: stale baseRevision -> 409 with `applied` listing our command
    sync = await db.sync.get(tournamentId);
    expect(sync?.pending).toEqual([]);
    expect(sync?.revision).toBe(2); // applied exactly once

    const done = env.server.getSnapshot(tournamentId)?.matches.filter((m) => m.status === 'done') ?? [];
    expect(done).toHaveLength(1);
    expect(done[0]!.id).toBe(matchId);
  });
});

/* ------------------------------------------------------------------------ */

describe('a dropped command', () => {
  it('is reported by name and the queue still drains', async () => {
    const { tournamentId, playerIds } = await seedTournament(2);
    const [a, b] = playerIds;
    const matchId = await scheduleCasualMatch(tournamentId, [a!], [b!]);
    await publishTournament(tournamentId, null);
    await syncNow(tournamentId);

    const notices: SyncNotice[] = [];
    const unsubscribe = onSyncNotice((notice) => notices.push(notice));

    env.online.value = false;
    await setMatchResult(matchId, 21, 5);
    await syncNow(tournamentId);
    expect((await db.sync.get(tournamentId))?.pending).toHaveLength(1);

    // Another device deletes the match we were about to score.
    env.server.pushAsOtherDevice(tournamentId, (snapshot) => ({
      ...snapshot,
      matches: snapshot.matches.filter((m) => m.id !== matchId),
    }));

    env.online.value = true;
    await syncNow(tournamentId);
    unsubscribe();

    const sync = await db.sync.get(tournamentId);
    expect(sync?.pending).toEqual([]);
    expect(sync?.revision).toBe(env.server.getRevision(tournamentId));
    expect(notices).toContainEqual({ kind: 'dropped', tournamentId, count: 1 });
    expect(await db.matches.get(matchId)).toBeUndefined();
  });
});

/* ------------------------------------------------------------------------ */

describe('joining, leaving and deleting', () => {
  it('joinTournament fetches an existing public tournament by id', async () => {
    const { tournamentId } = await seedTournament(2);
    await publishTournament(tournamentId, null);
    await syncNow(tournamentId);
    const revision = env.server.getRevision(tournamentId);

    // A second device: fresh database, same fake server.
    await leaveTournament(tournamentId); // this device forgets it too, to simulate "someone else's phone"
    expect(await db.tournaments.get(tournamentId)).toBeUndefined();

    await joinTournament(tournamentId);

    const tournament = await db.tournaments.get(tournamentId);
    expect(tournament?.visibility).toBe('public');
    const sync = await db.sync.get(tournamentId);
    expect(sync?.role).toBe('joined');
    expect(sync?.revision).toBe(revision);
    expect(await db.players.where('tournamentId').equals(tournamentId).count()).toBe(2);
  });

  it('joinTournament throws not_found for an unknown id', async () => {
    await expect(joinTournament('00000000-0000-4000-8000-000000000000')).rejects.toMatchObject({
      code: 'not_found',
    });
  });

  it('leaveTournament removes only the local copy', async () => {
    const { tournamentId } = await seedTournament(1);
    await publishTournament(tournamentId, null);
    await syncNow(tournamentId);

    await leaveTournament(tournamentId);

    expect(await db.tournaments.get(tournamentId)).toBeUndefined();
    expect(await db.sync.get(tournamentId)).toBeUndefined();
    expect(env.server.has(tournamentId)).toBe(true); // everyone else still has it
  });

  it('deleteTournamentEverywhere needs the password when one is set', async () => {
    const { tournamentId } = await seedTournament(1);
    await publishTournament(tournamentId, 'geheim');
    await syncNow(tournamentId);
    await lockTournament(tournamentId);

    await expect(deleteTournamentEverywhere(tournamentId)).rejects.toMatchObject({ code: 'locked' });
    expect(env.server.has(tournamentId)).toBe(true);
    expect(await db.tournaments.get(tournamentId)).toBeDefined();

    await unlockTournament(tournamentId, 'geheim');
    await deleteTournamentEverywhere(tournamentId);

    expect(env.server.has(tournamentId)).toBe(false);
    expect(await db.tournaments.get(tournamentId)).toBeUndefined();
    expect(await db.sync.get(tournamentId)).toBeUndefined();
  });

  it('deleteTournamentEverywhere works without a password when none is set', async () => {
    const { tournamentId } = await seedTournament(1);
    await publishTournament(tournamentId, null);
    await syncNow(tournamentId);

    await deleteTournamentEverywhere(tournamentId);
    expect(env.server.has(tournamentId)).toBe(false);
    expect(await db.tournaments.get(tournamentId)).toBeUndefined();
  });

  it('a remote deletion converts the local copy to local and reports a notice', async () => {
    const { tournamentId } = await seedTournament(1);
    await publishTournament(tournamentId, null);
    await syncNow(tournamentId);

    env.server.deleteAsOtherDevice(tournamentId);

    const notices: SyncNotice[] = [];
    const unsubscribe = onSyncNotice((notice) => notices.push(notice));
    await addPlayer(tournamentId, 'Spieler B'); // queues a command, which then tries to sync
    await syncNow(tournamentId);
    unsubscribe();

    expect(notices).toContainEqual({ kind: 'deleted', tournamentId });
    const tournament = await db.tournaments.get(tournamentId);
    expect(tournament?.visibility).toBe('local');
    expect(await db.sync.get(tournamentId)).toBeUndefined();
    // The local copy, including the change made after the deletion, is kept.
    expect(await db.players.where('tournamentId').equals(tournamentId).count()).toBe(2);
  });
});

/* ------------------------------------------------------------------------ */

describe('parseJoinInput', () => {
  const id = '3fa85f64-5717-4562-b3fc-2c963f66afa6';

  it('extracts the id from a full share URL', () => {
    expect(parseJoinInput(`https://rally.example.com/t/${id}`)).toBe(id);
    expect(parseJoinInput(`https://rally.example.com/Spikeball/t/${id}?ref=qr`)).toBe(id);
  });

  it('extracts the id from a bare path', () => {
    expect(parseJoinInput(`/t/${id}`)).toBe(id);
  });

  it('extracts the bare id, case-insensitively', () => {
    expect(parseJoinInput(id.toUpperCase())).toBe(id);
    expect(parseJoinInput(`  ${id}  `)).toBe(id);
  });

  it('returns null for nonsense input', () => {
    expect(parseJoinInput('not a link')).toBeNull();
    expect(parseJoinInput('')).toBeNull();
  });
});

describe('shareUrl', () => {
  it('builds an absolute link under the app base path', () => {
    // main.tsx / vite provide `location`/BASE_URL in the browser; here we
    // only assert shareUrl doesn't crash and returns the tournament id path
    // when those globals exist (jsdom is not configured for this project's
    // node test environment, so this is skipped where they are unavailable).
    if (typeof location === 'undefined') return;
    const url = shareUrl('abc');
    expect(url).toContain('/t/abc');
  });
});
