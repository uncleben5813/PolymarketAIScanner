const GAMMA = 'https://gamma-api.polymarket.com';
const CLOB = 'https://clob.polymarket.com';

function arr(v) {
  if (Array.isArray(v)) return v;
  try {
    return JSON.parse(v || '[]');
  } catch {
    return [];
  }
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function yes(m) {
  const outcomes = arr(m.outcomes);
  const prices = arr(m.outcomePrices);

  const i = outcomes.findIndex(
    x => String(x).toLowerCase() === 'yes'
  );

  return i >= 0 ? Number(prices[i]) : NaN;
}

function binary(m) {
  const outcomes = arr(m.outcomes).map(x =>
    String(x).toLowerCase()
  );

  return (
    outcomes.length === 2 &&
    outcomes.includes('yes') &&
    outcomes.includes('no')
  );
}

function token(m) {
  const ids = arr(m.clobTokenIds);
  const outcomes = arr(m.outcomes);

  const i = outcomes.findIndex(
    x => String(x).toLowerCase() === 'yes'
  );

  return ids[i >= 0 ? i : 0] || null;
}

/* -------------------------------------------------------
   DATABASE
------------------------------------------------------- */

async function sqlExec(q, params = []) {
  const { neon } = await import('@neondatabase/serverless');

  if (!process.env.DATABASE_URL) {
    throw new Error('DATABASE_URL missing');
  }

  const sql = neon(process.env.DATABASE_URL);
  return sql(q, params);
}

async function ensure() {
  await sqlExec(`
    CREATE TABLE IF NOT EXISTS predictions (
      id BIGSERIAL PRIMARY KEY,
      market_id TEXT NOT NULL,
      question TEXT,
      predicted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),

      model_p DOUBLE PRECISION NOT NULL,
      market_p DOUBLE PRECISION NOT NULL,

      confidence INT,
      edge DOUBLE PRECISION,

      outcome INT,
      resolved_at TIMESTAMPTZ,

      UNIQUE (market_id, predicted_at)
    )
  `);

  await sqlExec(`
    CREATE INDEX IF NOT EXISTS predictions_market_idx
    ON predictions(market_id)
  `);

  await sqlExec(`
    CREATE INDEX IF NOT EXISTS predictions_outcome_idx
    ON predictions(outcome)
  `);
}

async function loadDB() {
  await ensure();

  const resolved = await sqlExec(`
    SELECT
      market_id,
      question,
      predicted_at,
      model_p,
      market_p,
      confidence,
      edge,
      outcome
    FROM predictions
    WHERE outcome IS NOT NULL
    ORDER BY predicted_at DESC
    LIMIT 3000
  `);

  const tracked = await sqlExec(`
    SELECT COUNT(*)::int AS n
    FROM predictions
  `);

  return {
    resolved,
    tracked: tracked[0]?.n || 0
  };
}

/* -------------------------------------------------------
   HISTORY
------------------------------------------------------- */

async function hist(t) {
  if (!t) return [];

  try {
    const u = new URL(`${CLOB}/prices-history`);

    u.searchParams.set('market', t);
    u.searchParams.set('interval', '1d');
    u.searchParams.set('fidelity', '60');

    const r = await fetch(u);

    if (!r.ok) return [];

    const j = await r.json();

    return Array.isArray(j.history)
      ? j.history
      : [];
  } catch {
    return [];
  }
}

/* -------------------------------------------------------
   MODEL
------------------------------------------------------- */

function baseModel(m, history, cal) {
  let p = clamp(yes(m), 0.001, 0.999);

  const pts = history
    .map(x => Number(x.p))
    .filter(Number.isFinite);

  let momentum = 0;
  let volatility = 0;

  if (pts.length >= 4) {
    const recent = pts.slice(-6);
    const older = pts.slice(-12, -6);

    const recentAvg =
      recent.reduce((a, b) => a + b, 0) /
      recent.length;

    const olderAvg = older.length
      ? older.reduce((a, b) => a + b, 0) /
        older.length
      : pts[0];

    momentum = clamp(
      recentAvg - olderAvg,
      -0.15,
      0.15
    );

    const diffs = [];

    for (let i = 1; i < pts.length; i++) {
      diffs.push(pts[i] - pts[i - 1]);
    }

    volatility = Math.sqrt(
      diffs.reduce((a, b) => a + b * b, 0) /
      Math.max(1, diffs.length)
    );
  }

  const liquidity = Math.max(
    0,
    Number(m.liquidity || 0)
  );

  const depth = clamp(
    Math.log10(liquidity + 1) / 6,
    0,
    1
  );

  const sample = clamp(
    pts.length / 24,
    0,
    1
  );

  const noise = clamp(
    volatility * 4,
    0,
    1
  );

  const uncertainty = clamp(
    0.045 +
      (1 - sample) * 0.045 +
      noise * 0.08 -
      depth * 0.018,
    0.018,
    0.13
  );

  let raw = clamp(
    p + momentum * 0.22,
    0.001,
    0.999
  );

  let edge =
    (raw - p) *
    clamp(0.85 - uncertainty * 2, 0.55, 0.85) *
    (1 - uncertainty * 2.5);

  let candidate = clamp(
    p + edge,
    0.001,
    0.999
  );

  /* Calibration */

  const bucket =
    Math.min(
      90,
      Math.floor(candidate * 100 / 10) * 10
    );

  const adjustment = cal[bucket];

  if (
    adjustment &&
    adjustment.n >= 20
  ) {
    candidate = clamp(
      candidate +
        (adjustment.actual -
          adjustment.predicted) *
        0.35,
      0.001,
      0.999
    );
  }

  edge = candidate - p;

  const confidence = clamp(
    Math.round(
      52 +
      depth * 15 +
      sample * 18 +
      (1 - noise) * 12 -
      uncertainty * 55
    ),
    50,
    90
  );

  return {
    marketYes: p,
    modelYes: candidate,
    edge,
    confidence,
    momentum,
    uncertainty,
    liquidity,
    volume: Number(m.volume || 0),

    dataQuality:
      pts.length >= 12
        ? 'history+liquidity'
        : pts.length >= 4
          ? 'short history'
          : 'market baseline'
  };
}

/* -------------------------------------------------------
   CALIBRATION
------------------------------------------------------- */

function calibration(rows) {
  const buckets = {};

  for (const x of rows) {
    const p =
      x.model_p ??
      x.p;

    const y = x.outcome;

    if (
      p == null ||
      y == null
    ) {
      continue;
    }

    const k =
      Math.min(
        90,
        Math.floor(p * 100 / 10) * 10
      );

    buckets[k] ??= {
      n: 0,
      p: 0,
      y: 0
    };

    buckets[k].n++;
    buckets[k].p += p;
    buckets[k].y += y;
  }

  for (const k of Object.keys(buckets)) {
    buckets[k].predicted =
      buckets[k].p /
      buckets[k].n;

    buckets[k].actual =
      buckets[k].y /
      buckets[k].n;
  }

  return buckets;
}

/* -------------------------------------------------------
   MARKET RESOLUTION
------------------------------------------------------- */

async function getMarket(id) {
  try {
    const r = await fetch(
      `${GAMMA}/markets/${encodeURIComponent(id)}`
    );

    if (!r.ok) return null;

    return await r.json();
  } catch {
    return null;
  }
}

async function getClosed(ids) {
  if (!ids.length) return [];

  const results = [];

  /*
   Check in small batches to avoid
   hammering Gamma API.
  */

  for (const id of ids.slice(0, 100)) {
    const m = await getMarket(id);

    if (!m || !binary(m)) {
      continue;
    }

    const p = yes(m);

    if (
      !m.closed ||
      !Number.isFinite(p)
    ) {
      continue;
    }

    let outcome = null;

    if (p >= 0.99) {
      outcome = 1;
    } else if (p <= 0.01) {
      outcome = 0;
    }

    if (outcome !== null) {
      results.push({
        id: String(id),
        outcome
      });
    }
  }

  return results;
}

/* -------------------------------------------------------
   RESOLVE OLD PREDICTIONS
------------------------------------------------------- */

async function resolveTrackedPredictions() {
  const rows = await sqlExec(`
    SELECT DISTINCT market_id
    FROM predictions
    WHERE outcome IS NULL
    ORDER BY market_id
    LIMIT 100
  `);

  const ids = rows.map(
    x => String(x.market_id)
  );

  if (!ids.length) {
    return 0;
  }

  const closed = await getClosed(ids);

  let resolved = 0;

  for (const c of closed) {
    const result = await sqlExec(`
      UPDATE predictions
      SET
        outcome = $1,
        resolved_at = NOW()
      WHERE
        market_id = $2
        AND outcome IS NULL
    `, [
      c.outcome,
      c.id
    ]);

    resolved += result.length || 0;
  }

  return resolved;
}

/* -------------------------------------------------------
   INSERT PREDICTION
------------------------------------------------------- */

async function savePrediction(x) {
  /*
   IMPORTANT:
   One prediction per market per hour.

   This prevents the database from exploding
   when the API is called every few seconds.
  */

  await sqlExec(`
    INSERT INTO predictions (
      market_id,
      question,
      predicted_at,
      model_p,
      market_p,
      confidence,
      edge
    )
    SELECT
      $1,
      $2,
      date_trunc('hour', NOW()),
      $3,
      $4,
      $5,
      $6
    WHERE NOT EXISTS (
      SELECT 1
      FROM predictions
      WHERE
        market_id = $1
        AND predicted_at =
            date_trunc('hour', NOW())
    )
  `, [
    String(x.id),
    x.question,
    x.modelYes,
    x.marketYes,
    x.confidence,
    x.edge
  ]);
}

/* -------------------------------------------------------
   MAIN HANDLER
------------------------------------------------------- */

async function handler(req, res) {
  try {
    if (!process.env.DATABASE_URL) {
      return res.status(500).json({
        ok: false,
        error:
          'DATABASE_URL is missing in Vercel Environment Variables'
      });
    }

    /*
     * 1. Prepare DB
     */

    await ensure();

    /*
     * 2. Resolve old predictions first
     */

    await resolveTrackedPredictions();

    /*
     * 3. Load calibration data
     */

    let db = await loadDB();

    const cal =
      calibration(db.resolved);

    /*
     * 4. Fetch active markets
     */

    const u =
      new URL(`${GAMMA}/markets`);

    u.searchParams.set(
      'active',
      'true'
    );

    u.searchParams.set(
      'closed',
      'false'
    );

    u.searchParams.set(
      'limit',
      '100'
    );

    u.searchParams.set(
      'order',
      'volume'
    );

    u.searchParams.set(
      'ascending',
      'false'
    );

    const r = await fetch(u);

    if (!r.ok) {
      throw new Error(
        `Gamma HTTP ${r.status}`
      );
    }

    let ms = await r.json();

    if (!Array.isArray(ms)) {
      ms = ms.markets || [];
    }

    ms = ms
      .filter(binary)
      .slice(
        0,
        Math.min(
          300,
          Number(req.query?.limit || 300)
        )
      );

    /*
     * 5. Analyse markets
     */

    const out = [];

    /*
     * Limit expensive history calls.
     */

    for (
      const m of ms.slice(0, 80)
    ) {
      const history =
        await hist(token(m));

      const model =
        baseModel(
          m,
          history,
          cal
        );

      out.push({
        ...model,

        id: m.id,
        question: m.question,
        endDate: m.endDate
      });
    }

    /*
     * 6. Save predictions
     */

    for (const x of out) {
      await savePrediction(x);
    }

    /*
     * 7. Resolve newly tracked markets too
     */

    const currentIds =
      out.map(x => String(x.id));

    const closed =
      await getClosed(currentIds);

    for (const c of closed) {
      await sqlExec(`
        UPDATE predictions
        SET
          outcome = $1,
          resolved_at = NOW()
        WHERE
          market_id = $2
          AND outcome IS NULL
      `, [
        c.outcome,
        c.id
      ]);
    }

    /*
     * 8. Reload DB after updates
     */

    db = await loadDB();

    /*
     * 9. Metrics
     */

    const resolvedRecords =
      db.resolved.map(x => ({
        p:
          x.model_p ??
          x.p,

        m:
          x.market_p ??
          x.m,

        y: x.outcome,

        conf:
          x.confidence ??
          50,

        edge:
          x.edge ??
          0
      }));

    /*
     * 10. Response
     */

    return res.status(200).json({
      ok: true,

      storage: 'database',

      activeMarkets:
        ms.length,

      analysed:
        out.length,

      markets:
        out,

      metrics: {
        tracked:
          db.tracked,

        resolvedRecords
      },

      updatedAt:
        Date.now()
    });

  } catch (e) {
    console.error(
      'Polymarket API error:',
      e
    );

    return res.status(500).json({
      ok: false,
      error:
        e?.message ||
        'Unknown server error'
    });
  }
}

export default handler;
