// NHL Calendar PWA
// Fetches NHL schedule from our Vercel serverless function at /api/schedule
// (no more CORS proxies, no more mock data — real games only)

let currentDate = new Date();
let gamesData = [];
let currentView = 'month';             // 'month' or 'week'
let currentWeekStart = null;            // Date (first day of displayed week) when in week view
// ============================================================================
// Season bounds - derived from live NHL schedule data (see initSeasonBounds).
//
// The values below are the OFFICIAL 2026-27 dates and act as an instant
// fallback so the calendar works before (or without) the bounds fetch.
// They are replaced at runtime by /api/schedule?bounds=1, which returns the
// season dates published by the NHL (regularSeasonStartDate / playoffEndDate),
// cached for 24h in localStorage. Never hardcode new dates elsewhere -
// navigation limits, week-view guards and messages all read these variables.
// ============================================================================
let seasonStart = new Date(2026, 8, 29);  // Sep 29, 2026 - regular season start
let seasonEnd   = new Date(2027, 5, 10);  // Jun 10, 2027 - playoff end date
let seasonLabel = '2026-27';              // human-readable label for messages

// NHL team brand colors keyed by 3-letter abbreviation.
// Used to color the calendar game pills: pill background = away team color,
// left border accent = home team color.
//
// For teams whose primary color is black (BOS, PIT, ANA, LAK, NJD), we use
// the most recognizable secondary color (gold, orange, silver, etc.) so the
// pill backgrounds remain visible on the dark site background.
const TEAM_COLORS = {
    // Atlantic Division
    BOS: '#FFB81C', // gold (black is primary)
    BUF: '#0048C0', // royal blue
    DET: '#CE1126', // red
    FLA: '#C8102E', // red
    MTL: '#AF1E2D', // red
    OTT: '#C52032', // red
    TBL: '#002868', // blue
    TOR: '#00205B', // blue
    // Metropolitan Division
    CAR: '#CC0000', // red
    CBJ: '#002654', // navy blue
    NJD: '#CE1126', // red
    NYI: '#00539B', // blue
    NYR: '#0038A8', // blue
    PHI: '#F74902', // orange
    PIT: '#FCB514', // gold (black is primary)
    WSH: '#C8102E', // red
    // Central Division
    ARI: '#8C2633', // brick red
    CHI: '#CF0A2C', // red
    COL: '#6F263D', // burgundy
    DAL: '#006847', // victory green
    MIN: '#154734', // forest green
    NSH: '#FFB81C', // gold
    STL: '#002F87', // blue
    UTA: '#71AFE5', // salt blue (new expansion team)
    // Pacific Division
    ANA: '#F47A38', // orange (black is primary)
    CGY: '#C8102E', // red
    EDM: '#FF4C00', // orange
    LAK: '#A2AAAD', // silver (black is primary)
    SJS: '#006D75', // teal
    SEA: '#99D9D9', // ice blue
    VAN: '#00205B', // blue
    VGK: '#B4975A', // gold
};

// Convert a hex color (#RRGGBB or #RGB) to an rgba() string with the given
// alpha. Returns null if the input is invalid (caller can fall back).
function hexToRgba(hex, alpha) {
    if (!hex || typeof hex !== 'string') return null;
    let h = hex.replace('#', '').trim();
    if (h.length === 3) {
        // Expand shorthand: #abc -> #aabbcc
        h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
    }
    if (h.length !== 6) return null;
    const r = parseInt(h.substring(0, 2), 16);
    const g = parseInt(h.substring(2, 4), 16);
    const b = parseInt(h.substring(4, 6), 16);
    if (isNaN(r) || isNaN(g) || isNaN(b)) return null;
    return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

// Helper: check whether a date's MONTH overlaps the season interval
// (month granularity). The season starts mid-month (e.g. Sep 29), so we
// compare month spans, not just first-of-month - otherwise September's
// opening games would be unreachable.
function isInSeason(date) {
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  const lastOfMonth = new Date(date.getFullYear(), date.getMonth() + 1, 0);
  return firstOfMonth <= seasonEnd && lastOfMonth >= seasonStart;
}

// ============================================================================
// Season bounds derivation (data-driven, replaces hardcoded constants)
// ============================================================================

const SEASON_BOUNDS_KEY = 'nhl-calendar-season-bounds';  // localStorage key
const SEASON_BOUNDS_TTL = 24 * 60 * 60 * 1000;           // refresh once a day

// Apply a bounds object from the API (or cache). Returns true if valid.
// Expected shape: { regularSeasonStartDate, playoffEndDate, label, ... }
function applySeasonBounds(b) {
  if (!b || !b.regularSeasonStartDate || !b.playoffEndDate) return false;
  const s = new Date(b.regularSeasonStartDate + 'T00:00:00');
  const e = new Date(b.playoffEndDate + 'T23:59:59');
  if (isNaN(s.getTime()) || isNaN(e.getTime()) || s >= e) return false;
  seasonStart = s;
  seasonEnd = e;
  if (b.label) seasonLabel = b.label;
  return true;
}

// Re-sync navigation state after bounds change, and retry the current view
// if it previously errored because it looked out of season (e.g. September,
// which the old Oct 1 fallback blocked but the real season covers).
function refreshNavAfterBoundsChange() {
  updateNavButtons();
  if (currentView === 'week') updateWeekNavButtons();
  const errorEl = document.getElementById('error');
  const errorVisible = errorEl && !errorEl.classList.contains('hidden');
  if (errorVisible && isInSeason(currentDate)) {
    loadSchedule(currentDate);
  }
}

// Load season bounds: 1) localStorage cache (<24h old), else 2) live fetch
// from /api/schedule?bounds=1 (NHL-published season dates, server-cached 6h).
// On failure the built-in fallback dates stay active - never fatal.
async function initSeasonBounds() {
  // 1. Fresh cache?
  try {
    const raw = localStorage.getItem(SEASON_BOUNDS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && parsed.bounds && (Date.now() - parsed.at) < SEASON_BOUNDS_TTL) {
        if (applySeasonBounds(parsed.bounds)) {
          refreshNavAfterBoundsChange();
          return;
        }
      }
    }
  } catch (_) { /* corrupted cache - fall through to fetch */ }

  // 2. Fetch from our API (which reads the NHL's own published dates).
  try {
    const r = await fetch('/api/schedule?bounds=1');
    if (!r.ok) return;
    const data = await r.json();
    if (data && data.bounds && applySeasonBounds(data.bounds)) {
      try {
        localStorage.setItem(SEASON_BOUNDS_KEY, JSON.stringify({ bounds: data.bounds, at: Date.now() }));
      } catch (_) { /* storage full/blocked - bounds still active in memory */ }
      refreshNavAfterBoundsChange();
    }
  } catch (err) {
    console.warn('Season bounds fetch failed (using fallback dates):', err.message);
  }
}

// Enable/disable navigation buttons based on current month. Disabled means
// the target month does not overlap the season at all.
function updateNavButtons() {
  const prevBtn = document.getElementById('prevMonth');
  const nextBtn = document.getElementById('nextMonth');
  const prevFirst = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
  const prevLast  = new Date(currentDate.getFullYear(), currentDate.getMonth(), 0);
  const nextFirst = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
  prevBtn.disabled = prevLast < seasonStart || prevFirst > seasonEnd;
  nextBtn.disabled = nextFirst > seasonEnd;
}
document.addEventListener('DOMContentLoaded', () => {
    registerServiceWorker();
    setupEventListeners();
    loadSchedule(currentDate);
    // Derive season bounds from live NHL data (falls back to 2026-27 dates).
    initSeasonBounds();
    // Kick off the today-strip fetch + start the adaptive refresh loop
    // (15s while a favorite team's game is live, else 30s — only LIVE/PRE
    // games are refetched in detail; the schedule endpoint is cached
    // per-month, so this stays gentle on the NHL API).
    refreshTodayStrip();
    // Adaptive loop: 15s while a favorite team's game is live, else 30s.
    startStripRefreshLoop();
});

// Register service worker for PWA
async function registerServiceWorker() {
    if ('serviceWorker' in navigator) {
        try {
            // Unregister old service workers to clear any cached mock data
            const registrations = await navigator.serviceWorker.getRegistrations();
            for (const registration of registrations) {
                await registration.unregister();
            }

            // Register new service worker
            await navigator.serviceWorker.register('sw.js');
            console.log('Service Worker registered');
        } catch (error) {
            console.log('Service Worker registration failed:', error);
        }
    }
}

// Setup event listeners
function setupEventListeners() {
    document.getElementById('prevMonth').addEventListener('click', () => {
        navigateMonth(-1);
    });

    document.getElementById('nextMonth').addEventListener('click', () => {
        navigateMonth(1);
    });

    document.getElementById('closeDetails').addEventListener('click', () => {
        closeGameDetails();
    });

    // 'Jump to today' floating button - takes the user back to today's
    // date from anywhere in the calendar.
    document.getElementById('todayJump').addEventListener('click', () => {
        jumpToToday();
    });

    // Click outside the modal (on the modal's backdrop area) also closes it.
    document.getElementById('gameDetails').addEventListener('click', (e) => {
        // Only close if the click was on the modal container itself, not its children.
        if (e.target === e.currentTarget) {
            closeGameDetails();
        }
    });

    // ESC key closes the modal, then the day sheet.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('gameDetails');
            if (modal && !modal.classList.contains('hidden')) {
                closeGameDetails();
                return;
            }
            closeDaySheet();
        }
    });

    // Day sheet (compact month mode): backdrop tap + close button + swipe
    // down to dismiss (only when the panel is scrolled to the top, so
    // scrolling long sheet content never accidentally closes it).
    const daySheet = document.getElementById('daySheet');
    if (daySheet) {
        daySheet.querySelector('.day-sheet-backdrop').addEventListener('click', closeDaySheet);
        const sheetClose = document.getElementById('daySheetClose');
        if (sheetClose) sheetClose.addEventListener('click', closeDaySheet);
        const panel = daySheet.querySelector('.day-sheet-panel');
        let sheetTouch = null;
        panel.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) { sheetTouch = null; return; }
            sheetTouch = { x: e.touches[0].clientX, y: e.touches[0].clientY };
        }, { passive: true });
        panel.addEventListener('touchend', (e) => {
            if (!sheetTouch) return;
            const t = e.changedTouches[0];
            sheetTouch = null;
            if (!t) return;
            const dy = t.clientY - sheetTouch.y;
            const dx = t.clientX - sheetTouch.x;
            if (panel.scrollTop <= 0 && dy > 60 && Math.abs(dx) < Math.abs(dy)) {
                closeDaySheet();
            }
        }, { passive: true });
    }

    // View toggle tabs - switch between Month, Week and My Teams views.
    document.getElementById('viewMonth').addEventListener('click', () => setView('month'));
    document.getElementById('viewWeek').addEventListener('click', () => setView('week'));
    document.getElementById('viewMyTeams').addEventListener('click', () => setView('myteams'));

    // Re-render calendar when viewport crosses the narrow breakpoint so the
    // day-of-week labels switch between 'Sun' and 'S' as the user resizes
    // the browser or rotates their phone.
    const narrowMQ = window.matchMedia('(max-width: 600px)');
    const handleMQChange = () => {
        // Only re-render if we already have data loaded.
        if (gamesData && Object.keys(gamesData).length > 0) {
            if (currentView === 'week') renderWeekView();
            else if (currentView === 'myteams') renderMyTeamsView();
            else                          renderCalendar(currentDate);
        }
    };
    if (narrowMQ.addEventListener) {
        narrowMQ.addEventListener('change', handleMQChange);
    } else if (narrowMQ.addListener) {
        // Older Safari fallback.
        narrowMQ.addListener(handleMQChange);
    }

    // Re-fit pills to their cells whenever the viewport is resized (desktop
    // user dragging window, mobile user rotating phone, etc). Debounced
    // via requestAnimationFrame so it doesn't fire too often during a drag.
    let resizeRaf = 0;
    window.addEventListener('resize', () => {
        if (resizeRaf) cancelAnimationFrame(resizeRaf);
        resizeRaf = requestAnimationFrame(() => {
            fitPillsToCells();
            updateTodayJumpVisibility();  // viewport changed, re-check button
            resizeRaf = 0;
        });
    });

    // Re-check the 'Jump to Today' button visibility on scroll. The button
    // should appear as soon as today's cell scrolls out of view.
    window.addEventListener('scroll', handleScrollForTodayButton, { passive: true });

    // Mobile swipe: swipe left = next, swipe right = previous.
    // Works on both the month grid and the week view.
    setupSwipeNavigation();

    // Keyboard arrow keys: Left = previous, Right = next.
    // In month view this navigates months; in week view it navigates weeks.
    // Ignore when focus is in an input/textarea, or when the modal is open
    // (so arrow keys don't fight with scrolling inside the popup).
    document.addEventListener('keydown', (e) => {
        if (e.defaultPrevented) return;
        const modalOpen = !document.getElementById('gameDetails').classList.contains('hidden');
        if (modalOpen) return;
        const tag = (document.activeElement && document.activeElement.tagName) || '';
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;
        if (e.key === 'ArrowLeft')  { e.preventDefault(); navigateMonth(-1); }
        else if (e.key === 'ArrowRight') { e.preventDefault(); navigateMonth(1); }
    });
}

