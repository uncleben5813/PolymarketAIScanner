const GAMMA = “https://gamma-api.polymarket.com”;
const CLOB = “https://clob.polymarket.com”;

/* =========================
HELPERS
========================= */

function arr(v) {
if (Array.isArray(v)) return v;

if (typeof v === “string”) {
try {
const parsed = JSON.parse(v);
return Array.isArray(parsed) ? parsed : [];
} catch {
return [];
}
}

return [];
}

function num(v, fallback = 0) {
const n = Number(v);
return Number.isFinite(n) ? n : fallback;
}

function clamp(x, min, max) {
return Math.max(min, Math.min(max, x));
}

function probability(v) {
const n = num(v);

if (n > 1) {
return clamp(n / 100, 0, 1);
}

return clamp(n, 0, 1);
}

function percent(v) {
return Math.round(probability(v) * 10000) / 100;
}

function moneyNumber(v) {
return Math.max(0, num(v));
}

/* =========================
SAFE FETCH
========================= */

async function fetchJson(url, timeoutMs = 6000) {
const controller = new AbortController();

const timer = setTimeout(() => {
controller.abort();
}, timeoutMs);

try {
const response = await fetch(url, {
method: “GET”,
signal: controller.signal,
headers: {
Accept: “application/json”
}
});

const text = await response.text();
let data = null;
try {
  data = JSON.parse(text);
} catch {
  data = null;
}
if (!response.ok) {
  throw new Error(
    `HTTP ${response.status} ${response.statusText}`
  );
}
return data;

} finally {
clearTimeout(timer);
}
}

/* =========================
OUTCOME PARSER
========================= */

function getOutcomeProbability(
outcomes,
prices,
name
) {
const index = outcomes.findIndex(
x =>
String(x).toLowerCase() ===
name.toLowerCase()
);

if (index < 0) {
return 0;
}

return probability(prices[index]);
}

/* =========================
SCORE
========================= */

function logScore(value, divisor) {
return clamp(
Math.log10(
Math.max(value, 1)
) / divisor,
0,
1
);
}

/* =========================
AI ENGINE
========================= */

