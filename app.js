// NHL Calendar PWA
// Fetches NHL schedule from our Vercel serverless function at /api/schedule
// (no more CORS proxies, no more mock data — real games only)

let currentDate = new Date();
let gamesData = [];
let currentView = 'month';             // 'month' or 'week'
let currentWeekStart = null;            // Date (first day of displayed week) when in week view
// Define the allowed hockey season range (2026‑2027)
// NHL regular season typically runs from early October to early June.
const SEASON_START = new Date(2026, 9, 1); // Oct 1, 2026 (month is 0‑based)
const SEASON_END   = new Date(2027, 5, 30); // Jun 30, 2027

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

// Helper: check if a date (first day of its month) is within the allowed season
function isInSeason(date) {
  const firstOfMonth = new Date(date.getFullYear(), date.getMonth(), 1);
  return firstOfMonth >= SEASON_START && firstOfMonth <= SEASON_END;
}

// Enable/disable navigation buttons based on current month
function updateNavButtons() {
  const prevBtn = document.getElementById('prevMonth');
  const nextBtn = document.getElementById('nextMonth');
  // Compute month boundaries
  const prevMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1);
  const nextMonth = new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1);
  prevBtn.disabled = prevMonth < SEASON_START;
  nextBtn.disabled = nextMonth > SEASON_END;
}
document.addEventListener('DOMContentLoaded', () => {
    registerServiceWorker();
    setupEventListeners();
    loadSchedule(currentDate);
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

    // Click outside the modal (on the modal's backdrop area) also closes it.
    document.getElementById('gameDetails').addEventListener('click', (e) => {
        // Only close if the click was on the modal container itself, not its children.
        if (e.target === e.currentTarget) {
            closeGameDetails();
        }
    });

    // ESC key closes the modal.
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') {
            const modal = document.getElementById('gameDetails');
            if (modal && !modal.classList.contains('hidden')) {
                closeGameDetails();
            }
        }
    });

    // View toggle tabs - switch between Month and Week views.
    document.getElementById('viewMonth').addEventListener('click', () => setView('month'));
    document.getElementById('viewWeek').addEventListener('click', () => setView('week'));

    // Re-render calendar when viewport crosses the narrow breakpoint so the
    // day-of-week labels switch between 'Sun' and 'S' as the user resizes
    // the browser or rotates their phone.
    const narrowMQ = window.matchMedia('(max-width: 600px)');
    const handleMQChange = () => {
        // Only re-render if we already have data loaded.
        if (gamesData && Object.keys(gamesData).length > 0) {
            if (currentView === 'week') renderWeekView();
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
            resizeRaf = 0;
        });
    });

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

// Switch between month and week views.
function setView(view) {
    if (view === currentView) return;
    currentView = view;

    // Update tab active state.
    document.getElementById('viewMonth').classList.toggle('active', view === 'month');
    document.getElementById('viewWeek').classList.toggle('active', view === 'week');

    // Show/hide the appropriate container.
    document.getElementById('calendar').classList.toggle('hidden', view !== 'month');
    document.getElementById('weekView').classList.toggle('hidden', view !== 'week');
    // The day-of-week row (Sun Mon Tue...) only makes sense in month view.
    document.getElementById('dayHeaders').classList.toggle('hidden', view !== 'month');

    if (view === 'week') {
        // First time entering week view, or returning to it. Center on today.
        if (!currentWeekStart) currentWeekStart = getTodayWeekStart();
        loadWeekSchedule(currentWeekStart);
    } else {
        renderCalendar(currentDate);
        updateNavButtons();
    }
}