// Switch between month, week and my-teams views.
function setView(view) {
    if (view === currentView) return;
    currentView = view;

    // Update tab active state.
    document.getElementById('viewMonth').classList.toggle('active', view === 'month');
    document.getElementById('viewWeek').classList.toggle('active', view === 'week');
    document.getElementById('viewMyTeams').classList.toggle('active', view === 'myteams');

    // Show/hide the appropriate container.
    document.getElementById('calendar').classList.toggle('hidden', view !== 'month');
    document.getElementById('weekView').classList.toggle('hidden', view !== 'week');
    document.getElementById('myTeamsView').classList.toggle('hidden', view !== 'myteams');
    // The day-of-week row (Sun Mon Tue...) only makes sense in month view.
    document.getElementById('dayHeaders').classList.toggle('hidden', view !== 'month');

    if (view === 'week') {
        // First time entering week view, or returning to it. Center on today.
        if (!currentWeekStart) currentWeekStart = getTodayWeekStart();
        loadWeekSchedule(currentWeekStart);
    } else if (view === 'myteams') {
        // My Teams view reuses the displayed month's data; loadSchedule
        // dispatches rendering based on the active view.
        if (monthDataLoaded(currentDate)) {
            renderMyTeamsView();
        } else {
            loadSchedule(currentDate);
        }
    } else {
        renderCalendar(currentDate);
        updateNavButtons();
        updateTodayJumpVisibility();
    }
}

