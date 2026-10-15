import { serve } from "bun";

import index from "./index.html";
import { getOrCreatePlayerFromRequest, getPlayerSummary, saveScoreForPlayer, withSessionCookie } from "./server/player";

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
          const body = (await req.json()) as { points?: number };
          const points = Number(body.points);

          if (!Number.isInteger(points) || points < 0 || points > 10000) {
            return Response.json(
              { error: "points must be an integer between 0 and 10000" },
              { status: 400 },
            );
          }

          const summary = await saveScoreForPlayer(player.id, points);
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
