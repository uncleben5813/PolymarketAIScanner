# Polymarket AI Prediction Machine V2

V2 replaces the old artificial low-price uplift with a transparent model:
- Polymarket YES price is the baseline.
- Recent CLOB price history contributes a small momentum signal.
- Uncertainty shrinks the edge when history is short/noisy.
- Liquidity/volume contribute to confidence, not direction.
- No API key is required for public market-data reads.

Important: this is not a trained ML model and does not guarantee profitable predictions. The next serious upgrade is to store predictions, observe resolved outcomes, and calculate Brier score/log loss against the market baseline.
