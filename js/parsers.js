/**
 * parsers.js — PDF Statement Parser Module
 *
 * Parses bank and credit card PDF statements for:
 *   1. Ally Bank          (checking + savings)
 *   2. Capital One        (savings)
 *   3. Bilt Obsidian      (credit card)
 *   4. Discover It        (credit card)
 *   5. Wells Fargo Autograph (credit card)
 *
 * Exposes a global `PDFParser` object.
 * Requires PDF.js (pdfjsLib) to be loaded before this script.
 *
 * Amount sign convention:
 *   Bank (checking/savings): deposits = POSITIVE, withdrawals = NEGATIVE
 *   Credit cards:            purchases = NEGATIVE, payments = POSITIVE
 */

// ─── Merchant Display Name Map ────────────────────────────────────────────────

/**
 * Maps lowercase keyword fragments to clean display names.
 * Keys are checked via String.includes() against the lowercased raw description.
 * More specific keys should come before more general ones.
 */
const MERCHANT_DISPLAY_NAMES = {
  // Shopping
  'amazon.com':           'Amazon',
  'amazon':               'Amazon',
  'amzn':                 'Amazon',
  'wholefds':             'Whole Foods',
  'whole foods':          'Whole Foods',
  'trader joe':           "Trader Joe's",
  'target':               'Target',
  'walmart':              'Walmart',
  'costco':               'Costco',
  'best buy':             'Best Buy',
  'home depot':           'Home Depot',
  'lowes':                "Lowe's",
  'ikea':                 'IKEA',
  'tj maxx':              'TJ Maxx',
  'marshalls':            'Marshalls',
  'ross stores':          'Ross',
  'dollar tree':          'Dollar Tree',
  'dollar general':       'Dollar General',
  'walgreens':            'Walgreens',
  'cvs':                  'CVS',
  'rite aid':             'Rite Aid',

  // Food & Dining
  'starbucks':            'Starbucks',
  'chipotle':             'Chipotle',
  'mcdonalds':            "McDonald's",
  'mcdonald':             "McDonald's",
  'chick-fil-a':          'Chick-fil-A',
  'chickfila':            'Chick-fil-A',
  'subway':               'Subway',
  'taco bell':            'Taco Bell',
  'burger king':          'Burger King',
  'wendys':               "Wendy's",
  'panera':               'Panera Bread',
  'dominos':              "Domino's",
  'pizza hut':            'Pizza Hut',
  'papa johns':           "Papa John's",
  'five guys':            'Five Guys',
  'in-n-out':             'In-N-Out',
  'shake shack':          'Shake Shack',
  'panda express':        'Panda Express',
  'olive garden':         'Olive Garden',
  'applebees':            "Applebee's",
  'cheesecake factory':   'Cheesecake Factory',
  'blue bottle':          'Blue Bottle Coffee',
  'dunkin':               'Dunkin',
  'dutch bros':           'Dutch Bros',

  // Delivery
  'doordash':             'DoorDash',
  'uber eats':            'Uber Eats',
  'grubhub':              'Grubhub',
  'instacart':            'Instacart',
  'postmates':            'Postmates',

  // Transportation
  'uber':                 'Uber',
  'lyft':                 'Lyft',
  'waymo':                'Waymo',
  'delta':                'Delta Airlines',
  'united air':           'United Airlines',
  'american air':         'American Airlines',
  'southwest':            'Southwest Airlines',
  'jetblue':              'JetBlue',
  'spirit air':           'Spirit Airlines',
  'amtrak':               'Amtrak',
  'bart':                 'BART',
  'clipper':              'Clipper Card',
  'ez pass':              'EZ Pass',
  'sunpass':              'SunPass',

  // Streaming & Entertainment
  'netflix':              'Netflix',
  'spotify':              'Spotify',
  'apple.com/bill':       'Apple',
  'apple.com':            'Apple',
  'itunes':               'Apple',
  'hulu':                 'Hulu',
  'disney':               'Disney+',
  'hbo':                  'HBO Max',
  'max.com':              'HBO Max',
  'paramount':            'Paramount+',
  'peacock':              'Peacock',
  'youtube':              'YouTube',
  'twitch':               'Twitch',
  'steam':                'Steam',
  'playstation':          'PlayStation',
  'xbox':                 'Xbox',
  'nintendo':             'Nintendo',
  'audible':              'Audible',
  'kindle':               'Kindle',

  // Utilities & Services
  'at&t':                 'AT&T',
  'verizon':              'Verizon',
  't-mobile':             'T-Mobile',
  'tmobile':              'T-Mobile',
  'comcast':              'Comcast',
  'xfinity':              'Xfinity',
  'spectrum':             'Spectrum',
  'pg&e':                 'PG&E',
  'pacific gas':          'PG&E',
  'con edison':           'Con Edison',
  'google':               'Google',
  'microsoft':            'Microsoft',
  'dropbox':              'Dropbox',
  'adobe':                'Adobe',
  'github':               'GitHub',
  'openai':               'OpenAI',
  'chatgpt':              'ChatGPT',
  'notion':               'Notion',
  'slack':                'Slack',
  'zoom':                 'Zoom',

  // Health & Fitness
  'cvs pharmacy':         'CVS Pharmacy',
  'planet fitness':       'Planet Fitness',
  'equinox':              'Equinox',
  'la fitness':           'LA Fitness',
  'peloton':              'Peloton',

  // Finance & Banking
  'zelle':                'Zelle Transfer',
  'venmo':                'Venmo',
  'paypal':               'PayPal',
  'cashapp':              'Cash App',
  'cash app':             'Cash App',
  'coinbase':             'Coinbase',
  'robinhood':            'Robinhood',

  // Gas Stations
  'chevron':              'Chevron',
  'shell':                'Shell',
  'exxon':                'ExxonMobil',
  'mobil':                'ExxonMobil',
  'bp ':                  'BP',
  'arco':                 'ARCO',
  'valero':               'Valero',
  'circle k':             'Circle K',
  '7-eleven':             '7-Eleven',
  '7eleven':              '7-Eleven',

  // Travel & Lodging
  'airbnb':               'Airbnb',
  'vrbo':                 'VRBO',
  'marriott':             'Marriott',
  'hilton':               'Hilton',
  'hyatt':                'Hyatt',
  'ihg':                  'IHG',
  'expedia':              'Expedia',
  'booking.com':          'Booking.com',
  'hotels.com':           'Hotels.com',
};

// ─── Date Parsing Utilities ───────────────────────────────────────────────────

const MONTH_NAMES = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6,
  jul: 7, aug: 8, sep: 9, oct: 10, nov: 11, dec: 12,
};

/**
 * Pads a number to 2 digits: 5 → '05', 12 → '12'
 * @param {number} n
 * @returns {string}
 */
function pad2(n) {
  return String(n).padStart(2, '0');
}

