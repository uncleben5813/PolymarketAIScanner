const GAMMA = “https://gamma-api.polymarket.com”;
const CLOB = “https://clob.polymarket.com”;

function arr(v) {
if (Array.isArray(v)) return v;
try { return JSON.parse(v || “[]”); } catch { return []; }
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
return n > 1 ? clamp(n / 100, 0, 1) : clamp(n, 0, 1);
}

function percent(v) {
return Math.round(probability(v) * 10000) / 100;
}

function money(v) {
return Math.max(0, num(v));
}

async function fetchJson(url, options = {}) {
const controller = new AbortController();
const timer = setTimeout(
() => controller.abort(),
options.timeout || 9000
);

try {
const r = await fetch(url, {
…options,
signal: controller.signal,
headers: {
accept: “application/json”,
…(options.headers || {})
}
});

const text = await r.text();
let data;
try { data = JSON.parse(text); }
catch { data = text; }
if (!r.ok) {
  throw new Error(`${r.status} ${r.statusText}`);
}
return data;

} finally {
clearTimeout(timer);
}
}

function outcomeProbability(outcomes, prices, name) {
const i = outcomes.findIndex(
x => String(x).toLowerCase() === name.toLowerCase()
);
return i >= 0 ? probability(prices[i]) : 0;
}

function logScore(value, divisor) {
return clamp(
Math.log10(Math.max(value, 1)) / divisor,
0,
1
);
}

/*

* AI ENGINE
* Conservative heuristic model.
    */
    function calculateAI(market) {
    const marketYes = probability(market.yes?.probability);
    const volume = money(market.volume);
    const volume24h = money(market.volume24h);
    const liquidity = money(market.liquidity);

const liquidityScore = logScore(liquidity, 6);
const volumeScore = logScore(volume, 7);
const recentScore = logScore(volume24h, 6);

const marketQuality = clamp(
liquidityScore * 45 +
volumeScore * 30 +
recentScore * 25,
0,
100
);

let momentum = 50;

if (volume > 0 && volume24h > 0) {
momentum = clamp(
50 + (volume24h / volume) * 250,
0,
100
);
}

let adjustment = 0;

if (marketQuality >= 75) adjustment += 0.018;
else if (marketQuality >= 55) adjustment += 0.010;
else if (marketQuality < 25) adjustment -= 0.010;

if (marketYes >= 0.97) adjustment -= 0.012;
if (marketYes <= 0.03) adjustment += 0.012;

if (momentum >= 75) adjustment += 0.006;
else if (momentum <= 25) adjustment -= 0.004;

const aiYes = clamp(
marketYes + adjustment,
0.01,
0.99
);

const aiNo = 1 - aiYes;
const edgePct = (aiYes - marketYes) * 100;

const confidence = clamp(
48 +
Math.abs(edgePct) * 2.4 +
marketQuality * 0.28 +
Math.abs(momentum - 50) * 0.10,
0,
97
);

let side = “NEUTRAL”;
let strength = “LOW”;

if (edgePct >= 5) {
side = “YES”;
strength = “STRONG”;
} else if (edgePct >= 2) {
side = “YES”;
strength = “MODERATE”;
} else if (edgePct <= -5) {
side = “NO”;
strength = “STRONG”;
} else if (edgePct <= -2) {
side = “NO”;
strength = “MODERATE”;
}

const opportunityScore = clamp(
Math.abs(edgePct) * 8 +
confidence * 0.35 +
marketQuality * 0.25,
0,
100
);

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

const reasons = [];

if (Math.abs(edgePct) >= 5)
reasons.push(model sees a ${Math.abs(edgePct).toFixed(1)}% probability gap);
else if (Math.abs(edgePct) >= 2)
reasons.push(model sees a moderate ${Math.abs(edgePct).toFixed(1)}% probability gap);
else
reasons.push(“model sees limited probability edge”);

if (marketQuality >= 75)
reasons.push(“strong market liquidity and activity”);
else if (marketQuality >= 50)
reasons.push(“acceptable market liquidity and activity”);
else
reasons.push(“lower market quality increases uncertainty”);

if (momentum >= 70)
reasons.push(“recent trading activity is elevated”);
else if (momentum <= 30)
reasons.push(“recent trading activity is quiet”);

const recommendation =
side === “YES”
? strength === “STRONG” ? “AI FAVORS YES” : “LEAN YES”
: side === “NO”
? strength === “STRONG” ? “AI FAVORS NO” : “LEAN NO”
: “NO CLEAR EDGE”;

return {
aiYes: percent(aiYes),
aiNo: percent(aiNo),
modelYes: aiYes,
modelNo: aiNo,
confidence: Math.round(confidence),
edge: Math.round(edgePct * 100) / 100,
edgePct: Math.round(edgePct * 100) / 100,
modelQuality: Math.round(marketQuality),
momentum: Math.round(momentum),
opportunityScore: Math.round(opportunityScore),
risk,
recommendation,
reasoning: reasons.join(”. “) + “.”,
factors: {
liquidity: Math.round(liquidityScore * 100),
volume: Math.round(volumeScore * 100),
recentActivity: Math.round(recentScore * 100),
marketQuality: Math.round(marketQuality),
momentum: Math.round(momentum)
},
signal: {
side,
strength,
score: Math.round(opportunityScore)
}
};
}

