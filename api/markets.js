const GAMMA = "https://gamma-api.polymarket.com";
const CLOB = "https://clob.polymarket.com";

function arr(v) {
  if (Array.isArray(v)) return v;
  try {
    return JSON.parse(v || "[]");
  } catch {
    return [];
  }
}

function num(v, fallback = 0) {
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

function clamp(x, a, b) {
  return Math.max(a, Math.min(b, x));
}

function probability(v) {
  const n = num(v, 0);
  return n > 1 ? clamp(n / 100, 0, 1) : clamp(n, 0, 1);
}

function pct(v) {
  return Math.round(probability(v) * 10000) / 100;
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(
    () => controller.abort(),
    options.timeout || 9000
  );

  try {
    const res = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        accept: "application/json",
        ...(options.headers || {})
      }
    });

    const text = await res.text();

    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = text;
    }

    if (!res.ok) {
      throw new Error(
        `${res.status} ${res.statusText}: ${
          typeof data === "string" ? data.slice(0, 200) : JSON.stringify(data)
        }`
      );
    }

    return data;
  } finally {
    clearTimeout(timeout);
  }
}

function normalizeNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function getOutcomeProbability(outcomes, prices, target) {
  const index = outcomes.findIndex(
    x => String(x).toLowerCase() === target.toLowerCase()
  );

  if (index >= 0 && prices[index] !== undefined) {
    return probability(prices[index]);
  }

  return 0;
}

function calculateAI(market) {
  const marketYes = probability(market.yes?.probability);
  const marketNo = probability(market.no?.probability);

  const volume = normalizeNumber(market.volume);
  const volume24h = normalizeNumber(market.volume24h);
  const liquidity = normalizeNumber(market.liquidity);

  /*
   * AI/model layer.
   *
   * This is a heuristic scoring engine, NOT a trained ML model.
   * It combines:
   * - market probability
   * - liquidity
   * - total volume
   * - recent volume
   * - market quality
   */

  const liquidityScore = clamp(
    Math.log10(Math.max(liquidity, 1)) / 6,
    0,
    1
  );

  const volumeScore = clamp(
    Math.log10(Math.max(volume, 1)) / 7,
    0,
    1
  );

  const recentScore = clamp(
    Math.log10(Math.max(volume24h, 1)) / 6,
    0,
    1
  );

  const quality =
    liquidityScore * 0.45 +
    volumeScore * 0.30 +
    recentScore * 0.25;

  /*
   * Small model adjustment.
   * The purpose is to avoid simply copying the market price.
   */

  let adjustment = 0;

  if (quality > 0.75) adjustment += 0.015;
  else if (quality > 0.50) adjustment += 0.008;
  else if (quality < 0.20) adjustment -= 0.008;

  /*
   * Extreme probabilities get slightly reduced confidence
   * because they have less room for model edge.
   */

  if (marketYes > 0.95) adjustment -= 0.01;
  if (marketYes < 0.05) adjustment += 0.01;

  const aiYes = clamp(marketYes + adjustment, 0.01, 0.99);
  const aiNo = clamp(1 - aiYes, 0.01, 0.99);

  const edge = aiYes - marketYes;
  const edgePct = edge * 100;

  const confidence = clamp(
    0.50 +
      Math.abs(edge) * 1.8 +
      quality * 0.28,
    0,
    0.98
  );

  let side = "NEUTRAL";
  let strength = "LOW";

  if (edgePct >= 5) {
    side = "YES";
    strength = "STRONG";
  } else if (edgePct >= 2) {
    side = "YES";
    strength = "MODERATE";
  } else if (edgePct <= -5) {
    side = "NO";
    strength = "STRONG";
  } else if (edgePct <= -2) {
    side = "NO";
    strength = "MODERATE";
  }

  const score = clamp(
    Math.abs(edgePct) * 8 +
      confidence * 35 +
      quality * 25,
    0,
    100
  );

  return {
    aiYes: pct(aiYes),
    aiNo: pct(aiNo),

    modelYes: aiYes,
    modelNo: aiNo,

    confidence: Math.round(confidence * 100),
    edge: Math.round(edgePct * 100) / 100,
    edgePct: Math.round(edgePct * 100) / 100,

    modelQuality: Math.round(quality * 100),

    signal: {
      side,
      strength,
      score: Math.round(score)
    }
  };
}

