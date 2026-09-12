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
  const n = num(v, 0);
  if (n > 1) return clamp(n / 100, 0, 1);
  return clamp(n, 0, 1);
}

function percent(v) {
  return Number((num(v) * 100).toFixed(2));
}

function moneyNumber(v) {
  return Math.max(0, num(v, 0));
}

async function fetchJson(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, {
      ...options,
      signal: controller.signal,
      headers: {
        Accept: "application/json",
        ...(options.headers || {})
      }
    });

    const text = await response.text();

    if (!response.ok) {
      throw new Error(
        `HTTP ${response.status} from ${url}: ${text.slice(0, 300)}`
      );
    }

    try {
      return JSON.parse(text);
    } catch {
      throw new Error(`Invalid JSON from ${url}`);
    }
  } finally {
    clearTimeout(timeout);
  }
}

function getOutcomeProbability(market) {
  const prices = arr(market.outcomePrices);

  if (prices.length > 0) {
    return probability(prices[0]);
  }

  if (market.marketYes !== undefined) {
    return probability(market.marketYes);
  }

  if (market.yes && typeof market.yes === "object") {
    if (market.yes.probability !== undefined) {
      return probability(market.yes.probability);
    }

    if (market.yes.price !== undefined) {
      return probability(market.yes.price);
    }
  }

  if (market.yesPrice !== undefined) {
    return probability(market.yesPrice);
  }

  return 0.5;
}

function getVolume24h(market) {
  return moneyNumber(
    market.volume24hr ??
    market.volume24h ??
    market.volume24Hour ??
    market.oneDayVolume ??
    0
  );
}

function getVolume(market) {
  return moneyNumber(market.volume ?? market.totalVolume ?? 0);
}

function getLiquidity(market) {
  return moneyNumber(
    market.liquidity ??
    market.liquidityNum ??
    0
  );
}

function getCategory(market) {
  if (market.category) return market.category;

  if (Array.isArray(market.tags) && market.tags.length) {
    return market.tags[0];
  }

  if (typeof market.tags === "string") {
    const tags = arr(market.tags);
    if (tags.length) return tags[0];
  }

  return "General";
}

function calculateAI(market) {
  const marketYes = getOutcomeProbability(market);
  const volume = getVolume(market);
  const volume24h = getVolume24h(market);
  const liquidity = getLiquidity(market);

  let adjustment = 0;

  const liquidityScore = clamp(
    Math.log10(liquidity + 1) / 7,
    0,
    1
  );

  const volumeScore = clamp(
    Math.log10(volume24h + 1) / 7,
    0,
    1
  );

  const marketQuality = clamp(
    liquidityScore * 0.55 + volumeScore * 0.45,
    0,
    1
  );

  if (marketYes > 0.5) {
    adjustment += 0.02 * marketQuality;
  } else if (marketYes < 0.5) {
    adjustment -= 0.02 * marketQuality;
  }

  const momentum =
    volume > 0
      ? clamp(volume24h / Math.max(volume, 1), 0, 1)
      : 0;

  if (momentum > 0.25) {
    adjustment += marketYes >= 0.5 ? 0.01 : -0.01;
  }

  const aiYes = clamp(marketYes + adjustment, 0.001, 0.999);
  const aiNo = 1 - aiYes;

  const edge = aiYes - marketYes;
  const edgePct = edge * 100;

  const confidence = clamp(
    45 +
      marketQuality * 35 +
      Math.abs(edgePct) * 2,
    0,
    98
  );

  let signal = "NEUTRAL";

  if (edgePct >= 2) {
    signal = "YES";
  } else if (edgePct <= -2) {
    signal = "NO";
  }

  let opportunityScore =
    Math.abs(edgePct) * 10 +
    confidence * 0.35 +
    marketQuality * 20;

  opportunityScore = clamp(opportunityScore, 0, 100);

  let risk = "HIGH";

  if (marketQuality >= 0.7 && confidence >= 75) {
    risk = "LOW";
  } else if (marketQuality >= 0.4 && confidence >= 60) {
    risk = "MEDIUM";
  }

  let recommendation = "WATCH";

  if (signal === "YES" && opportunityScore >= 60) {
    recommendation = "BUY YES";
  } else if (signal === "NO" && opportunityScore >= 60) {
    recommendation = "BUY NO";
  }

  const reasoning = [];

  if (Math.abs(edgePct) >= 5) {
    reasoning.push("Large AI vs market probability gap");
  } else if (Math.abs(edgePct) >= 2) {
    reasoning.push("Moderate AI vs market probability gap");
  } else {
    reasoning.push("AI and market probability are close");
  }

  if (liquidityScore >= 0.7) {
    reasoning.push("Strong liquidity");
  } else if (liquidityScore >= 0.4) {
    reasoning.push("Moderate liquidity");
  } else {
    reasoning.push("Low liquidity");
  }

  if (momentum >= 0.25) {
    reasoning.push("Active recent trading");
  }

  return {
    marketYes,
    marketNo: 1 - marketYes,
    aiYes,
    aiNo,
    edge,
    edgePct,
    confidence,
    signal,
    opportunityScore,
    risk,
    recommendation,
    marketQuality,
    momentum,
    reasoning: reasoning.join(". ") + ".",
    factors: {
      liquidityScore,
      volumeScore,
      marketQuality,
      momentum
    }
  };
}

