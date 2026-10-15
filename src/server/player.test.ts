import { afterEach, beforeAll, describe, expect, test } from "bun:test";

import { runMigrations, sql } from "./db";
import {
  getPlayerSummary,
  saveScoreForPlayer,
  ensurePlayerForRequest,
  parseCookieHeader,
  createRecoveryCodeForPlayer,
  redeemRecoveryCode,
  createRunForPlayer,
  markRunUsed,
} from "./player";

async function resetDatabase() {
  await sql.unsafe("TRUNCATE TABLE scores, players RESTART IDENTITY CASCADE");
}

describe("anonymous player identity and score APIs", () => {
  beforeAll(async () => {
    await runMigrations();
  });

  afterEach(async () => {
    await resetDatabase();
  });

  test("new visitors get a cookie and the same cookie resolves to the same player", async () => {
    const first = await ensurePlayerForRequest(new Request("http://localhost/api/me"));

    expect(first.response.headers.get("set-cookie") ?? "").toContain("fp_session=");
    expect(first.player.id).toBeTruthy();

    const cookieHeader = first.response.headers.get("set-cookie") ?? "";
    const cookieValue = parseCookieHeader(cookieHeader, "fp_session");

    const second = await ensurePlayerForRequest(
      new Request("http://localhost/api/me", {
        headers: {
          Cookie: `fp_session=${cookieValue}`,
        },
      }),
    );

    expect(second.player.id).toBe(first.player.id);
  });

  test("invalid score submissions are rejected", async () => {
    const player = await ensurePlayerForRequest(new Request("http://localhost/api/me"));

    await expect(saveScoreForPlayer(player.player.id, -10)).rejects.toThrow(/points/i);
    await expect(saveScoreForPlayer(player.player.id, Number.NaN)).rejects.toThrow(/points/i);
    await expect(saveScoreForPlayer(player.player.id, 10001)).rejects.toThrow(/points/i);
  });

  test("high score is computed correctly for the current player", async () => {
    const player = await ensurePlayerForRequest(new Request("http://localhost/api/me"));

    await saveScoreForPlayer(player.player.id, 10);
    await saveScoreForPlayer(player.player.id, 42);
    await saveScoreForPlayer(player.player.id, 13);

    const summary = await getPlayerSummary(player.player.id);
    expect(summary.highScore).toBe(42);
    expect(summary.recent).toEqual([13, 42, 10]);
  });

  test("one player cannot read another player's score summary", async () => {
    const first = await ensurePlayerForRequest(new Request("http://localhost/api/me"));
    const second = await ensurePlayerForRequest(new Request("http://localhost/api/me"));

    await saveScoreForPlayer(first.player.id, 88);
    await saveScoreForPlayer(second.player.id, 20);

    const firstSummary = await getPlayerSummary(first.player.id);
    const secondSummary = await getPlayerSummary(second.player.id);

    expect(firstSummary.highScore).toBe(88);
    expect(secondSummary.highScore).toBe(20);
    expect(firstSummary.highScore).not.toBe(secondSummary.highScore);
  });

  test("recovery codes can be created and redeemed to bind a new browser", async () => {
    const first = await ensurePlayerForRequest(new Request("http://localhost/api/me"));
    const second = await ensurePlayerForRequest(new Request("http://localhost/api/me"));

    const code = await createRecoveryCodeForPlayer(first.player.id);
    expect(code).toMatch(/^[A-Z0-9-]+$/i);

    const rebound = await redeemRecoveryCode(second.player.id, code);
    expect(rebound.playerId).toBe(first.player.id);
    expect(rebound.newToken).toBeTruthy();
  });

  test("runs are created and marked used once", async () => {
    const player = await ensurePlayerForRequest(new Request("http://localhost/api/me"));
    const run = await createRunForPlayer(player.player.id);

    expect(run.id).toBeTruthy();
    expect(run.used).toBe(false);

    await markRunUsed(run.id);
    const usedRun = await markRunUsed(run.id);
    expect(usedRun.used).toBe(true);
  });
});
