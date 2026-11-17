// ---- Stashwalk settings (edit freely) ----
window.GEO_CONFIG = {
  APP_NAME: "Stashwalk",
  ADMIN_USER: "TonyIspht",   // shows the admin panel; the Worker's ADMIN_USERS decides who really is admin

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
  GEIGER_FT: 500,          // the locator is offered (and ticks) this far from a chest
  // ---- Hidden chests ----
  // Chests stay off the map until you find them. Undiscovered ones show only as a dashed
  // search circle that contains the chest somewhere inside (never at the centre).
  SEARCH_RADIUS_FT: 300,   // size of a search circle
  SEARCH_SHOW_MI: 1,       // search circles appear for undiscovered chests this close to you (or the drone)
  SEARCH_MAX: 12,          // and at most this many at once
  DISCOVER_FT: 20,         // get this close (on foot, or with the drone) and the chest is found for good
  MAX_TILES: 40,           // most map tiles loaded at once (each is one degree square)
  STARTER_ITEMS: 3,        // items a brand-new player begins with
  MERGE_COUNT: 3,          // identical items needed to merge one rarity upward
  CHEST_SLOTS: 4,          // items a chest starts with
  MAX_CHEST_SLOTS: 8,      // a chest can grow to this many when players leave gifts
  FLAGS_TO_REMOVE: 3,      // reports from different players before a chest is dropped
  TRADE_COOLDOWN_MIN: 60,  // minutes before you can trade at the same chest again
  HIDE_PER_DAY: 10,        // how many chests a player may hide per day
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
    { ft: 300,   cost: 0 },      // level 1 - what you get when you buy it
    { ft: 600,   cost: 300 },
    { ft: 1056,  cost: 450 },    // 0.2 mi
    { ft: 2112,  cost: 650 },    // 0.4 mi
    { ft: 3960,  cost: 900 },    // 0.75 mi
    { ft: 7920,  cost: 1250 },   // 1.5 mi
    { ft: 14520, cost: 1700 },   // 2.75 mi
    { ft: 26400, cost: 2300 }    // level 8 - five miles
  ],
  DRONE_REACH_FT: 50,      // how close the drone has to hover to open a chest
  DRONE_SPEED_MPS: 45,     // slowest top speed (about 100 mph); bigger ranges fly faster...
  DRONE_EDGE_S: 30,        // ...so the edge of its range is about this many seconds away at full stick
  DRONE_LISTEN_FT: 400,    // the locator's hot/cold scale while flying
  DRONE_HIDES_PER_DAY: 2,  // chests the drone can hide in a day (these count toward HIDE_PER_DAY too)
  DRONE_HIDE_NEAR_M: 0,    // 0 = the drone can hide a chest anywhere; set metres to require a nearby park or public place

  // ---- Road coins ----
  // Coins scattered along real streets and trails (OpenStreetMap data via OpenFreeMap - free,
  // no key). Never on highways or main roads, private driveways or in tunnels.
  ROAD_COINS: {
    on: true,
    tiles: "https://tiles.openfreemap.org/planet",
    pathEvery: 90,         // metres between coin chances on footpaths, trails and tracks
    roadEvery: 180,        // ...and on quiet streets
    chance: 0.55,          // how often a chance becomes a coin
    spacingM: 80,          // never two coins closer than about this (keeps busy downtowns sane)
    value: [2, 3],         // a normal coin is worth 2 or 3...
    pathBonus: 1,          // ...plus this on trails and footpaths
    stackChance: 0.04,     // now and then a gold stack instead
    stackValue: 25,
    magnetFt: 80,          // they fly to you inside this distance
    droneMagnetFt: 100,    // and to the drone inside this
    dronePerDay: 60        // most the drone can pick up in a day (0 = no limit). Walking has no limit.
  },

  // Extra chests generated along the real road & path network near the player, so there is
  // always something to find even where there are no parks. Deterministic: every player sees
  // the same ones, no server needed. Uses the same map tiles as the road coins.
  WILD_CHESTS: {
    on: true,
    roadEvery: 230,        // metres between chest chances on quiet streets
    pathEvery: 150,        // ...and on trails and footpaths (denser - nicer to walk)
    chance: 0.55,          // how often a chance becomes a chest
    gapM: 170,             // never two wild chests closer than about this (medium density)
    maxPerTile: 80         // safety cap per map tile
  }
};