function calculateAI(market) {

const marketYes =
probability(
market.yes?.probability
);

const volume =
moneyNumber(
market.volume
);

const volume24h =
moneyNumber(
market.volume24h
);

const liquidity =
moneyNumber(
market.liquidity
);

/*

* MARKET QUALITY
    */

const liquidityScore =
logScore(
liquidity,
6
);

const volumeScore =
logScore(
volume,
7
);

const recentVolumeScore =
logScore(
volume24h,
6
);

const marketQuality =
clamp(
liquidityScore * 45 +
volumeScore * 30 +
recentVolumeScore * 25,
0,
100
);

/*

* MOMENTUM
    */

let momentum = 50;

if (
volume > 0 &&
volume24h > 0
) {
const ratio =
volume24h / volume;

momentum =
  clamp(
    50 + ratio * 250,
    0,
    100
  );

}

/*

* AI ADJUSTMENT
    */

let adjustment = 0;

if (marketQuality >= 75) {
adjustment += 0.018;

} else if (marketQuality >= 55) {
adjustment += 0.010;

} else if (marketQuality < 25) {
adjustment -= 0.010;
}

/*

* EXTREME PROBABILITY
    */

if (marketYes >= 0.97) {
adjustment -= 0.012;
}

if (marketYes <= 0.03) {
adjustment += 0.012;
}

/*

* RECENT ACTIVITY
    */

if (momentum >= 75) {
adjustment += 0.006;

} else if (momentum <= 25) {
adjustment -= 0.004;
}

const aiYes =
clamp(
marketYes + adjustment,
0.01,
0.99
);

const aiNo =
clamp(
1 - aiYes,
0.01,
0.99
);

/*

* EDGE
    */

const edge =
aiYes - marketYes;

const edgePct =
edge * 100;

/*

* CONFIDENCE
    */

const confidence =
clamp(
48 +
Math.abs(edgePct) * 2.4 +
marketQuality * 0.28 +
Math.abs(momentum - 50) * 0.10,
0,
97
);

/*

* SIGNAL
    */

let side = “NEUTRAL”;
let strength = “LOW”;

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

/*

* OPPORTUNITY SCORE
    */

const opportunityScore =
clamp(
Math.abs(edgePct) * 8 +
confidence * 0.35 +
marketQuality * 0.25,
0,
100
);

/*

* RISK
    */

let risk = “MEDIUM”;

if (
marketQuality >= 75 &&
confidence >= 75 &&
Math.abs(edgePct) >= 5
) {
risk = “LOW”;

} else if (
marketQuality < 35 ||
confidence < 55
) {
risk = “HIGH”;
}

/*

* REASONING
    */

const reasons = [];

if (Math.abs(edgePct) >= 5) {

reasons.push(
  `model sees a ${Math.abs(edgePct).toFixed(1)}% probability gap`
);

} else if (Math.abs(edgePct) >= 2) {

reasons.push(
  `model sees a moderate ${Math.abs(edgePct).toFixed(1)}% probability gap`
);

} else {

reasons.push(
  "model sees limited probability edge"
);

}

if (marketQuality >= 75) {

reasons.push(
  "strong market liquidity and activity"
);

} else if (marketQuality >= 50) {

reasons.push(
  "acceptable market liquidity and activity"
);

} else {

reasons.push(
  "lower market quality increases uncertainty"
);

}

if (momentum >= 70) {

reasons.push(
  "recent trading activity is elevated"
);

} else if (momentum <= 30) {

reasons.push(
  "recent trading activity is relatively quiet"
);

}

if (marketYes >= 0.90) {

reasons.push(
  "YES probability is already heavily priced"
);

} else if (marketYes <= 0.10) {

reasons.push(
  "YES probability is currently very low"
);

}

/*

* RECOMMENDATION
    */

let recommendation =
“NO CLEAR EDGE”;

if (side === “YES”) {

recommendation =
  strength === "STRONG"
    ? "AI FAVORS YES"
    : "LEAN YES";

} else if (side === “NO”) {

recommendation =
  strength === "STRONG"
    ? "AI FAVORS NO"
    : "LEAN NO";

}

return {

aiYes:
  percent(aiYes),
aiNo:
  percent(aiNo),
modelYes:
  aiYes,
modelNo:
  aiNo,
confidence:
  Math.round(confidence),
edge:
  Math.round(
    edgePct * 100
  ) / 100,
edgePct:
  Math.round(
    edgePct * 100
  ) / 100,
modelQuality:
  Math.round(
    marketQuality
  ),
momentum:
  Math.round(
    momentum
  ),
opportunityScore:
  Math.round(
    opportunityScore
  ),
risk,
recommendation,
reasoning:
  reasons.join(". ") + ".",
factors: {
  liquidity:
    Math.round(
      liquidityScore * 100
    ),
  volume:
    Math.round(
      volumeScore * 100
    ),
  recentActivity:
    Math.round(
      recentVolumeScore * 100
    ),
  marketQuality:
    Math.round(
      marketQuality
    ),
  momentum:
    Math.round(
      momentum
    )
},
signal: {
  side,
  strength,
  score:
    Math.round(
      opportunityScore
    )
}

};
}

/* =========================
NORMALIZE MARKET
========================= */

function normalizeMarket(market) {

const outcomes =
arr(market.outcomes);

const prices =
arr(market.outcomePrices);

const yesProbability =
getOutcomeProbability(
outcomes,
prices,
“Yes”
);

let noProbability =
getOutcomeProbability(
outcomes,
prices,
“No”
);

/*

* Some Polymarket markets can have
* unusual outcome structures.
    */

if (
noProbability === 0 &&
yesProbability > 0
) {
noProbability =
clamp(
1 - yesProbability,
0,
1
);
}

const normalized = {

id:
  String(
    market.id ||
    market.conditionId ||
    ""
  ),
question:
  market.question ||
  "Unknown market",
slug:
  market.slug ||
  "",
conditionId:
  market.conditionId ||
  "",
category:
  market.category ||
  market.groupItemTitle ||
  market.eventTitle ||
  "Other",
description:
  market.description ||
  "",
image:
  market.image ||
  "",
icon:
  market.icon ||
  "",
active:
  Boolean(
    market.active
  ),
closed:
  Boolean(
    market.closed
  ),
archived:
  Boolean(
    market.archived
  ),
restricted:
  Boolean(
    market.restricted
  ),
featured:
  Boolean(
    market.featured
  ),
new:
  Boolean(
    market.new
  ),
startDate:
  market.startDate ||
  null,
endDate:
  market.endDate ||
  null,
closedTime:
  market.closedTime ||
  null,
outcomes,
outcomePrices:
  prices,
yes: {
  price:
    yesProbability,
  probability:
    yesProbability,
  percentage:
    percent(
      yesProbability
    ),
  tokenId:
    ""
},
no: {
  price:
    noProbability,
  probability:
    noProbability,
  percentage:
    percent(
      noProbability
    ),
  tokenId:
    ""
},
volume:
  moneyNumber(
    market.volume ??
    market.volumeNum
  ),
volume24h:
  moneyNumber(
    market.volume24hr ??
    market.volume24h ??
    market.volume24Hour ??
    market.oneDayVolume
  ),
liquidity:
  moneyNumber(
    market.liquidity ??
    market.liquidityNum
  ),
enableOrderBook:
  Boolean(
    market.enableOrderBook
  ),
acceptingOrders:
  Boolean(
    market.acceptingOrders
  ),
orderPriceMinTickSize:
  market.orderPriceMinTickSize ||
  null,
minimumOrderSize:
  market.minimumOrderSize ||
  null,
negRisk:
  Boolean(
    market.negRisk
  ),
negRiskMarketID:
  market.negRiskMarketID ||
  null,
clobTokenIds:
  arr(
    market.clobTokenIds
  )

};

const ai =
calculateAI(
normalized
);

return {
…normalized,
…ai
};
}

