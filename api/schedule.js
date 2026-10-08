// Vercel serverless function: /api/schedule?year=YYYY&month=MM
// Fetches NHL schedule from the official NHL stats API and returns it as JSON.
//
// Vercel Node.js runtime — works on free Hobby tier with zero config.
// File must be named `schedule.js` and live in the `api/` folder.

const NHL_API_BASE = "https://statsapi.web.nhl.com/api/v1";
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

  const start = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-01`;
  const end   = `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-31`;
  const url   = `${NHL_API_BASE}/schedule?startDate=${start}&endDate=${end}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), NHL_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: {
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
      },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      return res.status(502).json({
        error: `NHL API returned ${response.status} ${response.statusText}`
      });
    }

    const data = await response.json();
    return res.status(200).json(data);
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