function normalizeMarket(market) {
const outcomes = arr(market.outcomes);
const prices = arr(market.outcomePrices);

const yes = outcomeProbability(
outcomes,
prices,
“Yes”
);

const no = outcomeProbability(
outcomes,
prices,
“No”
) || (1 - yes);

const normalized = {
id: String(market.id || market.conditionId || “”),
question: market.question || “Unknown market”,
slug: market.slug || “”,
conditionId: market.conditionId || “”,
category:
market.category ||
market.groupItemTitle ||
market.eventTitle ||
“Other”,
description: market.description || “”,
image: market.image || “”,
icon: market.icon || “”,
active: Boolean(market.active),
closed: Boolean(market.closed),
archived: Boolean(market.archived),
featured: Boolean(market.featured),
startDate: market.startDate || null,
endDate: market.endDate || null,
closedTime: market.closedTime || null,
outcomes,
outcomePrices: prices,

yes: {
  price: yes,
  probability: yes,
  percentage: percent(yes),
  tokenId: ""
},
no: {
  price: no,
  probability: no,
  percentage: percent(no),
  tokenId: ""
},
volume: money(market.volume),
volume24h: money(
  market.volume24h ||
  market.volume24Hour ||
  market.oneDayVolume
),
liquidity: money(market.liquidity),
enableOrderBook: Boolean(market.enableOrderBook),
minimumOrderSize: market.minimumOrderSize || null,
negRisk: Boolean(market.negRisk),
negRiskMarketID: market.negRiskMarketID || null,
clobTokenIds: arr(market.clobTokenIds)

};

return {
…normalized,
…calculateAI(normalized)
};
}

async function getMarkets(limit) {
const url =
${GAMMA}/markets?active=true&closed=false&archived=false +
&limit=${limit}&order=volume24hr&ascending=false;

const data = await fetchJson(url);

if (Array.isArray(data)) return data;
if (Array.isArray(data?.data)) return data.data;

return [];
}

async function getBook(tokenId) {
if (!tokenId) return null;

try {
return await fetchJson(
${CLOB}/book?token_id=${encodeURIComponent(tokenId)},
{ timeout: 6000 }
);
} catch {
return null;
}
}

function analyzeBook(book) {
if (!book) {
return {
available: false,
spread: null,
bidDepth: 0,
askDepth: 0,
imbalance: 0,
pressure: “UNKNOWN”
};
}

const bids = Array.isArray(book.bids) ? book.bids : [];
const asks = Array.isArray(book.asks) ? book.asks : [];

const bidDepth = bids.reduce(
(s, x) => s + money(x.size),
0
);

const askDepth = asks.reduce(
(s, x) => s + money(x.size),
0
);

const total = bidDepth + askDepth;

const imbalance = total
? ((bidDepth - askDepth) / total) * 100
: 0;

const bestBid = bids.length
? num(bids[0].price)
: 0;

const bestAsk = asks.length
? num(asks[0].price)
: 0;

const spread =
bestBid && bestAsk
? (bestAsk - bestBid) * 100
: null;

return {
available: true,
bestBid,
bestAsk,
spread,
bidDepth,
askDepth,
imbalance: Math.round(imbalance * 100) / 100,
pressure:
imbalance >= 15
? “BUYING”
: imbalance <= -15
? “SELLING”
: “BALANCED”
};
}

async function enrichMarket(market) {
const result = { …market };
const tokens = market.clobTokenIds || [];

if (tokens[0]) result.yes.tokenId = tokens[0];
if (tokens[1]) result.no.tokenId = tokens[1];

const book = await getBook(result.yes.tokenId);

result.orderBook = analyzeBook(book);

return result;
}

function buildStats(markets) {
const total = markets.length;

const totalVolume = markets.reduce(
(s, m) => s + money(m.volume),
0
);

const totalLiquidity = markets.reduce(
(s, m) => s + money(m.liquidity),
0
);

const avgYes =
total
? markets.reduce(
(s, m) => s + probability(m.yes?.probability),
0
) / total
: 0;

return {
total,
active: markets.filter(m => m.active).length,
closed: markets.filter(m => m.closed).length,
totalVolume,
totalLiquidity,
avgYesProbability: percent(avgYes),
strongSignals: markets.filter(
m => m.signal?.strength === “STRONG”
).length,
yesSignals: markets.filter(
m => m.signal?.side === “YES”
).length,
noSignals: markets.filter(
m => m.signal?.side === “NO”
).length,
opportunities: markets.filter(
m => Math.abs(m.edge || 0) >= 2
).length,
lowRisk: markets.filter(
m => m.risk === “LOW”
).length,
highRisk: markets.filter(
m => m.risk === “HIGH”
).length
};
}

export default async function handler(req, res) {
const started = Date.now();

try {
res.setHeader(
“Cache-Control”,
“s-maxage=20, stale-while-revalidate=40”
);

const limit = clamp(
  num(req.query?.limit, 100),
  1,
  100
);
let markets = (await getMarkets(limit))
  .map(normalizeMarket)
  .filter(m => m.question);
markets.sort(
  (a, b) =>
    b.opportunityScore -
    a.opportunityScore
);
/*
 * Enrich top markets with live CLOB order book.
 * This avoids hammering the API for 100 books.
 */
const top = markets.slice(0, 20);
const enriched = await Promise.all(
  top.map(enrichMarket)
);
const enrichedMap = new Map(
  enriched.map(m => [m.id, m])
);
markets = markets.map(
  m => enrichedMap.get(m.id) || m
);
return res.status(200).json({
  ok: true,
  source: {
    gamma: GAMMA,
    clob: CLOB
  },
  timestamp: Date.now(),
  responseTimeMs: Date.now() - started,
  count: markets.length,
  stats: buildStats(markets),
  topMarkets: markets.slice(0, 10),
  markets
});

} catch (error) {
console.error(“Polymarket API error:”, error);

return res.status(500).json({
  ok: false,
  error: "Polymarket API error",
  message: error?.message || "Unknown error",
  timestamp: Date.now(),
  responseTimeMs: Date.now() - started
});

}
}