/* =========================
GET MARKETS
========================= */

async function getMarkets(limit) {

/*

* IMPORTANT:
* Gamma supports volume24hr ordering.
    */

const url =
${GAMMA}/markets +
?active=true +
&closed=false +
&archived=false +
&limit=${limit} +
&order=volume24hr +
&ascending=false;

const data =
await fetchJson(
url,
6000
);

if (Array.isArray(data)) {
return data;
}

if (
Array.isArray(
data?.data
)
) {
return data.data;
}

return [];
}

/* =========================
CLOB BOOK
========================= */

async function getBook(
tokenId
) {

if (!tokenId) {
return null;
}

try {

return await fetchJson(
  `${CLOB}/book?token_id=${encodeURIComponent(tokenId)}`,
  4000
);

} catch {

return null;

}
}

/* =========================
CLOB HISTORY
========================= */

async function getHistory(
tokenId
) {

if (!tokenId) {
return null;
}

try {

return await fetchJson(
  `${CLOB}/prices-history?market=${encodeURIComponent(tokenId)}`,
  4000
);

} catch {

return null;

}
}

/* =========================
ENRICH
========================= */

async function enrichMarket(
market,
params
) {

const result = {
…market
};

const tokens =
market.clobTokenIds ||
[];

if (tokens[0]) {

result.yes = {
  ...result.yes,
  tokenId:
    tokens[0]
};

}

if (tokens[1]) {

result.no = {
  ...result.no,
  tokenId:
    tokens[1]
};

}

/*

* Only call CLOB when explicitly requested.
    */

if (
params.book === “true” &&
result.yes?.tokenId
) {

result.orderBook =
  await getBook(
    result.yes.tokenId
  );

}

if (
params.history === “true” &&
result.yes?.tokenId
) {

result.priceHistory =
  await getHistory(
    result.yes.tokenId
  );

}

return result;
}

/* =========================
STATS
========================= */

function buildStats(
markets
) {

const total =
markets.length;

const active =
markets.filter(
m => m.active
).length;

const closed =
markets.filter(
m => m.closed
).length;

const totalVolume =
markets.reduce(
(sum, m) =>
sum +
moneyNumber(
m.volume
),
0
);

const totalLiquidity =
markets.reduce(
(sum, m) =>
sum +
moneyNumber(
m.liquidity
),
0
);

const avgYesProbability =
total
? markets.reduce(
(sum, m) =>
sum +
probability(
m.yes?.probability
),
0
) / total
: 0;

const strongSignals =
markets.filter(
m =>
m.signal?.strength ===
“STRONG”
).length;

const yesSignals =
markets.filter(
m =>
m.signal?.side ===
“YES”
).length;

const noSignals =
markets.filter(
m =>
m.signal?.side ===
“NO”
).length;

const opportunities =
markets.filter(
m =>
Math.abs(
moneyNumber(
m.edge
)
) >= 2
).length;

const lowRisk =
markets.filter(
m =>
m.risk ===
“LOW”
).length;

return {

total,
active,
closed,
totalVolume,
totalLiquidity,
avgYesProbability:
  percent(
    avgYesProbability
  ),
strongSignals,
yesSignals,
noSignals,
opportunities,
lowRisk

};
}

