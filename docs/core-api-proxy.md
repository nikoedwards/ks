# Kicksonar Web to Core proxy

Kicksonar Web keeps its existing same-origin `/api/*` browser contract while a
server-side allowlist forwards selected routes to the versioned Core API. The
proxy is disabled by default, so merging the code does not switch production
traffic.

## Configuration

```text
KICKSONAR_JOBS_ENABLED=0
KICKSONAR_CORE_PROXY_ENABLED=1
KICKSONAR_CORE_PROXY_GROUPS=public,account
KICKSONAR_CORE_BASE_URL=http://kicksonar-core-staging.railway.internal
```

`KICKSONAR_CORE_BASE_URL` is server-only. Browser JavaScript continues to call
the Web origin and never receives the Railway private hostname or the Core
service token.

## Boundary

- `public` forwards display/search/analysis/project/snapshot routes.
- `account` forwards authentication, favorites, API keys, tracking, push state,
  Kicktraq enrichment, and authenticated collaborator refreshes.
- `/api/admin/*`, `/api/data-quality/*`, `/api/platforms/*`, `/api/sync/*`, and
  `/api/v1/internal/*` are deliberately excluded.

The account routes rely on the normal browser cookie. External Next.js rewrites
forward the request cookie and return Core's `Set-Cookie` response on the Web
origin, preserving the existing frontend session contract.

## Safe rollout

1. Deploy a separate Web staging service without a Volume.
2. Set `KICKSONAR_JOBS_ENABLED=0` and enable `public,account` proxy groups.
3. Point `KICKSONAR_CORE_BASE_URL` at the Core service over Railway private DNS.
4. Run `WEB_SMOKE_BASE_URL=https://<web-staging-domain> npm run smoke:core-proxy`.
5. Compare user flows and payloads before enabling the proxy on production Web.

The legacy route handlers remain in the repository during the rollback window.
They are bypassed only when the proxy feature flag is enabled.

`GET /api/health` always remains Web-local and reports the Web role, proxy
state, selected proxy groups, and disabled job state. Railway uses it as the
staging health check.
