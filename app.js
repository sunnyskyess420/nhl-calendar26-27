// NHL Calendar PWA
// Fetches NHL schedule from our Vercel serverless function at /api/schedule
// (no more CORS proxies, no more mock data — real games only)

let currentDate = new Date();
let gamesData = [];
// Define the allowed hockey season range (2026‑2027)
// NHL regular season typically runs from early October to early June.
const SEASON_START = new Date(2026, 9, 1); // Oct 1, 2026 (month is 0‑based)
const SEASON_END   = new Date(2027, 5, 30); // Jun 30, 2027

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
        currentDate.setMonth(currentDate.getMonth() - 1);
        loadSchedule(currentDate);
    });

    document.getElementById('nextMonth').addEventListener('click', () => {
        currentDate.setMonth(currentDate.getMonth() + 1);
        loadSchedule(currentDate);
    });

    document.getElementById('closeDetails').addEventListener('click', () => {
        document.getElementById('gameDetails').classList.add('hidden');
    });

    // Re-render calendar when viewport crosses the narrow breakpoint so the
    // day-of-week labels switch between 'Sun' and 'S' as the user resizes
    // the browser or rotates their phone.
    const narrowMQ = window.matchMedia('(max-width: 600px)');
    const handleMQChange = () => {
        // Only re-render if we already have data loaded.
        if (gamesData && Object.keys(gamesData).length > 0) {
            renderCalendar(currentDate);
        }
    };
    if (narrowMQ.addEventListener) {
        narrowMQ.addEventListener('change', handleMQChange);
    } else if (narrowMQ.addListener) {
        // Older Safari fallback.
        narrowMQ.addListener(handleMQChange);
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
            gamesData[dateKey].forEach(game => {
                const gameItem = document.createElement('div');
                gameItem.className = 'game-item';
// Create logo elements using static NHL logo URLs
const awayLogo = document.createElement('img');
awayLogo.src = `https://assets.nhle.com/logos/nhl/svg/${game.teams.away.team.abbreviation}_light.svg`;
awayLogo.alt = game.teams.away.team.abbreviation;
awayLogo.className = 'team-logo';
const awayAbbr = document.createElement('span');
awayAbbr.textContent = game.teams.away.team.abbreviation;
awayAbbr.className = 'team-abbr';

const homeLogo = document.createElement('img');
homeLogo.src = `https://assets.nhle.com/logos/nhl/svg/${game.teams.home.team.abbreviation}_light.svg`;
homeLogo.alt = game.teams.home.team.abbreviation;
homeLogo.className = 'team-logo';
const homeAbbr = document.createElement('span');
homeAbbr.textContent = game.teams.home.team.abbreviation;
homeAbbr.className = 'team-abbr';
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
        }

        calendar.appendChild(dayCell);
    }

    // Auto-scroll to today's cell after the calendar grid is rendered.
    // No-op if today isn't in the currently displayed month.
    scrollToToday();
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