// True when we already have schedule data for the given month (so My Teams
// can render instantly without a refetch).
function monthDataLoaded(date) {
    if (!gamesData) return false;
    const prefix = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}`;
    for (const key in gamesData) {
        if (key.startsWith(prefix)) return true;
    }
    return false;
}

// Compute the start of the week centered on today (today minus 3 days).
function getTodayWeekStart() {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate() - 3);
}

// Jump to today's date from anywhere in the calendar.
// - In month view: sets currentDate to today, loads that month, scrolls to today's cell.
// - In week view: sets currentWeekStart to today-centered week, loads it, scrolls to today's card.
// Also closes the modal if it's open (so the user can see the calendar).
function jumpToToday() {
    // Close the modal if open so we can see the calendar.
    if (!document.getElementById('gameDetails').classList.contains('hidden')) {
        closeGameDetails();
    }

    if (currentView === 'week') {
        currentWeekStart = getTodayWeekStart();
        loadWeekSchedule(currentWeekStart);
    } else {
        currentDate = new Date();
        loadSchedule(currentDate);
    }
}

// Show or hide the 'Jump to Today' button based on whether today's cell
// is currently visible in the viewport. The button appears as soon as
// today scrolls out of view - whether because the user navigated to a
// different month, or because they scrolled down within today's month
// past today's cell.
function updateTodayJumpVisibility() {
    const btn = document.getElementById('todayJump');
    if (!btn) return;

    // Find today's element in the current view.
    let todayEl = null;
    if (currentView === 'myteams') {
        todayEl = null;  // month list has no today cell - show button when away
    } else if (currentView === 'week') {
        todayEl = document.querySelector('.week-day-card.is-today');
    } else {
        todayEl = document.querySelector('.day-cell.today');
    }

    // If there's no today element (e.g. viewing a different month with no
    // today cell), show the button so the user can jump back.
    if (!todayEl) {
        btn.classList.remove('hidden');
        return;
    }

    // Check if today's element is visible in the viewport.
    // We use a slightly generous threshold: consider it "visible" if any
    // part of it is within the viewport (with a small margin to account
    // for the sticky header overlapping the top).
    const rect = todayEl.getBoundingClientRect();
    const viewportTop = 0;
    const stickyHeaderHeight = 160;  // approx height of sticky header
    const viewportBottom = window.innerHeight || document.documentElement.clientHeight;
    const isVisible = (
        rect.bottom > viewportTop + stickyHeaderHeight &&  // not scrolled past top
        rect.top < viewportBottom - 50  // not scrolled past bottom (with margin)
    );

    if (isVisible) {
        btn.classList.add('hidden');
    } else {
        btn.classList.remove('hidden');
    }
}

// Debounced scroll handler - re-checks today button visibility on scroll.
// Uses requestAnimationFrame to avoid running too often during fast scrolls.
let _scrollRaf = 0;
function handleScrollForTodayButton() {
    if (_scrollRaf) return;  // already scheduled
    _scrollRaf = requestAnimationFrame(() => {
        updateTodayJumpVisibility();
        _scrollRaf = 0;
    });
}

// Helper: navigate to previous or next period (month or week, depending on
// current view), respecting season bounds. `direction` is -1 or +1.
function navigateMonth(direction) {
    if (currentView === 'week') {
        navigateWeek(direction);
        return;
    }
    const prevBtn = document.getElementById('prevMonth');
    const nextBtn = document.getElementById('nextMonth');
    if (direction < 0 && prevBtn && prevBtn.disabled) return;
    if (direction > 0 && nextBtn && nextBtn.disabled) return;
    currentDate.setMonth(currentDate.getMonth() + direction);
    // Add a brief slide animation class for visual feedback.
    const cal = document.getElementById('calendar');
    if (cal) {
        cal.classList.remove('slide-from-left', 'slide-from-right');
        // Force reflow so the animation restarts even if the class was just removed.
        void cal.offsetWidth;
        cal.classList.add(direction > 0 ? 'slide-from-right' : 'slide-from-left');
    }
    loadSchedule(currentDate);
}

// Navigate by one week (7 days) in the given direction.
function navigateWeek(direction) {
    if (!currentWeekStart) currentWeekStart = getTodayWeekStart();
    const candidate = new Date(currentWeekStart);
    candidate.setDate(candidate.getDate() + (direction * 7));
    // Season guard: don't allow navigating to a week that starts before the
    // season begins or ends after the season does. Be slightly lenient - if
    // any day of the candidate week is within season, allow it.
    const weekEnd = new Date(candidate);
    weekEnd.setDate(weekEnd.getDate() + 6);
    const seasonStartDay = new Date(seasonStart.getFullYear(), seasonStart.getMonth(), seasonStart.getDate());
    const seasonEndDay = new Date(seasonEnd.getFullYear(), seasonEnd.getMonth(), seasonEnd.getDate());
    if (weekEnd < seasonStartDay || candidate > seasonEndDay) return;

    currentWeekStart = candidate;
    const wv = document.getElementById('weekView');
    if (wv) {
        wv.classList.remove('slide-from-left', 'slide-from-right');
        void wv.offsetWidth;
        wv.classList.add(direction > 0 ? 'slide-from-right' : 'slide-from-left');
    }
    loadWeekSchedule(currentWeekStart);
}

// Setup touch swipe navigation. Listens on BOTH the calendar grid and the
// week view so swipes work regardless of which view is active.
// Threshold: 50px horizontal travel, and horizontal must exceed vertical
// by 1.5x so vertical scrolls don't accidentally trigger navigation.
function setupSwipeNavigation() {
    const targets = [
        document.getElementById('calendar'),
        document.getElementById('weekView'),
        document.getElementById('myTeamsView')
    ];
    for (const cal of targets) {
        if (!cal) continue;
        let startX = 0, startY = 0, startT = 0;
        let tracking = false;

        cal.addEventListener('touchstart', (e) => {
            if (e.touches.length !== 1) { tracking = false; return; }
            startX = e.touches[0].clientX;
            startY = e.touches[0].clientY;
            startT = Date.now();
            tracking = true;
        }, { passive: true });

        cal.addEventListener('touchend', (e) => {
            if (!tracking) return;
            tracking = false;
            const touch = e.changedTouches[0];
            if (!touch) return;
            const dx = touch.clientX - startX;
            const dy = touch.clientY - startY;
            const dt = Date.now() - startT;
            const absX = Math.abs(dx);
            const absY = Math.abs(dy);
            if (absX < 50 || absX < absY * 1.5 || dt > 800) return;
            if (dx < 0) navigateMonth(1);
            else        navigateMonth(-1);
        }, { passive: true });
    }
}

// Load NHL schedule for a specific month via our Vercel API
async function loadSchedule(date) {
    // Season guard – navigation is limited to the data-derived season bounds.
    if (!isInSeason(date)) {
        showError('No schedule available – the calendar only covers the ' + seasonLabel + ' NHL season.');
        document.getElementById('calendar').innerHTML = '';
        showLoading(false);
        updateNavButtons();
        return;
    }
    showLoading(true);
    hideError();

    const year = date.getFullYear();
    const month = date.getMonth() + 1;

    try {
        const response = await fetch(`/api/schedule?year=${year}&month=${month}`);
        if (!response.ok) {
            let msg = `Server returned ${response.status}`;
            try {
                const errBody = await response.json();
                if (errBody && errBody.error) msg = errBody.error;
            } catch (_) {}
            throw new Error(msg);
        }
        const data = await response.json();
        gamesData = processScheduleData(data);
        // Render whichever view is active (My Teams reuses the month data).
        if (currentView === 'myteams') {
            renderMyTeamsView();
        } else {
            renderCalendar(date);
        }
        // If today happens to be in the month we just loaded, the today strip
        // can use gamesData directly. Otherwise refreshTodayStrip will fetch
        // today's month on its own (it tracks which month it has loaded).
        renderTodayStrip();
        updateTodayJumpVisibility();
        updateFavCountdown();
    } catch (error) {
        console.error('Error loading schedule:', error);
        showError(
            'Could not load NHL schedule. ' +
            'The site may be updating — try refreshing in a minute. ' +
            'Details: ' + error.message
        );
    } finally {
        showLoading(false);
        // Keep navigation arrows in sync
        updateNavButtons();
    }
}

// In-memory season cache: union of every month/week fetch this session.
// Lets the My Teams countdown find the next favorite game across all months
// seen so far (today's month is always loaded, so the rest of this month is
// covered at minimum). Fresh fetches replace per-date entries, so cached
// games keep their latest state (scores, game state, etc).
const _seasonGameCache = {};

// Process schedule data from NHL API
function processScheduleData(data) {
    const games = {};

    if (data.dates) {
        data.dates.forEach(dateData => {
            const dateKey = dateData.date;
            games[dateKey] = dateData.games || [];
            // Merge into the season cache (latest fetch wins per date).
            _seasonGameCache[dateKey] = games[dateKey];
        });
    }

    return games;
}

// ============================================================================
// Favorite teams - stored in localStorage, highlighted with gold glow
// on calendar pills + today-strip chips. Star toggle in the modal.
// ============================================================================

const FAVORITES_KEY = 'nhl-calendar-favorites';  // localStorage key

// Load favorites from localStorage. Returns a Set of team abbreviations.
function loadFavorites() {
    try {
        const raw = localStorage.getItem(FAVORITES_KEY);
        if (!raw) return new Set();
        const arr = JSON.parse(raw);
        return Array.isArray(arr) ? new Set(arr) : new Set();
    } catch (err) {
        console.warn('Could not load favorites:', err.message);
        return new Set();
    }
}

// Save favorites to localStorage. Accepts a Set.
function saveFavorites(favSet) {
    try {
        const arr = Array.from(favSet);
        localStorage.setItem(FAVORITES_KEY, JSON.stringify(arr));
    } catch (err) {
        console.warn('Could not save favorites:', err.message);
    }
}

// Returns true if the given team abbreviation is in the user's favorites.
function isFavoriteTeam(abbrev) {
    return _favorites.has(abbrev);
}

// Toggle a team's favorite state. Returns the new state (true = now favorite).
function toggleFavorite(abbrev) {
    if (_favorites.has(abbrev)) {
        _favorites.delete(abbrev);
        saveFavorites(_favorites);
        return false;
    } else {
        _favorites.add(abbrev);
        saveFavorites(_favorites);
        return true;
    }
}

// Initialize favorites on script load.
const _favorites = loadFavorites();

// Returns true if any team in the given game is a favorite.
function gameHasFavorite(game) {
    if (!game || !game.teams) return false;
    return isFavoriteTeam(game.teams.away.team.abbreviation) ||
           isFavoriteTeam(game.teams.home.team.abbreviation);
}

// Re-render the active view + today strip after favorites change, so the
// gold border highlight appears immediately. Cheap operation since it's
// pure DOM (no refetch).
function refreshAfterFavoritesChange() {
    if (currentView === 'week') {
        renderWeekView();
    } else if (currentView === 'myteams') {
        renderMyTeamsView();
    } else {
        renderCalendar(currentDate);
    }
    renderTodayStrip();
    updateFavCountdown();
}

// ============================================================================
// Next favorite game countdown (slim bar under the header)
//
// Searches the season cache for the user's next favorite-team game, shows a
// live countdown while it's in the future and "LIVE now" while it's in
// progress. Hidden entirely when there are no favorites or nothing upcoming
// in the loaded data. Clicking it opens the game's detail popup.
// ============================================================================

let _nextFavGame = null;          // { game, live } for the 1s ticker
let _countdownTimerStarted = false;

const MS_DAY = 24 * 60 * 60 * 1000;
const MS_HOUR = 60 * 60 * 1000;
const MS_MINUTE = 60 * 1000;

// Local-time YYYY-MM-DD key (same format the schedule API uses).
function localDateKey(d) {
    return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
}

function formatCountdown(ms) {
    if (ms <= 0) return 'starting now';
    const days = Math.floor(ms / MS_DAY);
    const hours = Math.floor((ms % MS_DAY) / MS_HOUR);
    const mins = Math.floor((ms % MS_HOUR) / MS_MINUTE);
    const secs = Math.floor((ms % MS_MINUTE) / 1000);
    if (days > 0) return `in ${days}d ${hours}h`;
    if (hours > 0) return `in ${hours}h ${mins}m`;
    if (mins > 0) return `in ${mins}m ${secs}s`;
    return `in ${secs}s`;
}

// Soonest favorite game at/after now; a live favorite game wins instantly.
function findNextFavoriteGame() {
    const now = new Date();
    const todayKey = localDateKey(now);
    let best = null;
    let bestTime = Infinity;
    for (const dateKey in _seasonGameCache) {
        if (dateKey < todayKey) continue;  // ISO strings compare chronologically
        const games = _seasonGameCache[dateKey] || [];
        for (const game of games) {
            if (!gameHasFavorite(game)) continue;
            const state = game.gameState || game.status.abstractGameState || 'FUT';
            if (state === 'LIVE' || state === 'CRIT') {
                return { game, live: true };
            }
            const t = new Date(game.gameDate).getTime();
            if (t < now.getTime()) continue;   // already started (not live)
            if (t < bestTime) {
                bestTime = t;
                best = { game, live: false };
            }
        }
    }
    return best;
}

function updateFavCountdown() {
    const el = document.getElementById('favCountdown');
    if (!el) return;

    if (_favorites.size === 0) {
        el.classList.add('hidden');
        _nextFavGame = null;
        return;
    }

    const found = findNextFavoriteGame();
    _nextFavGame = found;
    if (!found) {
        el.classList.add('hidden');
        return;
    }

    el.classList.remove('hidden');
    renderFavCountdownText(el, found);

    // Start the 1s display ticker once (cheap textContent-level updates).
    if (!_countdownTimerStarted) {
        _countdownTimerStarted = true;
        setInterval(() => {
            const elNow = document.getElementById('favCountdown');
            if (!elNow || elNow.classList.contains('hidden')) return;
            if (!_nextFavGame || _nextFavGame.live) return;
            const ms = new Date(_nextFavGame.game.gameDate).getTime() - Date.now();
            if (ms <= 0) {
                // Countdown finished - re-evaluate (may flip to LIVE or next game).
                updateFavCountdown();
            } else {
                renderFavCountdownText(elNow, _nextFavGame);
            }
        }, 1000);
    }
}

function renderFavCountdownText(el, found) {
    const g = found.game;
    const matchup = `${g.teams.away.team.abbreviation} @ ${g.teams.home.team.abbreviation}`;
    if (found.live) {
        const aw = g.teams.away.score;
        const hm = g.teams.home.score;
        el.innerHTML =
            `<span class="fav-countdown-star">★</span> ` +
            `<strong>${escapeHtml(matchup)}</strong> is LIVE now` +
            (aw !== null && aw !== undefined && hm !== null && hm !== undefined
                ? ` <span class="fav-countdown-score">${escapeHtml(String(aw))} - ${escapeHtml(String(hm))}</span>`
                : '');
        el.classList.add('is-live');
    } else {
        const ms = new Date(g.gameDate).getTime() - Date.now();
        el.innerHTML =
            `<span class="fav-countdown-star">★</span> Next: ` +
            `<strong>${escapeHtml(matchup)}</strong> ` +
            `<span class="fav-countdown-time">${escapeHtml(formatCountdown(ms))}</span>`;
        el.classList.remove('is-live');
    }
    el.onclick = () => showGameDetails(g);
}

// ============================================================================
// "Today's games" strip - horizontal scrollable row at the top of the page
// showing today's games with live scores. Auto-refreshes every 60 seconds.
// ============================================================================

// Track which month the today-strip has loaded data for, so we don't refetch
// every refresh cycle (only refetch when the displayed month is missing).
let _todayStripLoadedMonth = null;  // 'YYYY-M' string
let _todayStripGames = [];          // array of game objects for today

// Refresh the today-strip: fetches today's month if not already loaded,
// then fetches live detail for any in-progress or pre-game games so the
// scores update in real time. Called every 60s by setInterval.
async function refreshTodayStrip() {
    const today = new Date();
    const monthKey = `${today.getFullYear()}-${today.getMonth() + 1}`;

    // If today's month isn't loaded yet, fetch it.
    if (_todayStripLoadedMonth !== monthKey) {
        try {
            const year = today.getFullYear();
            const month = today.getMonth() + 1;
            const r = await fetch(`/api/schedule?year=${year}&month=${month}`);
            if (r.ok) {
                const data = await r.json();
                const freshData = processScheduleData(data);
                // Merge into gamesData so the calendar also benefits (e.g. if
                // the user is currently viewing a different month, today's
                // data is still available for the strip).
                _todayStripGames = [];
                for (const dateKey in freshData) {
                    if (!gamesData[dateKey]) gamesData[dateKey] = freshData[dateKey];
                }
                _todayStripLoadedMonth = monthKey;
            }
        } catch (err) {
            console.warn('Today strip fetch failed:', err.message);
            // Fall through - we'll try to render with whatever gamesData has.
        }
    }

    // For LIVE and PRE games today, fetch fresh detail so scores update in
    // real time. We do this every refresh cycle (60s) for any game that
    // isn't FINAL yet - once a game goes FINAL, the schedule API already
    // has the final score, so we skip refetching.
    await refreshLiveTodayGames();

    renderTodayStrip();
    updateFavCountdown();
}

// Fetch fresh detail for each of today's games that is LIVE or PRE,
// and merge the updated scores/gameState back into gamesData[todayKey].
// This makes the today-strip scores update in real time every 60s.
async function refreshLiveTodayGames() {
    const today = new Date();
    const todayKey = localDateKey(today);
    const todaysGames = (gamesData && gamesData[todayKey]) || [];
    if (todaysGames.length === 0) return;

    // Find games that are in-progress or about to start - these are the
    // ones whose scores/state we want to refresh.
    const toRefresh = todaysGames.filter(g => {
        const state = g.gameState || g.status.abstractGameState || 'FUT';
        return state === 'LIVE' || state === 'CRIT' || state === 'PRE';
    });
    if (toRefresh.length === 0) return;

    // Fetch detail for each in parallel.
    const detailPromises = toRefresh.map(async (g) => {
        if (!g.gamePk) return null;
        try {
            const r = await fetch(`/api/game?id=${g.gamePk}`);
            if (!r.ok) return null;
            return await r.json();
        } catch (err) {
            console.warn(`Live fetch failed for game ${g.gamePk}:`, err.message);
            return null;
        }
    });
    const details = await Promise.all(detailPromises);

    // Merge fresh data back into gamesData. We mutate the existing game
    // object in-place so any other code holding a reference (e.g. the
    // click handler that opens the modal) sees the updated scores.
    details.forEach(detail => {
        if (!detail) return;
        const idx = todaysGames.findIndex(g => String(g.gamePk) === String(detail.gamePk));
        if (idx === -1) return;
        const g = todaysGames[idx];
        // Update scores + state from the detail.
        if (detail.awayTeam && detail.awayTeam.score !== null && detail.awayTeam.score !== undefined) {
            g.teams.away.score = detail.awayTeam.score;
            g.teams.away.sog = detail.awayTeam.sog;
        }
        if (detail.homeTeam && detail.homeTeam.score !== null && detail.homeTeam.score !== undefined) {
            g.teams.home.score = detail.homeTeam.score;
            g.teams.home.sog = detail.homeTeam.sog;
        }
        if (detail.gameState) {
            g.gameState = detail.gameState;
            if (g.status) g.status.abstractGameState = detail.gameState;
        }
        if (detail.periodDescriptor) g.period = detail.periodDescriptor;
        if (detail.clock) g.clock = detail.clock;
    });
}

// Render the today-strip from gamesData + _todayStripGames.
function renderTodayStrip() {
    const strip = document.getElementById('todayStrip');
    if (!strip) return;
    strip.innerHTML = '';

    // Format today's date key (YYYY-MM-DD in local time).
    const today = new Date();
    const todayKey = localDateKey(today);

    // Find today's games (from gamesData which may have been loaded by either
    // loadSchedule for the displayed month, or refreshTodayStrip for today's month).
    const todaysGames = (gamesData && gamesData[todayKey]) || [];

    // Section header.
    const header = document.createElement('div');
    header.className = 'today-strip-header';
    const nowStr = today.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    if (todaysGames.length === 0) {
        header.innerHTML = `<span class="today-strip-title">Today's Games</span><span class="today-strip-sub">No NHL games today - check back tomorrow</span>`;
        strip.appendChild(header);
        // Show the empty-state strip too (so the user sees the message).
        strip.classList.add('has-games');
        return;
    }
    header.innerHTML = `<span class="today-strip-title">Today's Games</span><span class="today-strip-sub">${todaysGames.length} game${todaysGames.length === 1 ? '' : 's'} - updated ${nowStr}</span>`;
    strip.appendChild(header);
    strip.classList.add('has-games');

    // Horizontal scroll row of game chips.
    const chipsRow = document.createElement('div');
    chipsRow.className = 'today-strip-chips';

    // Goal detection FIRST: compares scores against the previous render, so
    // chips can flash gold and screen readers can announce the new score.
    const flashedIds = detectGoalFlashes(todaysGames);
    if (flashedIds.size > 0) announceGoals(flashedIds, todaysGames);

    // Favorites first: stable sort keeps chronological order within groups.
    const orderedGames = todaysGames.slice().sort(
        (a, b) => (gameHasFavorite(b) ? 1 : 0) - (gameHasFavorite(a) ? 1 : 0)
    );

    orderedGames.forEach(game => {
        const chip = document.createElement('div');
        chip.className = 'today-chip';

        // If any team is a favorite, add a gold border class.
        if (gameHasFavorite(game)) {
            chip.classList.add('favorite');
        }

        const state = game.gameState || game.status.abstractGameState || 'FUT';
        if (state === 'LIVE' || state === 'CRIT') {
            chip.classList.add('live');
            if (flashedIds.has(String(game.gamePk))) {
                chip.classList.add('goal-flash');
            }
        } else if (state === 'OFF' || state === 'FINAL') {
            chip.classList.add('final');
        } else if (state === 'PRE') {
            chip.classList.add('pre');
        }

        // Apply team brand colors (consistent with calendar pills).
        if (state === 'FUT' || state === 'OFF' || state === 'FINAL') {
            const awayColor = TEAM_COLORS[game.teams.away.team.abbreviation];
            const homeColor = TEAM_COLORS[game.teams.home.team.abbreviation];
            if (awayColor) {
                const bg = hexToRgba(awayColor, 0.28);
                if (bg) chip.style.backgroundColor = bg;
            }
            if (homeColor) {
                chip.style.setProperty('--home-color', homeColor);
            }
        }

        // Away logo + abbr
        const awayLogo = document.createElement('img');
        awayLogo.src = `https://assets.nhle.com/logos/nhl/svg/${game.teams.away.team.abbreviation}_light.svg`;
        awayLogo.alt = game.teams.away.team.abbreviation;
        awayLogo.className = 'team-logo';
        const awayAbbr = document.createElement('span');
        awayAbbr.textContent = game.teams.away.team.abbreviation;
        awayAbbr.className = 'team-abbr';

        // Home logo + abbr
        const homeLogo = document.createElement('img');
        homeLogo.src = `https://assets.nhle.com/logos/nhl/svg/${game.teams.home.team.abbreviation}_light.svg`;
        homeLogo.alt = game.teams.home.team.abbreviation;
        homeLogo.className = 'team-logo';
        const homeAbbr = document.createElement('span');
        homeAbbr.textContent = game.teams.home.team.abbreviation;
        homeAbbr.className = 'team-abbr';

        // Center: score (for live/final) or time (for scheduled) or 'LIVE' badge
        const center = document.createElement('span');
        center.className = 'today-chip-center';
        if (state === 'LIVE' || state === 'CRIT') {
            const aw = game.teams.away.score;
            const hm = game.teams.home.score;
            if (aw !== null && aw !== undefined && hm !== null && hm !== undefined) {
                center.textContent = `${aw} - ${hm}`;
            } else {
                center.textContent = 'LIVE';
            }
            const dot = document.createElement('span');
            dot.className = 'live-dot';
            center.insertBefore(dot, center.firstChild);
        } else if (state === 'OFF' || state === 'FINAL') {
            const aw = game.teams.away.score;
            const hm = game.teams.home.score;
            if (aw !== null && aw !== undefined && hm !== null && hm !== undefined) {
                center.textContent = `${aw} - ${hm}`;
                center.classList.add('final-score');
                // Mark the winner green (consistent with calendar pills).
                if (aw > hm) {
                    awayAbbr.classList.add('winner');
                } else if (hm > aw) {
                    homeAbbr.classList.add('winner');
                }
            } else {
                center.textContent = 'Final';
            }
        } else {
            // Scheduled - show start time.
            const gd = new Date(game.gameDate);
            const tm = gd.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
            center.textContent = tm;
            center.classList.add('scheduled-time');
        }

        // Symmetric layout: [logo] abbr [center] abbr [logo]
        chip.appendChild(awayLogo);
        chip.appendChild(awayAbbr);
        chip.appendChild(center);
        chip.appendChild(homeAbbr);
        chip.appendChild(homeLogo);

        // Period + clock badge for live games (merged from /api/game detail)
        // plus a full-state label for screen readers.
        if (state === 'LIVE' || state === 'CRIT') {
            const badgeText = liveBadgeText(game);
            if (badgeText) {
                const badge = document.createElement('span');
                badge.className = 'chip-live-badge';
                badge.textContent = badgeText;
                chip.appendChild(badge);
            }
            chip.setAttribute('aria-label', liveAriaLabel(game));
        }

        chip.addEventListener('click', () => showGameDetails(game));
        chipsRow.appendChild(chip);
    });

    strip.appendChild(chipsRow);
}

