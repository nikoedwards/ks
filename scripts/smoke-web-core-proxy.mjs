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

const health = await expectLocal('Web health stays local', '/api/health');
assert(health?.service === 'kicksonar-web', 'Web health returned the wrong service identity');
assert(health?.jobsEnabled === false, 'Web health reports background jobs enabled');
await expectCore('public stats proxy', '/api/stats', 200);
await expectCore('account session proxy', '/api/auth/me', 200);
await expectCore('account write protection', '/api/track/missing-project', 401, { method: 'POST' });
await expectLocal('admin route stays out of Web proxy', '/api/admin/users');
await expectLocal('crawler route stays out of Web proxy', '/api/sync/status');

console.log(`Kicksonar Web -> Core proxy smoke passed against ${baseUrl}`);
