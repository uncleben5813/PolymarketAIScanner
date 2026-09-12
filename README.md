# Polymarket AI Prediction Machine V3

V3 improves the scanner and introduces a metrics layer. It deliberately does NOT fake a historical win rate or Brier score when no resolved prediction database exists.

Current model:
- Market YES probability is the prior.
- CLOB history supplies a small momentum signal.
- Uncertainty shrinks edge.
- Liquidity/volume affect confidence.
- Brier and Log Loss are shown as Pending until resolved predictions are persisted.

Next serious backend upgrade: add persistent storage for prediction snapshots, resolve outcomes, and calculate Brier/Log Loss over time.