function normalizeMarket(market) {
  const outcomes = arr(market.outcomes);
  const prices = arr(market.outcomePrices);

  const yesProbability = getOutcomeProbability(
    outcomes,
    prices,
    "Yes"
  );

  const noProbability = getOutcomeProbability(
    outcomes,
    prices,
    "No"
  );

  const normalized = {
    id: String(market.id || market.conditionId || ""),
    question: market.question || "Unknown market",
    slug: market.slug || "",
    conditionId: market.conditionId || "",

    category:
      market.category ||
      market.groupItemTitle ||
      market.eventTitle ||
      "Other",

    description: market.description || "",

    image: market.image || "",
    icon: market.icon || "",

    active: Boolean(market.active),
    closed: Boolean(market.closed),
    archived: Boolean(market.archived),

    restricted: Boolean(market.restricted),
    featured: Boolean(market.featured),
    new: Boolean(market.new),

    startDate: market.startDate || null,
    endDate: market.endDate || null,
    closedTime: market.closedTime || null,

    outcomes,
    outcomePrices: prices,

    yes: {
      price: yesProbability,
      probability: yesProbability,
      percentage: pct(yesProbability),
      tokenId: ""
    },

    no: {
      price: noProbability,
      probability: noProbability,
      percentage: pct(noProbability),
      tokenId: ""
    },

    volume: normalizeNumber(market.volume),
    volume24h: normalizeNumber(
      market.volume24h ||
      market.volume24Hour ||
      market.oneDayVolume
    ),

    liquidity: normalizeNumber(market.liquidity),

    enableOrderBook: Boolean(market.enableOrderBook),

    orderPriceMinTickSize:
      market.orderPriceMinTickSize || null,

    minimumOrderSize:
      market.minimumOrderSize || null,

    negRisk: Boolean(market.negRisk),
    negRiskMarketID: market.negRiskMarketID || null
  };

  const ai = calculateAI(normalized);

  return {
    ...normalized,
    ...ai
  };
}

async function getMarkets(limit = 100) {
  const url =
    `${GAMMA}/markets` +
    `?active=true` +
    `&closed=false` +
    `&archived=false` +
    `&limit=${limit}` +
    `&order=volume24hr` +
    `&ascending=false`;

  const data = await fetchJson(url);

  if (Array.isArray(data)) return data;

  if (Array.isArray(data?.data)) return data.data;

  return [];
}

async function getBook(tokenId) {
  if (!tokenId) return null;

  try {
    return await fetchJson(
      `${CLOB}/book?token_id=${encodeURIComponent(tokenId)}`,
      { timeout: 6000 }
    );
  } catch {
    return null;
  }
}

async function getHistory(tokenId) {
  if (!tokenId) return null;

  try {
    return await fetchJson(
      `${CLOB}/prices-history?market=${encodeURIComponent(tokenId)}`,
      { timeout: 6000 }
    );
  } catch {
    return null;
  }
}

async function enrichMarket(market, params) {
  const result = { ...market };

  const outcomes = market.outcomes || [];
  const prices = market.outcomePrices || [];

  const yesIndex = outcomes.findIndex(
    x => String(x).toLowerCase() === "yes"
  );

  const noIndex = outcomes.findIndex(
    x => String(x).toLowerCase() === "no"
  );

  if (yesIndex >= 0) {
    result.yes.tokenId =
      market.clobTokenIds
        ? arr(market.clobTokenIds)[yesIndex] || ""
        : "";
  }

  if (noIndex >= 0) {
    result.no.tokenId =
      market.clobTokenIds
        ? arr(market.clobTokenIds)[noIndex] || ""
        : "";
  }

  if (params.book === "true") {
    result.orderBook = await getBook(result.yes.tokenId);
  }

  if (params.history === "true") {
    result.priceHistory = await getHistory(result.yes.tokenId);
  }

  return result;
}

