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
        typeof data === "string"
          ? data
          : JSON.stringify(data)
      }`
    );
  }

  return data;
}

/*
 * -----------------------------------------
 * MARKET NORMALIZATION
 * -----------------------------------------
 */

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
      : probability(prices[1] ?? (1 - yesPrice));

  const yesToken =
    yesIndex >= 0
      ? tokens[yesIndex]
      : tokens[0];

  const noToken =
    noIndex >= 0
      ? tokens[noIndex]
      : tokens[1];

  return {
    id: market.id ?? null,

    question:
      market.question ??
      "",

    slug:
      market.slug ??
      "",

    conditionId:
      market.conditionId ??
      market.condition_id ??
      null,

    category:
      market.category ??
      "",

    description:
      market.description ??
      "",

    image:
      market.image ??
      null,

    icon:
      market.icon ??
      null,

    active:
      Boolean(market.active),

    closed:
      Boolean(market.closed),

    archived:
      Boolean(market.archived),

    restricted:
      Boolean(market.restricted),

    featured:
      Boolean(market.featured),

    startDate:
      market.startDate ??
      null,

    endDate:
      market.endDate ??
      null,

    closedTime:
      market.closedTime ??
      null,

    outcomes,

    outcomePrices:
      prices,

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

    volume:
      num(market.volume),

    volume24h:
      num(
        market.volume24hr ??
        market.volume24h ??
        market.volume24Hr
      ),

    liquidity:
      num(market.liquidity),

    enableOrderBook:
      market.enableOrderBook !== false,

    minimumOrderSize:
      num(market.minimumOrderSize),

    orderPriceMinTickSize:
      num(
        market.orderPriceMinTickSize,
        0.01
      ),

    negRisk:
      Boolean(market.negRisk),

    negRiskMarketID:
      market.negRiskMarketID ??
      market.negRiskMarketId ??
      null
  };
}

/*
 * -----------------------------------------
 * AI / MODEL ENGINE
 * -----------------------------------------
 *
 * This is a model estimate, NOT guaranteed
 * outcome prediction.
 *
 * Inputs:
 * - market probability
 * - YES/NO balance
 * - liquidity
 * - volume
 * - 24h volume
 *
 * The model deliberately keeps its adjustment
 * small so it does not produce ridiculous
 * probabilities.
 */

function calculateAI(market) {

  const yes = probability(
    market.yes.price
  );

  const no = probability(
    market.no.price
  );

  const volume =
    Math.max(
      0,
      num(market.volume)
    );

  const volume24h =
    Math.max(
      0,
      num(market.volume24h)
    );

  const liquidity =
    Math.max(
      0,
      num(market.liquidity)
    );

  /*
   * Market baseline.
   */
  let aiYes = yes;

  /*
   * Confidence starts from probability
   * distance from 50%.
   */
  let confidence =
    50 +
    Math.abs(yes - 0.5) * 90;

  /*
   * Liquidity quality.
   */
  const liquidityFactor =
    clamp(
      Math.log10(
        liquidity + 1
      ) / 7,
      0,
      1
    );

  /*
   * Volume quality.
   */
  const volumeFactor =
    clamp(
      Math.log10(
        volume + 1
      ) / 8,
      0,
      1
    );

  /*
   * Recent activity.
   */
  const recentFactor =
    volume > 0
      ? clamp(
          volume24h /
          Math.max(volume, 1),
          0,
          1
        )
      : 0;

  /*
   * Strong liquidity + activity increases
   * confidence in market price.
   */
  const quality =
    (
      liquidityFactor * 0.45 +
      volumeFactor * 0.35 +
      recentFactor * 0.20
    );

  /*
   * Small model adjustment.
   *
   * The model pushes extreme probabilities
   * slightly toward/away from center depending
   * on market quality.
   */
  const distance =
    yes - 0.5;

  const adjustment =
    distance *
    0.08 *
    quality;

  aiYes =
    yes + adjustment;

  /*
   * Very uncertain markets get pulled toward
   * 50%.
   */
  if (
    yes > 0.35 &&
    yes < 0.65
  ) {

    const uncertaintyPull =
      (0.5 - yes) *
      0.04 *
      (1 - quality);

    aiYes +=
      uncertaintyPull;
  }

  aiYes =
    clamp(
      aiYes,
      0.01,
      0.99
    );

  const aiNo =
    1 - aiYes;

  const edge =
    aiYes - yes;

  /*
   * Confidence.
   */
  confidence +=
    quality * 20;

  confidence =
    clamp(
      confidence,
      35,
      97
    );

  /*
   * Signal.
   */
  let side = "NEUTRAL";
  let strength = "NEUTRAL";

  const absEdge =
    Math.abs(edge);

  if (absEdge >= 0.08) {
    side =
      edge > 0
        ? "YES"
        : "NO";

    strength = "VERY_STRONG";

  } else if (absEdge >= 0.045) {
    side =
      edge > 0
        ? "YES"
        : "NO";

    strength = "STRONG";

  } else if (absEdge >= 0.025) {
    side =
      edge > 0
        ? "YES"
        : "NO";

    strength = "MODERATE";

  } else {

    /*
     * If the model agrees closely with market,
     * use market direction only when strong.
     */
    if (yes >= 0.70) {
      side = "YES";
    } else if (yes <= 0.30) {
      side = "NO";
    }
  }

  const score =
    Math.round(
      clamp(
        50 +
        edge * 500 +
        (confidence - 50) * 0.25,
        1,
        99
      )
    );

  return {

    aiYes:
      Number(
        aiYes.toFixed(6)
      ),

    aiNo:
      Number(
        aiNo.toFixed(6)
      ),

    confidence:
      Number(
        confidence.toFixed(1)
      ),

    edge:
      Number(
        edge.toFixed(6)
      ),

    edgePct:
      Number(
        (edge * 100).toFixed(2)
      ),

    signal: {
      side,
      strength,
      score
    },

    modelQuality:
      Number(
        (quality * 100).toFixed(1)
      )
  };
}

/*
 * -----------------------------------------
 * ORDER BOOK
 * -----------------------------------------
 */

async function getOrderBook(tokenId) {

  if (!tokenId) {
    return null;
  }

  try {

    const data =
      await fetchJson(
        `${CLOB}/book?token_id=${encodeURIComponent(
          tokenId
        )}`
      );

    const bids =
      Array.isArray(data.bids)
        ? data.bids
        : [];

    const asks =
      Array.isArray(data.asks)
        ? data.asks
        : [];

    const bestBid =
      bids.length
        ? num(bids[0].price)
        : null;

    const bestAsk =
      asks.length
        ? num(asks[0].price)
        : null;

    const spread =
      bestBid !== null &&
      bestAsk !== null
        ? bestAsk - bestBid
        : null;

    return {

      bestBid,

      bestAsk,

      spread,

      spreadPct:
        spread !== null
          ? Number(
              (
                spread * 100
              ).toFixed(3)
            )
          : null,

      bids,

      asks,

      timestamp:
        Date.now()
    };

  } catch {

    return null;
  }
}

/*
 * -----------------------------------------
 * PRICE HISTORY
 * -----------------------------------------
 */

async function getPriceHistory(tokenId) {

  if (!tokenId) {
    return [];
  }

  try {

    const data =
      await fetchJson(
        `${CLOB}/prices-history?market=${encodeURIComponent(
          tokenId
        )}&interval=1d&fidelity=60`
      );

    return data?.history || [];

  } catch {

    return [];
  }
}

/*
 * -----------------------------------------
 * POLYMARKET MARKETS
 * -----------------------------------------
 */

async function getMarkets(params = {}) {

  const limit =
    Math.min(
      Math.max(
        num(params.limit, 100),
        1
      ),
      100
    );

  const offset =
    Math.max(
      num(params.offset, 0),
      0
    );

  const url =
    new URL(
      `${GAMMA}/markets`
    );

  url.searchParams.set(
    "active",
    params.active === "false"
      ? "false"
      : "true"
  );

  url.searchParams.set(
    "closed",
    params.closed === "true"
      ? "true"
      : "false"
  );

  url.searchParams.set(
    "limit",
    String(limit)
  );

  url.searchParams.set(
    "offset",
    String(offset)
  );

  if (params.order) {

    url.searchParams.set(
      "order",
      params.order
    );
  }

  if (
    params.ascending !== undefined
  ) {

    url.searchParams.set(
      "ascending",
      String(params.ascending)
    );
  }

  if (params.q) {

    url.searchParams.set(
      "q",
      params.q
    );
  }

  if (params.tag_id) {

    url.searchParams.set(
      "tag_id",
      params.tag_id
    );
  }

  if (params.tag_slug) {

    url.searchParams.set(
      "tag_slug",
      params.tag_slug
    );
  }

  return fetchJson(
    url.toString()
  );
}

/*
 * -----------------------------------------
 * HANDLER
 * -----------------------------------------
 */

export default async function handler(
  req,
  res
) {

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

    /*
     * Fetch Gamma markets.
     */
    const markets =
      await getMarkets({

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

    /*
     * Normalize.
     */
    let result =
      Array.isArray(markets)
        ? markets.map(
            normalizeMarket
          )
        : [];

    /*
     * AI MODEL
     */
    result =
      result.map(market => {

        const ai =
          calculateAI(
            market
          );

        return {

          ...market,

          aiYes:
            ai.aiYes,

          aiNo:
            ai.aiNo,

          modelYes:
            ai.aiYes,

          modelNo:
            ai.aiNo,

          confidence:
            ai.confidence,

          edge:
            ai.edge,

          edgePct:
            ai.edgePct,

          modelQuality:
            ai.modelQuality,

          signal:
            ai.signal
        };
      });

    /*
     * Optional CLOB book.
     */
    if (book === "true") {

      result =
        await Promise.all(

          result.map(
            async market => {

              const yesBook =
                await getOrderBook(
                  market.yes.tokenId
                );

              const noBook =
                await getOrderBook(
                  market.no.tokenId
                );

              return {

                ...market,

                orderBook: {

                  yes:
                    yesBook,

                  no:
                    noBook

                }

              };
            }
          )

        );
    }

    /*
     * Optional history.
     */
    if (history === "true") {

      result =
        await Promise.all(

          result.map(
            async market => {

              const yesHistory =
                await getPriceHistory(
                  market.yes.tokenId
                );

              return {

                ...market,

                history: {

                  yes:
                    yesHistory

                }

              };
            }
          )

        );
    }

    /*
     * AI EDGE ranking.
     *
     * Best opportunities first.
     */
    result.sort(
      (a, b) => {

        const edgeA =
          Math.abs(
            num(a.edge)
          );

        const edgeB =
          Math.abs(
            num(b.edge)
          );

        if (
          edgeA !== edgeB
        ) {

          return (
            edgeB -
            edgeA
          );
        }

        return (
          num(b.volume) -
          num(a.volume)
        );
      }
    );

    /*
     * Statistics.
     */
    const totalVolume =
      result.reduce(
        (sum, m) =>
          sum +
          num(m.volume),
        0
      );

    const totalLiquidity =
      result.reduce(
        (sum, m) =>
          sum +
          num(m.liquidity),
        0
      );

    const avgYes =
      result.length
        ? result.reduce(
            (sum, m) =>
              sum +
              probability(
                m.yes.price
              ),
            0
          ) /
          result.length
        : 0;

    const avgAI =
      result.length
        ? result.reduce(
            (sum, m) =>
              sum +
              probability(
                m.aiYes
              ),
            0
          ) /
          result.length
        : 0;

    const strongSignals =
      result.filter(
        m =>
          m.signal &&
          (
            m.signal.strength ===
              "STRONG" ||
            m.signal.strength ===
              "VERY_STRONG"
          )
      ).length;

    const yesSignals =
      result.filter(
        m =>
          m.signal?.side ===
          "YES"
      ).length;

    const noSignals =
      result.filter(
        m =>
          m.signal?.side ===
          "NO"
      ).length;

    /*
     * Top AI opportunities.
     */
    const topMarkets =
      result
        .slice(0, 10)
        .map(m => ({

          id:
            m.id,

          question:
            m.question,

          slug:
            m.slug,

          yes:
            m.yes,

          no:
            m.no,

          marketYes:
            m.yes.price,

          marketNo:
            m.no.price,

          aiYes:
            m.aiYes,

          aiNo:
            m.aiNo,

          modelYes:
            m.modelYes,

          confidence:
            m.confidence,

          edge:
            m.edge,

          edgePct:
            m.edgePct,

          modelQuality:
            m.modelQuality,

          signal:
            m.signal,

          volume:
            m.volume,

          volume24h:
            m.volume24h,

          liquidity:
            m.liquidity,

          active:
            m.active,

          closed:
            m.closed,

          endDate:
            m.endDate

        }));

    /*
     * Compact version if requested.
     */
    const outputMarkets =
      details === "false"

        ? result.map(
            m => ({

              id:
                m.id,

              question:
                m.question,

              slug:
                m.slug,

              yes:
                m.yes,

              no:
                m.no,

              marketYes:
                m.yes.price,

              marketNo:
                m.no.price,

              aiYes:
                m.aiYes,

              aiNo:
                m.aiNo,

              modelYes:
                m.modelYes,

              confidence:
                m.confidence,

              edge:
                m.edge,

              edgePct:
                m.edgePct,

              modelQuality:
                m.modelQuality,

              signal:
                m.signal,

              volume:
                m.volume,

              volume24h:
                m.volume24h,

              liquidity:
                m.liquidity,

              active:
                m.active,

              closed:
                m.closed,

              endDate:
                m.endDate

            })
          )

        : result;

    /*
     * FINAL RESPONSE
     */
    return res.status(200).json({

      ok: true,

      source: {

        gamma:
          GAMMA,

        clob:
          CLOB,

        model:
          "Polymarket AI Probability Engine"

      },

      timestamp:
        Date.now(),

      count:
        result.length,

      stats: {

        total:
          result.length,

        active:
          result.filter(
            m =>
              m.active &&
              !m.closed
          ).length,

        closed:
          result.filter(
            m =>
              m.closed
          ).length,

        totalVolume,

        totalLiquidity,

        avgYesProbability:
          Number(
            (
              avgYes * 100
            ).toFixed(2)
          ),

        avgAIProbability:
          Number(
            (
              avgAI * 100
            ).toFixed(2)
          ),

        strongSignals,

        yesSignals,

        noSignals

      },

      topMarkets,

      markets:
        outputMarkets

    });

  } catch (error) {

    console.error(
      "MARKET API ERROR:",
      error
    );

    return res.status(500).json({

      ok: false,

      error:
        "Market API failed",

      message:
        error?.message ||
        "Unknown error",

      timestamp:
        Date.now()

    });
  }
}