// --------------------------------------------------------------------------
// Live mode polish: adaptive refresh, period+clock badges, goal flash,
// screen-reader announcements.
// --------------------------------------------------------------------------

// Adaptive refresh loop for the today strip: 15s while a FAVORITE team's
// game is live (scores feel near-real-time), 30s otherwise. Re-evaluated
// after every cycle since game states change.
let _stripRefreshTimer = null;
function startStripRefreshLoop() {
    if (_stripRefreshTimer) clearTimeout(_stripRefreshTimer);
    _stripRefreshTimer = setTimeout(async () => {
        await refreshTodayStrip();
        startStripRefreshLoop();
    }, liveFavoriteGameToday() ? 15000 : 30000);
}

// True when one of the user's favorite teams is playing right now.
function liveFavoriteGameToday() {
    const todayKey = localDateKey(new Date());
    const games = (gamesData && gamesData[todayKey]) || [];
    return games.some(g => {
        const state = g.gameState || g.status.abstractGameState || 'FUT';
        return (state === 'LIVE' || state === 'CRIT') && gameHasFavorite(g);
    });
}

// Build "1st 08:32" style text from a game's merged period/clock data
// (populated by refreshLiveTodayGames from /api/game detail).
function liveBadgeText(game) {
    const period = game.period;
    const clock = game.clock;
    if (!period || !period.number || !clock || !clock.timeRemaining) return '';
    return formatPeriodLabel(period.number, period.periodType) + ' ' + clock.timeRemaining;
}

// Screen-reader description of a live chip's full state.
function liveAriaLabel(game) {
    const a = game.teams.away.team.abbreviation;
    const h = game.teams.home.team.abbreviation;
    const aw = game.teams.away.score;
    const hm = game.teams.home.score;
    let label = `${a} at ${h}, live`;
    if (aw !== null && aw !== undefined && hm !== null && hm !== undefined) {
        label += `, ${aw} to ${hm}`;
    }
    const badge = liveBadgeText(game);
    if (badge) label += `, ${badge} remaining`;
    return label;
}

// Goal-flash bookkeeping: gamePk -> 'aw-hm' as of the last strip render.
// A score INCREASE between renders means a goal happened - the chip gets a
// gold flash and screen readers get an announcement.
const _lastChipScores = {};

function detectGoalFlashes(todaysGames) {
    const flashed = new Set();
    todaysGames.forEach(g => {
        const id = String(g.gamePk || '');
        if (!id) return;
        const aw = g.teams.away.score;
        const hm = g.teams.home.score;
        if (aw === null || aw === undefined || hm === null || hm === undefined) return;
        const key = `${aw}-${hm}`;
        const prev = _lastChipScores[id];
        if (prev && prev !== key) {
            const parts = prev.split('-');
            if ((aw > Number(parts[0])) || (hm > Number(parts[1]))) {
                flashed.add(id);
            }
        }
        _lastChipScores[id] = key;
    });
    return flashed;
}

// Announce goal flashes via the polite aria-live region.
function announceGoals(flashedIds, todaysGames) {
    const region = document.getElementById('liveAnnouncer');
    if (!region || flashedIds.size === 0) return;
    const lines = [];
    todaysGames.forEach(g => {
        if (!flashedIds.has(String(g.gamePk))) return;
        const a = g.teams.away.team.abbreviation;
        const h = g.teams.home.team.abbreviation;
        const badge = liveBadgeText(g);
        lines.push(
            `Goal in the ${a} at ${h} game. New score ` +
            `${g.teams.away.score} to ${g.teams.home.score}` +
            (badge ? `, ${badge}` : '') + '.'
        );
    });
    if (lines.length === 0) return;
    // Clear first so identical consecutive messages still announce.
    region.textContent = '';
    window.setTimeout(() => { region.textContent = lines.join(' '); }, 50);
}

// Load NHL schedule for a 7-day window starting at `weekStart`.
// If the week spans two months (e.g. Oct 30 - Nov 5), fetches both months
// and merges the results into gamesData.
async function loadWeekSchedule(weekStart) {
    showLoading(true);
    hideError();

    const weekEnd = new Date(weekStart);
    weekEnd.setDate(weekEnd.getDate() + 6);

    // Build a list of unique {year, month} pairs covering the week.
    const monthsToFetch = [];
    const seen = new Set();
    const addMonth = (d) => {
        const key = `${d.getFullYear()}-${d.getMonth() + 1}`;
        if (!seen.has(key)) {
            seen.add(key);
            monthsToFetch.push({ year: d.getFullYear(), month: d.getMonth() + 1 });
        }
    };
    addMonth(weekStart);
    addMonth(weekEnd);

    try {
        const responses = await Promise.all(
            monthsToFetch.map(m =>
                fetch(`/api/schedule?year=${m.year}&month=${m.month}`)
                    .then(r => {
                        if (!r.ok) throw new Error(`Server returned ${r.status}`);
                        return r.json();
                    })
            )
        );

        // Merge all responses into gamesData.
        gamesData = {};
        for (const data of responses) {
            const merged = processScheduleData(data);
            for (const dateKey in merged) {
                gamesData[dateKey] = merged[dateKey];
            }
        }

        renderWeekView();
        updateTodayJumpVisibility();
    } catch (error) {
        console.error('Error loading week schedule:', error);
        showError(
            'Could not load NHL schedule. ' +
            'The site may be updating — try refreshing in a minute. ' +
            'Details: ' + error.message
        );
    } finally {
        showLoading(false);
        updateWeekNavButtons();
    }
}

