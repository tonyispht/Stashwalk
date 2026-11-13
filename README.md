# Stashwalk – digital geocaching

Plain static files. Upload the folder to any static host (GitHub Pages, Netlify Drop, Cloudflare Pages). No server to run.
GPS needs HTTPS (those hosts all provide it; `localhost` also works for testing).

## Files
index.html, style.css, app.js (game), fx.js (sound/visual effects/fullscreen), worker/ (optional shared-world backend), items.js (550 items), places/ (263,565 chest locations as map tiles), tools/ (dataset builders), db.js (storage), config.js (settings)

## 1. Local mode (default, zero setup)
Everything saves in the player's browser. Works instantly, but chests/trades are only shared between accounts on the same device.
Players can Export/Import a save file (Me tab) to move devices.

## 2. Shared world with Cloudflare (all players see the same chests)
A pure file host can't be written to by visitors, so shared chests need one small always-on service.
`worker/worker.js` is that service: a free Cloudflare Worker backed by a free D1 (SQLite) database.
You don't run or maintain a server - Cloudflare does. Free plan is far more than this game needs.

Setup, all in the Cloudflare dashboard (dash.cloudflare.com), ~5 minutes:
1. **Make the database.** Left menu -> **Storage & Databases** -> **D1 SQL database** -> **Create**.
   Name it `stashwalk-db` -> **Create**. (The game creates its own table on first use - no SQL to run.)
2. **Make the Worker.** Left menu -> **Compute (Workers)** / **Workers & Pages** -> **Create** ->
   **Start with Hello World!** -> **Get started**. Name it `stashwalk` -> **Deploy**.
3. **Paste the code.** On the Worker -> **Edit code** (or **</> Edit code**). Select everything in the
   editor, delete it, paste the whole contents of `worker/worker.js` -> **Deploy**.
4. **Connect the database.** Worker -> **Bindings** tab -> **Add binding** -> **D1 database**.
   Variable name must be exactly `DB`. Pick `stashwalk-db`. -> **Add binding** / **Deploy**.
