// ---- Stashwalk settings (edit freely) ----
window.GEO_CONFIG = {
  APP_NAME: "Stashwalk",

  // "" = LOCAL mode: everything is saved in the browser on that device, no server of any kind.
  // Paste a Firebase Realtime Database URL to turn on SHARED mode, so every player sees the same
  // chests and swaps (still no server of yours to run). See README.md, step 2.
  DB_URL: "",

  // Preferred shared mode: your Cloudflare Worker URL (see README.md, "Shared world with Cloudflare").
  // e.g. "https://stashwalk.YOURNAME.workers.dev"   (when set, DB_URL above is ignored)
  WORKER_URL: "https://stashwalk.tonyispht.workers.dev",

  UNLOCK_FT: 20,           // how close (feet) you must be to a chest to open it
  DEFAULT_RADIUS_MI: 25,   // starting value of the "show chests within" slider (1-250 mi)
  MAX_PLACES: 150,         // most built-in chest locations shown at once
  COARSE_FT: 400,          // worse than this and the device is not giving real GPS
  GEIGER_FT: 250,          // proximity ticking starts this far from a chest
  MAX_TILES: 40,           // most map tiles loaded at once (each is one degree square)
  STARTER_ITEMS: 3,        // items a brand-new player begins with
  MERGE_COUNT: 3,          // identical items needed to merge one rarity upward
  CHEST_SLOTS: 4,          // items a chest starts with
  MAX_CHEST_SLOTS: 8,      // a chest can grow to this many when players leave gifts
  FLAGS_TO_REMOVE: 3,      // reports from different players before a chest is dropped
  HIDE_PER_DAY: 2,         // how many chests a player may hide per day
  MIN_CHEST_GAP_M: 20,     // new hidden chests must be this far from any other chest

  // ---- Trail Coins ----
  // What each thing earns. Walking pays out every tenth of a mile (mile / 10).
  COINS: {
    start: 50,             // a brand-new player's opening balance
    mile: 100,             // per mile walked with the game open
    daily: 20,             // daily reward, plus `dailyStreak` per streak day (up to 6 extra)...
    dailyStreak: 5,
    dailyBig: 75,          // ...and this on days 7, 14, 21 and 28
    chestNew: 15,          // opening a chest you have never opened before
    trade: 10,
    gift: 5,               // leaving an item without taking one
    hide: 10,
    newItem: 3,            // anything new for your shelf
    merge: 5,
    craft: 25,
    achievement: 50,
    referral: 200          // per invited friend who opens their first chest
  },
  PRICES: [40, 110, 280, 700, 1800],  // shop price by rarity: Common ... Legendary
  MAX_WALK_MPS: 6.5,       // faster than this (about 14.5 mph) counts as a vehicle, not walking

  // ---- Drone ----
  DRONE_PRICE: 500,
  // range (feet from you) at each level, and the coins to reach that level from the one before
  DRONE_LEVELS: [
    { ft: 300,  cost: 0 },       // level 1 - what you get when you buy it
    { ft: 500,  cost: 300 },
    { ft: 800,  cost: 450 },
    { ft: 1200, cost: 650 },
    { ft: 1800, cost: 900 },
    { ft: 2600, cost: 1250 },
    { ft: 3800, cost: 1700 },
    { ft: 5280, cost: 2300 }     // level 8 - one mile
  ],
  DRONE_REACH_FT: 50,      // how close the drone has to hover to open a chest
  DRONE_SPEED_MPS: 22,     // top speed (about 50 mph)
  DRONE_LISTEN_FT: 400     // the locator's hot/cold scale while flying
};