function normalizeMarket(market) {
  const ai = calculateAI(market);

  return {
    id: String(market.id ?? market.conditionId ?? ""),
    question:
      market.question ??
      market.title ??
      "Untitled market",

    category: getCategory(market),

    active: Boolean(market.active),
    closed: Boolean(market.closed),
    acceptingOrders: Boolean(
      market.acceptingOrders ?? market.enableOrderBook ?? true
    ),

    marketYes: Number(ai.marketYes.toFixed(6)),
    marketNo: Number(ai.marketNo.toFixed(6)),

    aiYes: Number(ai.aiYes.toFixed(6)),
    aiNo: Number(ai.aiNo.toFixed(6)),

    edge: Number(ai.edge.toFixed(6)),
    edgePct: Number(ai.edgePct.toFixed(2)),

    confidence: Number(ai.confidence.toFixed(2)),
    signal: ai.signal,

    opportunityScore: Number(ai.opportunityScore.toFixed(2)),
    aiScore: Number(ai.opportunityScore.toFixed(2)),

    risk: ai.risk,
    recommendation: ai.recommendation,

    marketQuality: Number(ai.marketQuality.toFixed(4)),
    momentum: Number(ai.momentum.toFixed(4)),

    volume: getVolume(market),
    volume24h: getVolume24h(market),
    liquidity: getLiquidity(market),

    reasoning: ai.reasoning,
    factors: ai.factors,

    endDate:
      market.endDate ??
      market.endDateIso ??
      null,

    startDate:
      market.startDate ??
      market.startDateIso ??
      null,

    conditionId: market.conditionId ?? null,

    slug: market.slug ?? null,

    clobTokenIds: arr(market.clobTokenIds),

    raw: {
      outcomes: arr(market.outcomes),
      outcomePrices: arr(market.outcomePrices)
    }
  };
}

async function getMarkets(limit) {
  const safeLimit = clamp(num(limit, 60), 1, 60);

  const url =
    `${GAMMA}/markets` +
    `?active=true` +
    `&closed=false` +
    `&archived=false` +
    `&limit=${safeLimit}` +
    `&order=volume24hr` +
    `&ascending=false`;

  const data = await fetchJson(url);

  if (Array.isArray(data)) {
    return data;
  }

  if (Array.isArray(data.data)) {
    return data.data;
  }

  if (Array.isArray(data.markets)) {
    return data.markets;
  }

  return [];
}

async function getBook(tokenId) {
  if (!tokenId) return null;

  try {
    return await fetchJson(
      `${CLOB}/book?token_id=${encodeURIComponent(tokenId)}`
    );
  } catch {
    return null;
  }
}

async function getHistory(tokenId) {
  if (!tokenId) return null;

  try {
    return await fetchJson(
      `${CLOB}/prices-history?market=${encodeURIComponent(tokenId)}&interval=1d`
    );
  } catch {
    return null;
  }
}

