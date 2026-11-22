const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
const formatter = new Intl.DateTimeFormat('en-GB', {
  timeZone: 'Europe/London', year: 'numeric', month: 'numeric', day: 'numeric'
});
const json = (data, status = 200) => Response.json(data, {
  status, headers: { 'Cache-Control': 'no-store' }
});
const error = (message, status) => json({ error: message }, status);

function dateParts(now) {
  return Object.fromEntries(formatter.formatToParts(now).map(p => [p.type, Number(p.value)]));
}

export function availableThrough(year, now) {
  const date = dateParts(now);
  if (date.year > year) return 24;
  if (date.year < year || date.month !== 12) return 0;
  return Math.min(date.day, 24);
}

export function canonicalTrack(value) {
  if (typeof value !== 'string' || value.length > 500) return null;
  try {
    const url = new URL(value.trim());
    const track = /^\/(?:intl-[a-z-]+\/)?track\/([A-Za-z0-9]{22})\/?$/.exec(url.pathname);
    if (url.origin === 'https://open.spotify.com' && !url.username && !url.password && track) {
      return 'https://open.spotify.com/track/' + track[1];
    }
  } catch {
    // The form displays the invalid slot.
  }
  return null;
}

function shareCode() {
  let code = '';
  while (code.length < 6) {
    for (const byte of crypto.getRandomValues(new Uint8Array(6))) {
      if (byte < 252) code += alphabet[byte % alphabet.length];
      if (code.length === 6) break;
    }
  }
  return code;
}

async function create(request, db, now) {
  const reader = request.body?.getReader();
  if (!reader) return error('Provide 24 Spotify track links.', 400);
  let size = 0;
  let body = '';
  const decoder = new TextDecoder();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > 16000) {
      await reader.cancel();
      return error('The submitted links are too long.', 413);
    }
    body += decoder.decode(value, { stream: true });
  }
  let payload;
  try {
    payload = JSON.parse(body + decoder.decode());
  } catch {
    return error('Invalid calendar data.', 400);
  }
  if (!Array.isArray(payload?.tracks) || payload.tracks.length !== 24) {
    return error('Fill all 24 doors with Spotify track links.', 400);
  }
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  if (!title || title.length > 100) return error('Give your calendar a name of 1–100 characters.', 400);
  const tracks = payload.tracks.map(canonicalTrack);
  const invalid = tracks.indexOf(null);
  if (invalid !== -1) return error('Door ' + (invalid + 1) + ' needs a Spotify song link.', 400);

  const date = dateParts(now);
  const year = date.year + Number(date.month === 12 && date.day > 24);
  for (let attempt = 0; attempt < 5; attempt++) {
    const code = shareCode();
    const result = await db.prepare('INSERT INTO calendars (code, year, tracks, title) VALUES (?, ?, ?, ?) ON CONFLICT(code) DO NOTHING')
      .bind(code, year, JSON.stringify(tracks), title).run();
    if (result.meta.changes === 1) return json({ code, year }, 201);
  }
  return error('Could not assign a code. Try again.', 503);
}

async function spotifyDetails(url) {
  try {
    const api = new URL('https://open.spotify.com/oembed');
    api.searchParams.set('url', url);
    const response = await fetch(api, { signal: AbortSignal.timeout(4500) });
    if (!response.ok) return {};
    const data = await response.json();
    let cover = null;
    if (typeof data.thumbnail_url === 'string') {
      const image = new URL(data.thumbnail_url);
      if (image.protocol === 'https:' && (image.hostname.endsWith('.scdn.co') || image.hostname.endsWith('.spotifycdn.com'))) cover = image.href;
    }
    return { title: typeof data.title === 'string' ? data.title : null, cover };
  } catch {
    return {};
  }
}

async function reportCalendarCount(env) {
  if (!env.DISCORD_WEBHOOK_URL) return;
  const row = await env.DB.prepare('SELECT COUNT(*) AS total FROM calendars').first();
  const total = Number(row.total);
  const previous = await env.DB.prepare('SELECT last_count FROM calendar_monitor WHERE id = 1').first();
  if (!previous) {
    await env.DB.prepare('INSERT INTO calendar_monitor (id, last_count) VALUES (1, ?) ON CONFLICT(id) DO NOTHING').bind(total).run();
    return;
  }
  const lastCount = Number(previous.last_count);
  if (total === lastCount) return;
  const change = total - lastCount;
  const webhook = new URL(env.DISCORD_WEBHOOK_URL);
  webhook.searchParams.set('wait', 'true');
  const response = await fetch(webhook, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      content: '🎵 Spotify advent calendars created: **' + total + '** (' + (change > 0 ? '+' : '') + change + ' since the last update).',
      allowed_mentions: { parse: [] }
    }),
    signal: AbortSignal.timeout(15000)
  });
  if (!response.ok) throw new Error('Discord calendar count delivery failed: ' + response.status);
  await env.DB.prepare('UPDATE calendar_monitor SET last_count = ? WHERE id = 1').bind(total).run();
}

export default {
  async scheduled(event, env, ctx) {
    ctx.waitUntil(reportCalendarCount(env));
  },
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (!path.startsWith('/api/')) return env.ASSETS.fetch(request);
    const origin = request.headers.get('Origin');
    const ownOrigin = new URL(request.url).origin;
    const external = origin && origin !== ownOrigin;
    if (external && origin !== env.PAGES_ORIGIN) return error('Site origin is not allowed.', 403);
    const cors = new Headers({ Vary: 'Origin' });
    if (external) cors.set('Access-Control-Allow-Origin', origin);
    if (request.method === 'OPTIONS') {
      cors.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
      cors.set('Access-Control-Allow-Headers', 'Content-Type');
      return new Response(null, { status: 204, headers: cors });
    }
    if (request.method === 'POST' && !origin) return error('Open the calendar site to create a calendar.', 403);
    const response = await route(request, env, path);
    const headers = new Headers(response.headers);
    for (const [name, value] of cors) headers.set(name, value);
    return new Response(response.body, { status: response.status, headers });
  }
};

async function route(request, env, path) {
    const now = new Date();
    try {
      if (request.method === 'POST' && path === '/api/calendars') return await create(request, env.DB, now);
      const match = /^\/api\/calendars\/([A-Z0-9]{6})(?:\/(?:doors\/([1-9]|1[0-9]|2[0-4])|(finale)))?$/.exec(path);
      if (!match || request.method !== 'GET') return error('Page not found.', 404);
      const [, code, door, finale] = match;
      const row = await env.DB.prepare((door || finale)
        ? 'SELECT year, tracks, title FROM calendars WHERE code = ?'
        : 'SELECT year, title FROM calendars WHERE code = ?').bind(code).first();
      if (!row) return error('Calendar code not found.', 404);
      const available = env.PREVIEW_MODE === 'true'
        ? 24
        : availableThrough(row.year, now);
      if (finale) {
        if (available < 24) return error('Your full playlist unlocks on December 24.', 403);
        return json({ title: row.title, tracks: JSON.parse(row.tracks) });
      }
      if (!door) return json({ code, title: row.title, year: row.year, available, preview: env.PREVIEW_MODE === 'true' });
      if (Number(door) > available) return error('This door is still locked.', 403);
      const url = JSON.parse(row.tracks)[Number(door) - 1];
      return json({ url, ...(await spotifyDetails(url)) });
    } catch {
      return error('The calendar service is temporarily unavailable. Try again.', 503);
    }
}
