const KEY = “poly_watchlist”;

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

async function getList() {
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

async function saveList(list) {
if (!hasKV()) return;

await kv(
/set/${encodeURIComponent(KEY)}/${encodeURIComponent(JSON.stringify(list))},
{ method: “GET” }
);
}

export default async function handler(req, res) {
try {
if (req.method === “GET”) {
return res.status(200).json({
ok: true,
persistent: hasKV(),
watchlist: await getList()
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
  const list = await getList();
  const exists = list.some(x => x.id === id);
  let next;
  if (exists) {
    next = list.filter(x => x.id !== id);
  } else {
    next = [
      ...list,
      {
        id,
        question: body.question || "",
        category: body.category || "",
        addedAt: Date.now()
      }
    ];
  }
  await saveList(next);
  return res.status(200).json({
    ok: true,
    persistent: hasKV(),
    watchlist: next
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
