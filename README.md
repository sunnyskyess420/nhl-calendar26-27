# NHL Calendar — Vercel + GitHub Deployment

This version is built to live on **Vercel** (hosting) with the code on **GitHub** (version control). After deployment, you get a permanent public URL like `https://nhl-calendar.vercel.app` that works on your phone, laptop, anywhere — no Python server to run, no terminal, no nothing.

---

## What's in this folder

```
nhl-calendar-vercel/
├── index.html              ← calendar webpage
├── styles.css              ← styling
├── app.js                  ← calls /api/schedule (no more CORS proxies, no mock data)
├── sw.js                   ← service worker (cache v4 — purges any old mock data)
├── manifest.webmanifest    ← PWA install metadata
├── icons/favicon.svg
├── api/
│   └── schedule.py         ← Vercel serverless function (fetches NHL data)
├── vercel.json             ← Vercel routing config
└── README.md               ← this file
```

---

## Step 1 — Push this code to GitHub

You already have a GitHub repo: `sunnyskyess420/nhl-calendar`. The cleanest path is to put this Vercel version on a **new branch** called `vercel`, so your existing `master` branch (with the GitHub Pages setup) stays untouched.

### Option A — Use GitHub's web UI (no terminal needed)

1. Unzip this folder somewhere on your computer.
2. Go to your repo: https://github.com/sunnyskyess420/nhl-calendar
3. Click the branch dropdown (top-left, says `master`) → type `vercel` → click "Create branch: vercel".
4. Now you're on the `vercel` branch. For each file in this folder:
   - Click **Add file** → **Upload files**
   - Drag the file(s) in
   - Click **Commit changes**
   - Repeat until all files are uploaded
5. For the `api/` folder: GitHub will create it automatically when you upload `schedule.py` with the path `api/schedule.py` — when uploading, click "Upload files" then in the filename field prefix it with `api/`.

### Option B — Use git on your computer (faster if you've done it before)

```bash
cd nhl-calendar
git checkout -b vercel
# delete the old docs/ folder contents (we're restructuring)
rm -rf docs
# copy all files from this unzipped folder into the repo root
# (index.html, styles.css, app.js, sw.js, manifest.webmanifest,
#  icons/, api/, vercel.json, README.md)
git add .
git commit -m "Restructure for Vercel deployment"
git push -u origin vercel
```

---

## Step 2 — Connect Vercel

1. Go to https://vercel.com and sign in with your **GitHub account** (one click — no credit card needed; free tier is plenty).

2. Click **"Add New..."** → **"Project"**.

3. You'll see a list of your GitHub repos. Find `sunnyskyess420/nhl-calendar` and click **"Import"**.

4. On the configure page:
   - **Framework Preset:** leave as "Other" (Vercel auto-detects)
   - **Root Directory:** leave blank (defaults to repo root)
   - **Build Command:** leave blank (no build step needed)
   - **Output Directory:** leave blank
   - **Install Command:** leave blank

5. **Important:** expand the **"Advanced"** section and check that:
   - The production branch is set to **`vercel`** (the branch you just created), NOT `master`.

6. Click **"Deploy"**.

7. Wait about 60 seconds. Vercel will:
   - Pull your code from GitHub
   - Detect the `api/schedule.py` file and turn it into a serverless function
   - Serve the static files (index.html etc.) from the root
   - Give you a live URL like `https://nhl-calendar.vercel.app`

8. Click the URL. Your calendar should load with **real NHL games**.

---

## Step 3 — Test it

1. Open the Vercel URL on your phone — should work.
2. Open it on your laptop — should work.
3. Use the `<` and `>` arrows to move between months.
4. Click any game for details (date, time, venue, teams, status).

If something's wrong, see **Troubleshooting** below.

---

## How updates work from now on

Whenever you (or any AI assistant) edits a file on the `vercel` branch of your GitHub repo and pushes the change, **Vercel redeploys automatically** within about 60 seconds. You never have to touch the Vercel dashboard again.

To edit files directly on GitHub: open the repo → switch to `vercel` branch → click any file → pencil icon (✏️) → edit → commit. Vercel picks it up.

---

## Troubleshooting

### "404 Not Found" on the homepage
- You're probably on the wrong branch. In Vercel: Project Settings → Git → Production Branch, make sure it's set to `vercel`.
- Or your files didn't all upload. Check the `vercel` branch on GitHub has `index.html` at the root level (not inside `docs/`).

### Calendar loads but says "Could not load NHL schedule"
- Open browser DevTools (F12) → Console tab. Look for the error message.
- Most likely cause: the `api/schedule.py` file isn't where Vercel expects. Make sure it's at `api/schedule.py` (in a folder named `api`, file named `schedule.py`).
- Second most likely: Vercel function failed. Go to your Vercel dashboard → project → "Functions" tab → check logs.

### Calendar shows OLD games from yesterday
- Hard refresh: hold Shift + click the refresh button.
- Or: DevTools (F12) → Application tab → Service Workers → "Unregister" → refresh.
- The service worker version was bumped to `v4-vercel`, so old Devin caches should auto-clear. If not, the manual unregister above fixes it.

### PWA install doesn't work
- You need HTTPS (Vercel gives you this for free automatically).
- Try Chrome or Edge — most reliable for PWA install.
- Look for the install icon (⊕ or "Install") in the address bar.

### I want a custom domain
- Vercel dashboard → Project → Settings → Domains → add your domain.
- Free tier supports custom domains.

---

## How this differs from your original GitHub Pages version

| Thing | Before (GitHub Pages) | Now (Vercel) |
|---|---|---|
| Hosting | GitHub Pages, free | Vercel, free |
| URL | `sunnyskyess420.github.io/nhl-calendar` | `nhl-calendar.vercel.app` (or custom) |
| NHL data | Browser → CORS proxy → NHL (broken) | Browser → Vercel function → NHL (works) |
| Backend | None (all client-side, fragile) | Serverless function at `api/schedule.py` |
| Mock data | Devin added it as fallback | Removed — only real games |
| VPN issues | Broke everything | Gone — fetches happen server-side |

---

## Questions?

If anything breaks, paste the exact error message to your AI assistant along with this README. The architecture is simple enough that any AI can debug it.
