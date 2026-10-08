// Vercel serverless function: /api/game?id=<gamePk>
// Returns live game detail from the NHL API: scores, period info, goal list
// with scorers, assists, time, strength, highlight URLs.

const NHL_API_HOST = 'api-web.nhle.com';
const NHL_TIMEOUT_MS = 12000;

const fetchGameLanding = async (gameId) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), NHL_TIMEOUT_MS);
  try {
    const response = await fetch(`https://${NHL_API_HOST}/v1/gamecenter/${gameId}/landing`, {
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

  const gameId = req.query && req.query.id;
  if (!gameId || !/^\d{6,12}$/.test(gameId)) {
    return res.status(400).json({
      error: 'Missing or invalid game id. Use: /api/game?id=2026020056'
    });
  }

  try {
    const data = await fetchGameLanding(gameId);

    // Slim down the response - we only need a subset of fields.
    const away = data.awayTeam || {};
    const home = data.homeTeam || {};
    const summary = data.summary || {};
    const scoring = Array.isArray(summary.scoring) ? summary.scoring : [];

    // Flatten scoring into a single goals array
    const goals = [];
    for (const periodScoring of scoring) {
      const pd = periodScoring.periodDescriptor || {};
      if (!Array.isArray(periodScoring.goals)) continue;
      for (const g of periodScoring.goals) {
        goals.push({
          period: pd.number || null,
          periodType: pd.periodType || null,
          timeInPeriod: g.timeInPeriod || null,
          strength: g.strength || null,           // 'ev' | 'pp' | 'sh' | 'en'
          team: (g.teamAbbrev && g.teamAbbrev.default) || null,
          scorer: (g.name && g.name.default) || ((g.firstName && g.firstName.default) + ' ' + (g.lastName && g.lastName.default)),
          scorerId: g.playerId || null,
          goalsToDate: g.goalsToDate || 0,
          assists: (g.assists || []).map(a => ({
            name: (a.name && a.name.default) || ((a.firstName && a.firstName.default) + ' ' + (a.lastName && a.lastName.default)),
            assistsToDate: a.assistsToDate || 0,
            sweaterNumber: a.sweaterNumber || null,
          })),
          awayScore: g.awayScore,
          homeScore: g.homeScore,
          leadingTeam: (g.leadingTeamAbbrev && g.leadingTeamAbbrev.default) || null,
          highlightUrl: g.highlightClipSharingUrl || null,
        });
      }
    }

    return res.status(200).json({
      gamePk: data.id,
      gameState: data.gameState || null,                    // 'LIVE' | 'OFF' | 'FUT' | 'PRE' | 'CRIT'
      gameScheduleState: data.gameScheduleState || null,
      startTimeUTC: data.startTimeUTC || null,
      venue: (data.venue && data.venue.default) || null,
      periodDescriptor: data.periodDescriptor || null,     // current period
      clock: data.clock || null,
      awayTeam: {
        abbrev: away.abbrev,
        name: (away.commonName && away.commonName.default) || (away.placeName && away.placeName.default) || null,
        score: away.score !== undefined ? away.score : null,
        sog: away.sog !== undefined ? away.sog : null,
      },
      homeTeam: {
        abbrev: home.abbrev,
        name: (home.commonName && home.commonName.default) || (home.placeName && home.placeName.default) || null,
        score: home.score !== undefined ? home.score : null,
        sog: home.sog !== undefined ? home.sog : null,
      },
      goals: goals,
    });
  } catch (err) {
    const msg = (err && err.message) || String(err);
    return res.status(502).json({
      error: `Could not reach the NHL API for game ${gameId}. (${msg})`
    });
  }
};