function buildStats(markets) {
  const total = markets.length;

  const active = markets.filter(m => m.active).length;
  const closed = markets.filter(m => m.closed).length;

  const totalVolume = markets.reduce(
    (sum, m) => sum + normalizeNumber(m.volume),
    0
  );

  const totalLiquidity = markets.reduce(
    (sum, m) => sum + normalizeNumber(m.liquidity),
    0
  );

  const avgYesProbability =
    total > 0
      ? markets.reduce(
          (sum, m) => sum + probability(m.yes?.probability),
          0
        ) / total
      : 0;

  const strongSignals = markets.filter(
    m => m.signal?.strength === "STRONG"
  ).length;

  const yesSignals = markets.filter(
    m => m.signal?.side === "YES"
  ).length;

  const noSignals = markets.filter(
    m => m.signal?.side === "NO"
  ).length;

  const opportunities = markets.filter(
    m => Math.abs(normalizeNumber(m.edge)) >= 2
  ).length;

  return {
    total,
    active,
    closed,

    totalVolume,
    totalLiquidity,

    avgYesProbability: pct(avgYesProbability),

    strongSignals,
    yesSignals,
    noSignals,

    opportunities
  };
}

export default async function handler(req, res) {
  try {
    res.setHeader(
      "Cache-Control",
      "s-maxage=30, stale-while-revalidate=60"
    );

    const params = req.query || {};

    const requestedLimit = num(params.limit, 100);

    const limit = Math.min(
      Math.max(requestedLimit, 1),
      100
    );

    let rawMarkets = await getMarkets(limit);

    let markets = rawMarkets
      .map(normalizeMarket)
      .filter(m => m.question);

    /*
     * Highest AI edge first.
     */
    markets.sort(
      (a, b) =>
        Math.abs(num(b.edge)) -
        Math.abs(num(a.edge))
    );

    if (params.book === "true" || params.history === "true") {
      const enriched = [];

      for (const market of markets) {
        enriched.push(
          await enrichMarket(market, params)
        );
      }

      markets = enriched;
    }

    const stats = buildStats(markets);

    const responseMarkets =
      params.details === "false"
        ? markets.map(m => ({
            id: m.id,
            question: m.question,
            category: m.category,

            yes: m.yes,
            no: m.no,

            aiYes: m.aiYes,
            aiNo: m.aiNo,

            confidence: m.confidence,
            edge: m.edge,
            edgePct: m.edgePct,

            modelQuality: m.modelQuality,
            signal: m.signal,

            volume: m.volume,
            volume24h: m.volume24h,
            liquidity: m.liquidity
          }))
        : markets;

    return res.status(200).json({
      ok: true,

      source: {
        gamma: GAMMA,
        clob: CLOB
      },

      timestamp: Date.now(),

      count: responseMarkets.length,

      stats,

      topMarkets: responseMarkets
        .slice(0, 10)
        .map(m => ({
          id: m.id,
          question: m.question,
          category: m.category,

          marketYes: m.yes?.probability ?? 0,
          marketNo: m.no?.probability ?? 0,

          aiYes: m.aiYes,
          aiNo: m.aiNo,

          confidence: m.confidence,

          edge: m.edge,
          edgePct: m.edgePct,

          signal: m.signal,

          volume: m.volume,
          liquidity: m.liquidity
        })),

      markets: responseMarkets
    });
  } catch (error) {
    console.error("Polymarket API error:", error);

    return res.status(500).json({
      ok: false,
      error: "Polymarket API error",
      message: error?.message || "Unknown error",
      timestamp: Date.now()
    });
  }
}
