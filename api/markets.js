// api/market.js

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

function clamp(x, min, max) {
  return Math.max(min, Math.min(max, x));
}

function probability(v) {
  return clamp(num(v), 0, 1);
}

function pct(v) {
  return Number((probability(v) * 100).toFixed(2));
}

function safeJson(v, fallback = {}) {
  try {
    if (typeof v === "object" && v !== null) return v;
    return JSON.parse(v || JSON.stringify(fallback));
  } catch {
    return fallback;
  }
}

async function fetchJson(url, options = {}) {
  const r = await fetch(url, {
    ...options,
    headers: {
      Accept: "application/json",
      ...(options.headers || {})
    }
  });

  const text = await r.text();

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = text;
  }

  if (!r.ok) {
    throw new Error(
      `${r.status} ${r.statusText}: ${
        typeof data === "string" ? data : JSON.stringify(data)
      }`
    );
  }

  return data;
}

function normalizeMarket(market) {
  const outcomes = arr(market.outcomes);
  const prices = arr(market.outcomePrices);
  const tokens = arr(market.clobTokenIds);

  const yesIndex = outcomes.findIndex(
    x => String(x).toLowerCase() === "yes"
  );

  const noIndex = outcomes.findIndex(
    x => String(x).toLowerCase() === "no"
  );

  const yesPrice =
    yesIndex >= 0
      ? probability(prices[yesIndex])
      : probability(prices[0]);

  const noPrice =
    noIndex >= 0
      ? probability(prices[noIndex])
      : probability(prices[1]);

  const yesToken =
    yesIndex >= 0
      ? tokens[yesIndex]
      : tokens[0];

  const noToken =
    noIndex >= 0
      ? tokens[noIndex]
      : tokens[1];

  const volume = num(market.volume);
  const liquidity = num(market.liquidity);
  const volume24h = num(
    market.volume24hr ??
    market.volume24h ??
    market.volume24Hr
  );

  return {
    id: market.id ?? null,
    question: market.question ?? "",
    slug: market.slug ?? "",

    conditionId:
      market.conditionId ??
      market.condition_id ??
      null,

    category: market.category ?? "",
    description: market.description ?? "",

    image: market.image ?? null,
    icon: market.icon ?? null,

    active: Boolean(market.active),
    closed: Boolean(market.closed),
    archived: Boolean(market.archived),
    restricted: Boolean(market.restricted),

    featured: Boolean(market.featured),
    new: Boolean(market.new),

    startDate: market.startDate ?? null,
    endDate: market.endDate ?? null,
    closedTime: market.closedTime ?? null,

    outcomes,
    outcomePrices: prices,

    yes: {
      price: yesPrice,
      probability: pct(yesPrice),
      tokenId: yesToken ?? null
    },

    no: {
      price: noPrice,
      probability: pct(noPrice),
      tokenId: noToken ?? null
    },

    volume,
    volume24h,
    liquidity,

    enableOrderBook:
      market.enableOrderBook !== false,

    orderPriceMinTickSize:
      num(market.orderPriceMinTickSize, 0.01),

    minimumOrderSize:
      num(market.minimumOrderSize),

    negRisk:
      Boolean(market.negRisk),

    negRiskMarketID:
      market.negRiskMarketID ??
      market.negRiskMarketId ??
      null,

    raw: market
  };
}

async function getOrderBook(tokenId) {
  if (!tokenId) return null;

  try {
    const data = await fetchJson(
      `${CLOB}/book?token_id=${encodeURIComponent(tokenId)}`
    );

    const bids = Array.isArray(data.bids) ? data.bids : [];
    const asks = Array.isArray(data.asks) ? data.asks : [];

    const bestBid =
      bids.length > 0
        ? num(bids[0].price)
        : null;

    const bestAsk =
      asks.length > 0
        ? num(asks[0].price)
        : null;

    const spread =
      bestBid !== null && bestAsk !== null
        ? bestAsk - bestBid
        : null;

    return {
      bestBid,
      bestAsk,
      spread,
      spreadPct:
        spread !== null
          ? Number((spread * 100).toFixed(3))
          : null,

      bids,
      asks,

      timestamp: Date.now()
    };
  } catch {
    return null;
  }
}

async function getPriceHistory(tokenId) {
  if (!tokenId) return null;

  try {
    const data = await fetchJson(
      `${CLOB}/prices-history?market=${encodeURIComponent(
        tokenId
      )}&interval=1d&fidelity=60`
    );

    return data?.history || [];
  } catch {
    return [];
  }
}

function calculateSignal(yes, no) {
  const y = probability(yes);
  const n = probability(no);

  if (y >= 0.80) {
    return {
      side: "YES",
      strength: "VERY_STRONG",
      score: Math.round(y * 100)
    };
  }

  if (y >= 0.65) {
    return {
      side: "YES",
      strength: "STRONG",
      score: Math.round(y * 100)
    };
  }

  if (y <= 0.20) {
    return {
      side: "NO",
      strength: "VERY_STRONG",
      score: Math.round(n * 100)
    };
  }

  if (y <= 0.35) {
    return {
      side: "NO",
      strength: "STRONG",
      score: Math.round(n * 100)
    };
  }

  return {
    side: "NEUTRAL",
    strength: "NEUTRAL",
    score: 50
  };
}