/**
 * Converts MM/DD/YYYY string to 'YYYY-MM-DD'.
 * @param {string} str  e.g. '01/15/2026'
 * @param {number} [fallbackYear]
 * @returns {string|null}
 */
function parseDate_MMDDYYYY(str, fallbackYear) {
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (!m) return null;
  const [, mm, dd, yyyy] = m;
  return `${yyyy}-${pad2(parseInt(mm, 10))}-${pad2(parseInt(dd, 10))}`;
}

/**
 * Converts MM/DD/YY string to 'YYYY-MM-DD' (assumes 2000s).
 * @param {string} str  e.g. '01/15/26'
 * @returns {string|null}
 */
function parseDate_MMDDYY(str) {
  const m = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (!m) return null;
  const [, mm, dd, yy] = m;
  const yyyy = 2000 + parseInt(yy, 10);
  return `${yyyy}-${pad2(parseInt(mm, 10))}-${pad2(parseInt(dd, 10))}`;
}

/**
 * Converts MM/DD (no year) to 'YYYY-MM-DD' using statement context.
 * Handles year-boundary edge cases (e.g. Dec statement with Jan transactions).
 * @param {string} str           e.g. '01/15'
 * @param {number} statementYear
 * @param {number} statementMonth  1-12
 * @returns {string|null}
 */
function parseDate_MMDD(str, statementYear, statementMonth) {
  const m = str.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (!m) return null;
  const mm = parseInt(m[1], 10);
  const dd = parseInt(m[2], 10);

  // If statement is in January and we see a December date, it's prior year
  let year = statementYear;
  if (statementMonth === 1 && mm === 12) {
    year = statementYear - 1;
  }
  // If statement is in December and we see a January date, it's next year
  if (statementMonth === 12 && mm === 1) {
    year = statementYear + 1;
  }

  return `${year}-${pad2(mm)}-${pad2(dd)}`;
}

/**
 * Converts 'Jan 15' style string to 'YYYY-MM-DD'.
 * @param {string} str           e.g. 'Jan 15'
 * @param {number} statementYear
 * @returns {string|null}
 */
function parseDate_MonDD(str, statementYear) {
  const m = str.match(/^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})$/i);
  if (!m) return null;
  const mm = MONTH_NAMES[m[1].toLowerCase()];
  const dd = parseInt(m[2], 10);
  if (!mm) return null;
  return `${statementYear}-${pad2(mm)}-${pad2(dd)}`;
}

/**
 * Extracts statement period (month + year) from raw PDF text.
 * Looks for common patterns across all supported banks.
 * @param {string} text
 * @returns {{ month: number, year: number, monthKey: string }}
 */
function extractStatementPeriod(text) {
  // Default fallback: current month
  const now = new Date();
  const fallback = {
    month: now.getMonth() + 1,
    year: now.getFullYear(),
    monthKey: `${now.getFullYear()}-${pad2(now.getMonth() + 1)}`,
  };

  try {
    // Pattern 1: "Statement Period: January 1 - January 31, 2026"
    // Pattern 1b: "Statement Period: January 1, 2026 - January 31, 2026"
    const p1 = text.match(
      /statement\s+period[:\s]+([A-Za-z]+)\s+\d{1,2}(?:,\s*\d{4})?\s*[-–]\s*[A-Za-z]+\s+\d{1,2},?\s*(\d{4})/i
    );
    if (p1) {
      const mm = MONTH_NAMES[p1[1].toLowerCase().slice(0, 3)];
      const yyyy = parseInt(p1[2], 10);
      if (mm && yyyy) return { month: mm, year: yyyy, monthKey: `${yyyy}-${pad2(mm)}` };
    }

    // Pattern 2: "Billing Period: 01/01/2026 - 01/31/2026"
    const p2 = text.match(/billing\s+period[:\s]+(\d{2})\/(\d{2})\/(\d{4})/i);
    if (p2) {
      const mm = parseInt(p2[1], 10);
      const yyyy = parseInt(p2[3], 10);
      return { month: mm, year: yyyy, monthKey: `${yyyy}-${pad2(mm)}` };
    }

    // Pattern 3: "Closing Date: 01/31/2026" or "Statement Date: 01/31/2026"
    const p3 = text.match(/(?:closing|statement)\s+date[:\s]+(\d{2})\/(\d{2})\/(\d{4})/i);
    if (p3) {
      const mm = parseInt(p3[1], 10);
      const yyyy = parseInt(p3[3], 10);
      return { month: mm, year: yyyy, monthKey: `${yyyy}-${pad2(mm)}` };
    }

    // Pattern 4: "Account Summary for January 2026" or "January 2026 Statement"
    const p4 = text.match(/(?:for\s+)?([A-Za-z]+)\s+(20\d{2})\s+(?:statement|summary)/i);
    if (p4) {
      const mm = MONTH_NAMES[p4[1].toLowerCase().slice(0, 3)];
      const yyyy = parseInt(p4[2], 10);
      if (mm && yyyy) return { month: mm, year: yyyy, monthKey: `${yyyy}-${pad2(mm)}` };
    }

    // Pattern 5: Any "Month YYYY" near the top of the document (first 500 chars)
    const topText = text.slice(0, 500);
    const p5 = topText.match(/\b(January|February|March|April|May|June|July|August|September|October|November|December)\s+(20\d{2})\b/i);
    if (p5) {
      const mm = MONTH_NAMES[p5[1].toLowerCase().slice(0, 3)];
      const yyyy = parseInt(p5[2], 10);
      if (mm && yyyy) return { month: mm, year: yyyy, monthKey: `${yyyy}-${pad2(mm)}` };
    }

    // Pattern 6: "MM/DD/YYYY - MM/DD/YYYY" date range anywhere
    const p6 = text.match(/(\d{2})\/\d{2}\/(\d{4})\s*[-–]\s*\d{2}\/\d{2}\/\d{4}/);
    if (p6) {
      const mm = parseInt(p6[1], 10);
      const yyyy = parseInt(p6[2], 10);
      return { month: mm, year: yyyy, monthKey: `${yyyy}-${pad2(mm)}` };
    }
  } catch (e) {
    console.warn('[Parser] extractStatementPeriod error:', e);
  }

  console.warn('[Parser] Could not extract statement period, using current month as fallback');
  return fallback;
}

// ─── Merchant Name Cleaning ───────────────────────────────────────────────────

/**
 * Cleans a raw transaction description into a human-readable merchant name.
 *
 * Steps:
 *  1. Check MERCHANT_DISPLAY_NAMES map for known merchants
 *  2. Remove common prefixes (SQ *, TST*, etc.)
 *  3. Remove transaction IDs (long alphanumeric strings)
 *  4. Remove store numbers (#1234, *AB123)
 *  5. Remove city/state suffixes
 *  6. Title-case the result
 *  7. Truncate to 40 chars
 *
 * @param {string} rawDescription
 * @returns {string}
 */
