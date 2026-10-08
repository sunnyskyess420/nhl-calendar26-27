# NHL Calendar PWA

A Progressive Web App (PWA) that displays NHL game schedules in a beautiful calendar format. View one month at a time with easy navigation between months.

## Features

- **Monthly Calendar View**: See all NHL games for a specific month in a clean, organized calendar grid
- **Easy Navigation**: Use arrow buttons to move forward or backward through months
- **Real-Time Data**: Fetches live schedule data from the official NHL API
- **Game Details**: Click on any game to see detailed information including:
  - Date and time
  - Venue
  - Teams playing
  - Game status
- **Today Highlighting**: Current day is highlighted with a green border
- **Responsive Design**: Works on desktop, tablet, and mobile devices
- **PWA Support**: Install as a desktop app for quick access
- **Offline Capability**: Service worker caches assets for offline viewing

## How to Use

### Online (GitHub Pages)

Visit the live site at: **https://sunnyskyess420.github.io/nhl-calendar/**

### Local

1. **Double-click** either of these files to launch the app:
   - `Start NHL Calendar.cmd` (recommended)
   - `Start NHL Calendar.vbs`

2. The calendar will open in your default browser, showing the current month's NHL schedule

### Navigation

- **Left Arrow (<)**: Go to previous month
- **Right Arrow (>)**: Go to next month
- **Click on a game**: View detailed game information in a modal popup
- **Click X or outside modal**: Close game details

### Installing as a PWA

1. Open the app in Chrome, Edge, or another modern browser
2. Look for the "Install" icon in the address bar (usually a "+" or download icon)
3. Click "Install" to add it to your desktop or start menu
4. The app will launch as a standalone application

## Project Structure

```
nhl-calendar/
├── docs/
│   ├── index.html          # Main HTML file
│   ├── styles.css          # Styling and layout
│   ├── app.js              # Application logic and NHL API integration
│   ├── sw.js               # Service worker for offline support
│   ├── manifest.webmanifest # PWA manifest file
│   └── icons/
│       └── favicon.svg     # App icon
├── Start NHL Calendar.cmd  # Windows batch file to launch app
├── Start NHL Calendar.vbs  # VBScript to launch app
└── README.md              # This file
```

## Technical Details

### NHL API

This app uses the official NHL Stats API:
- Base URL: `https://statsapi.web.nhl.com/api/v1`
- Endpoint: `/schedule` with date range parameters
- No API key required - it's a free public API

### Browser Compatibility

- Chrome/Edge: Full PWA support
- Firefox: Full support
- Safari: Partial support (some PWA features may not work)

### Data Source

The app fetches schedule data directly from the NHL's official API, ensuring accurate and up-to-date information. Games are displayed with team abbreviations for compact viewing.

## Customization

### Changing Colors

Edit `docs/styles.css` to customize the color scheme:
- Primary color: `#e31837` (NHL red)
- Background: `#1a1a2e` to `#16213e` (dark blue gradient)
- Highlight: `#00ff00` (green for today)

### Modifying the Date Range

By default, the app allows navigation through all months. If you want to restrict to the current NHL season only, modify the `loadSchedule` function in `docs/app.js`.

## Troubleshooting

### Games Not Loading

- Check your internet connection
- The NHL API may be temporarily unavailable
- Try refreshing the page

### PWA Not Installing

- Ensure you're using a modern browser (Chrome, Edge, Firefox)
- Make sure you're serving the files via HTTP or HTTPS (not file://)
- For local development, consider using a simple HTTP server

### Calendar Display Issues

- Clear your browser cache
- Disable any ad blockers that might interfere with the NHL API
- Try a different browser

## Future Enhancements

Potential features for future versions:
- Favorite team filtering
- Game reminders/notifications
- Score updates for live games
- Team logos instead of abbreviations
- Export calendar to iCal format
- Dark/light theme toggle

## License

This project is for personal use. The NHL API is provided by the NHL and may be subject to their terms of service.

## Credits

- NHL data provided by the official NHL Stats API
- Built with vanilla HTML, CSS, and JavaScript
- No external dependencies required

---

Enjoy tracking your favorite NHL games! 🏒