// Render the 7-day week view as a vertical list of cards.
// Each card shows the day name, date, and that day's games with the
// same visual treatment as the month view (team colors, W/L, live pulse).
function renderWeekView() {
    const weekView = document.getElementById('weekView');
    if (!weekView) return;
    weekView.innerHTML = '';

    const monthTitle = document.getElementById('monthTitle');
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Update the header title to show the week's date range.
    const dayNamesLong = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

    const startStr = `${monthShort[currentWeekStart.getMonth()]} ${currentWeekStart.getDate()}`;
    const endStr = (currentWeekStart.getMonth() === weekEnd(currentWeekStart).getMonth() &&
                    currentWeekStart.getFullYear() === weekEnd(currentWeekStart).getFullYear())
        ? `${weekEnd(currentWeekStart).getDate()}`
        : `${monthShort[weekEnd(currentWeekStart).getMonth()]} ${weekEnd(currentWeekStart).getDate()}`;
    const yearStr = currentWeekStart.getFullYear() === weekEnd(currentWeekStart).getFullYear()
        ? `${currentWeekStart.getFullYear()}`
        : `${currentWeekStart.getFullYear()}-${weekEnd(currentWeekStart).getFullYear()}`;
    monthTitle.textContent = `${startStr} - ${endStr}, ${yearStr}`;

    // Render 7 day cards.
    for (let i = 0; i < 7; i++) {
        const dayDate = new Date(currentWeekStart);
        dayDate.setDate(dayDate.getDate() + i);
        const dateKey = `${dayDate.getFullYear()}-${(dayDate.getMonth() + 1).toString().padStart(2, '0')}-${dayDate.getDate().toString().padStart(2, '0')}`;
        const isToday = dayDate.getTime() === today.getTime();

        const card = document.createElement('div');
        card.className = 'week-day-card';
        if (isToday) card.classList.add('is-today');

        // Card header: day name + date number.
        const cardHeader = document.createElement('div');
        cardHeader.className = 'week-card-header';
        const dayName = document.createElement('span');
        dayName.className = 'week-day-name';
        dayName.textContent = dayNamesLong[dayDate.getDay()];
        const dateNum = document.createElement('span');
        dateNum.className = 'week-date-num';
        dateNum.textContent = `${monthShort[dayDate.getMonth()]} ${dayDate.getDate()}`;
        if (isToday) {
            const todayBadge = document.createElement('span');
            todayBadge.className = 'today-badge';
            todayBadge.textContent = 'TODAY';
            dateNum.appendChild(todayBadge);
        }
        cardHeader.appendChild(dayName);
        cardHeader.appendChild(dateNum);
        card.appendChild(cardHeader);

        // Card body: games for this day (or 'no games' message).
        const cardBody = document.createElement('div');
        cardBody.className = 'week-card-body';

        const dayGames = gamesData[dateKey] || [];
        if (dayGames.length === 0) {
            const empty = document.createElement('div');
            empty.className = 'week-no-games';
            empty.textContent = 'No games scheduled';
            cardBody.appendChild(empty);
        } else {
            let dayHasLive = false;
            dayGames.forEach(game => {
                const state = game.gameState || game.status.abstractGameState || 'FUT';
                if (state === 'LIVE' || state === 'CRIT') dayHasLive = true;
                // Shared row builder (also used by My Teams + the mobile day sheet).
                cardBody.appendChild(buildGameRow(game));
            });
            if (dayHasLive) card.classList.add('has-live');
        }
        card.appendChild(cardBody);
        weekView.appendChild(card);
    }

    // Auto-scroll: if today's card is in this week, scroll to it; else scroll to top.
    const todayCard = weekView.querySelector('.week-day-card.is-today');
    if (todayCard) {
        requestAnimationFrame(() => {
            todayCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    } else {
        // Today isn't in this week - scroll to top of page so user sees the
        // start of the week, not a random scroll position.
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }

    // Auto-shrink pills to fit (week-view pills are wider so usually don't
    // need scaling, but call this for consistency with month view).
    fitPillsToCells();
}

// Helper: compute the last day (Date) of a 7-day week starting at `weekStart`.
function weekEnd(weekStart) {
    const e = new Date(weekStart);
    e.setDate(e.getDate() + 6);
    return e;
}

// Update nav button disabled state based on whether the week can go
// earlier/later within the season.
function updateWeekNavButtons() {
    const prevBtn = document.getElementById('prevMonth');
    const nextBtn = document.getElementById('nextMonth');
    if (!currentWeekStart || !prevBtn || !nextBtn) return;
    const weekEndDate = weekEnd(currentWeekStart);
    const seasonStartDay = new Date(seasonStart.getFullYear(), seasonStart.getMonth(), seasonStart.getDate());
    const seasonEndDay = new Date(seasonEnd.getFullYear(), seasonEnd.getMonth(), seasonEnd.getDate());
    prevBtn.disabled = (weekEndDate <= seasonStartDay);
    nextBtn.disabled = (currentWeekStart >= seasonEndDay);
}

// ============================================================================
// My Teams view - favorite-team games for the displayed month
// ============================================================================

// Render the My Teams view: favorite-team games grouped by date for the
// month the user is currently navigating (prev/next arrows still work).
// Shares the week-view pill markup so visuals stay consistent.
function renderMyTeamsView() {
    const container = document.getElementById('myTeamsView');
    if (!container) return;
    container.innerHTML = '';

    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
    const monthLabel = `${monthNames[currentDate.getMonth()]} ${currentDate.getFullYear()}`;

    // Keep the header title in sync with the browsed month (the calendar and
    // week view update it in their own render paths).
    document.getElementById('monthTitle').textContent = monthLabel;

    // No favorites at all - helpful empty state with a quick way into month view.
    if (_favorites.size === 0) {
        const empty = document.createElement('div');
        empty.className = 'myteams-empty';
        empty.innerHTML = `
            <div class="myteams-empty-star">☆</div>
            <h2>No favorite teams yet</h2>
            <p>Open any game and tap the <strong>star</strong> next to a team to follow it.<br>
            Your favorite teams' games will show up here.</p>
            <button class="myteams-hint-btn" type="button">Browse the month view</button>
        `;
        empty.querySelector('.myteams-hint-btn').addEventListener('click', () => setView('month'));
        container.appendChild(empty);
        return;
    }

    // Collect favorite games in the displayed month, grouped by date.
    const prefix = `${currentDate.getFullYear()}-${(currentDate.getMonth() + 1).toString().padStart(2, '0')}`;
    const byDate = [];
    for (const dateKey of Object.keys(gamesData).sort()) {
        if (!dateKey.startsWith(prefix)) continue;
        const favGames = (gamesData[dateKey] || []).filter(gameHasFavorite);
        if (favGames.length > 0) byDate.push({ dateKey, games: favGames });
    }

    const totalGames = byDate.reduce((sum, d) => sum + d.games.length, 0);

    // Section intro line.
    const intro = document.createElement('div');
    intro.className = 'myteams-intro';
    intro.innerHTML = `<span class="myteams-title">★ My Teams</span>` +
        (totalGames === 0
            ? `<span class="myteams-sub">No games for your teams in ${escapeHtml(monthLabel)}</span>`
            : `<span class="myteams-sub">${totalGames} game${totalGames === 1 ? '' : 's'} for your teams in ${escapeHtml(monthLabel)}</span>`);
    container.appendChild(intro);

    if (totalGames === 0) {
        const empty = document.createElement('div');
        empty.className = 'myteams-empty myteams-empty-small';
        empty.innerHTML = `
            <div class="myteams-empty-star">★</div>
            <p>Nothing this month. Use the arrows to check other months -<br>
            the countdown under the header always shows your next upcoming game.</p>
        `;
        container.appendChild(empty);
        return;
    }

    const dayNamesLong = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthShort = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
    const todayKey = localDateKey(new Date());

    byDate.forEach(({ dateKey, games }) => {
        // Parse dateKey (YYYY-MM-DD) as a local day.
        const parts = dateKey.split('-').map(Number);
        const dayDate = new Date(parts[0], parts[1] - 1, parts[2]);

        const dateHeading = document.createElement('div');
        dateHeading.className = 'myteams-date-heading';
        dateHeading.innerHTML =
            `<span class="myteams-date-name">${dayNamesLong[dayDate.getDay()]}, ${monthShort[dayDate.getMonth()]} ${dayDate.getDate()}</span>` +
            (dateKey === todayKey ? '<span class="today-badge">TODAY</span>' : '');
        container.appendChild(dateHeading);

        games.forEach(game => {
            // Shared row builder; these rows are all favorite games so the
            // gold border is added automatically by gameHasFavorite().
            container.appendChild(buildGameRow(game, 'myteams-game-item'));
        });
    });
}

// ============================================================================
// Mobile day sheet (compact month mode) + shared game row builder
// ============================================================================

// True below the 600px breakpoint - the compact month mode threshold.
function isNarrowViewport() {
    return window.matchMedia('(max-width: 600px)').matches;
}

// Build a game row shared by the week view, My Teams view and the mobile day
// sheet: team colors, logos, winner highlight, live/pre/final state classes,
// favorite gold border, score (or start time) and the live period+clock.
// `extraClasses` appends view-specific classes; `onOpen(game)` replaces the
// default click action (opening the detail popup).
function buildGameRow(game, extraClasses, onOpen) {
    const gameItem = document.createElement('div');
    gameItem.className = 'game-item week-game-item' + (extraClasses ? ' ' + extraClasses : '');

    const state = game.gameState || game.status.abstractGameState || 'FUT';
    if (state === 'LIVE' || state === 'CRIT') {
        gameItem.classList.add('game-live');
    } else if (state === 'PRE') {
        gameItem.classList.add('game-pre');
    } else if (state === 'OFF' || state === 'FINAL') {
        gameItem.classList.add('game-final');
    }
    if (gameHasFavorite(game)) {
        gameItem.classList.add('favorite');
    }

    // Team colors (same treatment across views).
    if (state === 'FUT' || state === 'OFF' || state === 'FINAL') {
        const awayColor = TEAM_COLORS[game.teams.away.team.abbreviation];
        const homeColor = TEAM_COLORS[game.teams.home.team.abbreviation];
        if (awayColor) {
            const bg = hexToRgba(awayColor, 0.28);
            if (bg) gameItem.style.backgroundColor = bg;
        }
        if (homeColor) gameItem.style.setProperty('--home-color', homeColor);
    }

    // Winner highlight for finished games.
    let awayWin = false, homeWin = false;
    if ((state === 'OFF' || state === 'FINAL') &&
        game.teams.away.score !== null && game.teams.away.score !== undefined &&
        game.teams.home.score !== null && game.teams.home.score !== undefined) {
        const aw = Number(game.teams.away.score);
        const hm = Number(game.teams.home.score);
        if (aw > hm)      { awayWin = true; }
        else if (hm > aw) { homeWin = true; }
    }

    const awayLogo = document.createElement('img');
    awayLogo.src = `https://assets.nhle.com/logos/nhl/svg/${game.teams.away.team.abbreviation}_light.svg`;
    awayLogo.alt = game.teams.away.team.abbreviation;
    awayLogo.className = 'team-logo';
    const awayAbbr = document.createElement('span');
    awayAbbr.textContent = game.teams.away.team.abbreviation;
    awayAbbr.className = 'team-abbr';
    if (awayWin) awayAbbr.classList.add('winner');

    const homeLogo = document.createElement('img');
    homeLogo.src = `https://assets.nhle.com/logos/nhl/svg/${game.teams.home.team.abbreviation}_light.svg`;
    homeLogo.alt = game.teams.home.team.abbreviation;
    homeLogo.className = 'team-logo';
    const homeAbbr = document.createElement('span');
    homeAbbr.textContent = game.teams.home.team.abbreviation;
    homeAbbr.className = 'team-abbr';
    if (homeWin) homeAbbr.classList.add('winner');

    // Score for started games, start time for scheduled ones; live games
    // also show period + clock inline.
    const scoreSpan = document.createElement('span');
    scoreSpan.className = 'week-game-score';
    if (game.teams.away.score !== null && game.teams.away.score !== undefined) {
        scoreSpan.textContent = `${game.teams.away.score} - ${game.teams.home.score}`;
        if (state === 'LIVE' || state === 'CRIT') {
            const badge = liveBadgeText(game);
            if (badge) scoreSpan.textContent += ' \u00b7 ' + badge;
        }
    } else {
        const gd = new Date(game.gameDate);
        scoreSpan.textContent = gd.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
    }

    gameItem.appendChild(awayLogo);
    gameItem.appendChild(awayAbbr);
    const sep = document.createElement('span');
    sep.textContent = ' @ ';
    gameItem.appendChild(sep);
    gameItem.appendChild(homeAbbr);
    gameItem.appendChild(homeLogo);
    gameItem.appendChild(scoreSpan);

    gameItem.addEventListener('click', (e) => {
        e.stopPropagation();
        if (onOpen) onOpen(game);
        else showGameDetails(game);
    });
    return gameItem;
}

// Bottom sheet showing a day's full game rows (compact month mode).
function openDaySheet(dateKey) {
    const sheet = document.getElementById('daySheet');
    const title = document.getElementById('daySheetTitle');
    const body = document.getElementById('daySheetBody');
    if (!sheet || !title || !body) return;

    const parts = dateKey.split('-').map(Number);
    const dayDate = new Date(parts[0], parts[1] - 1, parts[2]);
    const dayNamesLong = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                        'July', 'August', 'September', 'October', 'November', 'December'];
    const games = (gamesData && gamesData[dateKey]) || [];

    title.textContent = `${dayNamesLong[dayDate.getDay()]}, ${monthNames[dayDate.getMonth()]} ${dayDate.getDate()}`;

    body.innerHTML = '';
    if (games.length === 0) {
        const empty = document.createElement('div');
        empty.className = 'week-no-games';
        empty.textContent = 'No games scheduled';
        body.appendChild(empty);
    } else {
        games.forEach(game => {
            body.appendChild(buildGameRow(game, null, (g) => {
                closeDaySheet();
                showGameDetails(g);
            }));
        });
    }

    sheet.classList.remove('hidden');
    sheet.setAttribute('aria-hidden', 'false');
    // Reset scroll so a previously-scrolled sheet starts at the handle.
    sheet.querySelector('.day-sheet-panel').scrollTop = 0;
    lockBodyScroll();
}

function closeDaySheet() {
    const sheet = document.getElementById('daySheet');
    if (!sheet || sheet.classList.contains('hidden')) return;
    sheet.classList.add('hidden');
    sheet.setAttribute('aria-hidden', 'true');
    unlockBodyScroll();
}

// Render the calendar
function renderCalendar(date) {
    const calendar = document.getElementById('calendar');
    const monthTitle = document.getElementById('monthTitle');

    // Update title
    const monthNames = ['January', 'February', 'March', 'April', 'May', 'June',
                       'July', 'August', 'September', 'October', 'November', 'December'];
    monthTitle.textContent = `${monthNames[date.getMonth()]} ${date.getFullYear()}`;

    // Clear previous calendar
    calendar.innerHTML = '';

    // Render day headers into the sticky #dayHeaders row (separate from the
    // calendar grid so they stay pinned to the top while scrolling).
    // Use single letters on narrow screens (S M T W T F S) to save space.
    const dayHeaders = document.getElementById('dayHeaders');
    dayHeaders.innerHTML = '';
    const isNarrow = window.matchMedia('(max-width: 600px)').matches;
    const dayNames = isNarrow
        ? ['S', 'M', 'T', 'W', 'T', 'F', 'S']
        : ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayNames.forEach(label => {
        const header = document.createElement('div');
        header.className = 'day-header';
        header.textContent = label;
        dayHeaders.appendChild(header);
    });

    // Get first day of month and total days
    const firstDay = new Date(date.getFullYear(), date.getMonth(), 1);
    const lastDay = new Date(date.getFullYear(), date.getMonth() + 1, 0);
    const startingDay = firstDay.getDay();
    const totalDays = lastDay.getDate();

    // Get today's date for highlighting
    const today = new Date();
    const isCurrentMonth = today.getFullYear() === date.getFullYear() &&
                          today.getMonth() === date.getMonth();

    // Compact month mode (phones, <600px): cells shrink to date number +
    // colored dots (+ '+N'); tapping a day opens the bottom sheet with full
    // game rows. Desktop keeps the full pills (see below).
    const compact = isNarrowViewport();
    calendar.classList.toggle('compact', compact);

    // Add empty cells for days before the first day of the month
    for (let i = 0; i < startingDay; i++) {
        const emptyCell = document.createElement('div');
        emptyCell.className = 'day-cell other-month';
        calendar.appendChild(emptyCell);
    }

    // Add days of the month
    for (let day = 1; day <= totalDays; day++) {
        const dayCell = document.createElement('div');
        dayCell.className = 'day-cell';

        // Highlight today
        if (isCurrentMonth && day === today.getDate()) {
            dayCell.classList.add('today');
        }

        // Add day number
        const dayNumber = document.createElement('div');
        dayNumber.className = 'day-number';
        dayNumber.textContent = day;
        dayCell.appendChild(dayNumber);

        // Format date key for API data
        const dateKey = `${date.getFullYear()}-${(date.getMonth() + 1).toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;

        // Add games for this day
        if (gamesData[dateKey] && gamesData[dateKey].length > 0) {
            let dayHasLive = false;
            const dayGames = gamesData[dateKey];

            if (compact) {
                // COMPACT: up to 4 colored dots (away team color, green for
                // live games) + '+N' overflow label. Tap opens the day sheet.
                dayGames.forEach(game => {
                    const state = game.gameState || game.status.abstractGameState || 'FUT';
                    if (state === 'LIVE' || state === 'CRIT') dayHasLive = true;
                });
                const dots = document.createElement('div');
                dots.className = 'game-dots';
                dayGames.slice(0, 4).forEach(game => {
                    const state = game.gameState || game.status.abstractGameState || 'FUT';
                    const dot = document.createElement('span');
                    dot.className = 'game-dot';
                    if (state === 'LIVE' || state === 'CRIT') {
                        dot.style.backgroundColor = '#00ff66';
                        dot.classList.add('is-live');
                    } else {
                        dot.style.backgroundColor = TEAM_COLORS[game.teams.away.team.abbreviation] || '#e31837';
                    }
                    dots.appendChild(dot);
                });
                if (dayGames.length > 4) {
                    const more = document.createElement('span');
                    more.className = 'game-dots-more';
                    more.textContent = '+' + (dayGames.length - 4);
                    dots.appendChild(more);
                }
                dayCell.appendChild(dots);
                dayCell.classList.add('compact-tappable');
                dayCell.addEventListener('click', () => openDaySheet(dateKey));
            } else {
            gamesData[dateKey].forEach(game => {
                const gameItem = document.createElement('div');
                gameItem.className = 'game-item';

                // If any team in this game is a favorite, add a gold border class.
                if (gameHasFavorite(game)) {
                    gameItem.classList.add('favorite');
                }

                // Mark scheduled/live games with a state class for styling.
                const state = game.gameState || game.status.abstractGameState || 'FUT';
                if (state === 'LIVE' || state === 'CRIT') {
                    gameItem.classList.add('game-live');
                    dayHasLive = true;
                } else if (state === 'PRE') {
                    gameItem.classList.add('game-pre');
                } else if (state === 'OFF' || state === 'FINAL') {
                    gameItem.classList.add('game-final');
                }

                // Apply team brand colors to the pill, but ONLY for scheduled
                // and final games. LIVE games keep the green 'happening now'
                // background (more urgent than team identity), and PRE games
                // keep the orange 'about to start' background.
                if (state === 'FUT' || state === 'OFF' || state === 'FINAL') {
                    const awayAbbrForColor = game.teams.away.team.abbreviation;
                    const homeAbbrForColor = game.teams.home.team.abbreviation;
                    const awayColor = TEAM_COLORS[awayAbbrForColor];
                    const homeColor = TEAM_COLORS[homeAbbrForColor];

                    // Pill background = away team color at 28% opacity.
                    // Subtle enough to keep text readable, saturated enough
                    // to identify the team at a glance.
                    if (awayColor) {
                        const bg = hexToRgba(awayColor, 0.28);
                        if (bg) gameItem.style.backgroundColor = bg;
                    }

                    // Left border = home team color, full saturation.
                    // Creates a 'split' visual: home stripe on the left,
                    // away color fills the rest. Both teams visible.
                    if (homeColor) {
                        gameItem.style.setProperty('--home-color', homeColor);
                    }
                }

                // For finished games, derive W/L from scores so we can mark
                // each team's badge. Ties are very rare in modern NHL (only
                // possible if a game is suspended and never resumed).
                let awayResult = null;
                let homeResult = null;
                if ((state === 'OFF' || state === 'FINAL') &&
                    game.teams.away.score !== null && game.teams.away.score !== undefined &&
                    game.teams.home.score !== null && game.teams.home.score !== undefined) {
                    const aw = Number(game.teams.away.score);
                    const hm = Number(game.teams.home.score);
                    if (aw > hm)      { awayResult = 'W'; homeResult = 'L'; }
                    else if (hm > aw)  { awayResult = 'L'; homeResult = 'W'; }
                    else               { awayResult = 'T'; homeResult = 'T'; }
                }

// Create logo elements using static NHL logo URLs
const awayLogo = document.createElement('img');
awayLogo.src = `https://assets.nhle.com/logos/nhl/svg/${game.teams.away.team.abbreviation}_light.svg`;
awayLogo.alt = game.teams.away.team.abbreviation;
awayLogo.className = 'team-logo';
const awayAbbr = document.createElement('span');
awayAbbr.textContent = game.teams.away.team.abbreviation;
awayAbbr.className = 'team-abbr';
// Highlight winner with a class (no text badge).
if (awayResult === 'W') {
    awayAbbr.classList.add('winner');
}

const homeLogo = document.createElement('img');
homeLogo.src = `https://assets.nhle.com/logos/nhl/svg/${game.teams.home.team.abbreviation}_light.svg`;
homeLogo.alt = game.teams.home.team.abbreviation;
homeLogo.className = 'team-logo';
const homeAbbr = document.createElement('span');
homeAbbr.textContent = game.teams.home.team.abbreviation;
homeAbbr.className = 'team-abbr';
// Highlight winner with a class (no text badge).
if (homeResult === 'W') {
    homeAbbr.classList.add('winner');
}
                // Text separator
                const separator = document.createElement('span');
                separator.textContent = ' @ ';
                // Append logos and separator
                // Symmetrical layout: away logo | away abbr | @ | home abbr | home logo
                // Logos frame the matchup on the outer edges, abbreviations grouped around @.
                gameItem.appendChild(awayLogo);
gameItem.appendChild(awayAbbr);
gameItem.appendChild(separator);
gameItem.appendChild(homeAbbr);
gameItem.appendChild(homeLogo);
gameItem.addEventListener('click', (e) => {
    e.stopPropagation();
    showGameDetails(game);
});
                dayCell.appendChild(gameItem);
            });
            }
            // If any game in this day is live, mark the cell so it gets a
            // pulsing green border to draw the user's attention.
            if (dayHasLive) {
                dayCell.classList.add('has-live');
            }
        }

        calendar.appendChild(dayCell);
    }

    // Auto-shrink every game pill to fit its cell on a single line.
    // CSS sets white-space: nowrap on .game-item (no wrapping) + transform:
    // scale(var(--pill-scale, 1)). Here we measure each pill's scrollWidth
    // vs its clientWidth and set --pill-scale so the content fits inside
    // the cell without clipping, wrapping, or truncating with ellipsis.
    fitPillsToCells();

    // Auto-scroll to today's cell after the calendar grid is rendered.
    // No-op if today isn't in the currently displayed month.
    scrollToToday();
}