5. **Lock it to your site.** Same **Bindings**/**Variables** area -> add a **Text/Environment variable**
   named `ALLOWED_ORIGINS` with value `https://tonyispht.github.io` (your GitHub Pages origin, no
   trailing slash; comma-separate more). Deploy. Leaving it blank allows any site to use your Worker.
6. **Point the game at it.** Copy the Worker URL (like `https://stashwalk.YOURNAME.workers.dev`) and
   paste it into `WORKER_URL` in `config.js`. Commit/push. Done - every player now shares one world.

Check it: opening the Worker URL in a browser should show `{"ok":true,"app":"stashwalk"}`.
(Deploying with the CLI instead? `worker/wrangler.toml` is there; fill in your D1 `database_id`.)

What the Worker enforces: names can be registered once and never overwritten, password hashes are
never sent back to browsers, only a logged-in player may write, a player may only write their own
record, chest contents are validated, and swaps use version checks so two people trading at the same
chest can't overwrite each other. Passwords are PBKDF2-hashed in the browser before they are sent.
It is a casual game, not a hardened one - a determined player could still spoof GPS. Don't reuse real passwords.

### Alternative: Firebase
Instead of the Worker you can paste a Firebase Realtime Database URL into `DB_URL` in config.js
(`WORKER_URL` wins if both are set). Suggested rules:
{"rules":{".read":true,".write":true,"users":{"$u":{".write":"!data.exists()"}}}}
The Worker is the better option: Firebase in this mode is wide open to anyone with the URL.

## Locations
- `places/`: 263,565 real US locations, split into 1,896 map tiles of one degree each
  (`places/<lat>_<lon>.json`, plus `index.json` listing which exist). The game downloads only the
  tiles around the player - typically 1-5 files, a few KB each - and keeps them for the session.
- 187,701 parks, 50,409 nature reserves and protected areas, 17,053 campgrounds, 7,249 playgrounds,
  plus picnic sites, summits, viewpoints, trail shelters and visitor centers.
- Sources, both free and openly licensed:
  - Overture Maps (base theme, land_use) - ODbL, derived largely from OpenStreetMap.
  - Recreation Information Database (RIDB) full export - U.S. Government work, public domain.
- Excluded deliberately: cemeteries, schools, hospitals, prisons, churches, golf courses, military
  land, airports, quarries, landfills and private/residential land - by type code and again by name.
- NO internet service is queried to find chests. Tiles are static files served with the game.
- Players can hide their own chests (2/day); those live in your database.
- Rebuilding: `tools/overture_extract.py` pulls from Overture's public S3 bucket (needs duckdb),
  `tools/build_places.py` parses the RIDB export, `tools/build_tiles.py` merges, de-duplicates and
  writes the tiles.
- Opening a chest needs you within UNLOCK_FT (20 ft) in config.js. Phone GPS is often only accurate
  to ~10-30 ft, so raise it if players can't unlock.

## Test without walking
Open `index.html?dev=1` – tap the map to teleport, or use "Teleport to nearest chest".

## Starting out
A new player is given STARTER_ITEMS (3) random items so they can trade at the first chest they
reach, shown on a welcome card. Joining through an invite link adds a fourth. An account that
already exists but has never collected, traded or claimed anything gets the same kit on its next
sign-in, so nobody who registered earlier is left with an empty pack.

## Workshop: merging and crafting
A sixth tab, unlocked in stages. Your Workshop level is how many of these achievements you hold,
in any order, and it is also the highest rarity you can merge up to:
  1 Apprentice  - first trade          (merge up to Uncommon)
  2 Tinker      - open 5 chests        (up to Rare)
  3 Artisan     - collect 50 items     (up to Epic)
  4 Master      - 50 trades            (up to Legendary)
  5 Grandmaster - collect 100 items
**Merging**: MERGE_COUNT (3) copies of one item become a single copy one rarity higher.
**Relics**: 20 craft-only items in 5 tiers (`relics.js`), each from 3-4 named ingredients at a
minimum rarity. Relics never drop from chests - they join ITEMS and ITEM_BY_ID so they appear on
the Shelf as silhouettes to work toward, but deliberately NOT ITEMS_BY_R, which is what chests roll
from. They can still be traded, so a player can obtain one without crafting it.
Edit the recipes in `tools/build_relics.py` (ingredients are written by name, not index) and re-run
it to regenerate relics.js.

## Inviting friends
Share the link or QR code from the Me tab. The invited player starts with an extra item. You get a
Rare once they actually open their first chest, an Epic at 5 friends and a Legendary at 10, plus
the Recruiter and Party Leader titles. Rewards arrive on the Me tab (or within a minute of play);
"Check" forces a refresh.
A referral only counts after the invited player opens a chest, so fake sign-ups earn nothing, and
the tally lives server-side - the /kv/invites path refuses writes so no client can inflate it.

## Finding and opening a chest
Walk toward it. Within GEIGER_FT (250 ft) the game starts ticking like a Geiger counter, faster and
brighter the closer you get. Inside UNLOCK_FT (20 ft) an amber banner appears above the chest list
with an Open button, the list row reads YOU'RE HERE, and the map icon becomes tappable.
Toggle the ticking off under Me -> Settings.

## Hard refresh
Me tab -> "This build" shows the version stamp and a Hard refresh button. Scripts and styles are
version-stamped, but index.html itself can be served from cache and pin a player to an old build;
the button adds a changing query parameter to force a fresh copy, clears the Cache API, and drops
stale tile data. Sign-in, settings and any ?ref= invite parameter survive it.

## Layout and performance notes
- The app is a fixed-height flex column sized from `--vh`, clamped against `100svh`. Every API for
  "visible height" over-reports on some mobile browser with an overlaying toolbar, and they
  disagree with each other, so app.js also MEASURES where the tab bar actually landed and shrinks
  `--vh` until it is on screen (and gives the space back when the toolbar hides). Self-correcting
  rather than trusting innerHeight, visualViewport or any vh unit.
- The chest list updates distances in place and only rebuilds its HTML when the set of chests
  changes; it is throttled to 400 ms (with a trailing render) and skipped entirely while a dialog
  is open. Rebuilding 60 rows on every GPS fix was what made reveal animations stutter.
- `body.modal-open` stops every looping background animation while a dialog is up.
- The particle canvas caps its pixel ratio (1 on large viewports, 1.5 on small) and its particle
  count; a retina full-screen canvas cleared each frame costs far more than the confetti is worth.

## Sound, effects, fullscreen
Sounds are synthesized in the browser (no audio files). Header buttons toggle sound (🔊) and fullscreen (⛶); Me tab → Settings also toggles visual effects/vibration. Fullscreen turns on at login by default. Effects default off if the device asks for reduced motion.
