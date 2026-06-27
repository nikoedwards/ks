// IndexNow submitter — proactively notifies Bing / Yandex (and downstream
// Copilot / ChatGPT search) about Kicksonar URLs so they get crawled sooner.
//
// Prereqs: the site must be deployed and the key file must be reachable at
//   https://kicksonar.com/8b7f1f0d4c2a4e7f9d6c3b2a1e0f5d8c.txt
//
// Usage:
//   node scripts/indexnow.mjs                # key pages only (home + static + categories + countries)
//   node scripts/indexnow.mjs --all-projects # also every indexable project detail page (~137k, batched)
//   SITE_URL=https://staging.example.com node scripts/indexnow.mjs

const SITE = (process.env.SITE_URL || 'https://kicksonar.com').replace(/\/+$/, '');
const KEY = '8b7f1f0d4c2a4e7f9d6c3b2a1e0f5d8c';
const HOST = new URL(SITE).host;
const KEY_LOCATION = `${SITE}/${KEY}.txt`;
const BATCH = 10000; // IndexNow accepts up to 10,000 URLs per request.

async function locsFrom(path) {
  const res = await fetch(`${SITE}${path}`);
  if (!res.ok) throw new Error(`GET ${path} -> HTTP ${res.status}`);
  const xml = await res.text();
  return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1].trim());
}

async function submit(urlList) {
  let ok = 0;
  for (let i = 0; i < urlList.length; i += BATCH) {
    const batch = urlList.slice(i, i + BATCH);
    const res = await fetch('https://api.indexnow.org/indexnow', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json; charset=utf-8' },
      body: JSON.stringify({ host: HOST, key: KEY, keyLocation: KEY_LOCATION, urlList: batch }),
    });
    // IndexNow returns 200 (accepted) or 202 (accepted, pending validation).
    console.log(`  batch ${i / BATCH + 1}: ${batch.length} urls -> HTTP ${res.status}`);
    if (res.ok) ok += batch.length;
    else console.warn(`  response: ${await res.text()}`);
  }
  return ok;
}

async function main() {
  const includeAll = process.argv.includes('--all-projects');
  console.log(`IndexNow -> host=${HOST}, key file=${KEY_LOCATION}`);

  // Key pages live in sitemap chunk 0 (home + static + category + country pages).
  let urls = await locsFrom('/sitemap/0.xml');

  if (includeAll) {
    const childSitemaps = (await locsFrom('/sitemap_index.xml')).filter((u) =>
      /\/sitemap\/[1-9]\d*\.xml$/.test(u),
    );
    for (const c of childSitemaps) {
      const path = new URL(c).pathname;
      const part = await locsFrom(path);
      console.log(`  + ${path}: ${part.length} project urls`);
      urls = urls.concat(part);
    }
  }

  // De-dupe just in case.
  urls = [...new Set(urls)];
  console.log(`Submitting ${urls.length} url(s)...`);
  const ok = await submit(urls);
  console.log(`Done. Accepted ${ok}/${urls.length}.`);
}

main().catch((e) => {
  console.error('IndexNow failed:', e.message);
  process.exit(1);
});
