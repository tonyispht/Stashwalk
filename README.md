# Stashwalk – digital geocaching

Plain static files. Upload the folder to any static host (GitHub Pages, Netlify Drop, Cloudflare Pages). No server to run.
GPS needs HTTPS (those hosts all provide it; `localhost` also works for testing).

## Files
index.html, style.css, app.js (game), fx.js (sound/visual effects/fullscreen), worker/ (optional shared-world backend), items.js (550 items), locations.js (landmark chests), db.js (storage), config.js (settings)

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
- locations.js: 106 landmark chests across the US (national parks, peaks, scenic spots, city parks). Coordinates are approximate, so they open within LANDMARK_UNLOCK_FT (300 ft) – edit/add your own rows.
- Radius slider (Explore tab): choose how far to show chests, 1–250 mi. Park/campground data loads out to ~15 mi; landmarks show at any distance.
- Automatically: campsites, parks, picnic tables, viewpoints, summits, shelters, playgrounds and fire rings near each player are pulled from OpenStreetMap, so every area has chests.
- Players can hide their own chests (2/day) at their exact spot.
- Opening needs you within UNLOCK_FT (5 ft) in config.js. Phone GPS is often only accurate to ~10-30 ft, so raise it (e.g. 25) if players can't unlock.

## Test without walking
Open `index.html?dev=1` – tap the map to teleport, or use "Teleport to nearest chest".

## Sound, effects, fullscreen
Sounds are synthesized in the browser (no audio files). Header buttons toggle sound (🔊) and fullscreen (⛶); Me tab → Settings also toggles visual effects/vibration. Fullscreen turns on at login by default. Effects default off if the device asks for reduced motion.
