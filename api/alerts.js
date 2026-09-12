const KEY = “poly_alert_state”;

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

if (!r.ok) throw new Error(KV ${r.status});
return r.json();
}

async function getState() {
if (!hasKV()) return {};

const data = await kv(
/get/${encodeURIComponent(KEY)}
);

if (!data?.result) return {};

try {
return JSON.parse(data.result);
} catch {
return {};
}
}

async function saveState(state) {
if (!hasKV()) return;

await kv(
/set/${encodeURIComponent(KEY)}/${encodeURIComponent(JSON.stringify(state))},
{ method: “GET” }
);
}

export default async function handler(req, res) {
try {
if (req.method === “GET”) {
return res.status(200).json({
ok: true,
persistent: hasKV(),
state: await getState()
});
}

if (req.method === "POST") {
  const body =
    typeof req.body === "string"
      ? JSON.parse(req.body)
      : req.body || {};
  const id = String(body.id || "");
  if (!id) {
    return res.status(400).json({
      ok: false,
      error: "id required"
    });
  }
  const state = await getState();
  state[id] = {
    signal: body.signal || "NEUTRAL",
    strength: body.strength || "LOW",
    edge: Number(body.edge || 0),
    confidence: Number(body.confidence || 0),
    opportunityScore:
      Number(body.opportunityScore || 0),
    timestamp: Date.now()
  };
  await saveState(state);
  return res.status(200).json({
    ok: true,
    persistent: hasKV(),
    alert: state[id]
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
