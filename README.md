# Stashwalk – digital geocaching

Plain static files. Upload the folder to any static host (GitHub Pages, Netlify Drop, Cloudflare Pages). No server to run.
GPS needs HTTPS (those hosts all provide it; `localhost` also works for testing).

## Files
index.html, style.css, app.js (game), fx.js (sound/visual effects/fullscreen), items.js (550 items), locations.js (landmark chests), db.js (storage), config.js (settings)

## 1. Local mode (default, zero setup)
Everything saves in the player's browser. Works instantly, but chests/trades are only shared between accounts on the same device.
Players can Export/Import a save file (Me tab) to move devices.

## 2. Shared world (all players see the same chests) – still no server of yours
A pure file host cannot be written to by visitors, so shared chests need one free hosted database. Free Firebase Realtime Database:
1. console.firebase.google.com -> create project -> Build -> Realtime Database -> Create (test mode).
2. Paste the URL (https://YOURPROJECT-default-rtdb.firebaseio.com) into `DB_URL` in config.js.
3. Rules tab, suggested starter rules (stops people rewriting an existing account's password record):
   {"rules":{".read":true,".write":true,"users":{"$u":{".write":"!data.exists()"}}}}
Note: this is a casual game, not a hardened one – a determined player could still edit records or spoof GPS. Passwords are PBKDF2-hashed, but don't reuse real ones.

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
