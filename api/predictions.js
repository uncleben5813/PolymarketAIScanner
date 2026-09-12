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
          ai_yes,
          market_yes,
          signal,
          edge_pct,
          confidence,
          ai_score,
          status,
          correct,
          created_at,
          resolved_at
        FROM predictions
        WHERE client_id = ${clientId}
        ORDER BY created_at DESC
        LIMIT 200
      `;

      return res.status(200).json({
        ok: true,
        predictions: rows
      });
    }

    if (req.method === "POST") {
      const body = req.body || {};

      const clientId = String(body.clientId || "");
      const marketId = String(body.marketId || "");
      const question = String(body.question || "");

      if (!clientId || !marketId || !question) {
        return res.status(400).json({
          ok: false,
          error: "clientId, marketId and question required"
        });
      }

      const rows = await sql`
        INSERT INTO predictions (
          client_id,
          market_id,
          question,
          ai_yes,
          market_yes,
          signal,
          edge_pct,
          confidence,
          ai_score,
          status
        )
        VALUES (
          ${clientId},
          ${marketId},
          ${question},
          ${Number(body.aiYes || 0)},
          ${Number(body.marketYes || 0)},
          ${String(body.signal || "NEUTRAL")},
          ${Number(body.edgePct || 0)},
          ${Number(body.confidence || 0)},
          ${Number(body.aiScore || 0)},
          'OPEN'
        )
        RETURNING *
      `;

      return res.status(200).json({
        ok: true,
        prediction: rows[0]
      });
    }

    return res.status(405).json({
      ok: false,
      error: "Method not allowed"
    });

  } catch (error) {
    console.error("predictions error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Internal server error"
    });
  }
}
