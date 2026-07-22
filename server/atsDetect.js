// --- Shared ATS lookup/verification helpers ---
// Used by both the auto-detect-on-add flow and the manual "job board" entry endpoint.

function fetchWithTimeout(url, options = {}, timeoutMs = 4000) {
  return fetch(url, { ...options, signal: AbortSignal.timeout(timeoutMs) });
}

// --- Verify: a specific slug/url either resolves on that ATS or it doesn't ---

export async function verifyGreenhouseSlug(slug) {
  try {
    const res = await fetchWithTimeout(`https://boards-api.greenhouse.io/v1/boards/${slug}/jobs?content=false`);
    if (!res.ok) return { ok: false, error: `No Greenhouse board found for "${slug}"` };
    const data = await res.json();
    if (!Array.isArray(data.jobs)) return { ok: false, error: `Unexpected response from Greenhouse for "${slug}"` };
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach Greenhouse' };
  }
}

export async function verifyAshbySlug(slug) {
  try {
    const res = await fetchWithTimeout('https://jobs.ashbyhq.com/api/non-user-graphql?op=ApiJobBoardWithTeams', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        operationName: 'ApiJobBoardWithTeams',
        variables: { organizationHostedJobsPageName: slug },
        query: `query ApiJobBoardWithTeams($organizationHostedJobsPageName: String!) {
          jobBoard: jobBoardWithTeams(organizationHostedJobsPageName: $organizationHostedJobsPageName) {
            teams { id name }
            jobPostings { id title teamId locationName }
          }
        }`,
      }),
    });
    if (!res.ok) return { ok: false, error: `No Ashby board found for "${slug}"` };
    const data = await res.json();
    if (!data?.data?.jobBoard) return { ok: false, error: `No Ashby board found for "${slug}"` };
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach Ashby' };
  }
}

export async function verifyLeverSlug(slug) {
  try {
    const res = await fetchWithTimeout(`https://api.lever.co/v0/postings/${slug}?mode=json`);
    if (!res.ok) return { ok: false, error: `No Lever board found for "${slug}"` };
    const data = await res.json();
    if (!Array.isArray(data)) return { ok: false, error: `Unexpected response from Lever for "${slug}"` };
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach Lever' };
  }
}

// --- Workday URL parsing ---
// Public careers URL looks like: https://{tenant}.wd{shard}.myworkdayjobs.com/{sitePath...}
// The CXS JSON API lives at:     https://{tenant}.wd{shard}.myworkdayjobs.com/wday/cxs/{tenant}/{sitePath}/jobs

export function parseWorkdayUrl(url) {
  try {
    const u = new URL(url);
    const match = u.hostname.match(/^([a-z0-9-]+)\.wd(\d+)\.myworkdayjobs\.com$/i);
    if (!match) return null;
    const segments = u.pathname.replace(/^\/+|\/+$/g, '').split('/').filter(Boolean);
    if (!segments.length) return null;
    // The public careers URL often includes a locale prefix (e.g. "en-US") that the
    // CXS JSON API does not — the API path is just the site name.
    if (segments.length > 1 && /^[a-z]{2}-[A-Z]{2}$/.test(segments[0])) {
      segments.shift();
    }
    const sitePath = segments.join('/');
    if (!sitePath) return null;
    return { tenant: match[1], shard: match[2], sitePath };
  } catch {
    return null;
  }
}

export function workdayCxsUrl({ tenant, shard, sitePath }) {
  return `https://${tenant}.wd${shard}.myworkdayjobs.com/wday/cxs/${tenant}/${sitePath}/jobs`;
}

export function extractWorkdayReqId(externalPath) {
  if (!externalPath) return null;
  const match = externalPath.match(/_([A-Za-z0-9-]+)$/);
  if (match) return match[1];
  // Fallback: no recognizable trailing requisition token — derive a stable-ish id from the path itself
  let hash = 0;
  for (let i = 0; i < externalPath.length; i++) {
    hash = (hash * 31 + externalPath.charCodeAt(i)) | 0;
  }
  return `h${Math.abs(hash)}`;
}