// Measure each .game-item and set --pill-scale so it fits its container on
// one line. Called after every renderCalendar() and after a window resize.
// We use requestAnimationFrame so the layout is settled before we measure.
// ALSO: team logos load asynchronously, so we re-run after all images in
// the calendar have loaded - otherwise the initial measurement would see
// 0-width <img> elements and decide no scaling is needed, then images load
// and content overflows the pill (clipped by overflow:hidden).
function fitPillsToCells() {
    // Reset the images-loaded flag so we wait for the new batch of images
    // (every render creates new <img> elements with team logos that need
    // to load before we can accurately measure pill widths).
    _imagesFitRan = false;
    requestAnimationFrame(() => {
        _fitPillsOnce();
        // After images load, re-measure (they may have made pills wider).
        _refitWhenImagesLoaded();
    });
}

// Internal: do one pass of measurement + scale-setting.
function _fitPillsOnce() {
    const pills = document.querySelectorAll('#calendar .game-item, #weekView .game-item');
    pills.forEach(pill => {
        const sw = pill.scrollWidth;
        const cw = pill.clientWidth;
        if (sw > cw && cw > 0) {
            // Scale down proportionally so the FULL content is visible.
            //
            // The math: pill has overflow:hidden + width = 100% of cell.
            // Without intervention, content beyond clientWidth gets clipped.
            //
            // We set the pill's width explicitly to its scrollWidth so the
            // pill itself is wide enough to contain all its content (no
            // clipping). Then we apply transform: scale(cw/sw) which visually
            // shrinks the entire pill to fit inside the cell. Because the
            // pill's own width matches its content, no internal clipping
            // happens - the user sees the whole pill, just smaller.
            const scale = cw / sw;
            // Don't scale UP beyond 1.0 (no benefit), only down.
            // Also clamp to a minimum of 0.5 so the text stays readable.
            const finalScale = Math.max(0.5, Math.min(1, scale));
            pill.style.width = sw + 'px';
            pill.style.setProperty('--pill-scale', finalScale.toFixed(3));
        } else {
            // Fits naturally - reset width and scale.
            pill.style.width = '';
            pill.style.setProperty('--pill-scale', '1');
        }
    });
}

