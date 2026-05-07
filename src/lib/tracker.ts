import { getDueProjects, getProjectById } from './db';
import { buildKSJsonUrl, scrapeAndStore } from './scraper';

let started = false;

export function initTracker() {
  if (started || typeof window !== 'undefined') return;
  started = true;
  // Delay 10s on startup so the server finishes booting, then poll every 5min
  setTimeout(() => {
    runCycle();
    setInterval(runCycle, 5 * 60 * 1000);
  }, 10_000);
}

async function runCycle() {
  try {
    const due = getDueProjects();
    if (!due.length) return;
    console.log(`[tracker] ${due.length} project(s) due for scraping`);
    for (const { project_id, track_rewards, track_comments, track_text_diff } of due) {
      const project = await getProjectById(project_id) as { source_url?: string } | null;
      if (!project) continue;
      const jsonUrl = buildKSJsonUrl(project.source_url ?? '');
      if (!jsonUrl) continue;
      await scrapeAndStore(project_id, jsonUrl, { track_rewards, track_comments, track_text_diff });
      // Small delay between requests to be polite
      await sleep(500);
    }
  } catch (e) {
    console.error('[tracker] cycle error:', e);
  }
}

function sleep(ms: number) {
  return new Promise(resolve => setTimeout(resolve, ms));
}
