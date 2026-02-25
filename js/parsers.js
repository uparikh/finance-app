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
 * More specific keys MUST come before more general ones (object iteration order
 * is insertion order in modern JS, so put longer/more-specific keys first).
 *
 * These are used as a fast-path in cleanMerchantName() — if a key matches,
 * the display name is returned immediately without further processing.
 */
const MERCHANT_DISPLAY_NAMES = {
  // ── Groceries ────────────────────────────────────────────────────────────
  'wholefds':             'Whole Foods',       // truncated form on statements
  'whole foods':          'Whole Foods',
  'trader joe':           "Trader Joe's",
  'qfc':                  'QFC',
  'fred meyer':           'Fred Meyer',
  'safeway':              'Safeway',
  'kroger':               'Kroger',
  'publix':               'Publix',
  'wegmans':              'Wegmans',
  'sprouts':              'Sprouts',
  'aldi':                 'ALDI',
  'winco':                'WinCo',
  'smart & final':        'Smart & Final',
  'h-e-b':                'H-E-B',

  // ── Shopping ─────────────────────────────────────────────────────────────
  'amazon.com':           'Amazon',
  'amzn':                 'Amazon',
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
  'daiso':                'Daiso',
  'uniqlo':               'Uniqlo',
  'nordstrom':            'Nordstrom',
  'macy':                 "Macy's",
  'old navy':             'Old Navy',
  'gap ':                 'Gap',
  'h&m':                  'H&M',
  'zara':                 'Zara',
  'nike':                 'Nike',
  'adidas':               'Adidas',
  'bath & body':          'Bath & Body Works',
  'victoria secret':      "Victoria's Secret",
  'sephora':              'Sephora',
  'ulta':                 'Ulta Beauty',
  'barnes & noble':       'Barnes & Noble',
  'staples':              'Staples',
  'office depot':         'Office Depot',
  'petco':                'Petco',
  'petsmart':             'PetSmart',
  'chewy':                'Chewy',
  'wayfair':              'Wayfair',
  'etsy':                 'Etsy',
  'ebay':                 'eBay',

  // ── Food & Dining (chains — specific before general) ─────────────────────
  'cheesecake factory':   'Cheesecake Factory',
  'panda express':        'Panda Express',
  'shake shack':          'Shake Shack',
  'five guys':            'Five Guys',
  'in-n-out':             'In-N-Out',
  'in n out':             'In-N-Out',
  'olive garden':         'Olive Garden',
  'applebees':            "Applebee's",
  'applebee':             "Applebee's",
  'chick-fil-a':          'Chick-fil-A',
  'chickfila':            'Chick-fil-A',
  'chick fil a':          'Chick-fil-A',
  'taco bell':            'Taco Bell',
  'burger king':          'Burger King',
  'pizza hut':            'Pizza Hut',
  'papa john':            "Papa John's",
  'papa murphys':         "Papa Murphy's",
  'little caesar':        "Little Caesars",
  'dominos':              "Domino's",
  'domino':               "Domino's",
  'panera':               'Panera Bread',
  'starbucks':            'Starbucks',
  'dutch bros':           'Dutch Bros',
  'blue bottle':          'Blue Bottle Coffee',
  'peets coffee':         "Peet's Coffee",
  'peet\'s':              "Peet's Coffee",
  'dunkin':               'Dunkin',
  'chipotle':             'Chipotle',
  'mcdonalds':            "McDonald's",
  'mcdonald':             "McDonald's",
  'wendys':               "Wendy's",
  'wendy':                "Wendy's",
  'subway':               'Subway',
  'popeyes':              'Popeyes',
  'raising cane':         "Raising Cane's",
  'wingstop':             'Wingstop',
  'jersey mike':          "Jersey Mike's",
  'jimmy john':           "Jimmy John's",
  'firehouse sub':        'Firehouse Subs',
  'potbelly':             'Potbelly',
  'sweetgreen':           'Sweetgreen',
  'cava ':                'Cava',
  'mod pizza':            'MOD Pizza',
  'blaze pizza':          'Blaze Pizza',
  'round table':          'Round Table Pizza',
  'jack in the box':      'Jack in the Box',
  'del taco':             'Del Taco',
  'carl\'s jr':           "Carl's Jr.",
  'carls jr':             "Carl's Jr.",
  'hardees':              "Hardee's",
  'sonic drive':          'Sonic',
  'whataburger':          'Whataburger',
  'culvers':              "Culver's",
  'cook out':             'Cook Out',
  'habit burger':         'The Habit Burger',
  'smashburger':          'Smashburger',
  'fatburger':            'Fatburger',
  'ihop':                 'IHOP',
  'denny':                'Denny\'s',
  'waffle house':         'Waffle House',
  'cracker barrel':       'Cracker Barrel',
  'texas roadhouse':      'Texas Roadhouse',
  'outback':              'Outback Steakhouse',
  'red lobster':          'Red Lobster',
  'red robin':            'Red Robin',
  'buffalo wild':         'Buffalo Wild Wings',
  'hooters':              'Hooters',
  'chilis':               "Chili's",
  'chili\'s':             "Chili's",
  'bj\'s restaurant':     "BJ's Restaurant",
  'yard house':           'Yard House',
  'benihana':             'Benihana',
  'pf chang':             "P.F. Chang's",
  'noodles & company':    'Noodles & Company',
  'the melting pot':      'The Melting Pot',

  // ── Delivery ─────────────────────────────────────────────────────────────
  'doordash':             'DoorDash',
  'uber eats':            'Uber Eats',
  'grubhub':              'Grubhub',
  'instacart':            'Instacart',
  'postmates':            'Postmates',
  'seamless':             'Seamless',
  'caviar':               'Caviar',

  // ── Transportation ───────────────────────────────────────────────────────
  'uber':                 'Uber',
  'lyft':                 'Lyft',
  'waymo':                'Waymo',
  'delta':                'Delta Airlines',
  'united air':           'United Airlines',
  'american air':         'American Airlines',
  'southwest':            'Southwest Airlines',
  'jetblue':              'JetBlue',
  'spirit air':           'Spirit Airlines',
  'alaska air':           'Alaska Airlines',
  'frontier air':         'Frontier Airlines',
  'amtrak':               'Amtrak',
  'bart':                 'BART',
  'clipper':              'Clipper Card',
  'ez pass':              'EZ Pass',
  'sunpass':              'SunPass',
  'enterprise rent':      'Enterprise',
  'hertz':                'Hertz',
  'avis':                 'Avis',

  // ── Streaming & Entertainment ─────────────────────────────────────────────
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
  'crunchyroll':          'Crunchyroll',
  'amc ':                 'AMC Theatres',
  'regal cinema':         'Regal Cinemas',
  'cinemark':             'Cinemark',

  // ── Utilities & Services ──────────────────────────────────────────────────
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

  // ── Health & Fitness ──────────────────────────────────────────────────────
  'edgeworks':            'Edgeworks',           // Ally ACH: "Edgeworks Climbi PAYMENT" (climbing gym)
  'planet fitness':       'Planet Fitness',
  'equinox':              'Equinox',
  'la fitness':           'LA Fitness',
  'anytime fitness':      'Anytime Fitness',
  'ymca':                 'YMCA',
  'peloton':              'Peloton',

  // ── Finance & Banking ─────────────────────────────────────────────────────
  'fid bkg svc':          'Fidelity Transfer',   // Ally ACH: "FID BKG SVC LLC MONEYLINE"
  'zelle':                'Zelle Transfer',
  'venmo':                'Venmo',
  'paypal':               'PayPal',
  'cashapp':              'Cash App',
  'cash app':             'Cash App',
  'coinbase':             'Coinbase',
  'robinhood':            'Robinhood',

  // ── Gas Stations ──────────────────────────────────────────────────────────
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
  'buc-ee':               "Buc-ee's",

  // ── Travel & Lodging ──────────────────────────────────────────────────────
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

    // Pattern 2: "Billing Period: 11/21/2025 - 12/20/2025"
    // Use the END date (second date) to get the correct statement month.
    // e.g. billing period 11/21–12/20 → statement month is December (12).
    const p2 = text.match(/billing\s+period[:\s]+\d{2}\/\d{2}\/\d{4}\s*[-–]\s*(\d{2})\/\d{2}\/(\d{4})/i);
    if (p2) {
      const mm = parseInt(p2[1], 10);
      const yyyy = parseInt(p2[2], 10);
      return { month: mm, year: yyyy, monthKey: `${yyyy}-${pad2(mm)}` };
    }
    // Pattern 2b: "Billing Period: 01/01/2026" (single date — use it directly)
    const p2b = text.match(/billing\s+period[:\s]+(\d{2})\/(\d{2})\/(\d{4})/i);
    if (p2b) {
      const mm = parseInt(p2b[1], 10);
      const yyyy = parseInt(p2b[3], 10);
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
    // Use the END date (second date) — billing periods start in the prior month.
    // e.g. "11/21/2025 - 12/20/2025" → December 2025 (not November)
    const p6 = text.match(/\d{2}\/\d{2}\/\d{4}\s*[-–]\s*(\d{2})\/\d{2}\/(\d{4})/);
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
 * Processing pipeline:
 *  1. Strip payment-network prefixes: "SQ *", "TST*", "PP*", "APL*", etc.
 *  2. Strip bank transaction-type prefixes: "Check Card Purchase", "ACH Debit", etc.
 *  3. Strip inline reference IDs: "*AB1234XY", long alphanumeric codes
 *  4. Strip store/location numbers: "#0679", "031344", "LBL#10688"
 *  5. Strip trailing city + 2-letter state: "LONG BEACH CA"
 *  6. Strip trailing standalone numbers (location codes)
 *  7. Strip trailing truncation artifacts (all-caps 2-char fragments at end)
 *  8. Check MERCHANT_DISPLAY_NAMES for known-chain normalization
 *  9. Title-case the result
 * 10. Truncate to 40 chars
 *
 * Examples:
 *   "SQ *8E8 THAI STREET FO LOS ANGELES CA"  → "8E8 Thai Street Fo"  (SQ* stripped, city stripped)
 *   "TST* ONEZO - LONG BEAC LONG BEACH CA"   → "Onezo - Long Beach"  (TST* stripped, city stripped, dup removed)
 *   "CHIPOTLE 0679 LAKEWOOD CA"              → "Chipotle"            (known chain, number stripped)
 *   "WHOLEFDS LBL#10688 LONG BEACH CA"       → "Whole Foods"         (known chain via MERCHANT_DISPLAY_NAMES)
 *   "TACO BELL 031344 RENTON WA"             → "Taco Bell"           (known chain)
 *   "QFC #5827 NEWCASTLE WA"                 → "QFC"                 (known chain)
 *
 * @param {string} rawDescription
 * @returns {string}
 */
function cleanMerchantName(rawDescription) {
  if (!rawDescription) return 'Unknown';

  let name = rawDescription.trim();

  // ── Step 0: Check MERCHANT_DISPLAY_NAMES on the RAW description first ────
  // This catches known chains like "TACO BELL 031344 RENTON WA" → "Taco Bell"
  // BEFORE any stripping that might corrupt the name.
  const rawLower = name.toLowerCase();
  for (const [key, displayName] of Object.entries(MERCHANT_DISPLAY_NAMES)) {
    if (rawLower.includes(key.toLowerCase())) {
      return displayName;
    }
  }

  // ── Step 1: Strip payment-network / aggregator prefixes ──────────────────
  // These prefixes are added by Square, Toast, PayPal, Apple Pay, DoorDash, etc.
  // and carry no useful merchant information.
  //   "SQ *8E8 THAI..."   → "8E8 THAI..."
  //   "TST* ONEZO..."     → "ONEZO..."
  //   "PP*PAYPAL..."      → "PAYPAL..."
  //   "APL* ITUNES..."    → "ITUNES..."
  name = name.replace(
    /^(?:SQ\s*\*\s*|TST\*\s*|PP\s*\*\s*|SP\s*\*\s*|APL\s*\*\s*|DD\s*\*\s*|DoorDash\s*\*\s*|LNE\s*\*\s*|WAL\s*\*\s*|WM\s*SUPERCENTER\s*)/i,
    ''
  );

  // ── Step 2: Strip bank transaction-type prefixes ──────────────────────────
  // Ally and other banks prepend these to every transaction description.
  name = name.replace(
    /^(?:check\s+card\s+purchase|debit\s+card\s+purchase|pos\s+purchase|pos\s+debit|ach\s+debit|ach\s+credit|online\s+transfer|wire\s+transfer|bill\s+payment|recurring\s+payment|preauthorized\s+debit|electronic\s+payment)\s+/i,
    ''
  );

  // ── Step 3: Strip inline reference/transaction IDs ────────────────────────
  // e.g. "AMAZON.COM*NF99E7P60" → "AMAZON.COM"
  // e.g. "WHOLEFDS LBL#10688"   → "WHOLEFDS"  (LBL# is a label/location code)
  name = name.replace(/\*[A-Z0-9]{4,}/gi, '');          // *XXXXXXXX after merchant
  name = name.replace(/\s+LBL#\d+/gi, '');              // LBL#12345 (Whole Foods label)
  name = name.replace(/\s+REF\s*#?\s*\w+/gi, '');       // REF #XXXXXX

  // ── Step 4: Strip store/location numbers ─────────────────────────────────
  // e.g. "CHIPOTLE 0679 LAKEWOOD CA" → "CHIPOTLE LAKEWOOD CA"
  // e.g. "TACO BELL 031344 RENTON WA" → "TACO BELL RENTON WA"
  // e.g. "QFC #5827 NEWCASTLE WA" → "QFC NEWCASTLE WA"
  // Strategy: remove standalone digit sequences (4–8 digits) that appear
  // between the merchant name and the city/state, but NOT at the very start.
  name = name.replace(/\s*#\d+/g, '');                  // #1234 anywhere
  name = name.replace(/(?<=\S)\s+\d{4,8}(?=\s+[A-Z])/g, ''); // 4-8 digit codes mid-string
  name = name.replace(/\s+(?:No\.?|Store|Loc\.?|Ste\.?)\s*\d+/gi, ''); // No. 123, Store 456

  // ── Step 5: Strip trailing city + 2-letter state ──────────────────────────
  // e.g. "STARBUCKS SEATTLE WA"             → "STARBUCKS"
  // e.g. "8E8 THAI STREET FO LOS ANGELES CA" → "8E8 THAI STREET FO"
  // e.g. "ONEZO - LONG BEAC LONG BEACH CA"   → "ONEZO - LONG BEAC"
  //
  // SAFE pattern: only strip "CITY STATE" where CITY is 3+ uppercase letters
  // (not a single word like "BELL" which is part of "TACO BELL").
  // Require at least one space before the city, and city must be ≥3 chars.
  name = name.replace(/\s+[A-Z]{3,}(?:\s+[A-Z]{3,})*\s+[A-Z]{2}\s*$/, '');

  // ── Step 6: Strip trailing standalone numbers (location codes) ────────────
  // e.g. "STARBUCKS 12345" → "STARBUCKS"
  name = name.replace(/\s+\d{3,}$/, '');

  // ── Step 7: Strip trailing all-caps 2-char fragments (truncation artifacts)
  // PDF statements sometimes truncate long names, leaving orphaned 2-char fragments.
  // e.g. "THAI STREET FO" — "FO" is a truncation of "FOOD"
  // We leave these in place since they're part of the name; title-casing handles them.

  // ── Step 8: Check MERCHANT_DISPLAY_NAMES again after stripping ───────────
  // Catches cases where the prefix was hiding the merchant name,
  // e.g. "SQ *CHIPOTLE 0679 LAKEWOOD CA" → after stripping → "CHIPOTLE" → "Chipotle"
  const lower = name.toLowerCase().trim();
  for (const [key, displayName] of Object.entries(MERCHANT_DISPLAY_NAMES)) {
    if (lower.includes(key.toLowerCase())) {
      return displayName;
    }
  }

  // ── Step 9: Title-case ────────────────────────────────────────────────────
  name = name
    .toLowerCase()
    .replace(/\b\w/g, c => c.toUpperCase())
    .trim();

  // ── Step 10: Truncate to 40 characters ───────────────────────────────────
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

    // ── Ally ACH Withdrawal look-ahead ────────────────────────────────────────
    // Ally statements print ACH Withdrawals as two lines:
    //   Line 1: MM/DD/YYYY  ACH Withdrawal  $0.00  -$109.20  $795.07
    //   Line 2: Edgeworks Climbi PAYMENT          ← actual merchant name
    //   Line 3: PAYMENT                           ← repeated keyword (skip)
    //
    // Similarly for WEB Funds Transfer:
    //   Line 1: MM/DD/YYYY  WEB Funds Transfer  $500.00  -$0.00  $2,904.27
    //   Line 2: Requested transfer from ALLY BANK  ← detail (not a merchant)
    //
    // Strategy: use index-based loop so we can peek at lines[i+1] when we
    // detect an ACH Withdrawal or similar continuation-style transaction.

    /**
     * Returns true if a line looks like a transaction continuation/detail line
     * rather than a new transaction (i.e. does NOT start with MM/DD/YYYY).
     */
    function isContinuationLine(l) {
      return l.length > 0 && !/^\d{2}\/\d{2}\/\d{4}/.test(l);
    }

    /**
     * Given the raw description from the transaction line (e.g. "ACH Withdrawal")
     * and the next non-empty continuation line (e.g. "Edgeworks Climbi PAYMENT"),
     * return the best merchant description to use.
     *
     * Rules:
     *  - "ACH Withdrawal" → use the continuation line as the merchant description
     *  - "WEB Funds Transfer" → keep as-is (category will be forced to transfer)
     *  - Everything else → keep the original description
     */
    function resolveAllyDescription(desc, continuationLine) {
      const descLower = desc.toLowerCase().trim();

      // ACH Withdrawal: the real merchant is on the next line
      if (/^ach\s+withdrawal/i.test(descLower)) {
        // Use the continuation line, but strip trailing repeated keywords
        // e.g. "Edgeworks Climbi PAYMENT\nPAYMENT" → use "Edgeworks Climbi PAYMENT"
        return continuationLine || desc;
      }

      // For all other types (WEB Funds Transfer, eCheck Deposit, etc.)
      // keep the original description — category override handles WEB Funds Transfer
      return desc;
    }

    /**
     * Applies Ally-specific category overrides AFTER buildTransaction().
     * Called with the transaction object and the raw description used.
     *
     * Overrides:
     *  - "WEB Funds Transfer"  → transfer
     *  - "FID BKG SVC"         → transfer  (Fidelity money-line)
     *  - "Edgeworks"           → health    (climbing gym)
     *  - "Interest Paid"       → income
     */
    function applyAllyOverrides(tx, rawDesc) {
      const d = rawDesc.toLowerCase();

      if (/web\s+funds\s+transfer/i.test(d) ||
          /internet\s+transfer/i.test(d) ||
          /requested\s+transfer/i.test(d)) {
        tx.categoryId = 'transfer';
        return;
      }

      if (/fid\s+bkg\s+svc/i.test(d)) {
        tx.merchantName = 'Fidelity Transfer';
        tx.categoryId   = 'transfer';
        return;
      }

      if (/discover\s+e-payment|discover\s+epayment/i.test(d)) {
        tx.merchantName = 'Discover Payment';
        tx.categoryId   = 'transfer';
        return;
      }

      if (/wells\s+fargo\s+card|biltcrdcrd/i.test(d)) {
        tx.merchantName = 'WF Payment';
        tx.categoryId   = 'transfer';
        return;
      }

      if (/edgeworks/i.test(d)) {
        tx.merchantName = 'Edgeworks';
        tx.categoryId   = 'health';
        return;
      }

      if (/interest\s+paid/i.test(d)) {
        tx.categoryId = 'income';
        return;
      }
    }

    // Build a flat array of trimmed, non-empty lines for index-based access
    const trimmedLines = lines.map(l => l.trim()).filter(l => l.length > 0);

    for (let i = 0; i < trimmedLines.length; i++) {
      const line = trimmedLines[i];

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

        // Look ahead: if next line is a continuation, use it to resolve merchant
        const nextLine = (i + 1 < trimmedLines.length && isContinuationLine(trimmedLines[i + 1]))
          ? trimmedLines[i + 1]
          : null;
        const resolvedDesc = resolveAllyDescription(desc, nextLine);

        // Skip the continuation line(s) so they aren't re-processed
        if (nextLine && resolvedDesc !== desc) {
          i++; // consumed the merchant continuation line
          // Also skip a second continuation line if it's a repeated keyword
          // e.g. "PAYMENT" repeated on its own line after "Edgeworks Climbi PAYMENT"
          if (i + 1 < trimmedLines.length && isContinuationLine(trimmedLines[i + 1])) {
            const afterNext = trimmedLines[i + 1];
            // Skip if it's a short repeated word (≤20 chars, no date, no dollar)
            if (afterNext.length <= 20 && !/\$/.test(afterNext)) i++;
          }
        }

        const tx = buildTransaction({ date, description: resolvedDesc, amount, accountId, accountType });
        applyAllyOverrides(tx, resolvedDesc);
        result.transactions.push(tx);
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

        // Look ahead for continuation line
        const nextLine = (i + 1 < trimmedLines.length && isContinuationLine(trimmedLines[i + 1]))
          ? trimmedLines[i + 1]
          : null;
        const resolvedDesc = resolveAllyDescription(desc, nextLine);

        if (nextLine && resolvedDesc !== desc) {
          i++;
          if (i + 1 < trimmedLines.length && isContinuationLine(trimmedLines[i + 1])) {
            const afterNext = trimmedLines[i + 1];
            if (afterNext.length <= 20 && !/\$/.test(afterNext)) i++;
          }
        }

        const tx = buildTransaction({ date, description: resolvedDesc, amount: rawAmount, accountId, accountType });
        applyAllyOverrides(tx, resolvedDesc);
        result.transactions.push(tx);
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

    const statYear  = period.year  || new Date().getFullYear();
    const statMonth = period.month || new Date().getMonth() + 1;

    // ── Actual Bilt Obsidian (Wells Fargo-issued) statement format:
    //
    // Trans Date  Post Date  Reference Number  Long Reference  Description  Amount
    // 12/20   12/20   080001000   8540924PMWGNBXTMM   WAHTA RAMEN FRISCO TX   $33.42
    // 12/15   12/15   000000083   8574110PE57LDF436   Bill Pay Payment   $1,001.54-
    //
    // Key observations:
    //   - 2 date columns (MM/DD, no year) + reference + long ref + description + amount
    //   - Payments have TRAILING minus: "$1,001.54-"
    //   - Purchases have no sign: "$33.42"
    //   - Foreign transactions have 3 continuation lines (currency info) — skip them
    //   - Year inferred from statement period

    // Pattern: MM/DD  MM/DD  digits  alphanumeric_ref  DESCRIPTION  $AMOUNT[-]
    const txRegex = /^(\d{2}\/\d{2})\s+\d{2}\/\d{2}\s+\d{6,}\s+\S+\s+(.+?)\s+\$([\d,]+\.\d{2})(-?)\s*$/;

    // Simpler fallback: MM/DD  MM/DD  ...  DESCRIPTION  $AMOUNT[-]
    // Matches lines with two MM/DD dates at the start and a dollar amount at the end
    const txRegexB = /^(\d{2}\/\d{2})\s+\d{2}\/\d{2}\s+.+?\s+(.+?)\s+\$([\d,]+\.\d{2})(-?)\s*$/;

    // Skip boilerplate
    const skipPatterns = /^(trans\s+date|post\s+date|date|description|amount|balance|transaction\s+summary|account|summary|total|opening|closing|beginning|ending|statement|period|page\s+\d|continued|minimum|payment\s+due|credit\s+limit|fees\s+charged|interest\s+charged|biltprotect|notice|detach|wells\s+fargo|udit|frisco|los\s+angeles|new\s+balance|available|days\s+in|statement\s+closing|\d{4}\s+totals|total\s+fees|total\s+interest|if\s+you|only\s+the|savings|purchase|cash\s+advance|variable|apr|type\s+of)/i;

    let inTransactionSection = false;

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Detect transaction section
      if (/transaction\s+summary/i.test(line)) {
        inTransactionSection = true;
        continue;
      }
      if (/fees\s+charged|interest\s+charged|biltprotect\s+summary|interest\s+charge\s+calc/i.test(line)) {
        inTransactionSection = false;
        continue;
      }

      if (skipPatterns.test(line)) continue;

      // Skip foreign currency continuation lines (start with "-" and contain currency info)
      if (/^-\s+(IN\s+\w+|[\d,]+\.\d+\s+X\s+[\d.]+)/.test(line)) continue;

      // Try Pattern A (strict: with reference numbers)
      let match = line.match(txRegex);
      if (!match) {
        // Try Pattern B (looser)
        match = line.match(txRegexB);
      }

      if (!match) {
        if (inTransactionSection && /^\d{2}\/\d{2}/.test(line)) {
          result.parseErrors.push(`Bilt: unparsed line: ${line}`);
        }
        continue;
      }

      const [, dateStr, desc, amountStr, trailingMinus] = match;
      const rawAmount = parseFloat(amountStr.replace(/,/g, ''));
      if (isNaN(rawAmount)) continue;

      const date = parseDate_MMDD(dateStr, statYear, statMonth);
      if (!date) continue;

      // Sign convention:
      //   Trailing minus (e.g. "$1,001.54-") = payment/credit → store as POSITIVE (income/transfer)
      //   No minus (e.g. "$33.42") = purchase → store as NEGATIVE (expense)
      const isPayment = trailingMinus === '-';
      const storedAmount = isPayment ? rawAmount : -rawAmount;

      result.transactions.push(buildTransaction({
        date,
        description: desc,
        amount: storedAmount,
        accountId: 'bilt-credit',
        accountType: 'credit',
      }));
      result.parsedCount++;
    }

    if (result.rawLineCount > 0) {
      const dataLines = lines.filter(l => l.trim().length > 5).length;
      result.confidence = dataLines > 0
        ? Math.min(1, result.parsedCount / Math.max(1, dataLines * 0.15))
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

    // ── Discover statement multi-column layout problem ──────────────────────
    //
    // Discover PDFs use a two-column layout: the left column has transactions
    // and the right column has cashback bonus promotional text. PDF.js sometimes
    // merges these into a single line, producing lines like:
    //
    //   "Grocery Stores, Wholesale Clubs and Select 01/28   UNIQLO USA LLC UNIQLO BELLEVUE WA   Merchandise   $21.95"
    //   "JAN-MAR MKQZZ9B82DA0  You're Earning 5%"
    //   "062051"
    //   "®"
    //
    // Strategy: scan each line for an embedded MM/DD date pattern and extract
    // the transaction portion starting from that date. This handles both clean
    // lines and lines with prepended promo text.
    //
    // We also need to handle continuation lines (cashback codes, store numbers,
    // Apple Pay tokens, etc.) that appear between transaction lines — skip them.

    // Expanded merchant category list (Discover uses many variants)
    const MERCHANT_CATEGORIES = new Set([
      'gasoline', 'merchandise', 'restaurants', 'travel', 'services',
      'entertainment', 'healthcare', 'education', 'groceries', 'automotive',
      'home', 'utilities', 'insurance', 'government', 'charity', 'other',
      'supermarkets', 'wholesale clubs', 'streaming', 'department stores',
      'drug stores', 'home improvement', 'sporting goods', 'electronics',
      'clothing', 'hotels', 'airlines', 'car rental', 'gas stations',
      'fast food', 'grocery stores', 'discount stores', 'office supplies',
    ]);

    // Build a regex alternation from the known merchant categories for Pattern A.
    // This ensures we only split on a real category word, not part of the description.
    // e.g. "TACO BELL 031344 RENTON WA Restaurants $13.43"
    //       → desc="TACO BELL 031344 RENTON WA", cat="Restaurants", amount="13.43"
    // e.g. "QFC #5827 NEWCASTLE WA Supermarkets $32.49"
    //       → desc="QFC #5827 NEWCASTLE WA", cat="Supermarkets", amount="32.49"
    const CATEGORY_ALTERNATION = [...MERCHANT_CATEGORIES]
      .map(c => c.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'))  // escape regex special chars
      .sort((a, b) => b.length - a.length)                  // longest first (greedy match)
      .join('|');

    // Pattern A: MM/DD  DESCRIPTION  KNOWN_CATEGORY  $AMOUNT [optional trailing text]
    // Uses the known category list as an anchor so the description boundary is unambiguous.
    // Allow trailing content after the amount (PDF.js sometimes merges the next line's text).
    const txRegexA = new RegExp(
      '^(\\d{2}\\/\\d{2})\\s+(.+?)\\s+(' + CATEGORY_ALTERNATION + ')\\s+[-]?\\$?([\\d,]+\\.\\d{2})(?:\\s.*)?$',
      'i'
    );

    // Pattern B: MM/DD  DESCRIPTION  $AMOUNT [optional trailing text]
    // e.g. "10/05   DIRECTPAY FULL BALANCE   -$174.82"
    // e.g. "09/27   APPLE.COM/BILL 866-712-7753 CA   $2.15"
    // Allow trailing content after the amount (merged lines from PDF.js).
    const txRegexB = /^(\d{2}\/\d{2})\s+(.+?)\s+([-]?\$[\d,]+\.\d{2})(?:\s.*)?$/;

    // Skip header/summary/boilerplate lines
    const skipPatterns = /^(trans\.?|date|description|amount|merchant|category|payments\s+and\s+credits|purchases|fees\s+and\s+interest|total\s+fees|total\s+interest|\d{4}\s+totals|year-to-date|interest\s+charge|annual\s+percentage|30\s+days|promo|type\s+of|purchases\s+\d|cash\s+advances|variable|previous\s+balance|new\s+balance|minimum|payment\s+due|cashback|rewards|earned|redeemed|see\s+details|open\s+to\s+close|page\s+\d|discover\.com|dial\s+711|po\s+box|carol\s+stream|hearing|mkq|26s|dit|apple\s+pay|continued\s+on|transactions\s+continued|fico|cardmember|udit\s+parikh|frisco|charlotte)/i;

    let currentSection = 'unknown'; // start unknown until we see a section header
    let inTransactionSection = false;

    /**
     * Given a raw line (possibly with prepended promo text), extract the
     * transaction portion starting from the first MM/DD date pattern.
     * Returns the trimmed transaction substring, or the original line if
     * no embedded date is found.
     */
    function extractTransactionPart(rawLine) {
      // Look for MM/DD pattern that is NOT at position 0 (i.e., it's embedded)
      const embeddedDateMatch = rawLine.match(/^.+?(\d{2}\/\d{2}\s+.+)$/);
      if (embeddedDateMatch) {
        // Make sure the part before the date looks like promo text (not a date itself)
        const before = rawLine.slice(0, rawLine.indexOf(embeddedDateMatch[1])).trim();
        // If the line starts with MM/DD already, don't strip anything
        if (/^\d{2}\/\d{2}/.test(rawLine)) return rawLine;
        // If the prefix is promo/boilerplate text (no dollar amount), strip it
        if (before.length > 0 && !/\$[\d,]+\.\d{2}/.test(before)) {
          return embeddedDateMatch[1].trim();
        }
      }
      return rawLine;
    }

    for (const rawLine of lines) {
      const line = rawLine.trim();
      if (!line) continue;

      // Detect section changes — check BEFORE skipPatterns
      if (/payments\s+and\s+credits/i.test(line) && /date/i.test(line)) {
        currentSection = 'payments';
        inTransactionSection = true;
        continue;
      }
      if (/^PAYMENTS\s+AND\s+CREDITS$/i.test(line)) {
        currentSection = 'payments';
        inTransactionSection = true;
        continue;
      }
      if (/^DATE\s+PURCHASES/i.test(line) || /^PURCHASES\s*$/i.test(line) ||
          (/purchases/i.test(line) && /merchant\s+category/i.test(line))) {
        currentSection = 'purchases';
        inTransactionSection = true;
        continue;
      }
      if (/^Fees\s+and\s+Interest|^TOTAL\s+FEES|^Interest\s+Charge\s+Calc/i.test(line)) {
        inTransactionSection = false;
        continue;
      }

      if (skipPatterns.test(line)) continue;

      // Skip pure continuation/noise lines (cashback codes, store numbers, symbols)
      // These are lines that contain no dollar amount and no MM/DD date
      if (!/\$[\d,]+\.\d{2}/.test(line) && !/^\d{2}\/\d{2}/.test(line)) {
        // Could be a continuation line — only skip if it looks like noise
        // (short alphanumeric codes, ® symbols, Apple Pay tokens, promo text)
        if (/^[\dA-Z®\s]{1,20}$/.test(line) ||
            /^(apple\s+pay|you.re\s+earning|cashback\s+bonus|jan-mar|feb-apr|oct-dec|jul-sep|mkq|5%|1%)/i.test(line) ||
            /^(grocery\s+stores|wholesale\s+clubs|streaming|earn\s+\d|different\s+places|quarterly\s+maximum|cash\s+back\s+on)/i.test(line)) {
          continue;
        }
      }

      // Extract the transaction portion (handles lines with prepended promo text)
      const txLine = extractTransactionPart(line);

      // Try Pattern A (with known merchant category anchor)
      // txRegexA only matches when the category word is in MERCHANT_CATEGORIES,
      // so no further validation is needed.
      let match = txLine.match(txRegexA);
      if (match) {
        const [, dateStr, desc, , amountStr] = match;
        const rawAmount = parseFloat(amountStr.replace(/,/g, ''));
        if (!isNaN(rawAmount)) {
          const date = parseDate_MMDD(dateStr, statYear, statMonth);
          if (date) {
            const storedAmount = (currentSection === 'payments') ? rawAmount : -Math.abs(rawAmount);
            result.transactions.push(buildTransaction({
              date, description: desc.trim(), amount: storedAmount,
              accountId: 'discover-credit', accountType: 'credit',
            }));
            result.parsedCount++;
            continue;
          }
        }
      }

      // Try Pattern B (no merchant category)
      match = txLine.match(txRegexB);
      if (match) {
        const [, dateStr, desc, amountWithSign] = match;
        // Remove $ and parse — keep the sign from the PDF
        const rawAmount = parseFloat(amountWithSign.replace(/[$,]/g, ''));
        if (isNaN(rawAmount)) continue;

        const date = parseDate_MMDD(dateStr, statYear, statMonth);
        if (!date) continue;

        // Credit card sign convention:
        //   Negative in PDF (e.g. -$60.44) = payment/credit → store as POSITIVE (income)
        //   Positive in PDF (e.g. $2.48)   = purchase       → store as NEGATIVE (expense)
        let storedAmount;
        if (currentSection === 'payments') {
          // In payments section: negative PDF amount = payment → flip to positive
          storedAmount = rawAmount < 0 ? -rawAmount : -rawAmount;
        } else {
          // In purchases section: always negative (expense)
          storedAmount = -Math.abs(rawAmount);
        }

        result.transactions.push(buildTransaction({
          date, description: desc.trim(), amount: storedAmount,
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

    // ── Extract FICO credit score ──────────────────────────────────────────
    // Discover statements include a FICO Score 8 section.
    // ── FICO Score Extraction ─────────────────────────────────────────────
    // Discover statements contain a section like:
    //   "FICO   Score 8 based on TransUnion   data:\n798 AS OF 10/04/25"
    //
    // PDF.js may extract this with extra spaces between words (column layout)
    // and the score on the next line. We use a simple line-by-line approach:
    //   1. Find any line containing all key words: "fico", "score", "data"
    //   2. Check that line and the next 3 lines for a standalone 3-digit score
    //   3. Also check the line itself for an inline score (e.g. "data: 798")
    //
    // Score range: 300–850.
    let ficoScore = null;
    let ficoDate  = null;

    const ficoLines = text.split('\n');
    for (let i = 0; i < ficoLines.length; i++) {
      const lineLower = ficoLines[i].toLowerCase();
      // Look for a line that mentions both "fico" and ("score" or "data")
      if (lineLower.includes('fico') && (lineLower.includes('score') || lineLower.includes('data'))) {
        // Check this line and the next 4 lines for a score
        for (let j = i; j <= Math.min(i + 4, ficoLines.length - 1); j++) {
          const candidate = ficoLines[j].trim();
          // Match a standalone 3-digit number (possibly followed by "AS OF ...")
          const scoreMatch = candidate.match(/^([3-8]\d{2})\b/);
          if (scoreMatch) {
            const val = parseInt(scoreMatch[1], 10);
            if (val >= 300 && val <= 850) {
              ficoScore = val;
              // Try to extract "AS OF MM/DD/YY" date from the same line
              const dateMatch = candidate.match(/as\s+of\s+(\d{2}\/\d{2}\/\d{2,4})/i);
              if (dateMatch) ficoDate = dateMatch[1];
              console.log('[Parser] Discover: FICO score', ficoScore, 'found on line', j, ':', JSON.stringify(candidate));
              break;
            }
          }
          // Also check for inline score at end of line: "data: 798" or "data:\n798"
          if (j === i) {
            const inlineMatch = candidate.match(/data\s*:?\s*([3-8]\d{2})\b/i);
            if (inlineMatch) {
              const val = parseInt(inlineMatch[1], 10);
              if (val >= 300 && val <= 850) {
                ficoScore = val;
                console.log('[Parser] Discover: FICO score', ficoScore, 'found inline on line', i);
                break;
              }
            }
          }
        }
        if (ficoScore) break;
      }
    }

    // Fallback: "NNN as of MM/DD/YY" anywhere in text
    if (!ficoScore) {
      const p5 = text.match(/\b([3-8]\d{2})\s+as\s+of\s+(\d{2}\/\d{2}\/\d{2,4})/i);
      if (p5) {
        ficoScore = parseInt(p5[1], 10);
        ficoDate  = p5[2];
        console.log('[Parser] Discover: FICO score', ficoScore, 'found via "as of" fallback');
      }
    }

    if (ficoScore && (ficoScore < 300 || ficoScore > 850)) {
      console.warn('[Parser] Discover: rejected implausible FICO score:', ficoScore);
      ficoScore = null;
    }

    if (ficoScore) {
      result.creditScore = ficoScore;
      result.creditScoreDate = ficoDate || null;
      console.log('[Parser] Discover: ✅ credit score', result.creditScore, 'as of', result.creditScoreDate);
    } else {
      console.warn('[Parser] Discover: ❌ could not extract FICO score');
      // Log lines around "fico" for debugging
      const ficoLineIdx = ficoLines.findIndex(function (l) { return l.toLowerCase().includes('fico'); });
      if (ficoLineIdx !== -1) {
        console.log('[Parser] Discover: FICO context lines:', JSON.stringify(ficoLines.slice(Math.max(0, ficoLineIdx - 1), ficoLineIdx + 5)));
      }
    }

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
