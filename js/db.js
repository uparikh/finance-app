/**
 * db.js — IndexedDB Database Layer
 *
 * Exposes a global `FinanceDB` object with a Promise-based API for all
 * data operations in the Finance PWA.
 *
 * Usage:
 *   await FinanceDB.init();          // Must be called once at app startup
 *   const txns = await FinanceDB.getTransactionsByMonth('2026-02');
 *
 * Load order: must be included BEFORE app.js in index.html.
 * No ES modules, no bundler — plain <script src="js/db.js"> include.
 */

(function (global) {
  'use strict';

  // ─── Constants ──────────────────────────────────────────────────────────────

  const DB_NAME    = 'FinanceAppDB';
  const DB_VERSION = 4;

  // ─── Internal State ─────────────────────────────────────────────────────────

  /** @type {IDBDatabase|null} Cached DB connection — opened once, reused. */
  let _db = null;

  /**
   * In-memory cache of merchant rules for synchronous categorization.
   * Populated during init() and refreshed whenever rules are mutated.
   * @type {Array<{id:number, pattern:string, categoryId:string, merchantName:string, isUserDefined:boolean, matchCount:number}>}
   */
  let _rulesCache = [];

  // ─── Default Seed Data ──────────────────────────────────────────────────────

  const DEFAULT_CATEGORIES = [
    { id: 'food',          name: 'Food & Dining',    emoji: '🍔', color: '#FF6B6B', isDefault: true, isHidden: false, sortOrder: 1  },
    { id: 'groceries',     name: 'Groceries',         emoji: '🛒', color: '#4ECDC4', isDefault: true, isHidden: false, sortOrder: 2  },
    { id: 'transport',     name: 'Transport',          emoji: '🚗', color: '#45B7D1', isDefault: true, isHidden: false, sortOrder: 3  },
    { id: 'shopping',      name: 'Shopping',           emoji: '🛍️', color: '#96CEB4', isDefault: true, isHidden: false, sortOrder: 4  },
    { id: 'subscriptions', name: 'Subscriptions',      emoji: '📺', color: '#9B59B6', isDefault: true, isHidden: false, sortOrder: 5  },
    { id: 'health',        name: 'Health & Medical',   emoji: '💊', color: '#E74C3C', isDefault: true, isHidden: false, sortOrder: 6  },
    { id: 'travel',        name: 'Travel',             emoji: '✈️', color: '#3498DB', isDefault: true, isHidden: false, sortOrder: 7  },
    { id: 'housing',       name: 'Housing & Rent',     emoji: '🏠', color: '#E67E22', isDefault: true, isHidden: false, sortOrder: 8  },
    { id: 'entertainment', name: 'Entertainment',      emoji: '🎬', color: '#F39C12', isDefault: true, isHidden: false, sortOrder: 9  },
    { id: 'utilities',     name: 'Utilities',          emoji: '💡', color: '#1ABC9C', isDefault: true, isHidden: false, sortOrder: 10 },
    { id: 'income',        name: 'Income',             emoji: '💰', color: '#2ECC71', isDefault: true, isHidden: false, sortOrder: 11 },
    { id: 'gas',           name: 'Gas & Fuel',         emoji: '⛽', color: '#F97316', isDefault: true, isHidden: false, sortOrder: 12 },
    { id: 'transfer',      name: 'Transfer',           emoji: '🔄', color: '#95A5A6', isDefault: true, isHidden: false, sortOrder: 13 },
    { id: 'other',         name: 'Other',              emoji: '📦', color: '#BDC3C7', isDefault: true, isHidden: false, sortOrder: 14 },
  ];

  const DEFAULT_ACCOUNTS = [
    { id: 'ally-checking',       name: 'Ally Checking',          institution: 'Ally Bank',    type: 'checking', color: '#6C63FF', isActive: true, lastImported: null },
    { id: 'ally-savings',        name: 'Ally Savings',           institution: 'Ally Bank',    type: 'savings',  color: '#7C73FF', isActive: true, lastImported: null },
    { id: 'capital-one-savings', name: 'Capital One Savings',    institution: 'Capital One',  type: 'savings',  color: '#CC0000', isActive: true, lastImported: null },
    { id: 'bilt-credit',         name: 'Bilt Obsidian',          institution: 'Bilt',         type: 'credit',   color: '#1A1A2E', isActive: true, lastImported: null },
    { id: 'discover-credit',     name: 'Discover It',            institution: 'Discover',     type: 'credit',   color: '#FF6600', isActive: true, lastImported: null },
    { id: 'wells-fargo-credit',  name: 'Wells Fargo Autograph',  institution: 'Wells Fargo',  type: 'credit',   color: '#CC0000', isActive: true, lastImported: null },
  ];

  /**
   * Default merchant rules.
   * Each entry: [pattern, categoryId, merchantName]
   * pattern is a lowercase substring to match against the transaction description.
   */
  const DEFAULT_MERCHANT_RULES = [
    // ── Food & Dining — Named Chains ───────────────────────────────────────
    ['mcdonald',           'food', 'McDonald\'s'],
    ['burger king',        'food', 'Burger King'],
    ['wendy',              'food', 'Wendy\'s'],
    ['taco bell',          'food', 'Taco Bell'],
    ['chipotle',           'food', 'Chipotle'],
    ['subway',             'food', 'Subway'],
    ['domino',             'food', 'Domino\'s'],
    ['pizza hut',          'food', 'Pizza Hut'],
    ['papa john',          'food', 'Papa John\'s'],
    ['little caesar',      'food', 'Little Caesars'],
    ['papa murphy',        'food', 'Papa Murphy\'s'],
    ['chick-fil-a',        'food', 'Chick-fil-A'],
    ['chick fil a',        'food', 'Chick-fil-A'],
    ['popeyes',            'food', 'Popeyes'],
    ['raising cane',       'food', 'Raising Cane\'s'],
    ['wingstop',           'food', 'Wingstop'],
    ['five guys',          'food', 'Five Guys'],
    ['shake shack',        'food', 'Shake Shack'],
    ['smashburger',        'food', 'Smashburger'],
    ['fatburger',          'food', 'Fatburger'],
    ['habit burger',       'food', 'The Habit Burger'],
    ['whataburger',        'food', 'Whataburger'],
    ['sonic drive',        'food', 'Sonic'],
    ['jack in the box',    'food', 'Jack in the Box'],
    ['del taco',           'food', 'Del Taco'],
    ['carl\'s jr',         'food', 'Carl\'s Jr.'],
    ['carls jr',           'food', 'Carl\'s Jr.'],
    ['hardee',             'food', 'Hardee\'s'],
    ['culver',             'food', 'Culver\'s'],
    ['cook out',           'food', 'Cook Out'],
    ['in-n-out',           'food', 'In-N-Out'],
    ['in n out',           'food', 'In-N-Out'],
    ['starbucks',          'food', 'Starbucks'],
    ['dutch bros',         'food', 'Dutch Bros'],
    ['blue bottle',        'food', 'Blue Bottle Coffee'],
    ['peet\'s',            'food', 'Peet\'s Coffee'],
    ['peets coffee',       'food', 'Peet\'s Coffee'],
    ['dunkin',             'food', 'Dunkin\''],
    ['panera',             'food', 'Panera Bread'],
    ['panda express',      'food', 'Panda Express'],
    ['olive garden',       'food', 'Olive Garden'],
    ['applebee',           'food', 'Applebee\'s'],
    ['chili\'s',           'food', 'Chili\'s'],
    ['chilis',             'food', 'Chili\'s'],
    ['ihop',               'food', 'IHOP'],
    ['denny',              'food', 'Denny\'s'],
    ['waffle house',       'food', 'Waffle House'],
    ['cracker barrel',     'food', 'Cracker Barrel'],
    ['texas roadhouse',    'food', 'Texas Roadhouse'],
    ['outback',            'food', 'Outback Steakhouse'],
    ['red lobster',        'food', 'Red Lobster'],
    ['red robin',          'food', 'Red Robin'],
    ['buffalo wild',       'food', 'Buffalo Wild Wings'],
    ['yard house',         'food', 'Yard House'],
    ['cheesecake factory', 'food', 'Cheesecake Factory'],
    ['pf chang',           'food', 'P.F. Chang\'s'],
    ['benihana',           'food', 'Benihana'],
    ['noodles & company',  'food', 'Noodles & Company'],
    ['sweetgreen',         'food', 'Sweetgreen'],
    ['cava ',              'food', 'Cava'],
    ['mod pizza',          'food', 'MOD Pizza'],
    ['blaze pizza',        'food', 'Blaze Pizza'],
    ['jersey mike',        'food', 'Jersey Mike\'s'],
    ['jimmy john',         'food', 'Jimmy John\'s'],
    ['firehouse sub',      'food', 'Firehouse Subs'],
    ['potbelly',           'food', 'Potbelly'],
    ['round table',        'food', 'Round Table Pizza'],
    ['doordash',           'food', 'DoorDash'],
    ['uber eats',          'food', 'Uber Eats'],
    ['grubhub',            'food', 'Grubhub'],
    ['postmates',          'food', 'Postmates'],
    ['instacart restaurant','food','Instacart Restaurant'],
    ['seamless',           'food', 'Seamless'],
    ['caviar',             'food', 'Caviar'],

    // ── Food & Dining — Semantic Keywords ─────────────────────────────────
    // These catch independent/local restaurants by what they serve.
    // Placed AFTER named chains so chains match first.
    ['taco ',              'food', 'Taco Restaurant'],
    ['tacos',              'food', 'Taco Restaurant'],
    ['burrito',            'food', 'Mexican Restaurant'],
    ['mexican',            'food', 'Mexican Restaurant'],
    ['thai ',              'food', 'Thai Restaurant'],
    ['thai street',        'food', 'Thai Restaurant'],
    ['sushi',              'food', 'Sushi Restaurant'],
    ['ramen',              'food', 'Ramen Restaurant'],
    ['pho ',               'food', 'Vietnamese Restaurant'],
    ['vietnamese',         'food', 'Vietnamese Restaurant'],
    ['chinese',            'food', 'Chinese Restaurant'],
    ['dim sum',            'food', 'Chinese Restaurant'],
    ['korean bbq',         'food', 'Korean Restaurant'],
    ['korean ',            'food', 'Korean Restaurant'],
    ['japanese',           'food', 'Japanese Restaurant'],
    ['indian ',            'food', 'Indian Restaurant'],
    ['curry ',             'food', 'Indian Restaurant'],
    ['mediterranean',      'food', 'Mediterranean Restaurant'],
    ['greek ',             'food', 'Greek Restaurant'],
    ['italian ',           'food', 'Italian Restaurant'],
    ['pizza',              'food', 'Pizza Restaurant'],
    ['burger',             'food', 'Burger Restaurant'],
    ['bbq ',               'food', 'BBQ Restaurant'],
    ['barbecue',           'food', 'BBQ Restaurant'],
    ['steakhouse',         'food', 'Steakhouse'],
    ['steak ',             'food', 'Steakhouse'],
    ['seafood',            'food', 'Seafood Restaurant'],
    ['sandwich',           'food', 'Sandwich Shop'],
    ['deli ',              'food', 'Deli'],
    ['bakery',             'food', 'Bakery'],
    ['cafe ',              'food', 'Cafe'],
    ['coffee',             'food', 'Coffee Shop'],
    ['boba',               'food', 'Boba Tea'],
    ['bubble tea',         'food', 'Boba Tea'],
    ['milk tea',           'food', 'Boba Tea'],
    ['ice cream',          'food', 'Ice Cream'],
    ['gelato',             'food', 'Ice Cream'],
    ['frozen yogurt',      'food', 'Frozen Yogurt'],
    ['froyo',              'food', 'Frozen Yogurt'],
    ['donut',              'food', 'Donut Shop'],
    ['doughnut',           'food', 'Donut Shop'],
    ['bagel',              'food', 'Bagel Shop'],
    ['brunch',             'food', 'Brunch Restaurant'],
    ['breakfast',          'food', 'Breakfast Restaurant'],
    ['bistro',             'food', 'Restaurant'],
    ['grill ',             'food', 'Restaurant'],
    ['kitchen',            'food', 'Restaurant'],
    ['eatery',             'food', 'Restaurant'],
    ['restaurant',         'food', 'Restaurant'],
    ['dining',             'food', 'Restaurant'],
    ['food hall',          'food', 'Food Hall'],
    ['food truck',         'food', 'Food Truck'],
    ['wing ',              'food', 'Wings Restaurant'],
    ['wings',              'food', 'Wings Restaurant'],
    ['noodle',             'food', 'Noodle Restaurant'],
    ['dumpling',           'food', 'Dumpling Restaurant'],
    ['falafel',            'food', 'Middle Eastern Restaurant'],
    ['shawarma',           'food', 'Middle Eastern Restaurant'],
    ['kebab',              'food', 'Middle Eastern Restaurant'],
    ['tapas',              'food', 'Spanish Restaurant'],
    ['izakaya',            'food', 'Japanese Restaurant'],
    ['teriyaki',           'food', 'Japanese Restaurant'],
    ['hibachi',            'food', 'Japanese Restaurant'],
    ['hot pot',            'food', 'Hot Pot Restaurant'],
    ['hotpot',             'food', 'Hot Pot Restaurant'],
    ['fondue',             'food', 'Fondue Restaurant'],
    ['crepe',              'food', 'Crepe Restaurant'],
    ['waffle',             'food', 'Waffle Restaurant'],
    ['pancake',            'food', 'Breakfast Restaurant'],
    ['smoothie',           'food', 'Smoothie Bar'],
    ['juice bar',          'food', 'Juice Bar'],
    ['acai',               'food', 'Acai Bowl'],
    ['poke ',              'food', 'Poke Bowl'],
    ['bowl ',              'food', 'Restaurant'],
    ['bar & grill',        'food', 'Bar & Grill'],
    ['pub ',               'food', 'Pub'],
    ['tavern',             'food', 'Tavern'],
    ['brewery',            'food', 'Brewery'],
    ['brewpub',            'food', 'Brewpub'],
    ['winery',             'food', 'Winery'],
    // Note: "SQ *" (Square) and "TST*" (Toast) prefixes are stripped by
    // cleanMerchantName() before categorization, so we rely on the actual
    // merchant name keywords above rather than broad POS-prefix rules.

    // ── Groceries ──────────────────────────────────────────────────────────
    ['wholefds',           'groceries', 'Whole Foods'],   // truncated form on statements
    ['whole foods',        'groceries', 'Whole Foods'],
    ['trader joe',         'groceries', 'Trader Joe\'s'],
    ['safeway',            'groceries', 'Safeway'],
    ['kroger',             'groceries', 'Kroger'],
    ['publix',             'groceries', 'Publix'],
    ['wegmans',            'groceries', 'Wegmans'],
    ['costco',             'groceries', 'Costco'],
    ['sam\'s club',        'groceries', 'Sam\'s Club'],
    ['aldi',               'groceries', 'ALDI'],
    ['sprouts',            'groceries', 'Sprouts'],
    ['fresh market',       'groceries', 'The Fresh Market'],
    ['giant',              'groceries', 'Giant'],
    ['stop & shop',        'groceries', 'Stop & Shop'],
    ['food lion',          'groceries', 'Food Lion'],
    ['harris teeter',      'groceries', 'Harris Teeter'],
    ['meijer',             'groceries', 'Meijer'],
    ['h-e-b',              'groceries', 'H-E-B'],
    ['heb',                'groceries', 'H-E-B'],
    ['winco',              'groceries', 'WinCo'],
    ['smart & final',      'groceries', 'Smart & Final'],
    ['qfc',                'groceries', 'QFC'],
    ['fred meyer',         'groceries', 'Fred Meyer'],
    ['ralphs',             'groceries', 'Ralphs'],
    ['vons',               'groceries', 'Vons'],
    ['pavilions',          'groceries', 'Pavilions'],
    ['albertsons',         'groceries', 'Albertsons'],
    ['stater bros',        'groceries', 'Stater Bros'],
    ['food 4 less',        'groceries', 'Food 4 Less'],
    ['lucky supermarket',  'groceries', 'Lucky'],
    ['market basket',      'groceries', 'Market Basket'],
    ['piggly wiggly',      'groceries', 'Piggly Wiggly'],
    ['grocery',            'groceries', 'Grocery Store'],
    ['supermarket',        'groceries', 'Supermarket'],

    // ── Gas & Fuel ─────────────────────────────────────────────────────────
    ['shell',              'gas', 'Shell'],
    ['chevron',            'gas', 'Chevron'],
    ['exxon',              'gas', 'ExxonMobil'],
    ['bp ',                'gas', 'BP'],
    ['mobil',              'gas', 'Mobil'],
    ['sunoco',             'gas', 'Sunoco'],
    ['marathon',           'gas', 'Marathon'],
    ['speedway',           'gas', 'Speedway'],
    ['circle k',           'gas', 'Circle K'],
    ['wawa',               'gas', 'Wawa'],
    ['gas station',        'gas', 'Gas Station'],
    ['racetrac',           'gas', 'RaceTrac'],
    ['7-eleven',           'gas', '7-Eleven'],
    ['7 eleven',           'gas', '7-Eleven'],
    ['safeway fuel',       'gas', 'Safeway Fuel'],
    ['fred m fuel',        'gas', 'Fred Meyer Fuel'],
    ['costco gas',         'gas', 'Costco Gas'],
    ['buc-ee',             'gas', "Buc-ee's"],
    ['pilot flying',       'gas', 'Pilot Flying J'],
    ['loves travel',       'gas', "Love's Travel"],
    ['kwik trip',          'gas', 'Kwik Trip'],
    ['casey',              'gas', "Casey's"],
    ['fuel',               'gas', 'Gas Station'],
    // ── Transport ──────────────────────────────────────────────────────────
    ['uber',               'transport', 'Uber'],
    ['lyft',               'transport', 'Lyft'],
    ['parking',            'transport', 'Parking'],
    ['metro',              'transport', 'Metro'],
    ['transit',            'transport', 'Transit'],
    ['mta ',               'transport', 'MTA'],
    ['bart ',              'transport', 'BART'],
    ['caltrain',           'transport', 'Caltrain'],
    ['amtrak',             'transport', 'Amtrak'],
    ['greyhound',          'transport', 'Greyhound'],
    ['enterprise rent',    'transport', 'Enterprise'],
    ['hertz',              'transport', 'Hertz'],
    ['avis',               'transport', 'Avis'],
    ['budget rent',        'transport', 'Budget'],
    ['zipcar',             'transport', 'Zipcar'],
    ['ez pass',            'transport', 'E-ZPass'],
    ['fastrak',            'transport', 'FasTrak'],
    ['toll',               'transport', 'Toll'],

    // ── Shopping ───────────────────────────────────────────────────────────
    ['amazon',             'shopping', 'Amazon'],
    ['amzn',               'shopping', 'Amazon'],
    ['target',             'shopping', 'Target'],
    ['walmart',            'shopping', 'Walmart'],
    ['best buy',           'shopping', 'Best Buy'],
    ['apple store',        'shopping', 'Apple Store'],
    ['apple.com/bill',     'shopping', 'Apple'],
    ['ikea',               'shopping', 'IKEA'],
    ['home depot',         'shopping', 'Home Depot'],
    ['lowe\'s',            'shopping', 'Lowe\'s'],
    ['lowes',              'shopping', 'Lowe\'s'],
    ['bed bath',           'shopping', 'Bed Bath & Beyond'],
    ['tj maxx',            'shopping', 'TJ Maxx'],
    ['marshalls',          'shopping', 'Marshalls'],
    ['ross ',              'shopping', 'Ross'],
    ['nordstrom',          'shopping', 'Nordstrom'],
    ['macy',               'shopping', 'Macy\'s'],
    ['gap ',               'shopping', 'Gap'],
    ['old navy',           'shopping', 'Old Navy'],
    ['h&m',                'shopping', 'H&M'],
    ['zara',               'shopping', 'Zara'],
    ['uniqlo',             'shopping', 'Uniqlo'],
    ['daiso',              'shopping', 'Daiso'],
    ['nike',               'shopping', 'Nike'],
    ['adidas',             'shopping', 'Adidas'],
    ['under armour',       'shopping', 'Under Armour'],
    ['lululemon',          'shopping', 'Lululemon'],
    ['athleta',            'shopping', 'Athleta'],
    ['sephora',            'shopping', 'Sephora'],
    ['ulta',               'shopping', 'Ulta Beauty'],
    ['bath & body',        'shopping', 'Bath & Body Works'],
    ['victoria secret',    'shopping', 'Victoria\'s Secret'],
    ['barnes & noble',     'shopping', 'Barnes & Noble'],
    ['staples',            'shopping', 'Staples'],
    ['office depot',       'shopping', 'Office Depot'],
    ['dollar tree',        'shopping', 'Dollar Tree'],
    ['dollar general',     'shopping', 'Dollar General'],
    ['five below',         'shopping', 'Five Below'],
    ['etsy',               'shopping', 'Etsy'],
    ['ebay',               'shopping', 'eBay'],
    ['wayfair',            'shopping', 'Wayfair'],
    ['chewy',              'shopping', 'Chewy'],
    ['petco',              'shopping', 'Petco'],
    ['petsmart',           'shopping', 'PetSmart'],

    // ── Subscriptions ──────────────────────────────────────────────────────
    ['netflix',            'subscriptions', 'Netflix'],
    ['spotify',            'subscriptions', 'Spotify'],
    ['hulu',               'subscriptions', 'Hulu'],
    ['disney+',            'subscriptions', 'Disney+'],
    ['disney plus',        'subscriptions', 'Disney+'],
    ['hbo',                'subscriptions', 'HBO'],
    ['max ',               'subscriptions', 'Max'],
    ['apple one',          'subscriptions', 'Apple One'],
    ['apple music',        'subscriptions', 'Apple Music'],
    ['apple tv',           'subscriptions', 'Apple TV+'],
    ['youtube premium',    'subscriptions', 'YouTube Premium'],
    ['amazon prime',       'subscriptions', 'Amazon Prime'],
    ['paramount',          'subscriptions', 'Paramount+'],
    ['peacock',            'subscriptions', 'Peacock'],
    ['crunchyroll',        'subscriptions', 'Crunchyroll'],
    ['twitch',             'subscriptions', 'Twitch'],
    ['patreon',            'subscriptions', 'Patreon'],
    ['substack',           'subscriptions', 'Substack'],
    ['medium',             'subscriptions', 'Medium'],
    ['dropbox',            'subscriptions', 'Dropbox'],
    ['google one',         'subscriptions', 'Google One'],
    ['icloud',             'subscriptions', 'iCloud'],
    ['microsoft 365',      'subscriptions', 'Microsoft 365'],
    ['adobe',              'subscriptions', 'Adobe'],
    ['canva',              'subscriptions', 'Canva'],
    ['notion',             'subscriptions', 'Notion'],
    ['chatgpt',            'subscriptions', 'ChatGPT'],
    ['openai',             'subscriptions', 'OpenAI'],
    ['github',             'subscriptions', 'GitHub'],
    ['linkedin premium',   'subscriptions', 'LinkedIn Premium'],
    ['duolingo',           'subscriptions', 'Duolingo'],
    ['calm',               'subscriptions', 'Calm'],
    ['headspace',          'subscriptions', 'Headspace'],
    ['nytimes',            'subscriptions', 'NY Times'],
    ['wsj ',               'subscriptions', 'Wall Street Journal'],
    ['washington post',    'subscriptions', 'Washington Post'],

    // ── Health ─────────────────────────────────────────────────────────────
    ['cvs',                'health', 'CVS'],
    ['walgreens',          'health', 'Walgreens'],
    ['rite aid',           'health', 'Rite Aid'],
    ['pharmacy',           'health', 'Pharmacy'],
    ['hospital',           'health', 'Hospital'],
    ['clinic',             'health', 'Clinic'],
    ['urgent care',        'health', 'Urgent Care'],
    ['doctor',             'health', 'Doctor'],
    ['dentist',            'health', 'Dentist'],
    ['optometrist',        'health', 'Optometrist'],
    ['vision',             'health', 'Vision'],
    ['lab corp',           'health', 'LabCorp'],
    ['quest diagnostics',  'health', 'Quest Diagnostics'],
    ['insurance',          'health', 'Insurance'],
    ['gym',                'health', 'Gym'],
    ['planet fitness',     'health', 'Planet Fitness'],
    ['equinox',            'health', 'Equinox'],
    ['la fitness',         'health', 'LA Fitness'],
    ['anytime fitness',    'health', 'Anytime Fitness'],
    ['ymca',               'health', 'YMCA'],
    ['crossfit',           'health', 'CrossFit'],
    ['peloton',            'health', 'Peloton'],

    // ── Travel ─────────────────────────────────────────────────────────────
    ['airbnb',             'travel', 'Airbnb'],
    ['vrbo',               'travel', 'VRBO'],
    ['hotel',              'travel', 'Hotel'],
    ['marriott',           'travel', 'Marriott'],
    ['hilton',             'travel', 'Hilton'],
    ['hyatt',              'travel', 'Hyatt'],
    ['ihg ',               'travel', 'IHG'],
    ['wyndham',            'travel', 'Wyndham'],
    ['best western',       'travel', 'Best Western'],
    ['motel',              'travel', 'Motel'],
    ['expedia',            'travel', 'Expedia'],
    ['booking.com',        'travel', 'Booking.com'],
    ['kayak',              'travel', 'Kayak'],
    ['priceline',          'travel', 'Priceline'],
    ['delta',              'travel', 'Delta Airlines'],
    ['united',             'travel', 'United Airlines'],
    ['american airlines',  'travel', 'American Airlines'],
    ['southwest',          'travel', 'Southwest Airlines'],
    ['jetblue',            'travel', 'JetBlue'],
    ['spirit airlines',    'travel', 'Spirit Airlines'],
    ['frontier',           'travel', 'Frontier Airlines'],
    ['alaska airlines',    'travel', 'Alaska Airlines'],
    ['tsa precheck',       'travel', 'TSA PreCheck'],
    ['global entry',       'travel', 'Global Entry'],

    // ── Housing ────────────────────────────────────────────────────────────
    ['rent',               'housing', 'Rent'],
    ['mortgage',           'housing', 'Mortgage'],
    ['hoa ',               'housing', 'HOA'],
    ['property tax',       'housing', 'Property Tax'],
    ['renters insurance',  'housing', 'Renters Insurance'],
    ['homeowners',         'housing', 'Homeowners Insurance'],
    ['electric',           'housing', 'Electric'],
    ['water bill',         'housing', 'Water'],
    ['gas bill',           'housing', 'Gas'],
    ['internet',           'housing', 'Internet'],
    ['comcast',            'housing', 'Comcast'],
    ['xfinity',            'housing', 'Xfinity'],
    ['at&t',               'housing', 'AT&T'],
    ['verizon',            'housing', 'Verizon'],
    ['tmobile',            'housing', 'T-Mobile'],
    ['t-mobile',           'housing', 'T-Mobile'],
    ['spectrum',           'housing', 'Spectrum'],

    // ── Entertainment ──────────────────────────────────────────────────────
    ['amc ',               'entertainment', 'AMC Theatres'],
    ['regal cinema',       'entertainment', 'Regal Cinemas'],
    ['cinemark',           'entertainment', 'Cinemark'],
    ['movie',              'entertainment', 'Movie'],
    ['theater',            'entertainment', 'Theater'],
    ['concert',            'entertainment', 'Concert'],
    ['ticketmaster',       'entertainment', 'Ticketmaster'],
    ['stubhub',            'entertainment', 'StubHub'],
    ['eventbrite',         'entertainment', 'Eventbrite'],
    ['bowling',            'entertainment', 'Bowling'],
    ['arcade',             'entertainment', 'Arcade'],
    ['dave & buster',      'entertainment', 'Dave & Buster\'s'],
    ['topgolf',            'entertainment', 'Topgolf'],
    ['mini golf',          'entertainment', 'Mini Golf'],
    ['escape room',        'entertainment', 'Escape Room'],
    ['museum',             'entertainment', 'Museum'],
    ['zoo ',               'entertainment', 'Zoo'],
    ['aquarium',           'entertainment', 'Aquarium'],
    ['steam ',             'entertainment', 'Steam'],
    ['playstation',        'entertainment', 'PlayStation'],
    ['xbox',               'entertainment', 'Xbox'],
    ['nintendo',           'entertainment', 'Nintendo'],
    ['gamestop',           'entertainment', 'GameStop'],

    // ── Income ─────────────────────────────────────────────────────────────
    ['direct deposit',     'income', 'Direct Deposit'],
    ['payroll',            'income', 'Payroll'],
    ['salary',             'income', 'Salary'],
    ['ach deposit',        'income', 'ACH Deposit'],
    ['zelle from',         'income', 'Zelle'],
    ['venmo from',         'income', 'Venmo'],
    ['cashapp from',       'income', 'Cash App'],
    ['refund',             'income', 'Refund'],
    ['reimbursement',      'income', 'Reimbursement'],
    ['interest earned',    'income', 'Interest'],
    ['dividend',           'income', 'Dividend'],
    ['tax refund',         'income', 'Tax Refund'],
    ['stimulus',           'income', 'Stimulus'],

    // ── Transfer ───────────────────────────────────────────────────────────
    ['transfer to',        'transfer', 'Transfer'],
    ['transfer from',      'transfer', 'Transfer'],
    ['zelle to',           'transfer', 'Zelle Transfer'],
    ['venmo to',           'transfer', 'Venmo Transfer'],
    ['cashapp to',         'transfer', 'Cash App Transfer'],
    ['payment thank',      'transfer', 'Payment'],
    ['autopay',            'transfer', 'Autopay'],
    ['online payment',     'transfer', 'Online Payment'],
    ['online ach',         'transfer', 'Online Payment'],
    ['ach payment',        'transfer', 'ACH Payment'],
    ['ach credit',         'transfer', 'ACH Transfer'],
    ['mobile payment',     'transfer', 'Mobile Payment'],
    ['bill payment',       'transfer', 'Bill Payment'],
    ['credit card payment','transfer', 'Credit Card Payment'],
    ['directpay',          'transfer', 'Direct Pay'],
    ['direct pay',         'transfer', 'Direct Pay'],
    ['biltprotect',        'transfer', 'Bilt Protect'],
  ];

  // ─── Core DB Helper ─────────────────────────────────────────────────────────

  /**
   * Opens (or returns the cached) IDBDatabase connection.
   * Handles the onupgradeneeded event to create stores and seed defaults.
   * @returns {Promise<IDBDatabase>}
   */
  function openDB() {
    return new Promise(function (resolve, reject) {
      // Return cached connection if available
      if (_db) {
        resolve(_db);
        return;
      }

      // Safari Private mode silently hangs IndexedDB — reject after 8 s
      var timeoutId = setTimeout(function () {
        reject(new Error(
          'IndexedDB timed out. ' +
          'If you are in Private/Incognito mode, please switch to a regular tab. ' +
          'IndexedDB is not available in private browsing.'
        ));
      }, 8000);

      const request = indexedDB.open(DB_NAME, DB_VERSION);

      // ── Schema creation / migration ──────────────────────────────────────
      request.onupgradeneeded = function (event) {
        const db = event.target.result;
        console.log('[FinanceDB] Running onupgradeneeded (version ' + event.oldVersion + ' → ' + event.newVersion + ')');

        // ── transactions store ─────────────────────────────────────────────
        if (!db.objectStoreNames.contains('transactions')) {
          const txnStore = db.createObjectStore('transactions', { keyPath: 'id', autoIncrement: true });
          txnStore.createIndex('by_date',     'date',       { unique: false });
          txnStore.createIndex('by_month',    'monthKey',   { unique: false });
          txnStore.createIndex('by_category', 'categoryId', { unique: false });
          txnStore.createIndex('by_account',  'accountId',  { unique: false });
        }

        // ── categories store ───────────────────────────────────────────────
        if (!db.objectStoreNames.contains('categories')) {
          const catStore = db.createObjectStore('categories', { keyPath: 'id' });
          catStore.createIndex('by_name', 'name', { unique: false });
        }

        // ── accounts store ─────────────────────────────────────────────────
        if (!db.objectStoreNames.contains('accounts')) {
          db.createObjectStore('accounts', { keyPath: 'id' });
        }

        // ── merchant_rules store ───────────────────────────────────────────
        if (!db.objectStoreNames.contains('merchant_rules')) {
          const rulesStore = db.createObjectStore('merchant_rules', { keyPath: 'id', autoIncrement: true });
          rulesStore.createIndex('by_pattern', 'pattern', { unique: true });
        }

        // ── monthly_summaries store ────────────────────────────────────────
        if (!db.objectStoreNames.contains('monthly_summaries')) {
          db.createObjectStore('monthly_summaries', { keyPath: 'monthKey' });
        }

        // ── meta store (tracks whether seeding has been done) ──────────────
        if (!db.objectStoreNames.contains('meta')) {
          db.createObjectStore('meta', { keyPath: 'key' });
        }

        // ── credit_scores store ────────────────────────────────────────────
        // Stores FICO credit score snapshots keyed by monthKey (YYYY-MM)
        if (!db.objectStoreNames.contains('credit_scores')) {
          db.createObjectStore('credit_scores', { keyPath: 'monthKey' });
        }

        // Seed defaults ONLY on fresh install (oldVersion === 0)
        // On upgrades (v1→v2, v2→v3, etc.) the data already exists
        if (event.oldVersion === 0) {
          _seedDefaults(event.target.transaction);
        }
      };

      request.onsuccess = function (event) {
        clearTimeout(timeoutId);
        _db = event.target.result;

        // Handle unexpected version changes / connection issues
        _db.onversionchange = function () {
          _db.close();
          _db = null;
          console.warn('[FinanceDB] Database version changed — connection closed. Please reload.');
        };

        resolve(_db);
      };

      request.onerror = function (event) {
        clearTimeout(timeoutId);
        console.error('[FinanceDB] Failed to open database:', event.target.error);
        reject(event.target.error);
      };

      request.onblocked = function () {
        clearTimeout(timeoutId);
        console.warn('[FinanceDB] Database open blocked — another tab may have an older version open.');
        reject(new Error('IndexedDB open was blocked by another tab. Please close other tabs running this app and reload.'));
      };
    });
  }

  // ─── Seeding ────────────────────────────────────────────────────────────────

  /**
   * Seeds default categories, accounts, and merchant rules into the DB.
   * Called from within the onupgradeneeded transaction so it runs atomically.
   * @param {IDBTransaction} transaction - The upgrade transaction
   */
  function _seedDefaults(transaction) {
    const catStore   = transaction.objectStore('categories');
    const accStore   = transaction.objectStore('accounts');
    const rulesStore = transaction.objectStore('merchant_rules');
    const metaStore  = transaction.objectStore('meta');

    // Seed categories
    DEFAULT_CATEGORIES.forEach(function (cat) {
      catStore.put(cat);
    });

    // Seed accounts
    DEFAULT_ACCOUNTS.forEach(function (acc) {
      accStore.put(acc);
    });

    // Seed merchant rules
    DEFAULT_MERCHANT_RULES.forEach(function (entry) {
      rulesStore.add({
        pattern:       entry[0],
        categoryId:    entry[1],
        merchantName:  entry[2],
        isUserDefined: false,
        matchCount:    0,
      });
    });

    // Mark as seeded
    metaStore.put({ key: 'seeded', value: true, seededAt: new Date().toISOString() });

    console.log(
      '[FinanceDB] Seeded ' + DEFAULT_CATEGORIES.length + ' categories, ' +
      DEFAULT_ACCOUNTS.length + ' accounts, ' +
      DEFAULT_MERCHANT_RULES.length + ' merchant rules'
    );
  }

  // ─── Generic Store Helpers ──────────────────────────────────────────────────

  /**
   * Wraps an IDBRequest in a Promise.
   * @param {IDBRequest} request
   * @returns {Promise<any>}
   */
  function _promisify(request) {
    return new Promise(function (resolve, reject) {
      request.onsuccess = function () { resolve(request.result); };
      request.onerror   = function () { reject(request.error);  };
    });
  }

  /**
   * Returns all records from a given object store.
   * @param {string} storeName
   * @returns {Promise<any[]>}
   */
  async function _getAll(storeName) {
    const db    = await openDB();
    const tx    = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    return _promisify(store.getAll());
  }

  /**
   * Gets a single record by key from a store.
   * @param {string} storeName
   * @param {any} key
   * @returns {Promise<any>}
   */
  async function _getOne(storeName, key) {
    const db    = await openDB();
    const tx    = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    return _promisify(store.get(key));
  }

  /**
   * Puts (upserts) a record into a store.
   * @param {string} storeName
   * @param {object} record
   * @returns {Promise<any>} The key of the stored record
   */
  async function _put(storeName, record) {
    const db    = await openDB();
    const tx    = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    return _promisify(store.put(record));
  }

  /**
   * Deletes a record by key from a store.
   * @param {string} storeName
   * @param {any} key
   * @returns {Promise<void>}
   */
  async function _delete(storeName, key) {
    const db    = await openDB();
    const tx    = db.transaction(storeName, 'readwrite');
    const store = tx.objectStore(storeName);
    return _promisify(store.delete(key));
  }

  /**
   * Gets all records from a store matching an index value.
   * @param {string} storeName
   * @param {string} indexName
   * @param {any} value
   * @returns {Promise<any[]>}
   */
  async function _getByIndex(storeName, indexName, value) {
    const db    = await openDB();
    const tx    = db.transaction(storeName, 'readonly');
    const store = tx.objectStore(storeName);
    const index = store.index(indexName);
    return _promisify(index.getAll(value));
  }

  // ─── Merchant Rule Cache ─────────────────────────────────────────────────────

  /**
   * Loads all merchant rules from IndexedDB into the in-memory cache.
   * User-defined rules are sorted first so they take priority.
   * @returns {Promise<void>}
   */
  async function _refreshRulesCache() {
    try {
      const rules = await _getAll('merchant_rules');
      // Sort: user-defined first, then by id (insertion order)
      rules.sort(function (a, b) {
        if (a.isUserDefined && !b.isUserDefined) return -1;
        if (!a.isUserDefined && b.isUserDefined) return 1;
        return (a.id || 0) - (b.id || 0);
      });
      _rulesCache = rules;
    } catch (err) {
      console.error('[FinanceDB] Failed to refresh rules cache:', err);
    }
  }

  // ─── Runtime Migrations ─────────────────────────────────────────────────────

  /**
   * Adds any missing default categories to an existing DB.
   * Safe to call on every init — uses put() which is idempotent.
   */
  async function _migrateCategories() {
    try {
      const db = await openDB();
      const tx = db.transaction('categories', 'readwrite');
      const store = tx.objectStore('categories');
      // For each default category, add it if it doesn't exist yet
      DEFAULT_CATEGORIES.forEach(function (cat) {
        const req = store.get(cat.id);
        req.onsuccess = function () {
          if (!req.result) {
            store.put(cat);
            console.log('[FinanceDB] Migration: added category', cat.id);
          }
        };
      });
      await new Promise(function (resolve, reject) {
        tx.oncomplete = resolve;
        tx.onerror = reject;
      });
    } catch (err) {
      console.warn('[FinanceDB] _migrateCategories failed (non-fatal):', err);
    }
  }

  // ─── Public API ─────────────────────────────────────────────────────────────

  const FinanceDB = {

    // ── Initialization ────────────────────────────────────────────────────────

    /**
     * Opens the database, runs migrations if needed, and primes the rules cache.
     * Must be called once at app startup before any other FinanceDB methods.
     * @returns {Promise<void>}
     */
    init: async function () {
      try {
        await openDB();
        await _refreshRulesCache();
        // Runtime migration: add any missing default categories (e.g. Gas added in v2)
        await _migrateCategories();
        console.log('[FinanceDB] Database initialized ✅');
      } catch (err) {
        console.error('[FinanceDB] Initialization failed:', err);
        throw err;
      }
    },

    // ── Transactions ──────────────────────────────────────────────────────────

    /**
     * Adds a single transaction record.
     * @param {object} txn - Transaction object (without id)
     * @returns {Promise<number>} The auto-generated id
     */
    addTransaction: async function (txn) {
      try {
        const db    = await openDB();
        const tx    = db.transaction('transactions', 'readwrite');
        const store = tx.objectStore('transactions');
        const id    = await _promisify(store.add(txn));
        return id;
      } catch (err) {
        console.error('[FinanceDB] addTransaction failed:', err);
        throw err;
      }
    },

    /**
     * Bulk-inserts an array of transactions.
     * After insert, recomputes monthly summaries for all affected months.
     * @param {object[]} txns
     * @returns {Promise<number[]>} Array of new ids
     */
    addTransactions: async function (txns) {
      try {
        const db    = await openDB();
        const tx    = db.transaction('transactions', 'readwrite');
        const store = tx.objectStore('transactions');

        const ids = await Promise.all(
          txns.map(function (txn) { return _promisify(store.add(txn)); })
        );

        // Collect unique monthKeys affected by this batch
        const affectedMonths = [...new Set(txns.map(function (t) { return t.monthKey; }).filter(Boolean))];

        // Recompute summaries for each affected month (fire sequentially)
        for (const monthKey of affectedMonths) {
          await FinanceDB.recomputeMonthlySummary(monthKey);
        }

        return ids;
      } catch (err) {
        console.error('[FinanceDB] addTransactions failed:', err);
        throw err;
      }
    },

    /**
     * Retrieves a single transaction by id.
     * @param {number} id
     * @returns {Promise<object>}
     */
    getTransaction: async function (id) {
      try {
        return await _getOne('transactions', id);
      } catch (err) {
        console.error('[FinanceDB] getTransaction failed:', err);
        throw err;
      }
    },

    /**
     * Updates specific fields on an existing transaction.
     * @param {number} id
     * @param {object} changes - Partial object with fields to update
     * @returns {Promise<void>}
     */
    updateTransaction: async function (id, changes) {
      try {
        const existing = await _getOne('transactions', id);
        if (!existing) throw new Error('Transaction ' + id + ' not found');
        const updated = Object.assign({}, existing, changes, { id: id });
        await _put('transactions', updated);

        // Recompute summary for the affected month
        if (updated.monthKey) {
          await FinanceDB.recomputeMonthlySummary(updated.monthKey);
        }
      } catch (err) {
        console.error('[FinanceDB] updateTransaction failed:', err);
        throw err;
      }
    },

    /**
     * Updates the categoryId (and optionally merchantName) on ALL transactions
     * whose merchantName matches the given name (case-insensitive).
     * Returns the count of updated transactions.
     * @param {string} merchantName
     * @param {string} categoryId
     * @returns {Promise<number>} count of updated transactions
     */
    /**
     * Updates all transactions matching originalMerchantName with a new category
     * and optionally a new merchant display name.
     *
     * @param {string} originalMerchantName  The current merchantName to match against
     * @param {string} categoryId            New category to apply
     * @param {string} [newMerchantName]     Optional new display name to apply
     * @returns {Promise<number>}            Number of transactions updated
     */
    updateTransactionsByMerchant: async function (originalMerchantName, categoryId, newMerchantName) {
      try {
        const all = await FinanceDB.getAllTransactions();
        const lower = originalMerchantName.toLowerCase().trim();
        const toUpdate = all.filter(function (t) {
          return (t.merchantName || '').toLowerCase().trim() === lower ||
                 (t.description  || '').toLowerCase().trim() === lower;
        });

        if (toUpdate.length === 0) return 0;

        // Build the changes object — always update category, optionally update name
        const changes = { categoryId: categoryId, isManuallyEdited: true };
        if (newMerchantName && newMerchantName.trim()) {
          changes.merchantName = newMerchantName.trim();
        }

        // Update each matching transaction
        for (const txn of toUpdate) {
          const updated = Object.assign({}, txn, changes);
          await _put('transactions', updated);
        }

        // Recompute summaries for all affected months
        const affectedMonths = [...new Set(toUpdate.map(function (t) { return t.monthKey; }).filter(Boolean))];
        for (const mk of affectedMonths) {
          await FinanceDB.recomputeMonthlySummary(mk);
        }

        return toUpdate.length;
      } catch (err) {
        console.error('[FinanceDB] updateTransactionsByMerchant failed:', err);
        throw err;
      }
    },

    /**
     * Saves or updates a user-defined merchant rule.
     * If a rule for this merchant already exists, updates it.
     * Otherwise creates a new rule.
     *
     * Also saves a "brand prefix" rule using the first meaningful word of the
     * merchant name (≥3 chars, not a stop-word) so that variants of the same
     * brand are auto-categorized on future imports.
     * e.g. categorizing "Mod Long" → food also saves "mod" → food, so
     * "Mod Pizza", "Mod Dtla", etc. are auto-categorized next time.
     *
     * @param {string} merchantName  Display name of the merchant
     * @param {string} categoryId    Category to assign
     * @returns {Promise<void>}
     */
    saveMerchantCategoryRule: async function (merchantName, categoryId) {
      try {
        const pattern = merchantName.toLowerCase().trim();
        if (!pattern) return;

        // ── Save exact-name rule ──────────────────────────────────────────
        const existing = _rulesCache.find(function (r) {
          return r.pattern === pattern && r.isUserDefined;
        });

        if (existing) {
          await FinanceDB.updateMerchantRule(existing.id, { categoryId: categoryId });
        } else {
          await FinanceDB.addMerchantRule({
            pattern:       pattern,
            categoryId:    categoryId,
            merchantName:  merchantName,
            isUserDefined: true,
            matchCount:    0,
          });
        }

        // ── Save brand-prefix rule (first meaningful word) ────────────────
        // Extract the first word that is ≥3 chars and not a generic stop-word.
        // This lets "Mod Long", "Mod Pizza", "Mod Dtla" all match "mod".
        const STOP_WORDS = new Set([
          'the', 'and', 'for', 'from', 'with', 'inc', 'llc', 'ltd', 'co',
          'corp', 'store', 'shop', 'market', 'online', 'pay', 'payment',
          'purchase', 'debit', 'credit', 'card', 'pos', 'ach', 'fee',
        ]);

        const words = pattern.split(/\s+/);
        const brandWord = words.find(function (w) {
          return w.length >= 3 && !STOP_WORDS.has(w) && /^[a-z]/.test(w);
        });

        if (brandWord && brandWord !== pattern) {
          // Only save prefix rule if it doesn't already exist as a default rule
          // (to avoid overriding e.g. "amazon" → shopping with a user's one-off)
          const prefixExists = _rulesCache.find(function (r) {
            return r.pattern === brandWord;
          });

          if (!prefixExists) {
            try {
              await FinanceDB.addMerchantRule({
                pattern:       brandWord,
                categoryId:    categoryId,
                merchantName:  merchantName,  // keep original name for display
                isUserDefined: true,
                matchCount:    0,
              });
              console.log('[FinanceDB] Saved brand-prefix rule:', brandWord, '→', categoryId);
            } catch (prefixErr) {
              // Duplicate pattern constraint — already exists, update it instead
              const dupRule = _rulesCache.find(function (r) { return r.pattern === brandWord; });
              if (dupRule) {
                await FinanceDB.updateMerchantRule(dupRule.id, { categoryId: categoryId });
              }
            }
          } else if (prefixExists.categoryId !== categoryId && prefixExists.isUserDefined) {
            // Update existing user-defined prefix rule to new category
            await FinanceDB.updateMerchantRule(prefixExists.id, { categoryId: categoryId });
          }
        }
      } catch (err) {
        console.error('[FinanceDB] saveMerchantCategoryRule failed:', err);
        throw err;
      }
    },

    /**
     * Deletes a transaction by id.
     * @param {number} id
     * @returns {Promise<void>}
     */
    deleteTransaction: async function (id) {
      try {
        // Fetch first so we know which month to recompute
        const existing = await _getOne('transactions', id);
        await _delete('transactions', id);
        if (existing && existing.monthKey) {
          await FinanceDB.recomputeMonthlySummary(existing.monthKey);
        }
      } catch (err) {
        console.error('[FinanceDB] deleteTransaction failed:', err);
        throw err;
      }
    },

    /**
     * Returns all transactions for a given month.
     * @param {string} monthKey - e.g. "2026-02"
     * @returns {Promise<object[]>}
     */
    getTransactionsByMonth: async function (monthKey) {
      try {
        return await _getByIndex('transactions', 'by_month', monthKey);
      } catch (err) {
        console.error('[FinanceDB] getTransactionsByMonth failed:', err);
        throw err;
      }
    },

    /**
     * Returns transactions for a category, optionally filtered by month.
     * @param {string} categoryId
     * @param {string} [monthKey]
     * @returns {Promise<object[]>}
     */
    getTransactionsByCategory: async function (categoryId, monthKey) {
      try {
        const all = await _getByIndex('transactions', 'by_category', categoryId);
        if (monthKey) {
          return all.filter(function (t) { return t.monthKey === monthKey; });
        }
        return all;
      } catch (err) {
        console.error('[FinanceDB] getTransactionsByCategory failed:', err);
        throw err;
      }
    },

    /**
     * Returns transactions for an account, optionally filtered by month.
     * @param {string} accountId
     * @param {string} [monthKey]
     * @returns {Promise<object[]>}
     */
    getTransactionsByAccount: async function (accountId, monthKey) {
      try {
        const all = await _getByIndex('transactions', 'by_account', accountId);
        if (monthKey) {
          return all.filter(function (t) { return t.monthKey === monthKey; });
        }
        return all;
      } catch (err) {
        console.error('[FinanceDB] getTransactionsByAccount failed:', err);
        throw err;
      }
    },

    /**
     * Returns every transaction in the database.
     * @returns {Promise<object[]>}
     */
    getAllTransactions: async function () {
      try {
        return await _getAll('transactions');
      } catch (err) {
        console.error('[FinanceDB] getAllTransactions failed:', err);
        throw err;
      }
    },

    /**
     * Returns a sorted list of monthKeys that have at least one transaction.
     * @returns {Promise<string[]>}
     */
    getMonthsWithData: async function () {
      try {
        const all = await _getAll('transactions');
        const months = [...new Set(all.map(function (t) { return t.monthKey; }).filter(Boolean))];
        months.sort();
        return months;
      } catch (err) {
        console.error('[FinanceDB] getMonthsWithData failed:', err);
        throw err;
      }
    },

    // ── Categories ────────────────────────────────────────────────────────────

    /**
     * Returns all non-hidden categories, sorted by sortOrder.
     * @returns {Promise<object[]>}
     */
    getCategories: async function () {
      try {
        const all = await _getAll('categories');
        return all
          .filter(function (c) { return !c.isHidden; })
          .sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
      } catch (err) {
        console.error('[FinanceDB] getCategories failed:', err);
        throw err;
      }
    },

    /**
     * Returns all categories including hidden ones.
     * @returns {Promise<object[]>}
     */
    getAllCategories: async function () {
      try {
        const all = await _getAll('categories');
        return all.sort(function (a, b) { return (a.sortOrder || 0) - (b.sortOrder || 0); });
      } catch (err) {
        console.error('[FinanceDB] getAllCategories failed:', err);
        throw err;
      }
    },

    /**
     * Adds a new category.
     * @param {object} cat - Category object with string id
     * @returns {Promise<void>}
     */
    addCategory: async function (cat) {
      try {
        await _put('categories', cat);
      } catch (err) {
        console.error('[FinanceDB] addCategory failed:', err);
        throw err;
      }
    },

    /**
     * Updates specific fields on an existing category.
     * @param {string} id
     * @param {object} changes
     * @returns {Promise<void>}
     */
    updateCategory: async function (id, changes) {
      try {
        const existing = await _getOne('categories', id);
        if (!existing) throw new Error('Category ' + id + ' not found');
        await _put('categories', Object.assign({}, existing, changes, { id: id }));
      } catch (err) {
        console.error('[FinanceDB] updateCategory failed:', err);
        throw err;
      }
    },

    /**
     * Deletes a category and reassigns all its transactions to 'other'.
     * @param {string} id
     * @returns {Promise<void>}
     */
    deleteCategory: async function (id) {
      try {
        // Reassign transactions
        const affected = await _getByIndex('transactions', 'by_category', id);
        for (const txn of affected) {
          await _put('transactions', Object.assign({}, txn, { categoryId: 'other' }));
        }
        await _delete('categories', id);
      } catch (err) {
        console.error('[FinanceDB] deleteCategory failed:', err);
        throw err;
      }
    },

    // ── Accounts ──────────────────────────────────────────────────────────────

    /**
     * Returns all accounts.
     * @returns {Promise<object[]>}
     */
    getAccounts: async function () {
      try {
        return await _getAll('accounts');
      } catch (err) {
        console.error('[FinanceDB] getAccounts failed:', err);
        throw err;
      }
    },

    /**
     * Updates specific fields on an existing account.
     * @param {string} id
     * @param {object} changes
     * @returns {Promise<void>}
     */
    updateAccount: async function (id, changes) {
      try {
        const existing = await _getOne('accounts', id);
        if (!existing) throw new Error('Account ' + id + ' not found');
        await _put('accounts', Object.assign({}, existing, changes, { id: id }));
      } catch (err) {
        console.error('[FinanceDB] updateAccount failed:', err);
        throw err;
      }
    },

    /**
     * Saves an account's latest balance from a parsed statement.
     * Stores balance, statement date, and last updated timestamp on the account record.
     * @param {string} accountId
     * @param {number} balance
     * @param {string} statementMonth  e.g. '2026-02'
     * @returns {Promise<void>}
     */
    saveAccountBalance: async function (accountId, balance, statementMonth) {
      try {
        const existing = await _getOne('accounts', accountId);
        if (!existing) {
          console.warn('[FinanceDB] saveAccountBalance: account not found:', accountId);
          return;
        }
        await _put('accounts', Object.assign({}, existing, {
          id: accountId,
          currentBalance: balance,
          balanceAsOf: statementMonth,
          balanceUpdatedAt: new Date().toISOString(),
        }));
        console.log('[FinanceDB] Saved balance for', accountId, ':', balance, 'as of', statementMonth);
      } catch (err) {
        console.error('[FinanceDB] saveAccountBalance failed:', err);
        // Non-fatal — don't throw
      }
    },

    /**
     * Saves a credit score snapshot for a given month.
     * @param {string} monthKey  e.g. "2024-03"
     * @param {number} score     FICO score (300-850)
     * @param {string} [source]  e.g. "discover"
     * @returns {Promise<void>}
     */
    saveCreditScore: async function (monthKey, score, source) {
      try {
        const db    = await openDB();
        const tx    = db.transaction('credit_scores', 'readwrite');
        const store = tx.objectStore('credit_scores');
        await _promisify(store.put({
          monthKey:  monthKey,
          score:     score,
          source:    source || 'unknown',
          savedAt:   new Date().toISOString(),
        }));
        console.log('[FinanceDB] Saved credit score', score, 'for', monthKey);
      } catch (err) {
        console.error('[FinanceDB] saveCreditScore failed:', err);
        // Non-fatal
      }
    },

    /**
     * Returns all credit score snapshots sorted ascending by monthKey.
     * @returns {Promise<object[]>}
     */
    getCreditScores: async function () {
      try {
        const all = await _getAll('credit_scores');
        return (all || []).sort(function (a, b) {
          return (a.monthKey || '').localeCompare(b.monthKey || '');
        });
      } catch (err) {
        console.error('[FinanceDB] getCreditScores failed:', err);
        return [];
      }
    },

    /**
     * Returns all accounts with their current balances.
     * Accounts without a balance will have currentBalance: null.
     * @returns {Promise<object[]>}
     */
    getAccountBalances: async function () {
      try {
        const accounts = await _getAll('accounts');
        return accounts.filter(function (a) { return a.isActive !== false; });
      } catch (err) {
        console.error('[FinanceDB] getAccountBalances failed:', err);
        return [];
      }
    },

    // ── Merchant Rules ────────────────────────────────────────────────────────

    /**
     * Returns all merchant rules.
     * @returns {Promise<object[]>}
     */
    getMerchantRules: async function () {
      try {
        return await _getAll('merchant_rules');
      } catch (err) {
        console.error('[FinanceDB] getMerchantRules failed:', err);
        throw err;
      }
    },

    /**
     * Adds a new merchant rule and refreshes the in-memory cache.
     * @param {object} rule - Rule object (without id)
     * @returns {Promise<void>}
     */
    addMerchantRule: async function (rule) {
      try {
        const db    = await openDB();
        const tx    = db.transaction('merchant_rules', 'readwrite');
        const store = tx.objectStore('merchant_rules');
        await _promisify(store.add(rule));
        await _refreshRulesCache();
      } catch (err) {
        console.error('[FinanceDB] addMerchantRule failed:', err);
        throw err;
      }
    },

    /**
     * Updates a merchant rule and refreshes the in-memory cache.
     * @param {number} id
     * @param {object} changes
     * @returns {Promise<void>}
     */
    updateMerchantRule: async function (id, changes) {
      try {
        const existing = await _getOne('merchant_rules', id);
        if (!existing) throw new Error('Merchant rule ' + id + ' not found');
        await _put('merchant_rules', Object.assign({}, existing, changes, { id: id }));
        await _refreshRulesCache();
      } catch (err) {
        console.error('[FinanceDB] updateMerchantRule failed:', err);
        throw err;
      }
    },

    /**
     * Synchronously categorizes a transaction description using the in-memory
     * rules cache. User-defined rules are checked first.
     *
     * Strips common payment-network prefixes (SQ *, TST*, PP*, etc.) and
     * trailing city/state/store-number noise before matching, so that semantic
     * keyword rules (e.g. 'thai ', 'ramen', 'pizza') work correctly even on
     * raw bank descriptions like "SQ *8E8 THAI STREET FO LOS ANGELES CA".
     *
     * @param {string} description - Raw merchant description from bank statement
     * @returns {string} categoryId — defaults to 'other' if no rule matches
     */
    categorizeTransaction: function (description) {
      if (!description) return 'other';

      // Normalize: lowercase, strip payment-network prefixes only.
      // We do NOT strip city/state here because the regex can accidentally eat
      // merchant names (e.g. "AMAZON WA" → "" after stripping " amazon wa").
      // Instead we match against BOTH the normalized string (prefix-stripped) AND
      // the original lowercased string, so named-chain rules always work.
      let normalized = description.toLowerCase().trim();

      // Strip payment-network / POS prefixes so semantic keywords work:
      // "SQ *8E8 THAI STREET FO LOS ANGELES CA" → "8e8 thai street fo los angeles ca"
      // → matches 'thai '
      normalized = normalized.replace(
        /^(?:sq\s*\*\s*|tst\*\s*|pp\s*\*\s*|sp\s*\*\s*|apl\s*\*\s*|dd\s*\*\s*|doordash\s*\*\s*|lne\s*\*\s*|wal\s*\*\s*|wm\s+supercenter\s*)/,
        ''
      );

      // Strip bank transaction-type prefixes
      normalized = normalized.replace(
        /^(?:check\s+card\s+purchase|debit\s+card\s+purchase|pos\s+purchase|pos\s+debit|ach\s+debit|ach\s+credit|online\s+transfer|wire\s+transfer|bill\s+payment|recurring\s+payment|preauthorized\s+debit|electronic\s+payment)\s+/,
        ''
      );

      // Strip inline reference IDs (e.g. "*NF99E7P60") so they don't interfere
      normalized = normalized.replace(/\*[a-z0-9]{4,}/gi, '');

      // Match against rules cache using both the normalized and original lowercased description
      const lower = description.toLowerCase();

      for (let i = 0; i < _rulesCache.length; i++) {
        const rule = _rulesCache[i];
        // Check normalized first (catches semantic keywords after prefix stripping),
        // then fall back to original (catches patterns like 'directpay', 'wholefds', etc.)
        if (normalized.indexOf(rule.pattern) !== -1 || lower.indexOf(rule.pattern) !== -1) {
          // Increment matchCount asynchronously (fire-and-forget)
          if (rule.id != null) {
            _put('merchant_rules', Object.assign({}, rule, { matchCount: (rule.matchCount || 0) + 1 }))
              .catch(function (err) {
                console.warn('[FinanceDB] Failed to increment matchCount for rule ' + rule.id + ':', err);
              });
            // Update cache entry immediately to keep it consistent
            _rulesCache[i] = Object.assign({}, rule, { matchCount: (rule.matchCount || 0) + 1 });
          }
          return rule.categoryId;
        }
      }

      return 'other';
    },

    // ── Monthly Summaries ─────────────────────────────────────────────────────

    /**
     * Returns the stored monthly summary for a given month.
     * @param {string} monthKey - e.g. "2026-02"
     * @returns {Promise<object|undefined>}
     */
    getMonthlySummary: async function (monthKey) {
      try {
        return await _getOne('monthly_summaries', monthKey);
      } catch (err) {
        console.error('[FinanceDB] getMonthlySummary failed:', err);
        throw err;
      }
    },

    /**
     * Recomputes the monthly summary from raw transactions and upserts it.
     * Called automatically after addTransactions / updateTransaction / deleteTransaction.
     * @param {string} monthKey
     * @returns {Promise<object>} The newly computed summary
     */
    recomputeMonthlySummary: async function (monthKey) {
      try {
        const txns = await FinanceDB.getTransactionsByMonth(monthKey);

        let totalIncome   = 0;
        let totalExpenses = 0;
        const categoryBreakdown = {};
        const accountBreakdown  = {};

        txns.forEach(function (t) {
          const amt = t.amount || 0;
          const catId = t.categoryId || '';

          // Exclude transfers from income/expense totals.
          // Transfers are credit card payments, account-to-account moves, etc.
          // They are not real income or spending — just money moving between accounts.
          const isTransfer = catId === 'transfer';

          if (!isTransfer) {
            if (amt > 0) {
              totalIncome += amt;
            } else {
              totalExpenses += Math.abs(amt);
            }
          }

          // Category breakdown (absolute amounts) — include transfers for reference
          if (catId) {
            categoryBreakdown[catId] = (categoryBreakdown[catId] || 0) + Math.abs(amt);
          }

          // Account breakdown (absolute amounts)
          if (t.accountId) {
            accountBreakdown[t.accountId] = (accountBreakdown[t.accountId] || 0) + Math.abs(amt);
          }
        });

        const summary = {
          monthKey:           monthKey,
          totalIncome:        Math.round(totalIncome   * 100) / 100,
          totalExpenses:      Math.round(totalExpenses * 100) / 100,
          netSavings:         Math.round((totalIncome - totalExpenses) * 100) / 100,
          transactionCount:   txns.length,
          categoryBreakdown:  categoryBreakdown,
          accountBreakdown:   accountBreakdown,
          lastUpdated:        new Date().toISOString(),
        };

        await _put('monthly_summaries', summary);
        return summary;
      } catch (err) {
        console.error('[FinanceDB] recomputeMonthlySummary failed:', err);
        throw err;
      }
    },

    /**
     * Returns all monthly summaries, sorted by monthKey ascending.
     * @returns {Promise<object[]>}
     */
    getAllMonthlySummaries: async function () {
      try {
        const all = await _getAll('monthly_summaries');
        return all.sort(function (a, b) { return a.monthKey.localeCompare(b.monthKey); });
      } catch (err) {
        console.error('[FinanceDB] getAllMonthlySummaries failed:', err);
        throw err;
      }
    },

    // ── Export / Import / Clear ───────────────────────────────────────────────

    /**
     * Exports all data from every store as a single JSON-serializable object.
     * @returns {Promise<object>}
     */
    exportAllData: async function () {
      try {
        const [transactions, categories, accounts, merchantRules, monthlySummaries] = await Promise.all([
          _getAll('transactions'),
          _getAll('categories'),
          _getAll('accounts'),
          _getAll('merchant_rules'),
          _getAll('monthly_summaries'),
        ]);

        return {
          version:          1,
          exportedAt:       new Date().toISOString(),
          transactions:     transactions,
          categories:       categories,
          accounts:         accounts,
          merchantRules:    merchantRules,
          monthlySummaries: monthlySummaries,
        };
      } catch (err) {
        console.error('[FinanceDB] exportAllData failed:', err);
        throw err;
      }
    },

    /**
     * Restores data from a JSON backup.
     * Clears transactions, summaries, and merchant rules, then bulk-inserts
     * from the provided JSON. Categories and accounts are only overwritten
     * if they are present in the JSON.
     * @param {object} json - Object produced by exportAllData()
     * @returns {Promise<void>}
     */
    importData: async function (json) {
      try {
        const db = await openDB();

        // Stores to always clear and re-import
        const clearStores = ['transactions', 'monthly_summaries', 'merchant_rules'];

        // Clear those stores
        await Promise.all(clearStores.map(function (storeName) {
          return new Promise(function (resolve, reject) {
            const tx    = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req   = store.clear();
            req.onsuccess = resolve;
            req.onerror   = function () { reject(req.error); };
          });
        }));

        // Re-import transactions (strip ids so autoIncrement re-assigns them)
        if (json.transactions && json.transactions.length) {
          const tx    = db.transaction('transactions', 'readwrite');
          const store = tx.objectStore('transactions');
          for (const t of json.transactions) {
            const record = Object.assign({}, t);
            delete record.id; // let autoIncrement assign a new id
            store.add(record);
          }
          await new Promise(function (resolve, reject) {
            tx.oncomplete = resolve;
            tx.onerror    = function () { reject(tx.error); };
          });
        }

        // Re-import merchant rules (strip ids)
        if (json.merchantRules && json.merchantRules.length) {
          const tx    = db.transaction('merchant_rules', 'readwrite');
          const store = tx.objectStore('merchant_rules');
          for (const r of json.merchantRules) {
            const record = Object.assign({}, r);
            delete record.id;
            store.add(record);
          }
          await new Promise(function (resolve, reject) {
            tx.oncomplete = resolve;
            tx.onerror    = function () { reject(tx.error); };
          });
        }

        // Re-import monthly summaries
        if (json.monthlySummaries && json.monthlySummaries.length) {
          const tx    = db.transaction('monthly_summaries', 'readwrite');
          const store = tx.objectStore('monthly_summaries');
          for (const s of json.monthlySummaries) {
            store.put(s);
          }
          await new Promise(function (resolve, reject) {
            tx.oncomplete = resolve;
            tx.onerror    = function () { reject(tx.error); };
          });
        }

        // Optionally overwrite categories if included in backup
        if (json.categories && json.categories.length) {
          const tx    = db.transaction('categories', 'readwrite');
          const store = tx.objectStore('categories');
          for (const c of json.categories) {
            store.put(c);
          }
          await new Promise(function (resolve, reject) {
            tx.oncomplete = resolve;
            tx.onerror    = function () { reject(tx.error); };
          });
        }

        // Optionally overwrite accounts if included in backup
        if (json.accounts && json.accounts.length) {
          const tx    = db.transaction('accounts', 'readwrite');
          const store = tx.objectStore('accounts');
          for (const a of json.accounts) {
            store.put(a);
          }
          await new Promise(function (resolve, reject) {
            tx.oncomplete = resolve;
            tx.onerror    = function () { reject(tx.error); };
          });
        }

        // Refresh rules cache after import
        await _refreshRulesCache();

        console.log('[FinanceDB] Import complete ✅');
      } catch (err) {
        console.error('[FinanceDB] importData failed:', err);
        throw err;
      }
    },

    /**
     * Clears all transactions and monthly summaries.
     * Categories and accounts are preserved.
     * @returns {Promise<void>}
     */
    clearAllData: async function () {
      try {
        const db = await openDB();
        const storesToClear = ['transactions', 'monthly_summaries'];

        await Promise.all(storesToClear.map(function (storeName) {
          return new Promise(function (resolve, reject) {
            const tx    = db.transaction(storeName, 'readwrite');
            const store = tx.objectStore(storeName);
            const req   = store.clear();
            req.onsuccess = resolve;
            req.onerror   = function () { reject(req.error); };
          });
        }));

        console.log('[FinanceDB] All transaction data cleared.');
      } catch (err) {
        console.error('[FinanceDB] clearAllData failed:', err);
        throw err;
      }
    },

    // ── Utility ───────────────────────────────────────────────────────────────

    /**
     * Returns storage statistics about the current database state.
     * @returns {Promise<{transactionCount: number, monthCount: number, oldestMonth: string|null, newestMonth: string|null}>}
     */
    getStorageStats: async function () {
      try {
        const txns   = await _getAll('transactions');
        const months = [...new Set(txns.map(function (t) { return t.monthKey; }).filter(Boolean))].sort();

        return {
          transactionCount: txns.length,
          monthCount:       months.length,
          oldestMonth:      months.length ? months[0]                    : null,
          newestMonth:      months.length ? months[months.length - 1]    : null,
        };
      } catch (err) {
        console.error('[FinanceDB] getStorageStats failed:', err);
        throw err;
      }
    },

  }; // end FinanceDB

  // ─── Expose Globally ────────────────────────────────────────────────────────

  global.FinanceDB = FinanceDB;

}(window));