function cleanMerchantName(rawDescription) {
  if (!rawDescription) return 'Unknown';

  const lower = rawDescription.toLowerCase().trim();

  // 1. Check known merchant map (most specific match wins)
  for (const [key, displayName] of Object.entries(MERCHANT_DISPLAY_NAMES)) {
    if (lower.includes(key)) {
      return displayName;
    }
  }

  let name = rawDescription.trim();

  // 2. Remove common card network / aggregator prefixes
  //    e.g. "SQ *BLUE BOTTLE", "TST* CHIPOTLE", "PP*PAYPAL", "SP *SPOTIFY"
  name = name.replace(/^(?:SQ\s*\*|TST\*\s*|PP\*|SP\s*\*|APL\*|DD\s*\*|DoorDash\s*\*)\s*/i, '');

  // 3. Remove transaction/reference IDs — sequences of 6+ alphanumeric chars
  //    that look like IDs (mixed letters+digits or all-caps codes)
  //    e.g. "AMAZON.COM*AB1234XY" → "AMAZON.COM"
  name = name.replace(/\*[A-Z0-9]{4,}/gi, '');
  name = name.replace(/\s+[A-Z]{2,3}\d{4,}[A-Z0-9]*/g, ''); // trailing IDs

  // 4. Remove store numbers: #1234, No. 123, Store 456
  name = name.replace(/\s*#\d+/g, '');
  name = name.replace(/\s+(?:No\.?|Store|Loc\.?)\s*\d+/gi, '');

  // 5. Remove embedded dates like "01/15" or "01-15-26"
  name = name.replace(/\s+\d{1,2}[\/\-]\d{1,2}(?:[\/\-]\d{2,4})?/g, '');

  // 6. Remove trailing city/state: "STARBUCKS AUSTIN TX" → "STARBUCKS"
  //    Only strip if it looks like a 2-letter state abbreviation at the end
  name = name.replace(/\s+[A-Z]{2,20}\s+[A-Z]{2}\s*$/g, '');

  // 7. Remove trailing numbers that are likely location codes
  name = name.replace(/\s+\d{3,}$/, '');

  // 8. Title-case
  name = name
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();

  // 9. Truncate to 40 characters
  if (name.length > 40) {
    name = name.slice(0, 37) + '…';
  }

  return name || 'Unknown';
}

// ─── PDF Text Extraction ──────────────────────────────────────────────────────

/**
 * Extracts text content from a PDF File object using PDF.js.
 *
 * @param {File} file  A PDF File object from an <input type="file">
 * @returns {Promise<{ fullText: string, pages: string[] }>}
 */
async function extractTextFromPDF(file) {
  console.log('[Parser] extractTextFromPDF() — file:', file.name, `(${(file.size / 1024).toFixed(1)} KB)`);

  if (typeof pdfjsLib === 'undefined') {
    throw new Error('PDF.js (pdfjsLib) is not loaded. Add the CDN script tag to index.html.');
  }

  // Read file as ArrayBuffer
  const arrayBuffer = await file.arrayBuffer();

  // Load the PDF document
  const loadingTask = pdfjsLib.getDocument({ data: arrayBuffer });
  const pdf = await loadingTask.promise;

  console.log(`[Parser] PDF loaded — ${pdf.numPages} page(s)`);

  const pages = [];

  for (let pageNum = 1; pageNum <= pdf.numPages; pageNum++) {
    const page = await pdf.getPage(pageNum);
    const textContent = await page.getTextContent();

    // Join text items, preserving approximate line structure.
    // PDF.js returns items with transform[5] = y-coordinate.
    // We group items by y-position to reconstruct lines.
    const items = textContent.items;
    if (items.length === 0) {
      pages.push('');
      continue;
    }

    // Sort by y descending (top of page first), then x ascending (left to right)
    const sorted = [...items].sort((a, b) => {
      const yDiff = b.transform[5] - a.transform[5];
      if (Math.abs(yDiff) > 2) return yDiff; // different lines
      return a.transform[4] - b.transform[4]; // same line, sort by x
    });

    // Group into lines by y-coordinate proximity (within 3 units)
    const lines = [];
    let currentLine = [];
    let lastY = null;

    for (const item of sorted) {
      const y = item.transform[5];
      if (lastY === null || Math.abs(y - lastY) <= 3) {
        currentLine.push(item.str);
      } else {
        if (currentLine.length > 0) {
          lines.push(currentLine.join(' ').trim());
        }
        currentLine = [item.str];
      }
      lastY = y;
    }
    if (currentLine.length > 0) {
      lines.push(currentLine.join(' ').trim());
    }

    const pageText = lines.filter(l => l.length > 0).join('\n');
    pages.push(pageText);
    console.log(`[Parser] Page ${pageNum}: ${lines.length} lines extracted`);
  }

  const fullText = pages.join('\n');
  console.log(`[Parser] Total text length: ${fullText.length} chars`);

  return { fullText, pages };
}

// ─── Bank Detection ───────────────────────────────────────────────────────────

/**
 * Detects which bank/institution a PDF statement belongs to.
 * Uses unique text fingerprints found in each institution's statements.
 *
 * @param {string} text  Full text extracted from the PDF
 * @returns {'ally'|'capital-one'|'bilt'|'discover'|'wells-fargo'|'unknown'}
 */
function detectBank(text) {
  const t = text.toLowerCase();

  // Check each institution's fingerprints
  if (t.includes('ally bank') || t.includes('ally.com') || t.includes('ally financial')) {
    console.log('[Parser] Detected bank: Ally Bank');
    return 'ally';
  }

  if (t.includes('bilt') || t.includes('biltrewards.com') || t.includes('bilt mastercard') || t.includes('bilt rewards')) {
    console.log('[Parser] Detected bank: Bilt');
    return 'bilt';
  }

  // Check Discover before Capital One (both are common)
  if (t.includes('discover it') || t.includes('discover.com') || t.includes('discover card') || t.includes('discover bank')) {
    console.log('[Parser] Detected bank: Discover');
    return 'discover';
  }

  if (t.includes('capital one') || t.includes('capitalone.com')) {
    console.log('[Parser] Detected bank: Capital One');
    return 'capital-one';
  }

  if (t.includes('wells fargo') || t.includes('wellsfargo.com')) {
    console.log('[Parser] Detected bank: Wells Fargo');
    return 'wells-fargo';
  }

  console.warn('[Parser] Could not detect bank from text');
  return 'unknown';
}

// ─── Helper: Build Empty ParseResult ─────────────────────────────────────────

/**
 * Creates a baseline ParseResult object with safe defaults.
 * @param {string} bank
 * @param {string} accountId
 * @param {string} accountType
 * @returns {object}
 */
function emptyParseResult(bank, accountId, accountType) {
  return {
    bank,
    accountId,
    accountType,
    statementMonth: '',
    statementYear: new Date().getFullYear(),
    transactions: [],
    parseErrors: [],
    rawLineCount: 0,
    parsedCount: 0,
    confidence: 0,
    endingBalance: null,   // Parsed ending/closing balance from statement
    statementDate: null,   // ISO date of statement end date
  };
}

/**
 * Extracts the ending balance from statement text.
 * Looks for patterns like "Ending Balance $1,234.56" or "New Balance $393.56"
 * @param {string} text
 * @returns {number|null}
 */
function extractEndingBalance(text) {
  // Patterns to try in order of preference
  const patterns = [
    // Ally/Capital One: "Ending Balance, as of MM/DD/YYYY   $1,234.56"
    /ending\s+balance[^$\d]*\$?([\d,]+\.\d{2})/i,
    // Wells Fargo credit: "New Balance   $393.56"
    /new\s+balance\s+\$?([\d,]+\.\d{2})/i,
    // Discover: "New Balance   $174.82"
    /new\s+balance[^$\d]*\$?([\d,]+\.\d{2})/i,
    // Bilt: "New Balance   $500.00"
    /closing\s+balance[^$\d]*\$?([\d,]+\.\d{2})/i,
    // Generic fallback
    /balance[^$\d]*\$?([\d,]+\.\d{2})\s*$/im,
  ];

  for (const pattern of patterns) {
    const match = text.match(pattern);
    if (match) {
      const val = parseFloat(match[1].replace(/,/g, ''));
      if (!isNaN(val)) return val;
    }
  }
  return null;
}

/**
 * Builds a Transaction object from parsed fields.
 * Calls FinanceDB.categorizeTransaction() if available.
 * @param {object} fields
 * @returns {object}
 */
function buildTransaction(fields) {
  const { date, description, amount, accountId, accountType } = fields;

  const monthKey = date ? date.slice(0, 7) : '';
  const merchantName = cleanMerchantName(description);
  const isIncome = amount > 0;

  // Auto-categorize if FinanceDB is available
  let categoryId = 'other';
  try {
    if (typeof FinanceDB !== 'undefined' && typeof FinanceDB.categorizeTransaction === 'function') {
      categoryId = FinanceDB.categorizeTransaction(description) || 'other';
    }
  } catch (e) {
    // Non-fatal — categorization is best-effort
  }

  // If the transaction is income (positive amount), always override category to 'income'
  // unless the merchant rule already identified it as 'transfer'
  if (isIncome && categoryId !== 'transfer') {
    categoryId = 'income';
  }

  return {
    date,
    monthKey,
    description: description.trim(),
    merchantName,
    amount,
    categoryId,
    accountId,
    accountType,
    isIncome,
    isManuallyEdited: false,
    importedAt: new Date().toISOString(),
  };
}

// ─── Parser: Ally Bank ────────────────────────────────────────────────────────

/**
 * Parses an Ally Bank checking or savings statement.
 *
 * Expected line format:
 *   MM/DD/YYYY  DESCRIPTION  AMOUNT  BALANCE
 *
 * Regex breakdown:
 *   (\d{2}\/\d{2}\/\d{4})   — date MM/DD/YYYY
 *   \s+(.+?)\s+              — description (non-greedy)
 *   ([-]?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)  — amount (with optional commas)
 *   \s+([-]?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)  — balance
 *   \s*$                     — end of line
 *
 * @param {string} text   Full PDF text
 * @param {string[]} pages  Per-page text array
 * @returns {object} ParseResult
 */
function parseAlly(text, pages) {
  console.log('[Parser] parseAlly() starting...');

  // Determine account type from text
  const isChecking = /checking/i.test(text);
  const accountType = isChecking ? 'checking' : 'savings';
  const accountId = isChecking ? 'ally-checking' : 'ally-savings';

  const result = emptyParseResult('ally', accountId, accountType);

  try {
    const period = extractStatementPeriod(text);
    result.statementMonth = period.monthKey;
    result.statementYear = period.year;

    const lines = text.split('\n');
    result.rawLineCount = lines.length;

    // ── Ally actual PDF format (from real statement):
    // Date   Description   Credits   Debits   Balance
    // 07/22/2020   eCheck Deposit   $500.08   -$0.00   $500.08
    //
    // Pattern: MM/DD/YYYY  DESCRIPTION  $CREDIT  $DEBIT  $BALANCE
    // Credits column = money coming in (positive)
    // Debits column  = money going out (negative, shown as -$0.00 when zero)
    //
    // We try two regex patterns:
    //   Pattern A: date  desc  $credit  $debit  $balance  (5 columns)
    //   Pattern B: date  desc  $amount  $balance           (4 columns, no separate credit/debit)

    // Strip $ signs and parse a dollar amount string like "$1,234.56" or "-$0.00"
    function parseDollar(str) {
      if (!str) return NaN;
      return parseFloat(str.replace(/[$,]/g, ''));
    }

    // Pattern A: MM/DD/YYYY  description  $credit  $debit  $balance
    const txRegexA = /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+\$?([\d,]+\.\d{2})\s+[-]?\$?([\d,]+\.\d{2})\s+[-]?\$?([\d,]+\.\d{2})\s*$/;

    // Pattern B: MM/DD/YYYY  description  $amount  $balance (no separate credit/debit)
    const txRegexB = /^(\d{2}\/\d{2}\/\d{4})\s+(.+?)\s+([-]?\$?[\d,]+\.\d{2})\s+([-]?\$?[\d,]+\.\d{2})\s*$/;

    // Skip header/summary lines
    const skipPatterns = /^(date|description|credits|debits|balance|transaction|account|summary|total|opening|closing|beginning|ending|statement|period|page|continued|activity|interest|overdraft|annual|average|days\s+in)/i;

    let inTransactionSection = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Detect start of transaction activity section
      if (/^\s*Activity\s*$/i.test(line) || /transaction\s+history|account\s+activity|transaction\s+detail/i.test(line)) {
        inTransactionSection = true;
        console.log('[Parser] Ally: found transaction section marker:', line);
        continue;
      }

      // Skip non-transaction lines
      if (skipPatterns.test(line)) continue;

      // Skip lines that are clearly balance/summary rows
      if (/beginning\s+balance|ending\s+balance/i.test(line)) continue;

      // Try Pattern A first (5 columns: date desc credit debit balance)
      let match = line.match(txRegexA);
      if (match) {
        const [, dateStr, desc, creditStr, debitStr] = match;
        const credit = parseDollar(creditStr);
        const debit  = parseDollar(debitStr);

        // Net amount: credit is positive (income), debit is negative (expense)
        // When credit > 0 and debit == 0: it's a deposit
        // When debit > 0 and credit == 0: it's a withdrawal
        let amount;
        if (!isNaN(credit) && credit > 0 && (isNaN(debit) || debit === 0)) {
          amount = credit;   // deposit
        } else if (!isNaN(debit) && debit > 0 && (isNaN(credit) || credit === 0)) {
          amount = -debit;   // withdrawal
        } else if (!isNaN(credit) && !isNaN(debit)) {
          amount = credit - debit;  // net
        } else {
          result.parseErrors.push(`Ally: could not determine amount: ${line}`);
          continue;
        }

        const date = parseDate_MMDDYYYY(dateStr);
        if (!date) { result.parseErrors.push(`Ally: invalid date: ${line}`); continue; }

        result.transactions.push(buildTransaction({ date, description: desc, amount, accountId, accountType }));
        result.parsedCount++;
        continue;
      }

      // Try Pattern B (4 columns: date desc amount balance)
      match = line.match(txRegexB);
      if (match) {
        const [, dateStr, desc, amountStr] = match;
        const rawAmount = parseDollar(amountStr);
        if (isNaN(rawAmount)) { result.parseErrors.push(`Ally: invalid amount: ${line}`); continue; }

        const date = parseDate_MMDDYYYY(dateStr);
        if (!date) { result.parseErrors.push(`Ally: invalid date: ${line}`); continue; }

        result.transactions.push(buildTransaction({ date, description: desc, amount: rawAmount, accountId, accountType }));
        result.parsedCount++;
        continue;
      }

      // Log unparsed lines in transaction section for debugging
      if (inTransactionSection && line.length > 10 && /\d{2}\/\d{2}\/\d{4}/.test(line)) {
        result.parseErrors.push(`Ally: unparsed line: ${line}`);
      }
    }

    // Calculate confidence
    if (result.rawLineCount > 0) {
      const dataLines = lines.filter(l => l.trim().length > 5).length;
      result.confidence = dataLines > 0
        ? Math.min(1, result.parsedCount / Math.max(1, dataLines * 0.15))
        : 0;
    }

    result.endingBalance = extractEndingBalance(text);
    console.log(`[Parser] Ally: parsed ${result.parsedCount} transactions, ending balance: ${result.endingBalance}, ${result.parseErrors.length} errors`);
  } catch (err) {
    console.error('[Parser] parseAlly() fatal error:', err);
    result.parseErrors.push(`Fatal parse error: ${err.message}`);
  }

  return result;
}