function calculateEdge(yes, aiYes) {
  const market = probability(yes);
  const ai = probability(aiYes);

  const edge = ai - market;

  return {
    marketProbability: pct(market),
    aiProbability: pct(ai),
    edge: Number(edge.toFixed(4)),
    edgePct: Number((edge * 100).toFixed(2))
  };
}

async function getMarkets(params = {}) {
  const limit = Math.min(
    Math.max(num(params.limit, 100), 1),
    100
  );

  const offset = Math.max(
    num(params.offset, 0),
    0
  );

  const url = new URL(`${GAMMA}/markets`);

  url.searchParams.set(
    "active",
    params.active === "false" ? "false" : "true"
  );

  url.searchParams.set(
    "closed",
    params.closed === "true" ? "true" : "false"
  );

  url.searchParams.set("limit", String(limit));
  url.searchParams.set("offset", String(offset));

  if (params.order) {
    url.searchParams.set("order", params.order);
  }

  if (params.ascending !== undefined) {
    url.searchParams.set(
      "ascending",
      String(params.ascending)
    );
  }

  if (params.q) {
    url.searchParams.set("q", params.q);
  }

  if (params.tag_id) {
    url.searchParams.set("tag_id", params.tag_id);
  }

  if (params.tag_slug) {
    url.searchParams.set("tag_slug", params.tag_slug);
  }

  return fetchJson(url.toString());
}

export default async function handler(req, res) {
  try {
    if (req.method !== "GET") {
      return res.status(405).json({
        ok: false,
        error: "Method not allowed"
      });
    }

    const {
      limit = "100",
      offset = "0",
      active = "true",
      closed = "false",
      order = "volume",
      ascending = "false",
      q = "",
      tag_id = "",
      tag_slug = "",
      details = "true",
      history = "false",
      book = "false"
    } = req.query || {};

    const markets = await getMarkets({
      limit,
      offset,
      active,
      closed,
      order,
      ascending,
      q,
      tag_id,
      tag_slug
    });

    const normalized = Array.isArray(markets)
      ? markets.map(normalizeMarket)
      : [];

    let result = normalized;

    /*
     * Optional CLOB orderbook.
     * Use ?book=true
     */
    if (book === "true") {
      result = await Promise.all(
        result.map(async market => {
          const yesBook = await getOrderBook(
            market.yes.tokenId
          );

          const noBook = await getOrderBook(
            market.no.tokenId
          );

          return {
            ...market,
            orderBook: {
              yes: yesBook,
              no: noBook
            }
          };
        })
      );
    }

    /*
     * Optional price history.
     * Use ?history=true
     */
    if (history === "true") {
      result = await Promise.all(
        result.map(async market => {
          const yesHistory =
            await getPriceHistory(
              market.yes.tokenId
            );

          return {
            ...market,
            history: {
              yes: yesHistory
            }
          };
        })
      );
    }

    /*
     * Market ranking.
     */
    result.sort((a, b) => {
      if (order === "liquidity") {
        return b.liquidity - a.liquidity;
      }

      if (
        order === "volume_24hr" ||
        order === "volume24h"
      ) {
        return b.volume24h - a.volume24h;
      }

      return b.volume - a.volume;
    });

    const top = result.slice(0, 10);

    /*
     * Basic dashboard statistics.
     */
    const stats = {
      total: result.length,

      active: result.filter(
        m => m.active && !m.closed
      ).length,

      closed: result.filter(
        m => m.closed
      ).length,

      totalVolume: result.reduce(
        (sum, m) => sum + m.volume,
        0
      ),

      totalLiquidity: result.reduce(
        (sum, m) => sum + m.liquidity,
        0
      ),

      avgYesProbability:
        result.length > 0
          ? Number(
              (
                result.reduce(
                  (sum, m) => sum + m.yes.price,
                  0
                ) /
                result.length *
                100
              ).toFixed(2)
            )
          : 0
    };

    /*
     * Top markets.
     */
    const topMarkets = top.map(m => ({
      id: m.id,
      question: m.question,
      slug: m.slug,

      yes: m.yes,
      no: m.no,

      volume: m.volume,
      volume24h: m.volume24h,
      liquidity: m.liquidity,

      signal: calculateSignal(
        m.yes.price,
        m.no.price
      ),

      endDate: m.endDate,
      active: m.active,
      closed: m.closed
    }));

    return res.status(200).json({
      ok: true,

      source: {
        gamma: GAMMA,
        clob: CLOB
      },

      timestamp: Date.now(),

      count: result.length,

      stats,

      topMarkets,

      markets:
        details === "false"
          ? result.map(m => ({
              id: m.id,
              question: m.question,
              slug: m.slug,
              yes: m.yes,
              no: m.no,
              volume: m.volume,
              volume24h: m.volume24h,
              liquidity: m.liquidity,
              active: m.active,
              closed: m.closed,
              endDate: m.endDate
            }))
          : result
    });

  } catch (error) {
    console.error("MARKET API ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: "Market API failed",
      message: error?.message || "Unknown error",
      timestamp: Date.now()
    });
  }
}