// Compute the start of the week centered on today (today minus 3 days).
function getTodayWeekStart() {
    const t = new Date();
    return new Date(t.getFullYear(), t.getMonth(), t.getDate() - 3);
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
    const seasonStartDay = new Date(SEASON_START.getFullYear(), SEASON_START.getMonth(), SEASON_START.getDate());
    const seasonEndDay = new Date(SEASON_END.getFullYear(), SEASON_END.getMonth(), SEASON_END.getDate());
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
        document.getElementById('weekView')
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
    // Season guard – only allow dates within Oct 2026 → Jun 2027
    if (!isInSeason(date)) {
        showError('No schedule available – the calendar only covers the 2026‑2027 NHL season.');
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
        renderCalendar(date);
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

// Process schedule data from NHL API
function processScheduleData(data) {
    const games = {};

    if (data.dates) {
        data.dates.forEach(dateData => {
            const dateKey = dateData.date;
            games[dateKey] = dateData.games || [];
        });
    }

    return games;
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
                const gameItem = document.createElement('div');
                gameItem.className = 'game-item week-game-item';

                const state = game.gameState || game.status.abstractGameState || 'FUT';
                if (state === 'LIVE' || state === 'CRIT') {
                    gameItem.classList.add('game-live');
                    dayHasLive = true;
                } else if (state === 'PRE') {
                    gameItem.classList.add('game-pre');
                } else if (state === 'OFF' || state === 'FINAL') {
                    gameItem.classList.add('game-final');
                }

                // Derive W/L for finished games.
                let awayResult = null, homeResult = null;
                if ((state === 'OFF' || state === 'FINAL') &&
                    game.teams.away.score !== null && game.teams.away.score !== undefined &&
                    game.teams.home.score !== null && game.teams.home.score !== undefined) {
                    const aw = Number(game.teams.away.score);
                    const hm = Number(game.teams.home.score);
                    if (aw > hm)      { awayResult = 'W'; homeResult = 'L'; }
                    else if (hm > aw)  { awayResult = 'L'; homeResult = 'W'; }
                    else               { awayResult = 'T'; homeResult = 'T'; }
                }

                // Team-colored pill (same as month view).
                if (state === 'FUT' || state === 'OFF' || state === 'FINAL') {
                    const awayColor = TEAM_COLORS[game.teams.away.team.abbreviation];
                    const homeColor = TEAM_COLORS[game.teams.home.team.abbreviation];
                    if (awayColor) {
                        const bg = hexToRgba(awayColor, 0.28);
                        if (bg) gameItem.style.backgroundColor = bg;
                    }
                    if (homeColor) gameItem.style.setProperty('--home-color', homeColor);
                }

                // Logos + abbreviations + score + badges.
                const awayLogo = document.createElement('img');
                awayLogo.src = `https://assets.nhle.com/logos/nhl/svg/${game.teams.away.team.abbreviation}_light.svg`;
                awayLogo.alt = game.teams.away.team.abbreviation;
                awayLogo.className = 'team-logo';
                const awayAbbr = document.createElement('span');
                awayAbbr.textContent = game.teams.away.team.abbreviation;
                awayAbbr.className = 'team-abbr';
                if (awayResult === 'W') {
                    // Highlight winner with a class (no text badge) - takes 0 horizontal space.
                    awayAbbr.classList.add('winner');
                }

                const homeLogo = document.createElement('img');
                homeLogo.src = `https://assets.nhle.com/logos/nhl/svg/${game.teams.home.team.abbreviation}_light.svg`;
                homeLogo.alt = game.teams.home.team.abbreviation;
                homeLogo.className = 'team-logo';
                const homeAbbr = document.createElement('span');
                homeAbbr.textContent = game.teams.home.team.abbreviation;
                homeAbbr.className = 'team-abbr';
                if (homeResult === 'W') {
                    homeAbbr.classList.add('winner');
                }

                // Score (live or final games only).
                const scoreSpan = document.createElement('span');
                scoreSpan.className = 'week-game-score';
                if (game.teams.away.score !== null && game.teams.away.score !== undefined) {
                    scoreSpan.textContent = `${game.teams.away.score} - ${game.teams.home.score}`;
                } else {
                    // Show game time for scheduled games.
                    const gd = new Date(game.gameDate);
                    const tm = gd.toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' });
                    scoreSpan.textContent = tm;
                }

                gameItem.appendChild(awayLogo);
                gameItem.appendChild(awayAbbr);
                const sep = document.createElement('span');
                sep.textContent = ' @ ';
                gameItem.appendChild(sep);
                gameItem.appendChild(homeLogo);
                gameItem.appendChild(homeAbbr);
                gameItem.appendChild(scoreSpan);

                gameItem.addEventListener('click', (e) => {
                    e.stopPropagation();
                    showGameDetails(game);
                });

                cardBody.appendChild(gameItem);
            });
            if (dayHasLive) card.classList.add('has-live');
        }
        card.appendChild(cardBody);
        weekView.appendChild(card);
    }

    // Auto-scroll the page so today's card is in view (not the sticky header).
    const todayCard = weekView.querySelector('.week-day-card.is-today');
    if (todayCard) {
        requestAnimationFrame(() => {
            todayCard.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
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
    const seasonStartDay = new Date(SEASON_START.getFullYear(), SEASON_START.getMonth(), SEASON_START.getDate());
    const seasonEndDay = new Date(SEASON_END.getFullYear(), SEASON_END.getMonth(), SEASON_END.getDate());
    prevBtn.disabled = (weekEndDate <= seasonStartDay);
    nextBtn.disabled = (currentWeekStart >= seasonEndDay);
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
            gamesData[dateKey].forEach(game => {
                const gameItem = document.createElement('div');
                gameItem.className = 'game-item';

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
                gameItem.appendChild(awayLogo);
gameItem.appendChild(awayAbbr);
gameItem.appendChild(separator);
gameItem.appendChild(homeLogo);
gameItem.appendChild(homeAbbr);
gameItem.addEventListener('click', (e) => {
    e.stopPropagation();
    showGameDetails(game);
});
                dayCell.appendChild(gameItem);
            });
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
            <span class="detail-value">${escapeHtml(game.teams.away.team.name)} (${escapeHtml(game.teams.away.team.abbreviation)})</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Home:</span>
            <span class="detail-value">${escapeHtml(game.teams.home.team.name)} (${escapeHtml(game.teams.home.team.abbreviation)})</span>
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
// No-op if today isn't in the current month (no .today cell exists).
function scrollToToday() {
    const todayCell = document.querySelector('.day-cell.today');
    if (todayCell) {
        // Wait one frame so layout settles before scrolling.
        requestAnimationFrame(() => {
            todayCell.scrollIntoView({ behavior: 'smooth', block: 'center' });
        });
    }
}