// ─── Parser: Capital One Savings ──────────────────────────────────────────────

/**
 * Parses a Capital One savings statement.
 *
 * Expected line format:
 *   Mon DD  DESCRIPTION  AMOUNT
 *   e.g. "Jan 15  Interest Earned  12.45"
 *
 * Regex breakdown:
 *   ^(Jan|Feb|...|Dec)   — 3-letter month abbreviation
 *   \s+(\d{1,2})         — day (1 or 2 digits)
 *   \s+(.+?)             — description (non-greedy)
 *   \s+([-]?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)  — amount
 *   \s*$
 *
 * @param {string} text
 * @param {string[]} pages
 * @returns {object} ParseResult
 */
function parseCapitalOne(text, pages) {
  console.log('[Parser] parseCapitalOne() starting...');

  const result = emptyParseResult('capital-one', 'capital-one-savings', 'savings');

  try {
    const period = extractStatementPeriod(text);
    result.statementMonth = period.monthKey;
    result.statementYear = period.year;

    const lines = text.split('\n');
    result.rawLineCount = lines.length;

    // Regex: "Jan 15  Some Description  1,234.56"
    const txRegex = /^(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\s+(\d{1,2})\s+(.+?)\s+([-]?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*$/i;

    const skipPatterns = /^(date|description|amount|balance|transaction|account|summary|total|opening|closing|beginning|ending|statement|period|page|continued|interest|annual)/i;

    let inTransactionSection = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (/account\s+activity|transaction\s+history|transaction\s+detail/i.test(line)) {
        inTransactionSection = true;
        console.log('[Parser] Capital One: found transaction section marker');
        continue;
      }

      if (skipPatterns.test(line)) continue;

      const match = line.match(txRegex);
      if (!match) {
        if (inTransactionSection && line.length > 10 && /\d/.test(line)) {
          result.parseErrors.push(`CapitalOne: unparsed line: ${line}`);
        }
        continue;
      }

      const [, monthStr, dayStr, desc, amountStr] = match;
      const rawAmount = parseFloat(amountStr.replace(/,/g, ''));
      if (isNaN(rawAmount)) {
        result.parseErrors.push(`CapitalOne: invalid amount in: ${line}`);
        continue;
      }

      // Build date string for parseDate_MonDD
      const dateInput = `${monthStr} ${dayStr}`;
      const date = parseDate_MonDD(dateInput, period.year);
      if (!date) {
        result.parseErrors.push(`CapitalOne: invalid date in: ${line}`);
        continue;
      }

      // Capital One savings: positive = credit/deposit, negative = debit/withdrawal
      const transaction = buildTransaction({
        date,
        description: desc,
        amount: rawAmount,
        accountId: 'capital-one-savings',
        accountType: 'savings',
      });

      result.transactions.push(transaction);
      result.parsedCount++;
    }

    if (result.rawLineCount > 0) {
      const dataLines = lines.filter(l => l.trim().length > 5).length;
      result.confidence = dataLines > 0
        ? Math.min(1, result.parsedCount / Math.max(1, dataLines * 0.3))
        : 0;
    }

    result.endingBalance = extractEndingBalance(text);
    console.log(`[Parser] Capital One: parsed ${result.parsedCount} transactions, ending balance: ${result.endingBalance}`);
  } catch (err) {
    console.error('[Parser] parseCapitalOne() fatal error:', err);
    result.parseErrors.push(`Fatal parse error: ${err.message}`);
  }

  return result;
}

// ─── Parser: Bilt Obsidian Credit Card ───────────────────────────────────────

/**
 * Parses a Bilt Obsidian credit card statement.
 *
 * Expected line format:
 *   MM/DD/YY  DESCRIPTION  $AMOUNT
 *   e.g. "01/15/26  AMAZON.COM  $47.99"
 *
 * Regex breakdown:
 *   (\d{2}\/\d{2}\/\d{2})   — date MM/DD/YY (2-digit year)
 *   \s+(.+?)                 — description
 *   \s+\$?([-]?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)  — optional $ then amount
 *   \s*$
 *
 * Sign convention:
 *   PDF positive (purchase) → stored as NEGATIVE (expense)
 *   PDF negative (payment)  → stored as POSITIVE (credit/transfer)
 *
 * @param {string} text
 * @param {string[]} pages
 * @returns {object} ParseResult
 */
function parseBilt(text, pages) {
  console.log('[Parser] parseBilt() starting...');

  const result = emptyParseResult('bilt', 'bilt-credit', 'credit');

  try {
    const period = extractStatementPeriod(text);
    result.statementMonth = period.monthKey;
    result.statementYear = period.year;

    const lines = text.split('\n');
    result.rawLineCount = lines.length;

    // Regex: "01/15/26  AMAZON.COM  $47.99" or "01/20/26  PAYMENT  -$500.00"
    const txRegex = /^(\d{2}\/\d{2}\/\d{2})\s+(.+?)\s+\$?([-]?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)\s*$/;

    const skipPatterns = /^(date|description|amount|balance|transaction|account|summary|total|opening|closing|beginning|ending|statement|period|page|continued|minimum|payment\s+due|credit\s+limit)/i;

    let inTransactionSection = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      if (/transactions|account\s+activity|transaction\s+detail/i.test(line)) {
        inTransactionSection = true;
        console.log('[Parser] Bilt: found transaction section marker');
        continue;
      }

      if (skipPatterns.test(line)) continue;

      const match = line.match(txRegex);
      if (!match) {
        if (inTransactionSection && line.length > 10 && /\d/.test(line)) {
          result.parseErrors.push(`Bilt: unparsed line: ${line}`);
        }
        continue;
      }

      const [, dateStr, desc, amountStr] = match;
      const rawAmount = parseFloat(amountStr.replace(/,/g, ''));
      if (isNaN(rawAmount)) {
        result.parseErrors.push(`Bilt: invalid amount in: ${line}`);
        continue;
      }

      const date = parseDate_MMDDYY(dateStr);
      if (!date) {
        result.parseErrors.push(`Bilt: invalid date in: ${line}`);
        continue;
      }

      // Credit card sign flip:
      //   PDF positive (purchase/charge) → NEGATIVE (expense)
      //   PDF negative (payment/credit)  → POSITIVE (reduces balance)
      const storedAmount = -rawAmount;

      const transaction = buildTransaction({
        date,
        description: desc,
        amount: storedAmount,
        accountId: 'bilt-credit',
        accountType: 'credit',
      });

      result.transactions.push(transaction);
      result.parsedCount++;
    }

    if (result.rawLineCount > 0) {
      const dataLines = lines.filter(l => l.trim().length > 5).length;
      result.confidence = dataLines > 0
        ? Math.min(1, result.parsedCount / Math.max(1, dataLines * 0.3))
        : 0;
    }

    result.endingBalance = extractEndingBalance(text);
    console.log(`[Parser] Bilt: parsed ${result.parsedCount} transactions, ending balance: ${result.endingBalance}`);
  } catch (err) {
    console.error('[Parser] parseBilt() fatal error:', err);
    result.parseErrors.push(`Fatal parse error: ${err.message}`);
  }

  return result;
}

