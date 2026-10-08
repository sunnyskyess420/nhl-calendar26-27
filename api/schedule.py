"""
Vercel serverless function: /api/schedule?year=YYYY&month=MM
Fetches NHL schedule from the official NHL stats API and returns it as JSON.

Vercel Python runtime expects a module with a `handler` class extending
BaseHTTPRequestHandler. Each cold invocation creates a fresh instance, so
we can't cache in memory — every request hits the NHL API. NHL API is fast
and rate-limit-friendly, so this is fine.
"""
from http.server import BaseHTTPRequestHandler
import urllib.request
import urllib.parse
import urllib.error
import json

NHL_API_BASE = "https://statsapi.web.nhl.com/api/v1"
NHL_TIMEOUT_SECONDS = 15
USER_AGENT = "nhl-calendar-vercel/1.0"


def fetch_nhl_schedule(year: int, month: int) -> dict:
    """Fetch one month of NHL schedule. Raises on network/HTTP errors."""
    start = f"{year:04d}-{month:02d}-01"
    end   = f"{year:04d}-{month:02d}-31"
    url   = f"{NHL_API_BASE}/schedule?startDate={start}&endDate={end}"

    req = urllib.request.Request(url, headers={
        "User-Agent": USER_AGENT,
        "Accept": "application/json",
    })
    with urllib.request.urlopen(req, timeout=NHL_TIMEOUT_SECONDS) as resp:
        raw = resp.read().decode("utf-8")
        return json.loads(raw)


class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        # Parse query string
        parsed = urllib.parse.urlparse(self.path)
        query = urllib.parse.parse_qs(parsed.query)

        try:
            year_str  = query.get("year",  [""])[0]
            month_str = query.get("month", [""])[0]
            year  = int(year_str)
            month = int(month_str)
            if not (1 <= month <= 12) or not (1900 <= year <= 2100):
                return self._send_json(
                    {"error": "year and month must be valid integers (1-12 / 1900-2100)."},
                    status=400,
                )
        except ValueError:
            return self._send_json(
                {"error": "Missing or invalid query params. Use: /api/schedule?year=2025&month=10"},
                status=400,
            )

        try:
            data = fetch_nhl_schedule(year, month)
            self._send_json(data)
        except urllib.error.URLError as e:
            reason = getattr(e, "reason", str(e))
            self._send_json(
                {"error": f"Could not reach the NHL API. ({reason})"},
                status=502,
            )
        except Exception as e:
            self._send_json(
                {"error": f"Server error: {type(e).__name__}: {e}"},
                status=500,
            )

    def do_OPTIONS(self):
        """Handle CORS preflight (only needed if calling cross-origin)."""
        self.send_response(204)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    def _send_json(self, obj: dict, status: int = 200):
        body = json.dumps(obj).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self.send_header("Cache-Control", "no-store")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.end_headers()
        try:
            self.wfile.write(body)
        except BrokenPipeError:
            pass

    def log_message(self, fmt, *args):
        # Silence default logging — Vercel captures it separately
        pass
