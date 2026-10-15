import { sql } from "./db";

const SESSION_COOKIE_NAME = "fp_session";
const MAX_SESSION_AGE_SECONDS = 60 * 60 * 24 * 365;
const SCORE_RATE_LIMIT_MS = process.env.NODE_ENV === "test" ? 0 : 3000;
const scoreRateLimit = new Map<string, number>();

export type PlayerRecord = {
  id: string;
  token_hash: Uint8Array;
  created_at: Date;
  last_seen_at: Date;
};

export function parseCookieHeader(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) {
    return null;
  }

  for (const entry of cookieHeader.split(";")) {
    const [rawName, ...rest] = entry.trim().split("=");
    if (rawName === name) {
      return decodeURIComponent(rest.join("="));
    }
  }

  return null;
}

function toBase64Url(bytes: Uint8Array) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }

  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function randomToken() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return toBase64Url(bytes);
}

async function hashToken(token: string) {
  const encoded = new TextEncoder().encode(token);
  const digest = await crypto.subtle.digest("SHA-256", encoded);
  return new Uint8Array(digest);
}

export function buildSessionCookie(token: string) {
  const secureFlag = process.env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE_NAME}=${encodeURIComponent(token)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${MAX_SESSION_AGE_SECONDS}${secureFlag}`;
}

export function withSessionCookie(response: Response, token: string) {
  const headers = new Headers(response.headers);
  headers.append("Set-Cookie", buildSessionCookie(token));
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}

export async function getOrCreatePlayerFromRequest(request: Request) {
  const cookieHeader = request.headers.get("cookie");
  const token = parseCookieHeader(cookieHeader, SESSION_COOKIE_NAME) ?? randomToken();
  const tokenHash = await hashToken(token);

  const existingPlayer = await sql<PlayerRecord>`
    SELECT id, token_hash, created_at, last_seen_at
    FROM players
    WHERE token_hash = ${tokenHash}
    LIMIT 1
  `;

  if (existingPlayer.length > 0) {
    const player = existingPlayer[0];
    await sql`
      UPDATE players
      SET last_seen_at = now()
      WHERE id = ${player.id}
    `;
    return { player, token };
  }

  const inserted = await sql<PlayerRecord>`
    INSERT INTO players (token_hash, last_seen_at)
    VALUES (${tokenHash}, now())
    RETURNING id, token_hash, created_at, last_seen_at
  `;

  const player = inserted[0];
  return { player, token };
}

export async function ensurePlayerForRequest(request: Request) {
  const { player, token } = await getOrCreatePlayerFromRequest(request);
  return {
    player,
    token,
    response: Response.json({
      playerId: player.id,
      highScore: 0,
      recent: []
    }, {
      headers: {
        "Set-Cookie": buildSessionCookie(token),
      },
    }),
  };
}

export async function getPlayerSummary(playerId: string) {
  const row = await sql<{ high_score: number }>`
    SELECT COALESCE(MAX(points), 0)::int AS high_score
    FROM scores
    WHERE player_id = ${playerId}
  `;

  const recentRows = await sql<{ points: number }>`
    SELECT points
    FROM scores
    WHERE player_id = ${playerId}
    ORDER BY created_at DESC
    LIMIT 20
  `;

  return {
    highScore: Number(row[0]?.high_score ?? 0),
    recent: recentRows.map(entry => Number(entry.points)),
  };
}

export async function saveScoreForPlayer(playerId: string, points: number) {
  if (!Number.isInteger(points) || points < 0 || points > 10000) {
    throw new Error("points must be an integer between 0 and 10000");
  }

  const lastSubmittedAt = scoreRateLimit.get(playerId) ?? 0;
  const now = Date.now();
  if (now - lastSubmittedAt < SCORE_RATE_LIMIT_MS) {
    throw new Error("Score submission rate limited. Please wait a moment and try again.");
  }

  scoreRateLimit.set(playerId, now);

  await sql`
    INSERT INTO scores (player_id, points)
    VALUES (${playerId}, ${points})
  `;

  return getPlayerSummary(playerId);
}
