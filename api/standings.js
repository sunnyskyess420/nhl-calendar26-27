// Vercel serverless function: /api/standings
// Returns normalized NHL standings for the Standings tab, grouped for
// League / by Division / Wild Card views. Data comes from the same
// api-web.nhle.com host as /api/schedule, so no new upstream dependency.
//
// Caching: standings only change when games finish; upstream is fetched at
// most once per TTL and served from module memory in between (same pattern
// as the season-bounds cache in schedule.js).

const NHL_API_HOST = 'api-web.nhle.com';
const STANDINGS_TTL_MS = 30 * 60 * 1000; // 30 min
const NHL_TIMEOUT_MS = 12000;

let _standingsCache = null;
let _standingsCacheAt = 0;

// Same fetch style as api/schedule.js: fetch with timeout, clear error on
// non-OK. Vercel Hobby-tier friendly (no streaming, simple single request).
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

// Flattens one upstream team entry into the fields the front-end table uses.
function normalizeTeam(s) {
    return {
        seasonId: s.seasonId || null,
        abbrev: (s.teamAbbrev && s.teamAbbrev.default) || '',
        name: (s.teamName && s.teamName.default) || '',
        division: s.divisionName || '',
        conference: s.conferenceName || '',
        gamesPlayed: s.gamesPlayed || 0,
        wins: s.wins || 0,
        losses: s.losses || 0,
        otLosses: s.otLosses || 0,
        points: s.points || 0,
        regulationWins: s.regulationWins || 0, // NHL's first tiebreak
        goalFor: s.goalFor || 0,
        goalAgainst: s.goalAgainst || 0,
        goalDifferential: s.goalDifferential || 0,
        // e.g. 'W'/'L'/'O' with streakCount; O = OT loss (NHL shows 'OT')
        streakCode: s.streakCode || '',
        streakCount: s.streakCount || 0,
        last10: `${s.l10Wins || 0}-${s.l10Losses || 0}-${s.l10OtLosses || 0}`,
        // Sequences from the API that encode each view's ranking:
        leagueSequence: s.leagueSequence || 0,
        divisionSequence: s.divisionSequence || 0,
        conferenceSequence: s.conferenceSequence || 0,
        // 0 = division top-3 leader; 1 & 2 = the two wild-card spots; 3+ = rest
        wildcardSequence: s.wildcardSequence || 0,
    };
}

async function loadStandings() {
    if (_standingsCache && (Date.now() - _standingsCacheAt) < STANDINGS_TTL_MS) {
        return _standingsCache;
    }

    const data = await fetchHttps('/v1/standings/now');
    if (!data || !Array.isArray(data.standings) || data.standings.length === 0) {
        throw new Error('no standings data returned by NHL API');
    }

    const teams = data.standings.map(normalizeTeam);

    // League table: API's leagueSequence = overall points ranking.
    const league = [...teams].sort((a, b) => a.leagueSequence - b.leagueSequence);

    // Divisions: each division in its own ranked list.
    const divisions = {};
    for (const team of teams) {
        (divisions[team.division] = divisions[team.division] || []).push(team);
    }
    for (const dv of Object.keys(divisions)) {
        divisions[dv].sort((a, b) => a.divisionSequence - b.divisionSequence);
    }

    // Wild card: per conference, ranked by wildcardSequence. Teams with
    // sequence 0 are the division leaders that rebuild the top of the view;
    // 1 & 2 hold the actual WC spots. Mark both so the UI can label them.
    const wildcards = {};
    for (const team of teams) {
        (wildcards[team.conference] = wildcards[team.conference] || []).push(team);
    }
    for (const conf of Object.keys(wildcards)) {
        wildcards[conf].sort((a, b) => a.wildcardSequence - b.wildcardSequence);
        for (const team of wildcards[conf]) {
            team.inWildcardSpot = team.wildcardSequence === 1 || team.wildcardSequence === 2;
        }
    }

    _standingsCache = {
        fetchedAt: new Date().toISOString(),
        standingsDateTimeUtc: data.standingsDateTimeUtc || null,
        seasonId: teams[0].seasonId || null,
        league,
        divisions,
        wildcards,
    };
    _standingsCacheAt = Date.now();
    return _standingsCache;
}

module.exports = async (req, res) => {
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET, OPTIONS');
    res.setHeader('Cache-Control', 'no-store');

    if (req.method === 'OPTIONS') return res.status(200).end();
    if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' });

    try {
        const payload = await loadStandings();
        return res.status(200).json(payload);
    } catch (err) {
        console.error('standings error:', err.message);
        return res.status(502).json({ error: 'Could not load NHL standings. ' + (err.message || '') });
    }
};