/* =========================
COMPACT
========================= */

function compactMarket(m) {

return {

id:
  m.id,
question:
  m.question,
category:
  m.category,
marketYes:
  m.yes?.probability ??
  0,
marketNo:
  m.no?.probability ??
  0,
aiYes:
  m.aiYes,
aiNo:
  m.aiNo,
modelYes:
  m.modelYes,
modelNo:
  m.modelNo,
confidence:
  m.confidence,
edge:
  m.edge,
edgePct:
  m.edgePct,
modelQuality:
  m.modelQuality,
momentum:
  m.momentum,
opportunityScore:
  m.opportunityScore,
risk:
  m.risk,
recommendation:
  m.recommendation,
reasoning:
  m.reasoning,
factors:
  m.factors,
signal:
  m.signal,
volume:
  m.volume,
volume24h:
  m.volume24h,
liquidity:
  m.liquidity

};
}

/* =========================
VERCEL HANDLER
========================= */

export default async function handler(
req,
res
) {

try {

res.setHeader(
  "Cache-Control",
  "s-maxage=15, stale-while-revalidate=30"
);
const params =
  req?.query || {};
/*
 * Keep API light enough for
 * Vercel Hobby.
 */
const requestedLimit =
  num(
    params.limit,
    60
  );
const limit =
  Math.min(
    Math.max(
      requestedLimit,
      1
    ),
    100
  );
/*
 * Fetch Gamma.
 */
const rawMarkets =
  await getMarkets(
    limit
  );
/*
 * Normalize.
 */
let markets =
  rawMarkets
    .map(normalizeMarket)
    .filter(
      m =>
        m &&
        m.question
    );
/*
 * Sort by AI opportunity.
 */
markets.sort(
  (a, b) =>
    num(
      b.opportunityScore
    ) -
    num(
      a.opportunityScore
    )
);
/*
 * Optional CLOB enrichment.
 */
if (
  params.book === "true" ||
  params.history === "true"
) {
  const enriched = [];
  /*
   * Do NOT hammer CLOB.
   * Limit enrichment to first 20.
   */
  const maxEnrich =
    Math.min(
      markets.length,
      20
    );
  for (
    let i = 0;
    i < markets.length;
    i++
  ) {
    if (i < maxEnrich) {
      enriched.push(
        await enrichMarket(
          markets[i],
          params
        )
      );
    } else {
      enriched.push(
        markets[i]
      );
    }
  }
  markets =
    enriched;
}
/*
 * Stats.
 */
const stats =
  buildStats(
    markets
  );
/*
 * Details mode.
 */
const responseMarkets =
  params.details === "false"
    ? markets.map(
        compactMarket
      )
    : markets;
/*
 * Top markets.
 */
const topMarkets =
  responseMarkets
    .slice(0, 10)
    .map(
      m => ({
        id:
          m.id,
        question:
          m.question,
        category:
          m.category,
        marketYes:
          m.yes?.probability ??
          m.marketYes ??
          0,
        marketNo:
          m.no?.probability ??
          m.marketNo ??
          0,
        aiYes:
          m.aiYes,
        aiNo:
          m.aiNo,
        confidence:
          m.confidence,
        edge:
          m.edge,
        edgePct:
          m.edgePct,
        modelQuality:
          m.modelQuality,
        momentum:
          m.momentum,
        opportunityScore:
          m.opportunityScore,
        risk:
          m.risk,
        recommendation:
          m.recommendation,
        reasoning:
          m.reasoning,
        signal:
          m.signal,
        volume:
          m.volume,
        volume24h:
          m.volume24h,
        liquidity:
          m.liquidity
      })
    );
/*
 * SUCCESS
 */
return res.status(
  200
).json({
  ok: true,
  source: {
    gamma:
      GAMMA,
    clob:
      CLOB
  },
  timestamp:
    Date.now(),
  count:
    responseMarkets.length,
  stats,
  topMarkets,
  markets:
    responseMarkets
});

} catch (error) {

console.error(
  "Polymarket API error:",
  error
);
/*
 * Return useful error JSON
 * instead of Vercel generic
 * function invocation error.
 */
return res.status(
  500
).json({
  ok: false,
  error:
    "Polymarket API error",
  message:
    error?.message ||
    "Unknown error",
  name:
    error?.name ||
    "Error",
  timestamp:
    Date.now()
});

}
}
