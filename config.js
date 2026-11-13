// ---- Stashwalk settings (edit freely) ----
window.GEO_CONFIG = {
  APP_NAME: "Stashwalk",

  // "" = LOCAL mode: everything is saved in the browser on that device, no server of any kind.
  // Paste a Firebase Realtime Database URL to turn on SHARED mode, so every player sees the same
  // chests and swaps (still no server of yours to run). See README.md, step 2.
  DB_URL: "",

  UNLOCK_FT: 5,            // how close (feet) you must be to a chest to open it
  SEARCH_RADIUS_M: 1200,   // how far around you to look for chest locations
  MAX_OSM_CHESTS: 80,      // cap on auto-generated chests shown at once
  CHEST_SLOTS: 4,          // items inside each chest
  HIDE_PER_DAY: 2,         // how many chests a player may hide per day
  MIN_CHEST_GAP_M: 20      // new hidden chests must be this far from any other chest
};
