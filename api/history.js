const KEY = “poly_ai_history”;

function hasKV() {
return Boolean(
process.env.KV_REST_API_URL &&
process.env.KV_REST_API_TOKEN
);
}

async function kv(path, options = {}) {
const r = await fetch(
${process.env.KV_REST_API_URL}${path},
{
…options,
headers: {
Authorization:
Bearer ${process.env.KV_REST_API_TOKEN},
…(options.headers || {})
}
}
);

if (!r.ok) {
throw new Error(KV ${r.status});
}

return r.json();
}

async function getHistory() {
if (!hasKV()) return [];

const data = await kv(
/get/${encodeURIComponent(KEY)}
);

if (!data?.result) return [];

try {
return JSON.parse(data.result);
} catch {
return [];
}
}

async function saveHistory(items) {
if (!hasKV()) return;

await kv(
/set/${encodeURIComponent(KEY)}/${encodeURIComponent(JSON.stringify(items))},
{ method: “GET” }
);
}

export default async function handler(req, res) {
try {
if (req.method === “GET”) {
const history = await getHistory();

  const correct = history.filter(
    x => x.result === "CORRECT"
  ).length;
  const wrong = history.filter(
    x => x.result === "WRONG"
  ).length;
  const resolved = correct + wrong;
  return res.status(200).json({
    ok: true,
    persistent: hasKV(),
    total: history.length,
    correct,
    wrong,
    accuracy: resolved
      ? Math.round(correct / resolved * 1000) / 10
      : null,
    history: history.slice(0, 500)
  });
}
if (req.method === "POST") {
  const body =
    typeof req.body === "string"
      ? JSON.parse(req.body)
      : req.body || {};
  const item = {
    id: `${Date.now()}-${Math.random().toString(36).slice(2,8)}`,
    timestamp: Date.now(),
    marketId: String(body.marketId || ""),
    question: body.question || "",
    prediction: body.prediction || "",
    marketProbability: Number(body.marketProbability || 0),
    aiProbability: Number(body.aiProbability || 0),
    edge: Number(body.edge || 0),
    confidence: Number(body.confidence || 0),
    opportunityScore: Number(body.opportunityScore || 0),
    risk: body.risk || "MEDIUM",
    result: "PENDING"
  };
  if (!item.marketId || !item.prediction) {
    return res.status(400).json({
      ok: false,
      error: "marketId and prediction required"
    });
  }
  const history = await getHistory();
  /*
   * Avoid duplicate snapshots for same market
   * inside a 10-minute window.
   */
  const duplicate = history.find(
    x =>
      x.marketId === item.marketId &&
      Math.abs(x.timestamp - item.timestamp) < 600000
  );
  if (!duplicate) {
    history.unshift(item);
    await saveHistory(history.slice(0, 1000));
  }
  return res.status(200).json({
    ok: true,
    persistent: hasKV(),
    item
  });
}
return res.status(405).json({
  ok: false,
  error: "Method not allowed"
});

} catch (error) {
return res.status(500).json({
ok: false,
error: error.message
});
}
}
