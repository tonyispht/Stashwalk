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
  LANDMARK_UNLOCK_FT: 300, // landmark chests (locations.js) use approximate coordinates, so they open from a wider ring
  MAX_OSM_CHESTS: 150,     // cap on auto-found park/campground chests
  CHEST_SLOTS: 4,          // items inside each chest
  HIDE_PER_DAY: 2,         // how many chests a player may hide per day
  MIN_CHEST_GAP_M: 20      // new hidden chests must be this far from any other chest
};