// ─── Parser: Discover It Credit Card ─────────────────────────────────────────

/**
 * Parses a Discover It credit card statement.
 *
 * Expected line format (two date columns):
 *   MM/DD  MM/DD  DESCRIPTION  $AMOUNT
 *   e.g. "01/14  01/15  NETFLIX.COM  $15.49"
 *
 * Regex breakdown:
 *   (\d{2}\/\d{2})   — transaction date MM/DD (no year)
 *   \s+(\d{2}\/\d{2})  — post date MM/DD (no year)
 *   \s+(.+?)           — description
 *   \s+\$?([-]?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)  — amount
 *   \s*$
 *
 * We use the TRANSACTION date (first column), not the post date.
 * Year is inferred from the statement period.
 *
 * Sign convention:
 *   PDF positive (purchase) → stored as NEGATIVE (expense)
 *   PDF negative (payment)  → stored as POSITIVE (credit/transfer)
 *
 * @param {string} text
 * @param {string[]} pages
 * @returns {object} ParseResult
 */
function parseDiscover(text, pages) {
  console.log('[Parser] parseDiscover() starting...');

  const result = emptyParseResult('discover', 'discover-credit', 'credit');

  try {
    const period = extractStatementPeriod(text);
    result.statementMonth = period.monthKey;
    result.statementYear = period.year;

    const lines = text.split('\n');
    result.rawLineCount = lines.length;

    // ── Real Discover It format (from actual statement):
    //
    // Payments section:
    //   10/05   DIRECTPAY FULL BALANCE   -$174.82
    //
    // Purchases section:
    //   09/10   7-ELEVEN 24053 CAPE CANAVERAFL   Gasoline   $27.33
    //   09/14   TRUE TO TENNESSEE ST28 NASHVILLE TN   Merchandise   $21.94
    //   10/07   AMAZON.COM*NF99E7P60   Merchandise   $95.23
    //
    // Format: MM/DD  DESCRIPTION  [MERCHANT_CATEGORY]  $AMOUNT
    // Dates are MM/DD (no year) — infer from statement period.
    // Payments are negative in PDF (e.g. -$174.82) → store as positive (income).
    // Purchases are positive in PDF → store as negative (expense).

    const statYear = period.year || new Date().getFullYear();
    const statMonth = period.month || new Date().getMonth() + 1;

    // Pattern A: MM/DD  DESCRIPTION  MERCHANT_CATEGORY  $AMOUNT
    // e.g. "09/10   7-ELEVEN 24053 CAPE CANAVERAFL   Gasoline   $27.33"
    const txRegexA = /^(\d{2}\/\d{2})\s+(.+?)\s+(Gasoline|Merchandise|Restaurants|Travel|Services|Entertainment|Healthcare|Education|Groceries|Automotive|Home|Utilities|Insurance|Government|Charity|Other)\s+[-]?\$?([\d,]+\.\d{2})\s*$/i;

    // Pattern B: MM/DD  DESCRIPTION  $AMOUNT (no merchant category — payments or simple purchases)
    // e.g. "10/05   DIRECTPAY FULL BALANCE   -$174.82"
    // e.g. "09/27   APPLE.COM/BILL 866-712-7753 CA   $2.15"
    const txRegexB = /^(\d{2}\/\d{2})\s+(.+?)\s+([-]?\$[\d,]+\.\d{2})\s*$/;

    // Skip header/summary/boilerplate lines
    const skipPatterns = /^(trans\.?|date|description|amount|merchant|category|payments\s+and\s+credits|purchases|fees\s+and\s+interest|total\s+fees|total\s+interest|2025\s+totals|year-to-date|interest\s+charge|annual\s+percentage|30\s+days|promo|type\s+of|purchases\s+\d|cash\s+advances|variable|previous\s+balance|new\s+balance|minimum|payment\s+due|cashback|rewards|earned|redeemed|see\s+details|open\s+to\s+close|page\s+\d|discover\.com|dial\s+711|po\s+box|carol\s+stream|hearing|mkq|26s|dit)/i;

    let currentSection = 'purchases';
    let inTransactionSection = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Detect section changes
      if (/^PAYMENTS\s+AND\s+CREDITS$/i.test(line) || /^DATE\s+PAYMENTS\s+AND\s+CREDITS/i.test(line)) {
        currentSection = 'payments';
        inTransactionSection = true;
        continue;
      }
      if (/^DATE\s+PURCHASES/i.test(line) || /^PURCHASES\s*$/i.test(line)) {
        currentSection = 'purchases';
        inTransactionSection = true;
        continue;
      }
      if (/^Fees\s+and\s+Interest|^TOTAL\s+FEES|^Interest\s+Charge\s+Calc/i.test(line)) {
        inTransactionSection = false;
        continue;
      }

      if (skipPatterns.test(line)) continue;

      // Try Pattern A (with merchant category)
      let match = line.match(txRegexA);
      if (match) {
        const [, dateStr, desc, , amountStr] = match;
        const rawAmount = parseFloat(amountStr.replace(/,/g, ''));
        if (isNaN(rawAmount)) continue;

        const date = parseDate_MMDD(dateStr, statYear, statMonth);
        if (!date) continue;

        // Purchases are positive in PDF → store as negative (expense)
        const storedAmount = (currentSection === 'payments') ? rawAmount : -rawAmount;

        result.transactions.push(buildTransaction({
          date, description: desc, amount: storedAmount,
          accountId: 'discover-credit', accountType: 'credit',
        }));
        result.parsedCount++;
        continue;
      }

      // Try Pattern B (no merchant category)
      match = line.match(txRegexB);
      if (match) {
        const [, dateStr, desc, amountWithSign] = match;
        // Remove $ and parse — keep the sign from the PDF
        const rawAmount = parseFloat(amountWithSign.replace(/[$,]/g, ''));
        if (isNaN(rawAmount)) continue;

        const date = parseDate_MMDD(dateStr, statYear, statMonth);
        if (!date) continue;

        // Negative in PDF = payment/credit → store as positive (income)
        // Positive in PDF = purchase → store as negative (expense)
        const storedAmount = rawAmount < 0 ? -rawAmount : -rawAmount;
        // Simplified: flip sign for credit card (payment negative→positive, purchase positive→negative)

        result.transactions.push(buildTransaction({
          date, description: desc, amount: storedAmount,
          accountId: 'discover-credit', accountType: 'credit',
        }));
        result.parsedCount++;
        continue;
      }

      if (inTransactionSection && line.length > 10 && /^\d{2}\/\d{2}/.test(line)) {
        result.parseErrors.push(`Discover: unparsed line: ${line}`);
      }
    }

    if (result.rawLineCount > 0) {
      const dataLines = lines.filter(l => l.trim().length > 5).length;
      result.confidence = dataLines > 0
        ? Math.min(1, result.parsedCount / Math.max(1, dataLines * 0.15))
        : 0;
    }

    result.endingBalance = extractEndingBalance(text);
    console.log(`[Parser] Discover: parsed ${result.parsedCount} transactions, ending balance: ${result.endingBalance}`);
  } catch (err) {
    console.error('[Parser] parseDiscover() fatal error:', err);
    result.parseErrors.push(`Fatal parse error: ${err.message}`);
  }

  return result;
}

