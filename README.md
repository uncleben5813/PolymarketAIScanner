# Polymarket AI Prediction Machine V6

## What changed
- Server-side persistent prediction ledger when `DATABASE_URL` is configured.
- Automatic table creation.
- Hourly prediction snapshots per market.
- Automatic resolution check for tracked binary YES/NO markets.
- Real AI-vs-market Brier Score and Log Loss.
- Historical calibration: after at least 20 resolved records in a probability bucket, the model adjusts future probabilities toward observed calibration.
- Filters out non-binary markets so multi-outcome markets are not treated as YES/NO.

## Recommended Vercel setup
Vercel no longer provides the old standalone Vercel Postgres product; database integrations are now provided through the Vercel Marketplace. Neon, Supabase, Prisma Postgres, AWS and others are available there.

1. In your Vercel project, open Storage/Marketplace and add a Postgres database integration (Neon is a simple choice).
2. Connect it to this project.
3. Make sure the integration supplies `DATABASE_URL`.
4. Redeploy.
5. Open `/api/markets` and confirm `"storage":"database"`.
6. Open the dashboard and confirm `DB Connected`.

If DATABASE_URL is absent, V6 still runs in local fallback mode, but server-side persistence is not available.

## Important
This is an adaptive statistical prediction engine, not a guaranteed-profit system. Brier and Log Loss are proper scoring metrics; lower is better. The calibration layer only changes probabilities after enough resolved observations exist.

Official Polymarket market-data documentation:
https://docs.polymarket.com/market-data/overview
