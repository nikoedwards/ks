# Kicksonar Browser Worker

This is a separate Railway service used by the main Kicksonar app when direct server-side requests to Kickstarter return Cloudflare HTML instead of readable JSON.

## Railway setup

1. Create a new Railway service from the same GitHub repo.
2. Set the service root directory to:

   ```text
   browser-worker
   ```

3. Use Dockerfile build. Railway should detect `browser-worker/Dockerfile`.
4. Add variables on this worker service:

   ```env
   BROWSER_WORKER_TOKEN=choose-a-long-random-token
   BROWSER_FETCH_TIMEOUT_MS=60000
   BROWSER_FETCH_MAX_BYTES=5000000
   ```

5. Deploy the worker and open:

   ```text
   https://your-worker.up.railway.app/health
   ```

6. Add these variables to the main `ks` service:

   ```env
   KICKSTARTER_BROWSER_FETCH_URL=https://your-worker.up.railway.app/fetch
   KICKSTARTER_BROWSER_TIMEOUT_MS=60000
   BROWSER_WORKER_TOKEN=the-same-token
   ```

7. Redeploy or restart the main `ks` service.

## API

```http
POST /fetch
Authorization: Bearer <BROWSER_WORKER_TOKEN>
Content-Type: application/json

{
  "url": "https://www.kickstarter.com/projects/example/project.json",
  "expect": "json"
}
```

The response contains `body` for JSON requests or `text` for HTML requests.