// Internal: wait for all team logo images to finish loading, then re-fit.
// Guards against double-running via the _imagesFitRan flag.
let _imagesFitRan = false;
function _refitWhenImagesLoaded() {
    if (_imagesFitRan) return;
    const imgs = document.querySelectorAll('#calendar .game-item img, #weekView .game-item img');
    if (imgs.length === 0) return;
    const allLoaded = Array.from(imgs).every(img => img.complete && img.naturalWidth > 0);
    if (allLoaded) {
        _imagesFitRan = true;
        // Wait one more frame so the browser lays out the loaded images.
        requestAnimationFrame(_fitPillsOnce);
    } else {
        // Some images still loading - retry in 100ms (debounced).
        setTimeout(_refitWhenImagesLoaded, 100);
    }
}

// Close the game-details modal and restore background scrolling.
function closeGameDetails() {
    document.getElementById('gameDetails').classList.add('hidden');
    unlockBodyScroll();
}

// Lock the body's scroll so the page behind the modal doesn't scroll when
// the user scrolls inside the popup. Saves the current scroll position so
// it can be restored on unlock (because position:fixed resets scroll).
let savedScrollY = 0;
function lockBodyScroll() {
    if (document.body.classList.contains('modal-open')) return; // already locked
    savedScrollY = window.scrollY || window.pageYOffset || 0;
    document.body.classList.add('modal-open');
    // Set top so the page doesn't jump to the top when position:fixed is applied.
    document.body.style.top = `-${savedScrollY}px`;
}

// Restore body scroll and jump back to where the user was before opening the modal.
function unlockBodyScroll() {
    if (!document.body.classList.contains('modal-open')) return;
    document.body.classList.remove('modal-open');
    document.body.style.top = '';
    window.scrollTo(0, savedScrollY);
}

// Show game details - fetches live detail from /api/game?id=...
async function showGameDetails(game) {
    const detailsModal = document.getElementById('gameDetails');
    const detailsTitle = document.getElementById('detailsTitle');
    const detailsContent = document.getElementById('detailsContent');

    detailsTitle.textContent = `${game.teams.away.team.name} @ ${game.teams.home.team.name}`;

    // Show loading state immediately so the popup appears responsive.
    detailsContent.innerHTML = '<div class="detail-loading">Loading game details...</div>';
    detailsModal.classList.remove('hidden');

    // Lock the background page so scrolling inside the modal doesn't move the page behind.
    lockBodyScroll();

    // Always render the basic info first (date/time/venue), which we already have.
    const basicHtml = renderBasicGameInfo(game);

    // Try to fetch live detail. Fall back to basic if the fetch fails.
    try {
        if (!game.gamePk) {
            throw new Error('No game ID available (game may not have started)');
        }
        const response = await fetch(`/api/game?id=${game.gamePk}`);
        if (!response.ok) {
            const err = await response.json().catch(() => ({}));
            throw new Error(err.error || `Server returned ${response.status}`);
        }
        const detail = await response.json();
        detailsContent.innerHTML = basicHtml + renderLiveDetail(detail);
        attachDetailHandlers(game, detail);
    } catch (err) {
        detailsContent.innerHTML = basicHtml +
            `<div class="detail-error">Live details unavailable: ${escapeHtml(err.message)}</div>`;
    }
}

// Render the basic game info (date/time/venue/teams) that comes from /api/schedule.
function renderBasicGameInfo(game) {
    const gameDate = new Date(game.gameDate);
    const formattedDate = gameDate.toLocaleDateString('en-US', {
        weekday: 'long', year: 'numeric', month: 'long', day: 'numeric'
    });
    const formattedTime = gameDate.toLocaleTimeString('en-US', {
        hour: '2-digit', minute: '2-digit'
    });

    // Build a status badge that reflects the game state.
    const state = game.gameState || game.status.abstractGameState || 'PRE';
    const badge = renderStatusBadge(state, game.clock);

    // Big score display (may be null if game hasn't started).
    const awayScore = game.teams.away.score;
    const homeScore = game.teams.home.score;
    const scoreDisplay = (awayScore !== null && awayScore !== undefined) ? `
        <div class="score-display">
            <div class="score-team">
                <span class="score-abbr">${escapeHtml(game.teams.away.team.abbreviation)}</span>
                <span class="score-num">${awayScore}</span>
            </div>
            <div class="score-sep">-</div>
            <div class="score-team">
                <span class="score-abbr">${escapeHtml(game.teams.home.team.abbreviation)}</span>
                <span class="score-num">${homeScore}</span>
            </div>
        </div>
    ` : '';

    return `
        ${badge}
        ${scoreDisplay}
        <div class="detail-row">
            <span class="detail-label">Date:</span>
            <span class="detail-value">${escapeHtml(formattedDate)}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Time:</span>
            <span class="detail-value">${escapeHtml(formattedTime)}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Venue:</span>
            <span class="detail-value">${escapeHtml(game.venue.name)}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Away:</span>
            <span class="detail-value">
                ${escapeHtml(game.teams.away.team.name)} (${escapeHtml(game.teams.away.team.abbreviation)})
                <button class="star-btn ${isFavoriteTeam(game.teams.away.team.abbreviation) ? 'starred' : ''}" data-team="${escapeHtml(game.teams.away.team.abbreviation)}" type="button" aria-label="Toggle favorite for ${escapeHtml(game.teams.away.team.abbreviation)}" title="Toggle favorite">${isFavoriteTeam(game.teams.away.team.abbreviation) ? '★' : '☆'}</button>
            </span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Home:</span>
            <span class="detail-value">
                ${escapeHtml(game.teams.home.team.name)} (${escapeHtml(game.teams.home.team.abbreviation)})
                <button class="star-btn ${isFavoriteTeam(game.teams.home.team.abbreviation) ? 'starred' : ''}" data-team="${escapeHtml(game.teams.home.team.abbreviation)}" type="button" aria-label="Toggle favorite for ${escapeHtml(game.teams.home.team.abbreviation)}" title="Toggle favorite">${isFavoriteTeam(game.teams.home.team.abbreviation) ? '★' : '☆'}</button>
            </span>
        </div>
    `;
}

