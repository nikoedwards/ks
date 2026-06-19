# Indiegogo Search Probe

Isolated Railway probe for testing whether `https://www.indiegogo.com/en/projects/search` can be loaded and inspected from a server-side browser.

This service is intentionally separate from the Kicksonar app and from the Kickstarter Cloudflare probe. It does not connect to the main database and does not import data.

## Endpoints

- `GET /health` - liveness and current status.
- `GET /report` - latest probe report.
- `POST /run` - start one probe run. Send `Authorization: Bearer <PROBE_TOKEN>` when `PROBE_TOKEN` is configured.

## Railway Setup

Create a new Railway service from the same GitHub repo and set:

```text
Root Directory: indiegogo-probe
Build: Dockerfile
```

Recommended environment variables:

```text
PROBE_TOKEN=<generate-a-long-random-token>
PROBE_RUN_ON_BOOT=0
PROBE_CLEAR_MS=90000
PROBE_SCROLLS=3
PROBE_TARGET_URL=https://www.indiegogo.com/en/projects/search
```

Run it:

```bash
curl https://<railway-probe-url>/health
curl -X POST https://<railway-probe-url>/run -H "Authorization: Bearer <PROBE_TOKEN>"
curl https://<railway-probe-url>/report
```

## Result Meaning

- `cleared: true` means the browser was not stuck on Cloudflare and the page could be inspected.
- `blocked: true` means the run still appeared to be on a challenge/access-denied page when the timeout expired.
- `sampleProjects` contains project links extracted from the DOM.
- `networkEndpoints` contains interesting JSON/API/GraphQL responses observed during the run.