// ─── Parser: Wells Fargo Autograph Credit Card ────────────────────────────────

/**
 * Parses a Wells Fargo Autograph credit card statement.
 *
 * Expected line format (similar to Bilt but no $ sign):
 *   MM/DD/YY  DESCRIPTION  AMOUNT
 *   e.g. "01/15/26  AMAZON.COM 1234  47.99"
 *
 * Also handles 4-digit years: MM/DD/YYYY
 *
 * Regex breakdown:
 *   (\d{2}\/\d{2}\/\d{2,4})  — date MM/DD/YY or MM/DD/YYYY
 *   \s+(.+?)                  — description
 *   \s+([-]?\d{1,3}(?:,\d{3})*(?:\.\d{2})?)  — amount (no $ sign)
 *   \s*$
 *
 * Sign convention:
 *   PDF positive (purchase) → stored as NEGATIVE (expense)
 *   PDF negative (payment)  → stored as POSITIVE (credit/transfer)
 *
 * @param {string} text
 * @param {string[]} pages
 * @returns {object} ParseResult
 */
function parseWellsFargo(text, pages) {
  console.log('[Parser] parseWellsFargo() starting...');

  const result = emptyParseResult('wells-fargo', 'wells-fargo-credit', 'credit');

  try {
    const period = extractStatementPeriod(text);
    result.statementMonth = period.monthKey;
    result.statementYear = period.year;

    const lines = text.split('\n');
    result.rawLineCount = lines.length;

    // ── Real Wells Fargo Autograph format (from actual statement):
    //
    // Card Trans Post  Reference Number          Description              Credits  Charges
    // Ending Date Date
    // in
    //
    // 8882  01/12  01/14  7536943QX2G63W01D  BAJA FRESH #30472 KENT WA  13.24
    // 8882  01/13  01/14  5544641QY4BXWWKTG  IKEA SEATLE REST RENTON WA  14.34
    //
    // Payments section (credits):
    // 02/04  02/04  8574110DL1WK3586X  ONLINE ACH PAYMENT REF #G5F22LFWVT  1,620.07
    //
    // Pattern A: CARD(4)  MM/DD  MM/DD  REFNUM  DESCRIPTION  AMOUNT
    //   card ending digits (4) + trans date + post date + ref# + desc + amount
    //
    // Pattern B: MM/DD  MM/DD  REFNUM  DESCRIPTION  AMOUNT
    //   (payments section — no card prefix)
    //
    // Dates are MM/DD (no year) — infer year from statement period.
    // Amounts have no $ sign. Positive = charge (expense). Credits are in a separate section.

    // Reference numbers are alphanumeric, 16-18 chars
    const refNumPattern = '[A-Z0-9]{10,20}';

    // Pattern A: 4-digit card suffix + trans date + post date + ref + desc + amount
    // e.g. "8882   01/12   01/14   7536943QX2G63W01D   BAJA FRESH #30472 KENT WA   13.24"
    const txRegexA = new RegExp(
      '^(\\d{4})\\s+(\\d{2}\\/\\d{2})\\s+(\\d{2}\\/\\d{2})\\s+' +
      refNumPattern + '\\s+(.+?)\\s+([\\d,]+\\.\\d{2})\\s*$'
    );

    // Pattern B: trans date + post date + ref + desc + amount (no card prefix — payments)
    // e.g. "02/04   02/04   8574110DL1WK3586X   ONLINE ACH PAYMENT REF #G5F22LFWVT   1,620.07"
    const txRegexB = new RegExp(
      '^(\\d{2}\\/\\d{2})\\s+(\\d{2}\\/\\d{2})\\s+' +
      refNumPattern + '\\s+(.+?)\\s+([\\d,]+\\.\\d{2})\\s*$'
    );

    // Skip header/summary lines
    const skipPatterns = /^(card|trans|post|reference|description|credits|charges|ending|date|in$|transactions|account|summary|total|fees|interest|minimum|payment\s+due|credit\s+limit|new\s+balance|previous\s+balance|continued|page\s+\d|wells\s+fargo|annual|days\s+in|balance\s+subject|type\s+of|purchases|cash\s+advances|apr|2026\s+totals|year-to-date|total\s+fees|total\s+interest|total\s+payments|total\s+other|total\s+purchases)/i;

    // Track which section we're in (payments = credits, purchases = charges)
    let currentSection = 'purchases'; // default
    let inTransactionSection = false;
    const statYear = period.year || new Date().getFullYear();

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Detect section changes
      if (/^Payments\s*$/i.test(line)) { currentSection = 'payments'; inTransactionSection = true; continue; }
      if (/^Other\s+Credits\s*$/i.test(line)) { currentSection = 'credits'; inTransactionSection = true; continue; }
      if (/^Purchases|Balance\s+Transfers|Other\s+Charges/i.test(line)) { currentSection = 'purchases'; inTransactionSection = true; continue; }
      if (/^Transactions\s*$/i.test(line) || /^Transactions\s+\(continued/i.test(line)) { inTransactionSection = true; continue; }
      if (/^Fees\s+Charged|^Interest\s+Charged/i.test(line)) { inTransactionSection = false; continue; }

      if (skipPatterns.test(line)) continue;

      // Try Pattern A (with card suffix prefix)
      let match = line.match(txRegexA);
      if (match) {
        const [, , transDateStr, , desc, amountStr] = match;
        const rawAmount = parseFloat(amountStr.replace(/,/g, ''));
        if (isNaN(rawAmount)) continue;

        const date = parseDate_MMDD(transDateStr, statYear, period.month);
        if (!date) continue;

        // Payments/credits are positive (reduce balance), purchases are negative (expense)
        const storedAmount = (currentSection === 'payments' || currentSection === 'credits')
          ? rawAmount    // credit/payment = positive
          : -rawAmount;  // purchase = negative (expense)

        result.transactions.push(buildTransaction({
          date, description: desc, amount: storedAmount,
          accountId: 'wells-fargo-credit', accountType: 'credit',
        }));
        result.parsedCount++;
        continue;
      }

      // Try Pattern B (no card suffix — payments section)
      match = line.match(txRegexB);
      if (match) {
        const [, transDateStr, , desc, amountStr] = match;
        const rawAmount = parseFloat(amountStr.replace(/,/g, ''));
        if (isNaN(rawAmount)) continue;

        const date = parseDate_MMDD(transDateStr, statYear, period.month);
        if (!date) continue;

        const storedAmount = (currentSection === 'payments' || currentSection === 'credits')
          ? rawAmount
          : -rawAmount;

        result.transactions.push(buildTransaction({
          date, description: desc, amount: storedAmount,
          accountId: 'wells-fargo-credit', accountType: 'credit',
        }));
        result.parsedCount++;
        continue;
      }

      if (inTransactionSection && line.length > 15 && /\d{2}\/\d{2}/.test(line)) {
        result.parseErrors.push(`WellsFargo: unparsed line: ${line}`);
      }
    }

    if (result.rawLineCount > 0) {
      const dataLines = lines.filter(l => l.trim().length > 5).length;
      result.confidence = dataLines > 0
        ? Math.min(1, result.parsedCount / Math.max(1, dataLines * 0.15))
        : 0;
    }

    result.endingBalance = extractEndingBalance(text);
    console.log(`[Parser] Wells Fargo: parsed ${result.parsedCount} transactions, ending balance: ${result.endingBalance}`);
  } catch (err) {
    console.error('[Parser] parseWellsFargo() fatal error:', err);
    result.parseErrors.push(`Fatal parse error: ${err.message}`);
  }

  return result;
}

