# NHL Calendar 2026-27

A free, no-login NHL calendar PWA: every game of the 2026-27 season on a real
calendar grid, with live scores, favorite teams, and a sortable standings tab.
Hosted on Vercel, data straight from the NHL's public web API — no ads, no
trackers, no mock data.

Live site: **https://nhl-calendar26-27.vercel.app**

## Features

- **Month view** — desktop-style calendar grid with team-colored game pills,
  home/away layout, and live in-game updates (scores, period and clock badges)
  that refresh adaptively every 15 s while a favorite team is live, else 30 s.
- **Week view** — day cards for a rolling week, centered on today.
- **My Teams view** — your favorited teams' games for the displayed month, plus
  a next-game countdown in the header and gold highlights everywhere favorites
  appear.
- **Standings tab** — League / By Division / Wild Card tables from the NHL's
  live standings, sortable by every stat column, with the sorting header and
  grouping buttons pinned below the sticky page header. Wild-card spots are
  labeled, favorite teams glow gold, official rank always visible.
- **On load** — the page opens at the top of **today's cell** (calendar views)
  using the measured sticky-header height, so today's games are the first thing
  you see on every visit.
- **PWA** — installable, works offline for cached code via a network-first
  service worker (code always refreshes on deploy; only images cache hard).

## Architecture

```
nhl-calendar26-27/
├── index.html              ← single page; four views switched by header tabs
├── app.js                  ← all view logic + rendering + favorites (localStorage)
├── styles.css              ← theming; responsive down to 600px (compact dots mode)
├── sw.js                   ← service worker (network-first for code, cache-first for images)
├── manifest.webmanifest    ← PWA install metadata
├── icons/favicon.svg
├── api/
│   ├── schedule.js         ← /api/schedule?year=YYYY&month=MM (+ ?bounds=1 for season dates)
│   ├── game.js             ← /api/game?id=…    (live game detail)
│   └── standings.js        ← /api/standings     (grouped league/division/wild-card tables)
├── vercel.json             ← /api/* rewrite + no-store headers
└── README.md
```

All three serverless functions talk to `api-web.nhle.com` server-side, so the
browser never hits CORS issues, and each caches upstream responses in module
memory (schedule bounds 6 h, standings 30 min) to stay friendly to the NHL
API on Vercel's Hobby tier, without ever exposing it to the browser.

## Development

No build step, no dependencies. Any static server works:

```bash
python3 -m http.server 3000
# then open http://localhost:3000
```

`/api/*` calls need Vercel to route to the functions — test end-to-end on the
deployed preview URL, or `vercel dev` locally with the Vercel CLI.

## Deployment

Push to `main` → Vercel redeploys automatically (~60 s). Nothing to configure;
vercel.json routes `/api/*` to the serverless functions and serves the static
files from the root.

## Troubleshooting

- **Stale layout after a deploy** — the service worker is network-first for
  code, so a normal reload gets the newest version. If something is stuck,
  DevTools → Application → Service Workers → Unregister, then reload.
- **"Could not load NHL schedule / standings"** — check the Vercel Functions
  tab for logs; the NHL API occasionally hiccups, and the functions
  time out cleanly after 12 s.
- **Games from the wrong season** — the app derives official season bounds
  (`/api/schedule?bounds=1`) and gates month navigation to them; a stale
  bounds cache self-refreshes daily (localStorage TTL 24 h).

## Data

All data is fetched server-side from the NHL's public web API
(`api-web.nhle.com`). No third-party services, no API keys, no databases.
