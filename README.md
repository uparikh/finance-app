# Personal Finance Tracker

A private, offline-first personal finance tracking PWA for iPhone.

## Features

- 📄 **Upload bank statements** — PDF upload with automatic transaction parsing
- 🏦 **Supported banks**: Ally Bank, Capital One, Bilt Obsidian, Discover It, Wells Fargo Autograph
- 📊 **Dashboard** — monthly spending summary, top categories, recent transactions
- 💳 **Transaction history** — full list with search, filtering by category/month, and inline editing
- 📈 **Analytics** — spending trends, category breakdown charts, monthly calendar heatmap
- ⚙️ **Settings** — category management, data export/import, theme toggle
- 🌙 **Light & dark mode** — follows system preference, manually overridable
- 🔒 **100% offline** — all data stays on your device in IndexedDB, nothing is ever sent to a server

---

## How to Run

### On your computer (development):

```bash
# Navigate to the project folder
cd finance-app

# Start the local server
python -m http.server 3000

# Open in browser
# → http://localhost:3000
```

### On your iPhone (install as PWA):

1. Make sure your iPhone and computer are on the **same Wi-Fi network**
2. Find your computer's local IP address:
   - **Mac**: System Settings → Wi-Fi → Details → IP Address
   - **Windows**: Run `ipconfig` in terminal → look for `IPv4 Address`
3. Open **Safari** on your iPhone
4. Navigate to: `http://YOUR_IP_ADDRESS:3000` (e.g. `http://192.168.1.100:3000`)
5. Tap the **Share button** (the box with an arrow pointing up: `⬆`)
6. Scroll down and tap **"Add to Home Screen"**
7. Tap **"Add"** — the app is now installed on your iPhone home screen!

> **Note:** The app must be served over HTTP (not opened as a file) for PWA features to work. The Python server handles this.

---

## One-Time Setup: Generate App Icons

Before installing on iPhone, generate the app icons:

1. Open `generate-icons.html` in your browser (via the local server: `http://localhost:3000/generate-icons.html`)
2. Click each **Download** button to save the icon files
3. Move the downloaded files into `assets/icons/`:
   - `icon-192.png`
   - `icon-512.png`
   - `icon-180.png`
4. Reload the app — icons will appear on the iPhone home screen after installation

---

## How to Use

### Uploading a Statement

1. Tap **Upload** (📂) in the bottom navigation
2. Tap **"Choose PDF"** and select a bank statement PDF
3. The app will automatically parse transactions from the PDF
4. Review the parsed transactions — tap any row to edit the category or description
5. Tap **"Save All Transactions"** to store them in the app

### Viewing Your Finances

- **Home (📊)** — Monthly summary card, spending by category, recent transactions
- **Analytics (📈)** — Trend charts, category pie chart, monthly spending calendar
- **Transactions (💳)** — Full searchable/filterable transaction list (accessible from Home → "See all")

### Managing Data

- **Settings (⚙️)** → **Export Data** — saves a JSON backup to your device
- **Settings (⚙️)** → **Import Data** — restores from a previously exported JSON file
- **Settings (⚙️)** → **Manage Categories** — add, rename, or reorder spending categories

---

## Privacy

All data is stored exclusively in your browser's **IndexedDB** on your device.

- ✅ No account required
- ✅ No internet connection needed after first load
- ✅ No data is ever transmitted to any server
- ✅ Works completely offline once installed

**To back up your data:** Settings → Export Data → save the JSON file to iCloud Drive or Files app.

---

## Project Structure

```
finance-app/
├── index.html              ← App shell (single HTML entry point)
├── manifest.json           ← PWA manifest (icons, display mode, theme)
├── sw.js                   ← Service worker (offline caching)
├── generate-icons.html     ← Tool to generate PNG app icons
├── README.md               ← This file
├── css/
│   ├── variables.css       ← Design tokens (colors, spacing, typography)
│   ├── base.css            ← Reset, body, typography, utilities
│   ├── components.css      ← Cards, buttons, chips, modals, forms
│   └── layout.css          ← App shell, bottom nav, screen transitions
├── js/
│   ├── db.js               ← IndexedDB wrapper (FinanceDB)
│   ├── parsers.js          ← PDF parsing logic for each bank format
│   ├── router.js           ← Client-side screen router
│   ├── theme.js            ← Light/dark theme management
│   ├── app.js              ← App entry point, screen loader, nav wiring
│   ├── upload.js           ← Upload screen logic
│   ├── dashboard.js        ← Dashboard screen logic
│   ├── transactions.js     ← Transactions screen logic
│   ├── analytics.js        ← Analytics screen logic
│   └── settings.js         ← Settings screen logic
├── screens/
│   ├── dashboard.html      ← Dashboard screen HTML fragment
│   ├── upload.html         ← Upload screen HTML fragment
│   ├── transactions.html   ← Transactions screen HTML fragment
│   ├── analytics.html      ← Analytics screen HTML fragment
│   └── settings.html       ← Settings screen HTML fragment
└── assets/
    └── icons/
        ├── icon-180.png    ← Apple touch icon (generate via generate-icons.html)
        ├── icon-192.png    ← Standard PWA icon
        └── icon-512.png    ← Large PWA icon / splash
```

---

## Supported Bank Statement Formats

| Bank | Card / Account | Format |
|------|---------------|--------|
| Ally Bank | Checking / Savings | PDF |
| Capital One | Credit Card | PDF |
| Bilt | Bilt Mastercard (Obsidian) | PDF |
| Discover | Discover It | PDF |
| Wells Fargo | Autograph Card | PDF |

> If your bank isn't listed, try uploading anyway — the generic parser may still extract transactions.

---

## Development Notes

- **No build step** — plain HTML, CSS, and JavaScript (ES2020+)
- **No frameworks** — vanilla JS only, keeping the bundle size at zero
- **No dependencies** — except Chart.js (charts) and PDF.js (PDF parsing), both loaded from CDN and cached by the service worker
- **Script loading order** matters — see `index.html` comments for the required order
