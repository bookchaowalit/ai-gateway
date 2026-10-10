# Agent Instructions

- Human-facing replies are in Thai by default; keep code, commands and identifiers as-is.
- Never print, commit or copy secrets. Railway variables are the only secret store.
- Run `npm test` and `npm run build` before committing.
- Deploys are manual (`railway up`), never automatic, and change production:
  verify `/healthz` afterwards and record the deploy in the commit or runbook.
- Keep the solo-empire registry entry (`ai-gateway` in
  `repository-catalog/registries/online-systems.yaml`) in sync when the URL,
  host or data store changes.
