# Polymarket AI Prediction Machine V4

V4 adds a prediction ledger in browser localStorage. Each market gets a model snapshot at most once per hour. The dashboard counts tracked and resolved observations and calculates Brier Score when outcomes are manually recorded in the ledger.

Important limitation: Vercel serverless functions are stateless. This V4 deliberately keeps the first ledger in the browser so it works without a database. For a real multi-device/persistent learning system, connect a durable store (for example Vercel KV/Postgres) and add automatic resolution polling.

Do not treat confidence or edge as guaranteed profit.