// Vercel serverless function: /api/schedule?year=YYYY&month=MM
// Uses Node's https module instead of fetch — more reliable on Vercel Hobby tier.
// Fetches from the new NHL API at api-web.nhle.com.

const https = require('https');
const NHL_API_HOST = 'api-web.nhle.com';
const NHL_TIMEOUT_MS = 12000;

const fetchHttps = async (urlPath) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NHL_TIMEOUT_MS);
  try {
    const response = await fetch(`https://${NHL_API_HOST}${urlPath}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
        'User-Agent': 'nhl-calendar/1.0',
      },
      signal: controller.signal,
    });
    clearTimeout(timeout);
    if (!response.ok) {
      throw new Error(`NHL API returned ${response.status}`);
    }
    return await response.json();
  } catch (err) {
    clearTimeout(timeout);
    throw err;
  }
};

module.exports = async (req, res) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  res.setHeader('Cache-Control', 'no-store');

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const yearStr  = (req.query && req.query.year)  || '';
  const monthStr = (req.query && req.query.month) || '';
  const year  = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  if (Number.isNaN(year) || Number.isNaN(month) ||
      month < 1 || month > 12 || year < 1900 || year > 2100) {
    return res.status(400).json({
      error: 'Missing or invalid query params. Use: /api/schedule?year=2025&month=10'
    });
  }

  const pad = (n) => String(n).padStart(2, '0');
  const startDate = `${year}-${pad(month)}-01`;
  const lastDay = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const endDate = `${year}-${pad(month)}-${pad(lastDay)}`;

  // Build list of weekly start dates to fetch (covers the whole month)
  const weeksToFetch = [];
  let cur = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T23:59:59Z`);
  while (cur <= end) {
    const iso = cur.toISOString().slice(0, 10);
    weeksToFetch.push(iso);
    cur = new Date(cur.getTime() + 7 * 24 * 60 * 60 * 1000);
  }

  try {
    const responses = await Promise.all(
      weeksToFetch.map((d) => fetchHttps(`/v1/schedule/${d}`))
    );

    // Transform new API response to old shape
    const datesMap = new Map();
    for (const data of responses) {
      if (!data || !Array.isArray(data.gameWeek)) continue;
      for (const day of data.gameWeek) {
        if (!day.date || !Array.isArray(day.games)) continue;
        const dayDate = new Date(day.date + 'T00:00:00Z');
        if (dayDate.getUTCFullYear() !== year || dayDate.getUTCMonth() + 1 !== month) continue;

        const oldShapeGames = day.games.map((g) => {
          const away = g.awayTeam || {};
          const home = g.homeTeam || {};
          const awayName = (away.commonName && away.commonName.default) ||
                           (away.name && away.name.default) ||
                           (away.placeName && away.placeName.default) || 'Unknown';
          const homeName = (home.commonName && home.commonName.default) ||
                           (home.name && home.name.default) ||
                           (home.placeName && home.placeName.default) || 'Unknown';
          const venueName = (g.venue && (g.venue.default || g.venue)) || 'TBD';
          return {
            gameDate: g.startTimeUTC,
            gamePk: g.id,                               // NHL game ID for /api/game?id=...
            venue: { name: venueName },
            status: {
              abstractGameState: g.gameState || 'Preview',
              detailedState: g.gameScheduleState || (g.gameState || 'Scheduled'),
            },
            gameState: g.gameState || null,             // 'FUT' | 'PRE' | 'LIVE' | 'CRIT' | 'OFF' | 'FINAL'
            period: g.periodDescriptor || null,         // { number, periodType, maxRegulationPeriods }
            clock: g.clock || null,                    // { timeRemaining, secondsRemaining } (live games only)
            teams: {
              away: {
                team: { name: awayName, abbreviation: away.abbrev || '???' },
                score: (away.score !== undefined ? away.score : null),
                sog:   (away.sog   !== undefined ? away.sog   : null),
                logo:  away.logo   || null,
              },
              home: {
                team: { name: homeName, abbreviation: home.abbrev || '???' },
                score: (home.score !== undefined ? home.score : null),
                sog:   (home.sog   !== undefined ? home.sog   : null),
                logo:  home.logo   || null,
              },
            },
          };
        });

        if (datesMap.has(day.date)) {
          datesMap.get(day.date).push(...oldShapeGames);
        } else {
          datesMap.set(day.date, oldShapeGames);
        }
      }
    }

    const dates = Array.from(datesMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, games]) => ({ date, games }));

    return res.status(200).json({ dates });
  } catch (err) {
    const msg = (err && err.message) || String(err);
    return res.status(502).json({
      error: `Could not reach the NHL API. (${msg})`
    });
  }
};