async function enrichMarket(market, includeDetails) {
  if (!includeDetails) {
    return market;
  }

  const tokenIds = market.clobTokenIds || [];
  const tokenId = tokenIds[0];

  if (!tokenId) {
    return market;
  }

  const [book, history] = await Promise.all([
    getBook(tokenId),
    getHistory(tokenId)
  ]);

  let bestBid = null;
  let bestAsk = null;
  let spread = null;

  if (book) {
    const bids = Array.isArray(book.bids) ? book.bids : [];
    const asks = Array.isArray(book.asks) ? book.asks : [];

    if (bids.length) {
      bestBid = Math.max(
        ...bids.map((x) => num(x.price, 0))
      );
    }

    if (asks.length) {
      bestAsk = Math.min(
        ...asks.map((x) => num(x.price, 0))
      );
    }

    if (
      bestBid !== null &&
      bestAsk !== null &&
      bestAsk >= bestBid
    ) {
      spread = bestAsk - bestBid;
    }
  }

  return {
    ...market,

    orderBook: {
      bestBid,
      bestAsk,
      spread
    },

    historyAvailable: Boolean(history)
  };
}

function buildStats(markets) {
  const active = markets.filter((m) => m.active && !m.closed);

  const volume = markets.reduce(
    (sum, m) => sum + moneyNumber(m.volume),
    0
  );

  const liquidity = markets.reduce(
    (sum, m) => sum + moneyNumber(m.liquidity),
    0
  );

  const avgYes =
    markets.length > 0
      ? markets.reduce((sum, m) => sum + m.marketYes, 0) /
        markets.length
      : 0;

  const opportunities = markets.filter(
    (m) =>
      m.opportunityScore >= 60 &&
      m.signal !== "NEUTRAL"
  );

  return {
    markets: markets.length,
    active: active.length,
    volume,
    liquidity,
    avgYes: Number(avgYes.toFixed(4)),
    avgYesPct: Number((avgYes * 100).toFixed(2)),
    opportunities: opportunities.length
  };
}

function compactMarket(market) {
  const copy = { ...market };
  delete copy.raw;
  return copy;
}

export default async function handler(req, res) {
  try {
    res.setHeader(
      "Cache-Control",
      "s-maxage=20, stale-while-revalidate=60"
    );

    const limit = req.query?.limit ?? 60;

    const details =
      String(req.query?.details ?? "false").toLowerCase() ===
      "true";

    const rawMarkets = await getMarkets(limit);

    if (!rawMarkets.length) {
      return res.status(200).json({
        ok: true,
        source: "Polymarket Gamma API",
        timestamp: Date.now(),
        count: 0,
        stats: {
          markets: 0,
          active: 0,
          volume: 0,
          liquidity: 0,
          avgYes: 0,
          avgYesPct: 0,
          opportunities: 0
        },
        topMarkets: [],
        markets: []
      });
    }

    let markets = rawMarkets.map(normalizeMarket);

    if (details) {
      const maxDetails = Math.min(markets.length, 20);

      const enriched = await Promise.all(
        markets.map((market, index) => {
          if (index < maxDetails) {
            return enrichMarket(market, true);
          }

          return market;
        })
      );

      markets = enriched;
    }

    markets.sort(
      (a, b) =>
        b.opportunityScore - a.opportunityScore
    );

    const stats = buildStats(markets);

    const topMarkets = markets
      .slice(0, 10)
      .map(compactMarket);

    return res.status(200).json({
      ok: true,
      source: "Polymarket Gamma API + AI",
      timestamp: Date.now(),
      count: markets.length,
      stats,
      topMarkets,
      markets: markets.map(compactMarket)
    });
  } catch (error) {
    console.error("MARKETS API ERROR:", error);

    return res.status(500).json({
      ok: false,
      error: "Polymarket API error",
      message:
        error?.message ||
        "Unknown server error",
      name:
        error?.name ||
        "Error",
      timestamp: Date.now()
    });
  }
}
