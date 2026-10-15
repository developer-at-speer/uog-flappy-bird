import { serve } from "bun";

import index from "./index.html";
import {
  createRecoveryCodeForPlayer,
  createRunForPlayer,
  getOrCreatePlayerFromRequest,
  getPlayerSummary,
  redeemRecoveryCode,
  saveScoreForPlayer,
  withSessionCookie,
} from "./server/player";

const server = serve({
  routes: {
    "/api/me": {
      async GET(req) {
        const { player, token } = await getOrCreatePlayerFromRequest(req);
        const summary = await getPlayerSummary(player.id);
        const response = Response.json({
          highScore: summary.highScore,
          recent: summary.recent,
        });
        return withSessionCookie(response, token);
      },
    },

    "/api/scores": {
      async POST(req) {
        const { player, token } = await getOrCreatePlayerFromRequest(req);

        try {
          const body = (await req.json()) as { points?: number; runId?: string };
          const points = Number(body.points);

          if (!Number.isInteger(points) || points < 0 || points > 10000) {
            return Response.json(
              { error: "points must be an integer between 0 and 10000" },
              { status: 400 },
            );
          }

          const summary = await saveScoreForPlayer(player.id, points, body.runId ? { runId: body.runId } : {});
          const response = Response.json({
            highScore: summary.highScore,
          });

          return withSessionCookie(response, token);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to save score";
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },

    "/api/runs": {
      async POST(req) {
        const { player, token } = await getOrCreatePlayerFromRequest(req);

        try {
          const run = await createRunForPlayer(player.id);
          const response = Response.json({ runId: run.id, used: run.used });
          return withSessionCookie(response, token);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to create run";
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },

    "/api/recovery": {
      async POST(req) {
        const { player, token } = await getOrCreatePlayerFromRequest(req);

        try {
          const code = await createRecoveryCodeForPlayer(player.id);
          const response = Response.json({ code });
          return withSessionCookie(response, token);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to create recovery code";
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },

    "/api/recovery/redeem": {
      async POST(req) {
        const { player, token } = await getOrCreatePlayerFromRequest(req);

        try {
          const body = (await req.json()) as { code?: string };
          if (!body.code || !body.code.trim()) {
            return Response.json({ error: "code is required" }, { status: 400 });
          }

          const result = await redeemRecoveryCode(player.id, body.code);
          const response = Response.json({
            playerId: result.playerId,
            highScore: (await getPlayerSummary(result.playerId)).highScore,
          });
          return withSessionCookie(response, result.newToken);
        } catch (error) {
          const message = error instanceof Error ? error.message : "Unable to redeem recovery code";
          return Response.json({ error: message }, { status: 400 });
        }
      },
    },

    // Serve index.html for all unmatched routes.
    "/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    // Enable browser hot reloading in development
    hmr: true,

    // Echo console logs from the browser to the server
    console: true,
  },
});

console.log(`🚀 Server running at ${server.url}`);
