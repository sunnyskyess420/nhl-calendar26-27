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

    // Add day headers
    const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
    dayNames.forEach(day => {
        const header = document.createElement('div');
        header.className = 'day-header';
        header.textContent = day;
        calendar.appendChild(header);
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

// Show game details
function showGameDetails(game) {
    const detailsModal = document.getElementById('gameDetails');
    const detailsTitle = document.getElementById('detailsTitle');
    const detailsContent = document.getElementById('detailsContent');

    const gameDate = new Date(game.gameDate);
    const formattedDate = gameDate.toLocaleDateString('en-US', {
        weekday: 'long',
        year: 'numeric',
        month: 'long',
        day: 'numeric'
    });

    const formattedTime = gameDate.toLocaleTimeString('en-US', {
        hour: '2-digit',
        minute: '2-digit'
    });

    detailsTitle.textContent = `${game.teams.away.team.name} @ ${game.teams.home.team.name}`;

    detailsContent.innerHTML = `
        <div class="detail-row">
            <span class="detail-label">Date:</span>
            <span class="detail-value">${formattedDate}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Time:</span>
            <span class="detail-value">${formattedTime}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Venue:</span>
            <span class="detail-value">${game.venue.name}</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Away Team:</span>
            <span class="detail-value">${game.teams.away.team.name} (${game.teams.away.team.abbreviation})</span>
        </div>
        <div class="detail-row">
            <span class="detail-label">Home Team:</span>
            <span class="detail-value">${game.teams.home.team.name} (${game.teams.home.team.abbreviation})</span>
        </div>
        ${game.status.detailedState ? `
        <div class="detail-row">
            <span class="detail-label">Status:</span>
            <span class="detail-value">${game.status.detailedState}</span>
        </div>
        ` : ''}
    `;

    detailsModal.classList.remove('hidden');
}

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
