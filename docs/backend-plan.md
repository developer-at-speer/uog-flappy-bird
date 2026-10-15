# Backend Plan: Persistent Anonymous Scores

Status: **Proposal, not yet implemented**
Branch: `feat/session-2-changes`

## 1. Goal

Anonymous players should be able to save their Flappy Bird scores on a server so the scores are not lost when the browser's history is cleared. Postgres is the database. The backend is built on Bun's built-in tooling (`Bun.serve`, `Bun.sql`, `bun test`) with no Express, `pg` or ORM, per [CLAUDE.md](../CLAUDE.md).

### Non-goals (for this iteration)

- Usernames, passwords, OAuth, or any sign-in flow.
- A public leaderboard with display names (see [Open questions](#9-open-questions)).
- Anti-cheat strong enough to stop a determined attacker (see [section 6](#6-score-integrity)).

## 2. Current state

| Area | Today |
| --- | --- |
| Game | [src/game.js](../src/game.js): plain script, canvas, `var`-style JS. Loaded by [src/index.html](../src/index.html). |
| Score storage | `localStorage` keys `flappy.highScore` and `flappy.scores` (last 20 scores). Written by `saveScore()` on game over. |
| Server | [src/index.ts](../src/index.ts): `Bun.serve` with a `"/*"` catch-all that serves `index.html`, plus demo `/api/hello` routes. |
| Hosting | [netlify.toml](../netlify.toml) runs `bun run build` and publishes `dist/` as **static files only**. |
| Database | None. |

The first problem is that the scores live in `localStorage`, which the browser deletes along with site data. The second is that the current Netlify setup cannot run a Bun server, which affects where the backend is deployed ([section 8](#8-deployment)).

## 3. The identity problem (read this first)

"Anonymous" means the server has no account to look a player up by. It has to recognise a returning browser by something the browser sends. That choice decides what the feature can actually promise.

| Identifier | Survives "clear browsing history" | Survives "clear cookies and site data" |
| --- | --- | --- |
| `localStorage` (today) | Depends on the browser, usually no | No |
| `HttpOnly` cookie holding a random token | **Yes** | No |
| Cookie plus a player-held **recovery code** | Yes | **Yes**, if the player enters the code |

Most "clear history" actions leave cookies alone unless the user also ticks "cookies and other site data". An `HttpOnly` cookie covers the common case you described. No design can silently restore scores after a user wipes cookies, because the server would have nothing to recognise them by. A recovery code is the only anonymous way to cover that case.

**Recommendation:**

1. Ship the `HttpOnly` cookie identity first (phase 1 and 2).
2. Add the recovery code as phase 3, so a player can move their scores to a new browser or restore them after clearing cookies.

Be upfront in the UI that clearing cookies and site data without a recovery code loses the link to the saved scores.

## 4. Architecture

```
Browser (game.js)
   │  fetch, same-origin, cookie sent automatically
   ▼
Bun.serve  (src/index.ts)
   ├─ routes "/api/..."  → handlers in src/server/routes/*
   ├─ route  "/*"        → index.html (unchanged)
   └─ src/server/db.ts   → Bun.sql pool
                              │
                              ▼
                          Postgres
```

Everything stays in one Bun process serving the frontend and the API from the same origin. That keeps cookies simple (no CORS, `SameSite=Lax` works) and matches the current setup. Bun routes match specific paths before the `"/*"` catch-all, so the API routes will not be shadowed. We should verify this early in phase 1.

### Proposed file layout

```
migrations/
  001_init.sql
src/
  index.ts                  # mounts API routes (existing file, edited)
  server/
    db.ts                   # `new SQL(...)` / `sql` export, reads DATABASE_URL
    migrate.ts              # tiny migration runner
    player.ts               # cookie → player lookup / creation helpers
    routes/
      scores.ts             # GET/POST score endpoints
      runs.ts               # start-run endpoint (phase 4)
      recovery.ts           # recovery-code endpoints (phase 3)
    *.test.ts               # bun test, next to the code
docker-compose.yml          # local Postgres for development
.env.example                # DATABASE_URL and friends
```

The `/api/hello` demo routes and [src/APITester.tsx](../src/APITester.tsx) are template leftovers. They can be removed when the real routes land.

## 5. Data model

Use `Bun.sql` (tagged templates, so queries are parameterised and safe from SQL injection). Bun reads `DATABASE_URL` / `POSTGRES_URL` from `.env` automatically, so no `dotenv` is needed.

```sql
-- migrations/001_init.sql
CREATE TABLE players (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  token_hash    bytea NOT NULL UNIQUE,   -- sha256 of the cookie token; raw token is never stored
  created_at    timestamptz NOT NULL DEFAULT now(),
  last_seen_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE scores (
  id          bigserial PRIMARY KEY,
  player_id   uuid NOT NULL REFERENCES players(id) ON DELETE CASCADE,
  points      integer NOT NULL CHECK (points >= 0 AND points <= 10000),
  duration_ms integer,                    -- filled in once runs are tracked (phase 4)
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX scores_player_recent ON scores (player_id, created_at DESC);
CREATE INDEX scores_points        ON scores (points DESC);
```

Notes:

- `token_hash` means a database leak does not hand out working identities.
- The high score is derived with `max(points)`. It is not stored separately, so it cannot drift out of sync.
- Phase 3 adds a nullable `recovery_hash bytea UNIQUE` column to `players`.
- Migrations are plain `.sql` files applied in order by `migrate.ts`, which records applied names in a `schema_migrations` table. A new tool is not needed at this scale.

## 6. Score integrity

Any score the browser sends can be forged, because the game runs entirely on the client. Treat this as best-effort protection for a casual game, not a security boundary.

Cheap measures, in order of value:

1. **Validate input.** Require an integer in a sane range. The `CHECK` constraint is the backstop.
2. **Rate limit** per player, for example one score every few seconds, with a small in-memory limiter.
3. **Server-timed runs (phase 4).** The client calls `POST /api/runs` when a game starts and gets a run id. When it submits the score, the server checks the run exists and is unused, and rejects scores that are impossible for the elapsed time. Pipes spawn every 90 frames at a 16 ms tick (about 1.44 s per pipe), so `points` can never exceed roughly `elapsed / 1.44 s`. This stops trivial `curl` forgery but not a modified client that waits long enough.

Anything stronger (replaying inputs on the server) would need the game logic moved server-side. That is out of scope.

## 7. API

All routes are same-origin JSON. The server finds the player from the `fp_session` cookie.

| Method and path | Purpose | Notes |
| --- | --- | --- |
| `GET /api/me` | Return `{ highScore, recent: number[] }` for the current player. | Creates the player and sets the cookie if there is none. |
| `POST /api/scores` | Body `{ points }`. Saves a score and returns the updated `{ highScore }`. | Validated and rate limited. In phase 4 the body also carries `runId`. |
| `POST /api/runs` | Phase 4. Returns `{ runId }`. | Starts the server-side timer. |
| `POST /api/recovery` | Phase 3. Creates a recovery code (shown once) for the current player. | Only the hash is stored. |
| `POST /api/recovery/redeem` | Phase 3. Body `{ code }`. Re-binds this browser to that player. | Rate limited to resist guessing. |

Cookie settings (via `req.cookies` in Bun routes, see [Bun cookies docs](https://bun.com/docs/runtime/http/cookies)):

- `HttpOnly`, `SameSite=Lax`, `Path=/`, `Secure` in production.
- Long `maxAge` (about 1 year), refreshed on use.
- Token: 32 random bytes from `crypto.getRandomValues`, base64url encoded.

## 8. Deployment

This is the biggest practical decision. [netlify.toml](../netlify.toml) publishes `dist/` as a static site, and **Netlify static hosting cannot run `Bun.serve` or hold a Postgres connection**. Once there is a backend, the app needs a host that runs a long-lived Bun process. Options:

| Option | Fit | Cost of change |
| --- | --- | --- |
| **A. Host the Bun server on Fly.io / Railway / Render**, with managed Postgres (or Neon / Supabase). Serves frontend and API from one origin. | Best fit with "leverage Bun". Cookies stay simple. | Replace Netlify deploy. Add a `Dockerfile` or platform config. |
| B. Keep the frontend on Netlify, host only the API elsewhere. | Possible. | Needs CORS with credentials and `SameSite=None; Secure` cookies, which is more fragile, and third-party cookie blocking can break identity. |
| C. Rewrite the API as Netlify Functions. | Works on Netlify. | Abandons the Bun server design. Not recommended. |

**Recommendation: option A.** The app is already `bun src/index.ts` in production (`bun start`). Required config is `DATABASE_URL` and `NODE_ENV=production`. Migrations run on deploy via a `bun run migrate` script.

## 9. Open questions

These need a decision from the team before or during the build:

1. **Hosting**: is moving off Netlify acceptable (option A above)? This blocks deployment but not local development.
2. **Recovery code**: do we want phase 3 now, or accept that clearing cookies loses scores?
3. **Leaderboard**: should the global top N be shown? That needs display names or an anonymous handle and some moderation thinking. It is not planned here.
4. **Retention**: should old anonymous players with no recent activity be deleted after some period (for example 12 months)? This is a privacy-friendly default if we say yes.
5. **Privacy notice**: a cookie is set for a functional purpose. Does the university require a notice or consent banner?

## 10. Implementation phases

Each phase is independently shippable and testable.

### Phase 1: Database foundation

- Add `docker-compose.yml` with Postgres and `.env.example` (`DATABASE_URL=postgres://...`). Make sure `.env*` is in `.gitignore`.
- Add `src/server/db.ts` and `src/server/migrate.ts`, with `bun run migrate` in `package.json`.
- Add `migrations/001_init.sql`.
- Tests: migration applies cleanly and is idempotent.

### Phase 2: Anonymous identity and scores API

- `src/server/player.ts`: read the cookie, hash it, find or create the player, set the cookie.
- `GET /api/me` and `POST /api/scores`, with validation and rate limiting.
- Mount routes in `src/index.ts` ahead of the `"/*"` catch-all.
- Tests (`bun test`, against a separate test database): new visitor gets a cookie; same cookie returns the same player; invalid scores rejected; high score computed correctly; one player cannot read another's scores.

### Phase 2b: Game integration

Edit [src/game.js](../src/game.js), keeping its existing style:

- On load, `fetch("/api/me")` and use the result for `highScore`.
- In `saveScore()`, keep writing to `localStorage` as an offline fallback and also `POST /api/scores`. A failed request must never break the game, so catch errors silently as the current code does.
- Decide on conflict handling: the server value wins; if `localStorage` holds a higher legacy score on first connect, upload it once so existing players do not lose history.

### Phase 3: Recovery code (if approved)

- Migration adding `recovery_hash`.
- Endpoints to create and redeem a code, plus a small UI in the game page to show it once and enter it.
- Redeeming should rotate the player's cookie token.

### Phase 4: Run tracking and plausibility checks

- Migration for a `runs` table (`id`, `player_id`, `started_at`, `used`).
- `POST /api/runs`, called from `startGame()` in `game.js`.
- Score submission checks the run and rejects impossible `points` for the elapsed time.

### Phase 5: Hardening and deploy

- Production hosting per [section 8](#8-deployment), secrets in the host's environment (never committed).
- Request body size limit, structured error responses, basic logging.
- Retention job if approved in open question 4.
- Update [README.md](../README.md) with setup instructions (`docker compose up -d`, `bun run migrate`, `bun dev`).

## 11. Risks

| Risk | Mitigation |
| --- | --- |
| Players expect scores to survive clearing cookies | Clear UI messaging; recovery code (phase 3). |
| Forged scores | Validation, rate limits, run timing; accept that this is best-effort. |
| Netlify config no longer matches reality | Resolve open question 1 before the first deploy. |
| Cookie not sent (private mode, blocked cookies) | Game keeps working with the `localStorage` fallback; server saves are skipped silently. |
| Test runs polluting the dev database | Use a separate `DATABASE_URL` for tests and truncate between tests. |