// Render the live detail section: shots on goal, period info, goals list, action buttons.
function renderLiveDetail(detail) {
    const away = detail.awayTeam || {};
    const home = detail.homeTeam || {};
    const goals = detail.goals || [];

    // Status badge (refresh with potentially-newer data)
    const state = detail.gameState || 'PRE';
    const badge = renderStatusBadge(state, detail.clock);

    // Score display from detail (more current than schedule data)
    let scoreHtml = '';
    if (away.score !== null && away.score !== undefined) {
        scoreHtml = `
            <div class="score-display">
                <div class="score-team">
                    <span class="score-abbr">${escapeHtml(away.abbrev)}</span>
                    <span class="score-num">${away.score}</span>
                </div>
                <div class="score-sep">-</div>
                <div class="score-team">
                    <span class="score-abbr">${escapeHtml(home.abbrev)}</span>
                    <span class="score-num">${home.score}</span>
                </div>
            </div>
        `;
    }

    // Shots on goal row
    let sogHtml = '';
    if (away.sog !== null && away.sog !== undefined) {
        sogHtml = `
            <div class="sog-row">
                <span class="sog-label">Shots:</span>
                <span class="sog-value">${escapeHtml(away.abbrev)} ${away.sog} - ${home.sog} ${escapeHtml(home.abbrev)}</span>
            </div>
        `;
    }

    // Goals list
    let goalsHtml = '';
    if (goals.length > 0) {
        const items = goals.map(g => {
            const periodLabel = formatPeriodLabel(g.period, g.periodType);
            const strengthLabel = formatStrength(g.strength);
            const scoreStr = `${escapeHtml(g.team || '')} ${g.awayScore}-${g.homeScore}`;
            const assistsStr = g.assists && g.assists.length > 0
                ? 'Assists: ' + g.assists.map(a => `${escapeHtml(a.name)} (${a.assistsToDate})`).join(', ')
                : 'Unassisted';
            const highlightLink = g.highlightUrl
                ? `<a class="goal-highlight" href="${escapeHtml(g.highlightUrl)}" target="_blank" rel="noopener">Watch highlight</a>`
                : '';
            return `
                <div class="goal-item">
                    <div class="goal-time">${escapeHtml(periodLabel)} ${escapeHtml(g.timeInPeriod || '')}</div>
                    <div class="goal-main">
                        <span class="goal-scorer">${escapeHtml(g.scorer)} (${g.goalsToDate})</span>
                        <span class="goal-team">${escapeHtml(g.team || '')}</span>
                        <span class="goal-strength">${escapeHtml(strengthLabel)}</span>
                    </div>
                    <div class="goal-score">${escapeHtml(scoreStr)}</div>
                    <div class="goal-assists">${escapeHtml(assistsStr)}</div>
                    ${highlightLink}
                </div>
            `;
        }).join('');
        goalsHtml = `
            <div class="goals-section">
                <h3>Goals</h3>
                ${items}
            </div>
        `;
    } else if (state === 'FUT' || state === 'PRE') {
        goalsHtml = '<div class="no-goals">Game has not started yet.</div>';
    } else if (state === 'LIVE' || state === 'CRIT') {
        goalsHtml = '<div class="no-goals">No goals yet.</div>';
    } else if (state === 'OFF' || state === 'FINAL') {
        goalsHtml = '<div class="no-goals">No scoring in this game.</div>';
    }

    // Action buttons (notify + refresh). Hide notify if game is final.
    const showNotify = (state !== 'OFF' && state !== 'FINAL');
    const notifyLabel = goalWatcher.isWatching(detail.gamePk) ? 'Stop watching' : 'Notify me of goals';
    const actionHtml = `
        <div class="detail-actions">
            ${showNotify ? `<button id="notifyBtn" class="action-btn notify-btn">${notifyLabel}</button>` : ''}
            <button id="refreshBtn" class="action-btn refresh-btn">Refresh</button>
        </div>
        <div id="watchStatus" class="watch-status"></div>
    `;

    return badge + scoreHtml + sogHtml + goalsHtml + actionHtml;
}

// Render a colored status badge for the game state.
function renderStatusBadge(state, clock) {
    let label, cls;
    switch (state) {
        case 'LIVE':
        case 'CRIT':
            label = 'LIVE';
            if (clock && clock.timeRemaining) label += ' - ' + clock.timeRemaining + ' left';
            cls = 'badge-live';
            break;
        case 'OFF':
        case 'FINAL':
            label = 'Final';
            cls = 'badge-final';
            break;
        case 'PRE':
            label = 'Pre-game';
            cls = 'badge-pre';
            break;
        case 'FUT':
        default:
            label = 'Scheduled';
            cls = 'badge-fut';
            break;
    }
    return `<div class="status-badge ${cls}">${escapeHtml(label)}</div>`;
}

// Format a period number+type into a readable label.
function formatPeriodLabel(period, periodType) {
    if (!period) return '';
    const suffix = (n) => {
        if (n === 1) return '1st';
        if (n === 2) return '2nd';
        if (n === 3) return '3rd';
        return n + 'th';
    };
    let label = suffix(period);
    if (periodType === 'OT') label += ' OT';
    if (periodType === 'SO') label = 'Shootout';
    return label;
}

// Format strength code into human-readable text.
function formatStrength(strength) {
    switch (strength) {
        case 'ev': return 'EV';
        case 'pp': return 'PP';
        case 'sh': return 'SH';
        case 'en': return 'EN';
        default: return strength || '';
    }
}

// Escape HTML special chars in user-supplied strings to prevent injection.
function escapeHtml(s) {
    if (s === null || s === undefined) return '';
    return String(s)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#39;');
}

// Wire up the action buttons after the detail HTML is rendered.
function attachDetailHandlers(game, detail) {
    const refreshBtn = document.getElementById('refreshBtn');
    if (refreshBtn) {
        refreshBtn.addEventListener('click', () => showGameDetails(game));
    }
    const notifyBtn = document.getElementById('notifyBtn');
    if (notifyBtn) {
        notifyBtn.addEventListener('click', () => {
            const gameId = detail.gamePk || game.gamePk;
            const name = `${game.teams.away.team.abbreviation} @ ${game.teams.home.team.abbreviation}`;
            if (goalWatcher.isWatching(gameId)) {
                goalWatcher.unwatch(gameId);
                notifyBtn.textContent = 'Notify me of goals';
                updateWatchStatus('Stopped watching for goals.');
            } else {
                goalWatcher.watch(gameId, name);
                notifyBtn.textContent = 'Stop watching';
                updateWatchStatus('Watching for goals - notifications enabled.');
            }
        });
        // Sync button label if already watching
        const gameId = detail.gamePk || game.gamePk;
        if (goalWatcher.isWatching(gameId)) {
            notifyBtn.textContent = 'Stop watching';
            updateWatchStatus('Watching for goals - notifications enabled.');
        }
    }

    // Star buttons - toggle favorite state for each team.
    const starBtns = document.querySelectorAll('.star-btn');
    starBtns.forEach(btn => {
        btn.addEventListener('click', (e) => {
            e.stopPropagation();
            const team = btn.getAttribute('data-team');
            if (!team) return;
            const nowFav = toggleFavorite(team);
            // Update the button's visual state immediately.
            btn.classList.toggle('starred', nowFav);
            btn.textContent = nowFav ? '★' : '☆';
            // Re-render calendar + today strip so gold border appears/disappears.
            refreshAfterFavoritesChange();
        });
    });
}

function updateWatchStatus(msg) {
    const el = document.getElementById('watchStatus');
    if (el) el.textContent = msg;
}

// ============================================================================
// GoalWatcher - polls /api/game every N seconds and fires notifications on goals.
// ============================================================================
class GoalWatcher {
    constructor() {
        this.watched = new Map();  // gameId -> { name, lastGoalCount, pollTimer }
    }

    isWatching(gameId) {
        return this.watched.has(String(gameId));
    }

    async watch(gameId, gameName) {
        gameId = String(gameId);
        if (this.watched.has(gameId)) return;

        // Request notification permission if needed.
        if ('Notification' in window && Notification.permission === 'default') {
            try {
                const perm = await Notification.requestPermission();
                if (perm !== 'granted') {
                    updateWatchStatus('Notification permission denied. Enable notifications to receive goal alerts.');
                    return;
                }
            } catch (e) {
                updateWatchStatus('Could not request notification permission.');
                return;
            }
        }

        this.watched.set(gameId, { name: gameName, lastGoalCount: -1, pollTimer: null });
        // Fire one immediate poll so we record the baseline goal count.
        this.pollGame(gameId);
    }

    unwatch(gameId) {
        gameId = String(gameId);
        const entry = this.watched.get(gameId);
        if (!entry) return;
        if (entry.pollTimer) clearTimeout(entry.pollTimer);
        this.watched.delete(gameId);
    }

    async pollGame(gameId) {
        gameId = String(gameId);
        const entry = this.watched.get(gameId);
        if (!entry) return;

        try {
            const r = await fetch(`/api/game?id=${gameId}`);
            if (r.ok) {
                const d = await r.json();
                const goals = d.goals || [];
                const totalGoals = goals.length;

                if (entry.lastGoalCount === -1) {
                    // Baseline - don't fire notifications for existing goals.
                    entry.lastGoalCount = totalGoals;
                } else if (totalGoals > entry.lastGoalCount) {
                    // New goal(s)! Fire a notification for the most recent one.
                    const newGoal = goals[totalGoals - 1];
                    if (newGoal) {
                        this.fireGoalNotification(entry.name, newGoal);
                    }
                    entry.lastGoalCount = totalGoals;
                }

                // If game is final, send a final notification and stop watching.
                if (d.gameState === 'OFF' || d.gameState === 'FINAL') {
                    this.fireFinalNotification(entry.name, d);
                    this.unwatch(gameId);
                    updateWatchStatus('Game is final - stopped watching.');
                    return;
                }
            }
        } catch (e) {
            // Transient network errors are OK - we'll retry on the next poll.
            console.warn(`GoalWatcher poll failed for ${gameId}:`, e.message);
        }

        // Schedule the next poll.
        // 30s for live games, 60s for scheduled games.
        // (We don't know the state here without parsing it; default to 60s.)
        entry.pollTimer = setTimeout(() => this.pollGame(gameId), 60000);
    }

    fireGoalNotification(gameName, goal) {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;

        const period = formatPeriodLabel(goal.period, goal.periodType);
        const time = goal.timeInPeriod || '';
        const scorer = goal.scorer || 'Unknown';
        const team = goal.team || '';
        const assists = (goal.assists || [])
            .map(a => a.name)
            .join(', ');
        const assistsStr = assists ? ' from ' + assists : ' (unassisted)';

        const title = `GOAL: ${team}`;
        const body = `${scorer}${assistsStr}
${period} ${time} - ${gameName}
Score: ${goal.awayScore}-${goal.homeScore}`;

        try {
            new Notification(title, {
                body: body,
                tag: `goal-${goal.team}-${goal.period}-${goal.timeInPeriod}`,
                icon: '/icons/favicon.svg',
            });
        } catch (e) {
            console.warn('Notification failed:', e);
        }
    }

    fireFinalNotification(gameName, detail) {
        if (!('Notification' in window) || Notification.permission !== 'granted') return;
        const away = detail.awayTeam || {};
        const home = detail.homeTeam || {};
        const title = `Final: ${gameName}`;
        const body = `${away.abbrev} ${away.score} - ${home.score} ${home.abbrev}`;
        try {
            new Notification(title, { body: body, tag: `final-${detail.gamePk}` });
        } catch (e) {
            console.warn('Notification failed:', e);
        }
    }
}

// Singleton instance - created on script load.
const goalWatcher = new GoalWatcher();


// UI helper functions
function showLoading(show) {
    const loading = document.getElementById('loading');
    if (show) {
        loading.classList.remove('hidden');
    } else {
        loading.classList.add('hidden');
    }
}

function showError(message) {
    const error = document.getElementById('error');
    error.textContent = message;
    error.classList.remove('hidden');
}

function hideError() {
    const error = document.getElementById('error');
    error.classList.add('hidden');
}

// Auto-scroll the calendar to today's cell.
// If today isn't in the current month (e.g. user navigated to November),
// scroll to the top of the page so they see the start of the month rather
// than a random scroll position left over from the previous month.
function scrollToToday() {
    const todayCell = document.querySelector('.day-cell.today');
    if (todayCell) {
        // Today is in the displayed month - scroll to it.
        requestAnimationFrame(() => {
            todayCell.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    } else {
        // Today isn't in this month - scroll to top of page.
        window.scrollTo({ top: 0, behavior: 'smooth' });
    }
}
