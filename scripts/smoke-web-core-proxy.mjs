const baseUrl = (process.env.WEB_SMOKE_BASE_URL ?? 'http://localhost:3000').replace(/\/$/, '');

async function request(path, init) {
  const response = await fetch(`${baseUrl}${path}`, init);
  const text = await response.text();
  let body = text;
  try { body = JSON.parse(text); } catch { /* text response */ }
  return { response, body };
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function expectCore(name, path, status, init) {
  const { response, body } = await request(path, init);
  assert(response.status === status, `${name}: expected ${status}, got ${response.status}: ${JSON.stringify(body)}`);
  assert(response.headers.get('x-kicksonar-api-version') === '1', `${name}: request did not reach Core API v1`);
  console.log(`PASS ${name} (${response.status}, Core v1)`);
}

async function expectLocal(name, path) {
  const { response, body } = await request(path);
  assert(response.headers.get('x-kicksonar-api-version') !== '1', `${name}: restricted route was unexpectedly proxied to Core`);
  console.log(`PASS ${name} (${response.status}, Web-local)`);
  return body;
}

async function expectBlocked(name, path, init) {
  const { response, body } = await request(path, init);
  assert(response.status === 503, `${name}: expected 503, got ${response.status}: ${JSON.stringify(body)}`);
  assert(response.headers.get('x-kicksonar-web-proxy') === 'blocked', `${name}: route was not blocked by the Web boundary`);
  console.log(`PASS ${name} (503, blocked before local execution)`);
}

const health = await expectLocal('Web health stays local', '/api/health');
assert(health?.service === 'kicksonar-web', 'Web health returned the wrong service identity');
assert(health?.jobsEnabled === false, 'Web health reports background jobs enabled');
assert(health?.coreProxyGroups?.includes('admin'), 'Web health does not report the admin proxy group');
assert(!health?.coreProxyGroups?.includes('operations'), 'Web health unexpectedly enables operations');
await expectCore('public stats proxy', '/api/stats', 200);
await expectCore('account session proxy', '/api/auth/me', 401);
await expectCore('account login body proxy', '/api/auth/login', 401, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ email: 'missing@example.invalid', password: 'invalid-password-1' }),
});
await expectCore('account write protection', '/api/track/missing-project', 401, { method: 'POST' });
await expectCore('admin users proxy requires role', '/api/admin/users', 403);
await expectCore('crawler status read proxy requires role', '/api/sync/status', 403);
await expectBlocked('crawler mutation cannot fall back to Web', '/api/sync/live', {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({ wait: true, maxPages: 1 }),
});

console.log(`Kicksonar Web -> Core proxy smoke passed against ${baseUrl}`);
