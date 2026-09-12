import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

export default async function handler(req, res) {
  try {
    if (req.method === "GET") {
      const clientId = String(req.query.clientId || "");

      if (!clientId) {
        return res.status(400).json({
          ok: false,
          error: "clientId required"
        });
      }

      const rows = await sql`
        SELECT
          id,
          client_id,
          market_id,
          question,
          created_at
        FROM watchlist
        WHERE client_id = ${clientId}
        ORDER BY created_at DESC
      `;

      return res.status(200).json({
        ok: true,
        watchlist: rows
      });
    }

    const body = req.body || {};
    const clientId = String(body.clientId || "");
    const marketId = String(body.marketId || "");

    if (!clientId || !marketId) {
      return res.status(400).json({
        ok: false,
        error: "clientId and marketId required"
      });
    }

    if (req.method === "POST") {
      const question = String(body.question || "");

      const rows = await sql`
        INSERT INTO watchlist (
          client_id,
          market_id,
          question
        )
        VALUES (
          ${clientId},
          ${marketId},
          ${question}
        )
        ON CONFLICT (client_id, market_id)
        DO UPDATE SET question = EXCLUDED.question
        RETURNING *
      `;

      return res.status(200).json({
        ok: true,
        watchlist: rows[0]
      });
    }

    if (req.method === "DELETE") {
      await sql`
        DELETE FROM watchlist
        WHERE client_id = ${clientId}
          AND market_id = ${marketId}
      `;

      return res.status(200).json({
        ok: true
      });
    }

    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });

  } catch (error) {
    console.error("watchlist error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Internal server error"
    });
  }
}
