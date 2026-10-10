# solo-ai-gateway

Central AI Gateway (`solo-empire.ai-gateway.v1`): one authenticated HTTPS
endpoint that routes model calls, enforces per-client scopes, rate limits and
budgets, and records run telemetry without storing prompts or outputs.

| | |
|---|---|
| Public URL | https://api.bookchaowalit.com (health: `/healthz`) |
| Host | Railway project `solo-ai-gateway`, service `ai-gateway`, always-on |
| Data | Railway volume at `/data` (SQLite telemetry) |
| Registry | solo-empire `repository-catalog/registries/online-systems.yaml` (`ai-gateway`) |
| Runbook | solo-empire `operations/runbooks/AI-API-GATEWAY-RUNBOOK.md` |

Extracted from the solo-empire monorepo (`infra/api/ai-gateway-service` and its
gateway modules) on 2026-10-10. This repository is now the source of truth for
the hosted service.

## Layout

```
api/                     gateway modules (routing, budget, rate limit, auth)
api/ai-gateway-service/  HTTP service, telemetry store, entrypoint, build
database/migrations/     telemetry schema
tests/                   node:test suites (run with tsx)
Dockerfile, railway.json build and deploy config (repository root is the context)
```

## Develop

```bash
npm install
npm test
npm run build
```

## Deploy

Railway variables hold every secret (`API_TOKENS_JSON`, upstream keys); none
live in this repository.

```bash
railway link --project solo-ai-gateway --service ai-gateway --environment production
railway up --ci
curl -fsS https://api.bookchaowalit.com/healthz
```