export async function verifyWorkdayUrl(url) {
  const parsed = parseWorkdayUrl(url);
  if (!parsed) return { ok: false, error: 'Not a recognizable Workday careers URL (expected https://{tenant}.wd{N}.myworkdayjobs.com/{site})' };
  try {
    const res = await fetchWithTimeout(workdayCxsUrl(parsed), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ appliedFacets: {}, limit: 1, offset: 0, searchText: '' }),
    });
    if (!res.ok) return { ok: false, error: 'No Workday board found at that URL' };
    const data = await res.json();
    if (typeof data.total !== 'number' || !Array.isArray(data.jobPostings)) {
      return { ok: false, error: 'No Workday board found at that URL' };
    }
    return { ok: true };
  } catch {
    return { ok: false, error: 'Could not reach Workday' };
  }
}

// --- Normalize user-pasted values (people paste full URLs, not bare slugs) ---

export function normalizeSourceInput(source, value) {
  const trimmed = value.trim();
  if (source === 'workday') return trimmed;
  const stripPrefixes = {
    greenhouse: /^https?:\/\/(www\.)?boards\.greenhouse\.io\//i,
    ashby: /^https?:\/\/(www\.)?jobs\.ashbyhq\.com\//i,
    lever: /^https?:\/\/(www\.)?jobs\.lever\.co\//i,
  };
  const prefix = stripPrefixes[source];
  let slug = prefix ? trimmed.replace(prefix, '') : trimmed;
  slug = slug.split('/')[0].split('?')[0];
  return slug;
}

// --- Candidate slug generation from a company name ---

function slugifyNoSeparator(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '');
}

function slugifyHyphenated(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

function candidateSlugsFromName(name) {
  const stripped = name.replace(/\b(inc|corp|corporation|llc|ltd|co)\.?$/i, '').trim();
  const bases = [...new Set([name, stripped])];
  const out = new Set();
  for (const b of bases) {
    out.add(slugifyNoSeparator(b));
    out.add(slugifyHyphenated(b));
  }
  return [...out].filter(Boolean);
}

// --- Detect: guess candidate slugs for a company name, return the first that verifies ---

export async function detectGreenhouse(name) {
  for (const slug of candidateSlugsFromName(name)) {
    const { ok } = await verifyGreenhouseSlug(slug);
    if (ok) return { found: true, slug };
  }
  return { found: false };
}

export async function detectAshby(name) {
  for (const slug of candidateSlugsFromName(name)) {
    const { ok } = await verifyAshbySlug(slug);
    if (ok) return { found: true, slug };
  }
  return { found: false };
}

export async function detectLever(name) {
  for (const slug of candidateSlugsFromName(name)) {
    const { ok } = await verifyLeverSlug(slug);
    if (ok) return { found: true, slug };
  }
  return { found: false };
}

const WORKDAY_SHARDS = ['wd1', 'wd3', 'wd5', 'wd2', 'wd10'];
const WORKDAY_SITE_PATHS = ['External', 'Careers', 'en-US/External', 'en-US/Careers'];

export async function detectWorkday(name) {
  const [tenant] = candidateSlugsFromName(name);
  if (!tenant) return { found: false };

  const combos = [];
  for (const shard of WORKDAY_SHARDS) {
    for (const sitePath of WORKDAY_SITE_PATHS) {
      combos.push({ shard, sitePath });
    }
  }

  const results = await Promise.allSettled(
    combos.map(({ shard, sitePath }) => verifyWorkdayUrl(`https://${tenant}.${shard}.myworkdayjobs.com/${sitePath}`))
  );

  const hitIndex = results.findIndex((r) => r.status === 'fulfilled' && r.value.ok);
  if (hitIndex === -1) return { found: false };

  const { shard, sitePath } = combos[hitIndex];
  return { found: true, url: `https://${tenant}.${shard}.myworkdayjobs.com/${sitePath}` };
}

export async function detectAtsForCompany(name) {
  const [greenhouse, ashby, lever, workday] = await Promise.all([
    detectGreenhouse(name),
    detectAshby(name),
    detectLever(name),
    detectWorkday(name),
  ]);
  return { greenhouse, ashby, lever, workday };
}
