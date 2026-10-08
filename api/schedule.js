// Vercel serverless function: /api/schedule?year=YYYY&month=MM
// Fetches NHL schedule from the NEW official NHL API (api-web.nhle.com).
// The old statsapi.web.nhl.com endpoint was deprecated.
//
// Returns data in the SAME shape as the old API, so app.js doesn't need changes:
//   { dates: [ { date: "YYYY-MM-DD", games: [...] }, ... ] }

const NHL_API_BASE = "https://api-web.nhle.com";
const NHL_TIMEOUT_MS = 15000;
const USER_AGENT = "nhl-calendar-vercel-js/1.0";

module.exports = async (req, res) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Methods", "GET, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Cache-Control", "no-store");

  if (req.method === "OPTIONS") {
    return res.status(204).end();
  }

  const yearStr  = (req.query && req.query.year)  || "";
  const monthStr = (req.query && req.query.month) || "";
  const year  = parseInt(yearStr, 10);
  const month = parseInt(monthStr, 10);

  if (Number.isNaN(year) || Number.isNaN(month) ||
      month < 1 || month > 12 || year < 1900 || year > 2100) {
    return res.status(400).json({
      error: "Missing or invalid query params. Use: /api/schedule?year=2025&month=10"
    });
  }

  // Compute first and last day of the month
  const pad = (n) => String(n).padStart(2, "0");
  const startDate = `${year}-${pad(month)}-01`;
  const lastDay = new Date(year, month, 0).getDate();
  const endDate = `${year}-${pad(month)}-${pad(lastDay)}`;

  // The new NHL API takes a weekly schedule URL: /v1/schedule/YYYY-MM-DD
  // It returns 7 days starting at the given date.
  // To cover a full month, we need to call it multiple times (one per week).
  const weeksToFetch = [];
  let cur = new Date(`${startDate}T00:00:00Z`);
  const end = new Date(`${endDate}T23:59:59Z`);
  while (cur <= end) {
    const iso = cur.toISOString().slice(0, 10);
    weeksToFetch.push(iso);
    cur = new Date(cur.getTime() + 7 * 24 * 60 * 60 * 1000);
  }

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NHL_TIMEOUT_MS);

  try {
    // Fetch all weeks in parallel
    const responses = await Promise.all(
      weeksToFetch.map(async (dateStr) => {
        const url = `${NHL_API_BASE}/v1/schedule/${dateStr}`;
        const r = await fetch(url, {
          headers: { "User-Agent": USER_AGENT, "Accept": "application/json" },
          signal: controller.signal,
        });
        if (!r.ok) throw new Error(`NHL API ${r.status} for ${dateStr}`);
        return r.json();
      })
    );

    clearTimeout(timeoutId);

    // Transform new API response to OLD shape that app.js expects:
    //   { dates: [ { date: "YYYY-MM-DD", games: [...] }, ... ] }
    //
    // New API response shape:
    //   { gameWeek: [ { date: "YYYY-MM-DD", games: [...] }, ... ], ... }
    const datesMap = new Map();  // date string -> games array

    for (const data of responses) {
      if (!data || !Array.isArray(data.gameWeek)) continue;
      for (const day of data.gameWeek) {
        if (!day.date || !Array.isArray(day.games)) continue;
        // Filter to only games within our target month
        const dayDate = new Date(day.date + "T00:00:00Z");
        if (dayDate.getUTCFullYear() !== year || dayDate.getUTCMonth() + 1 !== month) continue;

        // Transform each game from new shape to old shape
        const oldShapeGames = day.games.map(g => {
          // New shape uses .awayTeam/.homeTeam/.startTimeUTC/.venue.default
          // Old shape uses .teams.away.team/.teams.home.team/.gameDate/.venue.name
          const away = g.awayTeam || {};
          const home = g.homeTeam || {};
          return {
            gameDate: g.startTimeUTC,
            venue: { name: g.venue && (g.venue.default || g.venue) || "TBD" },
            status: {
              abstractGameState: g.gameState || "Preview",
              detailedState: g.gameScheduleState || (g.gameState || "Scheduled"),
            },
            teams: {
              away: {
                team: {
                  name: away.commonName && away.commonName.default || away.name && away.name.default || away.placeName && away.placeName.default || "Unknown",
                  abbreviation: away.abbrev || "???",
                },
              },
              home: {
                team: {
                  name: home.commonName && home.commonName.default || home.name && home.name.default || home.placeName && home.placeName.default || "Unknown",
                  abbreviation: home.abbrev || "???",
                },
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

    // Build the final response, sorted by date
    const dates = Array.from(datesMap.entries())
      .sort((a, b) => a[0].localeCompare(b[0]))
      .map(([date, games]) => ({ date, games }));

    return res.status(200).json({ dates });
  } catch (err) {
    clearTimeout(timeoutId);
    const msg = err && err.name === "AbortError"
      ? "NHL API timed out after 15 seconds"
      : (err && err.message) || String(err);
    return res.status(502).json({
      error: `Could not reach the NHL API. (${msg})`
    });
  }
};