// ─── Main Entry Point ─────────────────────────────────────────────────────────

/**
 * Main entry point. Auto-detects the bank and parses the PDF statement.
 *
 * @param {File} file  A PDF File object
 * @returns {Promise<object>} ParseResult
 */
async function parseStatement(file) {
  console.log('[Parser] parseStatement() — starting for:', file.name);

  // Safe fallback result in case everything fails
  const failResult = {
    bank: 'unknown',
    accountId: 'unknown',
    accountType: 'unknown',
    statementMonth: '',
    statementYear: new Date().getFullYear(),
    transactions: [],
    parseErrors: [`Could not parse file: ${file.name}`],
    rawLineCount: 0,
    parsedCount: 0,
    confidence: 0,
  };

  try {
    // Step 1: Extract text from PDF
    let extracted;
    try {
      extracted = await extractTextFromPDF(file);
    } catch (err) {
      console.error('[Parser] Text extraction failed:', err);
      failResult.parseErrors.push(`PDF text extraction failed: ${err.message}`);
      return failResult;
    }

    const { fullText, pages } = extracted;

    if (!fullText || fullText.trim().length < 50) {
      console.warn('[Parser] Extracted text is too short — PDF may be image-based or encrypted');
      failResult.parseErrors.push('PDF appears to be image-based or encrypted. Text extraction yielded insufficient content.');
      return failResult;
    }

    // Step 2: Detect bank
    const bank = detectBank(fullText);

    if (bank === 'unknown') {
      failResult.bank = 'unknown';
      failResult.parseErrors.push('Could not identify bank from PDF content. Supported banks: Ally, Capital One, Bilt, Discover, Wells Fargo.');
      return failResult;
    }

    // Step 3: Route to the appropriate parser
    let result;
    switch (bank) {
      case 'ally':
        result = parseAlly(fullText, pages);
        break;
      case 'capital-one':
        result = parseCapitalOne(fullText, pages);
        break;
      case 'bilt':
        result = parseBilt(fullText, pages);
        break;
      case 'discover':
        result = parseDiscover(fullText, pages);
        break;
      case 'wells-fargo':
        result = parseWellsFargo(fullText, pages);
        break;
      default:
        failResult.parseErrors.push(`No parser implemented for bank: ${bank}`);
        return failResult;
    }

    console.log(
      `[Parser] parseStatement() complete — bank: ${result.bank}, ` +
      `transactions: ${result.parsedCount}, ` +
      `errors: ${result.parseErrors.length}, ` +
      `confidence: ${(result.confidence * 100).toFixed(0)}%`
    );

    return result;

  } catch (err) {
    console.error('[Parser] parseStatement() unexpected error:', err);
    failResult.parseErrors.push(`Unexpected error: ${err.message}`);
    return failResult;
  }
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * PDFParser — global object exposing the full parser API.
 *
 * Usage:
 *   const result = await PDFParser.parseStatement(file);
 *   const bank   = PDFParser.detectBank(text);
 *   const { fullText, pages } = await PDFParser.extractTextFromPDF(file);
 */
const PDFParser = {
  // Main entry point
  parseStatement,

  // Individual parsers (callable directly for testing)
  parseAlly,
  parseCapitalOne,
  parseBilt,
  parseDiscover,
  parseWellsFargo,

  // Utilities
  detectBank,
  extractTextFromPDF,

  // Exposed helpers (useful for testing/debugging)
  extractStatementPeriod,
  cleanMerchantName,
  MERCHANT_DISPLAY_NAMES,
};

console.log('[Parser] parsers.js loaded ✅ — PDFParser ready');
