import { neon } from "@neondatabase/serverless";

const sql = neon(process.env.DATABASE_URL);

const GAMMA = "https://gamma-api.polymarket.com";

async function getMarket(id) {
  const r = await fetch(
    `${GAMMA}/markets/${encodeURIComponent(id)}`
  );

  if (!r.ok) {
    throw new Error(`Gamma HTTP ${r.status}`);
  }

  return r.json();
}

function getWinner(market) {
  if (!market) return null;

  if (market.closed !== true && market.closed !== "true") {
    return null;
  }

  let outcomes = market.outcomes;
  let prices = market.outcomePrices;

  try {
    if (typeof outcomes === "string") {
      outcomes = JSON.parse(outcomes);
    }

    if (typeof prices === "string") {
      prices = JSON.parse(prices);
    }
  } catch {
    return null;
  }

  if (!Array.isArray(outcomes) || !Array.isArray(prices)) {
    return null;
  }

  for (let i = 0; i < outcomes.length; i++) {
    const price = Number(prices[i]);

    if (price >= 0.99) {
      return String(outcomes[i]).toUpperCase();
    }
  }

  return null;
}

export default async function handler(req, res) {
  try {
    if (req.method !== "POST") {
      return res.status(405).json({
        ok: false,
        error: "POST required"
      });
    }

    const body = req.body || {};
    const clientId = String(body.clientId || "");

    if (!clientId) {
      return res.status(400).json({
        ok: false,
        error: "clientId required"
      });
    }

    const open = await sql`
      SELECT *
      FROM predictions
      WHERE client_id = ${clientId}
        AND status = 'OPEN'
      ORDER BY created_at ASC
      LIMIT 100
    `;

    let resolved = 0;

    for (const prediction of open) {
      try {
        const market = await getMarket(prediction.market_id);
        const winner = getWinner(market);

        if (!winner) continue;

        let correct = null;

        if (
          prediction.signal === "YES" &&
          winner === "YES"
        ) {
          correct = true;
        } else if (
          prediction.signal === "NO" &&
          winner === "NO"
        ) {
          correct = true;
        } else if (
          prediction.signal === "YES" ||
          prediction.signal === "NO"
        ) {
          correct = false;
        }

        await sql`
          UPDATE predictions
          SET
            status = 'RESOLVED',
            correct = ${correct},
            resolved_at = NOW()
          WHERE id = ${prediction.id}
        `;

        resolved++;
      } catch (error) {
        console.error(
          "resolve market error:",
          prediction.market_id,
          error.message
        );
      }
    }

    return res.status(200).json({
      ok: true,
      checked: open.length,
      resolved
    });

  } catch (error) {
    console.error("resolve error:", error);

    return res.status(500).json({
      ok: false,
      error: error.message || "Internal server error"
    });
  }
}
