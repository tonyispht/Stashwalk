# Stashwalk – digital geocaching

Plain static files. Upload the folder to any static host (GitHub Pages, Netlify Drop, Cloudflare Pages). No server to run.
GPS needs HTTPS (those hosts all provide it; `localhost` also works for testing).

## Files
index.html, style.css, app.js (game), fx.js (sound/visual effects/fullscreen), sw.js (service worker: install + offline), manifest.webmanifest, icons/, worker/ (optional shared-world backend), items.js (550 items), places/ (263,565 chest locations as map tiles), tools/ (dataset builders), db.js (storage), config.js (settings)

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

## Activity feed, gifts and reporting
- **Activity feed**: when another player takes an item you left in a chest, the server records it
  (derived from what actually changed in the chest, so it cannot be forged by a client) and the
  next time you open the game you get a "While you were away" card. `feed/<user>` keeps the last 30
  events and refuses client writes; each player tracks what they have seen with `feedSeen`.
- **Gifts**: "Leave an item (no swap)" puts an item into a FREE slot - chests grow from CHEST_SLOTS
  (4) up to MAX_CHEST_SLOTS (8), so a gift never overwrites anything. It does not use up your one
  trade per chest per hour (`TRADE_COOLDOWN_MIN`).
- **Reporting**: any player can report a chest that is on private land, unsafe or not a real public
  place. FLAGS_TO_REMOVE (3) reports from DIFFERENT players removes it for everyone - the server
  dedupes by player, adds it to a blocklist the client filters against, and deletes the chest and
  its index entry.

## Player stats and achievement progress
Tapping your name/avatar in the header opens a stats card: your record (chests, trades, items,
relics, merges, gifts, hidden, invites, streak, legendaries, achievements), the title picker, and
the achievement you are closest to finishing. A compact strip on the Explore tab shows that same
closest achievement with a progress bar, so there is always something concrete to aim at. The Me
tab lists every achievement with a bar and a count.

## Inviting friends
Share the link or QR code from the Me tab. The invited player starts with an extra item. You get a
Rare once they actually open their first chest, an Epic at 5 friends and a Legendary at 10, plus
the Recruiter and Party Leader titles. Rewards arrive on the Me tab (or within a minute of play);
"Check" forces a refresh.
A referral only counts after the invited player opens a chest, so fake sign-ups earn nothing, and
the tally lives server-side - the /kv/invites path refuses writes so no client can inflate it.

## When location is inaccurate
If a fix comes back worse than COARSE_FT (400 ft) the device gave a network-level position rather
than real GPS, chests appear in the wrong place and do not track walking. The GPS pill turns red and
reads "imprecise", and a help card shows platform-specific steps - on iOS almost always the
**Precise Location** switch for the browser under Settings -> Privacy & Security -> Location
Services, plus choosing "Allow While Using" rather than "Allow Once".

## Finding and opening a chest
Walk toward it. Within GEIGER_FT (250 ft) the game starts ticking like a Geiger counter, faster and
brighter the closer you get. Inside UNLOCK_FT (20 ft) an amber banner appears above the chest list
with an Open button, the list row reads YOU'RE HERE, and the map icon becomes tappable.
The ticking is OFF by default; turn it on under Me -> Settings.

## Install as an app, and playing without a signal
`manifest.webmanifest` plus `sw.js` make the game installable. Installed, it opens from the home
screen with no browser bars - which is also the dependable fix for the tab bar hiding behind a
browser toolbar. Me -> "Install & offline" has the button; Chrome fires `beforeinstallprompt`,
which is captured and held until the player taps it, and iOS gets the Share -> Add to Home Screen
walkthrough instead because Safari only offers it from its own menu.

Three caches, listed by `caches.keys()`:

| cache | holds | lifetime |
|---|---|---|
| `stashwalk-shell-<VERSION>` | app code, Leaflet, the icons | replaced on every deploy |
| `stashwalk-places-v1` | park/campground tiles already fetched | kept (files never change; the `?v=` stamp is stripped from the cache key so a deploy does not re-download them) |
| `stashwalk-maptiles-v1` | map images already viewed | kept, capped at 600, oldest dropped first |

**`VERSION` in sw.js must match `window.ASSET_V` in index.html.** Bump both on every deploy, or the
shell cache will not be replaced. A new version does not take over a running page: the player gets
a toast and an "Update now" button in Me. Hard refresh unregisters the worker and deletes every
cache, so it is still the escape hatch if a build ever goes wrong.

Requests to the Cloudflare Worker are never cached - the shared world has to be live. Without a
connection the game opens from the stored copy of the player record (`sw_snap_<key>` in
localStorage) and the pack, shelf, achievements and already-seen map still work; opening chests,
trading, daily rewards, hiding, merging and crafting all refuse with "… needs a connection",
because those change state other players can see. A 📴 chip appears in the header while offline,
and the record is re-read from the server when the connection returns.

## Account recovery
No email address is collected, so a forgotten password would otherwise mean a lost account. Every
account is created with a recovery code: 16 Crockford base32 characters (no I, L, O or U), shown
once at signup and again under Me -> Account recovery on the device that made it. Only a hash is
stored, derived in the browser by the same PBKDF2 routine as the password, with its own salt
(`rsalt`/`rhash` on the user record). `GET /kv/users/<name>` exposes `name`, `salt`, `rsalt` and a
`hasR` flag - never a hash.

Two Worker endpoints:

- `POST /setrec` - signed in, attaches or replaces a code. Used by "New code" and by the one-time
  prompt for accounts created before codes existed.
- `POST /recover` - name plus code hash plus a new password hash. On success the password is
  replaced **and the code is spent**: the client sends a fresh `rsalt`/`rhash2` in the same request,
  so a code can never be used twice. Six wrong attempts in an hour return 429 (`rl/<name>` row).

Entry is forgiving: lower case, spaces and the usual lookalikes (`O`->`0`, `I`/`L`->`1`, `U`->`V`)
are all normalised before hashing. Resetting a password invalidates the session on every other
device, since those hold the old hash.

## Item plates
Every item is an emoji on a generated plate, so the five rarities of one object no longer
look identical. Rarity picks the material - plain stone, mossy green, a blue sheen, a purple
starfield, then gold with rays - and `plateVars()` in app.js derives the angle, highlight
position and a faint accent tint from the base object's index, so each of the 110 objects
sits on its own variation. Craft-only relics get a violet pinstripe of their own, keyed off
their id (they all share `base: -1`, so without that they would come out identical).

It is all static CSS gradients: painted once, no filters, nothing per frame. The emoji is
no longer hue-rotated - the plate carries rarity now, which also removes a filter from every
tile on screen.

Uncollected items on the shelf keep a dimmed version of their rarity, so a missing Legendary
reads as gold rather than one more black blob. They use `sr0`-`sr4` rather than `r0`-`r4`
on purpose: the live Legendary glow and shine must not run on hundreds of shelf tiles.

One trap worth remembering: the silhouette is `filter: brightness(0)` on the emoji, and the
iOS performance rule that switches emoji filters off has to stay scoped
`.ios .tile:not(.sil) .em` - unscoped, it cancels the silhouettes and reveals every
uncollected item on iPhones.

## Chest opening
Opening a chest takes over the screen (`chestCinematic()` in app.js): the chest sits closed
and rattles, light forces its way out of the seam, the lid swings up on a growing beam, and the
instant it is fully open the screen flashes, rays start turning, particles burst out and motes
drift upward. About 1.7 s, 1.25 s on iOS; a tap anywhere skips it. It starts the moment the
player taps Open, so it also covers the round trip to the server - if the data is slow the
chest just sits there glowing.

The chest is inline SVG on purpose: the lid is hinged on the back-top edge of the box and the
interior glow is clipped to the opening and drawn behind the front wall. In plain divs the lid
read as a loose flap and the light looked painted on. The SVG uses class `cchest`, not
`chest` - `.chest` is the nearby-list row style and will paint a box behind it.

Timing comes from two custom properties set per run: `--lid` (when the lid starts moving) and
`--flash` (the moment it is fully open). The overlay sits at z-index 1050 - above the dialog,
below the `#fx` particle canvas, so canvas bursts draw over it. Skipped entirely when visual
effects are off or the device asks for reduced motion. Its sound is `FX.sfx('chest')`, scored
to the same timeline. Inside the dialog afterwards, the little chest is a still illustration
and the items rise in turn.

## Locator
Getting within `GEIGER_FT` of a chest no longer starts anything. It *offers* the locator: a
quiet panel slides up at the foot of the map, and the very first time one ever appears there
is a single toast pointing at it. Nothing ticks until the player taps Start.

Running, the panel shows the chest, a bar that fills as you close in, a distance, and a
heat word - Cold, Cool, Warm, Hot, Burning, Steps away, then "Right here - open it" once it is
actually in reach - with the colour shifting from blue to white-hot. Sonar rings pulse off the
player dot at the same rate as the ticking (`--sonar` on body), and the hunted chest gets a
ring of its own on the map. It stops itself when the chest is opened or the player walks off
to 2.5x the range.

The Settings toggle is now "ticking sound while the locator is running". It used to start on
its own, so it shipped off; with the locator opt-in it defaults on, and existing players are
switched on once (`sw_locmig`).

## Map style
Dark by default, toggled in Me -> Settings. The tiles are OpenStreetMap's own either way -
the dark look is a CSS filter (`invert` plus a 180 degree hue rotation, which keeps road
labels light-on-dark instead of vanishing) applied only to `.leaflet-tile-pane`. Markers,
the player dot and the attribution sit in sibling Leaflet panes and keep their real colours.
Doing it this way means no second tile service, no second set of cached tiles, and nothing
that can start demanding an API key. CARTO's dark basemap was the obvious choice and now
watermarks keyless requests, which is exactly the dependency this avoids.

## Trail Coins, miles walked and the shop
Coins (🪙, `P.coins`) are earned for walking and for playing, and spent in the Shop tab. Every
amount is in config.js under `COINS`, prices under `PRICES`.

**Walking** pays `COINS.mile` per mile, credited every tenth of a mile. The browser only reports
position while the game is open, so this counts walking done with Stashwalk on screen.
`trackWalk()` keeps an anchor point and only counts a move once it is further than both 10 m and
60% of the combined GPS uncertainty, so a phone sitting still and drifting earns nothing; anything
faster than `MAX_WALK_MPS` (6.5 m/s, ~14.5 mph) is treated as a vehicle and dropped; fixes worse
than 30 m are ignored; DEV teleports never count. In testing it credited 98% of a brisk walk,
nothing for 12 s of standing-still wobble, and nothing for 600 m covered in 4 s. Distance sits in
`P.stats.walkedM`, payouts in `walkPaid` (tenths of a mile already paid), and the running total
shows in the GPS pill on the map. Walking achievements at 1, 10, 50 and 100 miles.

**Other earnings**: daily reward (grows with the streak, extra on days 7/14/21/28), a chest you
have never opened before, trades, gifts, hiding, merging, crafting, achievements, anything new
for your shelf, and invited friends. Several at once (a trade that is also new for your shelf)
show as one "+13 🪙" pop under the coin counter, held back until the chest opening has finished.
Players from before coins existed get a one-off back payment for everything already done
(`retroCoins()`, flagged by `P.coinsV`), with an intro card. New players start with
`COINS.start`.

**The shop** has three parts:

- *Today's stock* - eight items, the same for every player, turning over at midnight UTC
  (seeded from the UTC day). One of each per player per day. On Sundays the last slot is a
  Legendary.
- *Finish a merge* - for anything you hold one or two of, the copies that would complete a set
  of three, at a 10% bundle discount.
- *Recipe ingredients* - what your relic recipes at your workshop level (and the next) are still
  missing, at the lowest rarity the recipe accepts.

Relics are never sold. Bought items do not earn the new-for-your-shelf bonus. Buying needs a
connection, like every other action that changes your record.

## Drone
Bought in the Shop (`DRONE_PRICE`), upgraded through `DRONE_LEVELS` - eight levels of range:
300 ft, 600 ft, 0.2 mi, 0.4 mi, 0.75 mi, 1.5 mi, 2.75 mi, and five miles at level 8. Once owned, a 🛸 button joins the map buttons; tap it to launch.

While it is up, the map belongs to the drone: the stick in the bottom-left steers it (arrow keys
or WASD on a computer), the map follows it, and a dashed circle around you marks its range - it
cannot leave that circle, which moves with you. The HUD at the top shows how far out it
is against its range, and the locator's heat bar for the chest nearest the *drone*, with the
same ticking and sonar rings as walking in, so you hunt with it exactly as you would on foot.
Within `DRONE_REACH_FT` of a chest an "Open" button appears; that plays the full opening and the
trade dialog as normal. The usual one-trade-per-chest-per-day rule still applies. Switching tabs
or tapping ✕ brings it home.

There is no battery or cooldown: the drone can fly and open chests as often as you like. Its
only limit is range, set by its level.

The player is always in control. Speed comes from the stick alone - analog and eased, so a light
push creeps and a full push races, with 85% of the way out already counting as full since thumbs
rarely reach the rim. Top speed is at least `DRONE_SPEED_MPS` (45 m/s, ~100 mph) and scales with
range (`DRONE_EDGE_S`) so the edge is never more than ~30 s away: 80 m/s at level 6, 148 at
level 7, 268 m/s (~600 mph) at level 8. The drone
never slows, steers or opens anything by itself; it only *offers* the Open button once you have
flown it within reach, and nothing happens until you tap it.

The game normally keeps only the player's nearest 150 places in memory, which in a city can end
two miles out. So the drone looks up places around itself as it flies (`droneScan()`, re-run
every 150 m of travel, 1.2 km radius), shows any the player's list lacks as dashed markers, and
can open them. Tested in Chicago: the player's list stopped at 2.06 mi, and a drone 4 mi out found
and opened Diversey Playground. Higher levels launch a little zoomed out, and the map keeps the
drone in the clear area below the HUD. While flying, the map fills the whole Explore screen down
to the tab bar (the slider and chest list come back when the drone lands) - about twice the height.

## Update banner
When the service worker finds a newer build, a bar appears under the header on every screen -
"A new version of Stashwalk is ready" with an Update button that swaps to it and reloads. The
game also checks for a new build every 15 minutes while open and whenever it comes back to the
foreground, since people leave it running on walks.

## Road coins
Coins lie along real streets, footpaths and trails, and fly into you (or the drone) when you get
close. Settings are in config.js under `ROAD_COINS`.

**Where the roads come from.** OpenFreeMap's public vector tiles of OpenStreetMap
(`https://tiles.openfreemap.org/planet`) - free, no key, no request limits, attribution required
(added to the map's credits automatically). `rcDecode()` is a small Mapbox Vector Tile reader that
pulls the `transportation` layer out of each zoom-14 tile; no library. The game loads the tile you
are on plus any neighbour you are near the edge of (about 100 KB each in a town), and the tile
around the drone while it flies. The service worker keeps up to 30 of them (`stashwalk-roads-v1`);
the index that names the current monthly data version is always fetched fresh.

**Where coins go.** Footpaths, trails and tracks every `pathEvery` m, quiet streets (minor,
tertiary, alleys) every `roadEvery` m, each a `chance` roll - and never on motorways, trunk,
primary or secondary roads, private driveways, parking-lot aisles, ramps or in tunnels, so the
game never rewards walking somewhere it should not. Downtowns map a sidewalk on each side of the
street as well as the street, so at most one coin survives per `spacingM` square. Worth 2-3, +1 on
trails; about 1 in 25 is a 25-coin gold stack.

**Same for everyone, once per day.** Placement is seeded from the tile and the UTC day, so every
player sees the same coins and they move at midnight UTC. What you have picked up is stored per
player per day (`P.rc`, compactly as indices per tile), so a reload never brings one back.

**Picking up.** Coins within twice the magnet radius start pulsing towards you; inside
`magnetFt` (80 ft) they lift off and are pulled in along an arc, accelerating as they go, with a
clink that climbs in pitch when you chain several. On foot it needs a real GPS fix of 40 m or
better (no coarse-location scooping, no DEV teleports). The drone uses `droneMagnetFt` and can pick
up `dronePerDay` coins a day (0 removes the limit); walking has no limit. Nothing is collected
offline. Achievements at 100 and 1,000 coins picked up.

## Hidden chests
Chests stay off the map and out of the nearby list until you find them.

- **Search circles.** Undiscovered chests near you (within `SEARCH_SHOW_MI`, the nearest
  `SEARCH_MAX`) show only as a dashed circle of `SEARCH_RADIUS_FT` with a "?" in the middle. The
  chest is always inside but never at the centre: each circle is offset from its chest by a fixed
  18-70% of the radius, seeded from the chest id (`searchCenter()`), so it is the same every time
  and for every player. While the drone is up, the circles follow the drone.
- **Locator.** Within `GEIGER_FT` (now 500 ft) of an undiscovered chest the locator panel offers
  itself as "A hidden chest is close" - it never names a chest you have not found. The heat bar,
  distance, ticking and sonar work as before; it prefers the nearest undiscovered chest over ones
  you already know.
- **Finding.** Walk within `DISCOVER_FT` (60 ft), or fly the drone within reach, and the chest is
  found for good (`P.found`): a "Found ..." toast, then it appears on the map and in the list with
  its name. It is also checked the moment the chest list loads, so standing still on a chest works.
  Chests you have opened before (`P.stats.visited`) and chests you hid count as found.
- **The list** shows found chests; the header and a hint line count the undiscovered ones. Nothing
  - the empty-list message, the locator, the drone HUD, the diagnostics - names an undiscovered
  chest.

## Hiding with the drone
The drone HUD has a "🫳 Hide" button that hides a chest where the drone is hovering, using the
normal hide dialog. `DRONE_HIDES_PER_DAY` (2) a day, and they count toward `HIDE_PER_DAY` too. The
usual 20 m gap from other chests applies. Chests can be hidden anywhere, on foot or by drone;
reporting (three reports removes a chest) is the safety valve. `DRONE_HIDE_NEAR_M` can optionally
require remote hides to be within that many metres of a known park or public place (0 = off).

## Leaderboards, challenges, cosmetics, rare chests, notifications (2026-11)
- **Leaderboards** (`/lb/submit`, `/lb` on the Worker; card in the Me tab): all-time boards for
  coins earned, miles, chests opened and shelf size, plus a weekly coins board. Players submit
  their own cumulative stats (`submitLB`, throttled); the Worker ranks them and returns the top
  100 plus the caller's rank. Opt out with "Appear on leaderboards" in Settings. `lb/<user>` is
  not reachable through `/kv`.
- **Daily & weekly challenges** (Daily tab): a deterministic rotating set (seeded by date), tracked
  against a snapshot of your cumulative stats taken when the period began, with coin rewards.
- **Cosmetics / coin sinks** (Shop → Style): buy app accent, map style, player-dot and drone-paint
  with coins; equip for free. Applied live through CSS variables (`applyCosmetics`). The free
  default is always owned.
- **Rare glowing chests**: ~1 in 22 chests (not player-hidden) glow on the map and hold a
  guaranteed Epic+ item plus a coin bonus. Deterministic (`isRare`).
- **Push notifications**: a daily "reward ready" reminder via the Notification Triggers API where
  supported, plus a live alert when a rare cache is within reach. Toggle in Settings. (Full
  background push for closed-app alerts would need a VAPID push server.)
- Chests now reveal within **20 ft** (was 60), and the Explore sheet's collapsed state is slimmed
  so the map is the majority of the screen.

## Wild chests (auto-generated)
Parks and campgrounds are sparse in most neighbourhoods, so the game also generates extra chests
along the **real road and path network** near the player. They are deterministic — seeded by map
tile with `rng(hashStr('stashwalk-wild|'+key))`, so every player sees the same ones with **no
server** (same trick as the shop and road coins), and they persist (seeded by tile, not by day).

- Source: the same OpenFreeMap vector tiles the road coins use (`RC.tiles`); `wildPlace()` walks
  the road/path lines and drops a chest every `roadEvery`/`pathEvery` metres, thinned to one per
  `gapM` square for medium density (~one every couple of blocks). Tuned in `config.js → WILD_CHESTS`.
- Kinds: `trail` (🥾 Trail Cache) on footpaths/trails, `street` (🚩 Street Cache) on quiet streets.
  Names are deterministic (`wildName()` → e.g. "Mossy Roadside Cache").
- IDs are coordinate-based (`wildId()`, `w…`) so they stay stable; they behave exactly like park
  chests — discover by walking within `DISCOVER_FT`, hunt with the locator, open and trade.
- Loading: `wildEnsureAround()` loads the tiles immediately around the player (works even if road
  coins are off) and folds the new chests into the live list via `mergeWild()`. `WILD` is capped
  at 24 tiles to bound memory on long walks. No Worker change — purely client-side.

## Admin
The account named in `ADMIN_USER` (config.js, "TonyIspht") gets a 🛡️ Admin card at the top of
the Me tab. Who is really an admin is decided by the Worker (`ADMIN_USERS` variable, defaulting
to tonyispht) - the game's own check only decides whether to show the card.

- **Numbers**: accounts, online now, active in the last 24 hours and 7 days; who is online,
  the newest accounts and recent activity. `GET /admin/stats`, admin only (403 otherwise).
- **Presence**: every player's game pings `POST /ping` once a minute while on screen; the server
  keeps `seen/<user>`. Online = seen in the last 2.5 minutes. Neither path is readable through
  `/kv`.
- **Notifications**: the server records sign-ups and players coming back after 10+ minutes away
  in `admin/events` (last 200; a brand-new account's first ping is not reported twice). The admin's
  game checks every 30 s and shows a toast, a dot on the Me tab, and - once "Turn on notifications"
  is tapped - a system notification while the game is in the background. Tapping it opens the
  panel. These work while the game is open or backgrounded, not when it is fully closed.


### More admin tools
- **Game-wide totals**: new accounts this week, chests opened, trades, miles walked, coins earned,
  items collected, merges + crafts, road coins, player-hidden chests, chests removed, drones owned
  and daily claims - added up from every player record by `GET /admin/stats`.
- **Clickable names**: every username in the admin card (players, hidden chests, activity) opens a
  player card (`GET /admin/user?u=`) with their coins, opens, trades, hides, items, miles, streak,
  drone level and more, plus **Show on map**, which jumps to their last known spot.
- **Players on the map**: "Show players on map" pins everyone who has shared a location
  (green = online, grey = away). Tap a pin for their card.
- **Locations**: `/ping` carries the player's position; the server rounds it to 3 decimals
  (~100 m) and keeps only the latest one in `seen/<user>`, readable only through the admin-only
  endpoints. Settings shows a one-line disclosure ("Your approximate location is shared with the
  server and admin team for further development"); there is no opt-out, so every player appears on
  the admin map.
- **Hide anywhere, no limits**: "Place chests on the map" puts the map in placement mode - tap
  anywhere to hide a chest there, stocked with any item in the game (not taken from the pack).
  The admin also skips the daily hide limits and the spacing rule when hiding normally.
- **Remove chests**: the Hidden chests tab lists player-made chests newest first, with a Remove
  button (`POST /admin/remove`) that deletes it for everyone at once.

### Who hid a chest
Player chests show "Hidden by <name> · 3 d ago" in the list and when opened; built-in chests say
"Stashwalk chest". The name is stamped by the Worker when the chest is first written and kept on
every later write, so it cannot be faked. Chests hidden before this update show "Hidden by a player".

### Daily coins
Every day on the Daily calendar shows the coins it pays (base + streak bonus, bigger on days 7,
14, 21 and 28), assuming the streak continues from today.

## Hard refresh
Me tab -> "This build" shows the version stamp and a Hard refresh button. Scripts and styles are
version-stamped, but index.html itself can be served from cache and pin a player to an old build;
the button adds a changing query parameter to force a fresh copy, clears the Cache API, and drops
stale tile data. Sign-in, settings and any ?ref= invite parameter survive it.

## Input locking and zoom
Text selection, long-press context menus and drags are disabled outside real inputs (inputs, the
invite link and the diagnostics block stay selectable so copying works). Pinch and double-tap zoom
are blocked via the viewport meta, touch-action and a touchend guard.
Browser PAGE zoom is a browser setting that a page cannot change. The game detects it
(screen.width vs innerWidth in portrait) and warns once per session; the Me tab readout shows the
estimate. If a player reports things being cut off, check that figure first.

## iOS performance
iOS pays far more than Android for CSS filters, backdrop blur and large canvases. On an iPhone or
iPad the game adds `body.ios` and turns on FX low-power mode: the canvas drops to 1x pixel ratio,
particle counts are roughly halved, and the header blur, per-item hue filters, screen flash and
several looping animations are switched off. The gameplay is identical.

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

## UI layout (2026-11 refresh)
- **Five bottom tabs** instead of seven: Explore, **Items** (Pack + Shelf behind a sub-toggle),
  Daily, **Shop** (Shop + Craft behind a sub-toggle), Me. `itemsSub`/`shopSub` remember the
  last half you viewed; `setSub()` switches them.
- **Header** is one compact stat strip (coins, streak, pack) beside the name. The title line and
  the sound/fullscreen buttons moved out — those toggles already live in Me › Settings.
- **Explore is a draggable bottom sheet.** The grip (`#sheetGrip`) drags to resize; tapping the
  grip or the list header cycles three snaps (peek / half / full). Default is peek so the map is
  large. Remembered in `sw_snap`.
- **Map legend** (the ❔ map button, `#legend`) explains the markers. Found chests that would
  overlap at the current zoom collapse into a numbered **cluster** bubble (`drawChestMarkers()`,
  re-run on `zoomend`) that fits-bounds to spread apart when tapped.
- **Empty states** (`emptyState()`) give pack/shelf/GPS-off a big icon, one line, and an action.
- **First-run coachmarks** (`coachOnce()`, once via `sw_coach`) point at the map, the sheet grip
  and the Daily tab.
- **Polish**: skeleton shimmer while the admin panel loads, tabular numerals on all counters,
  a soft view-change transition, 42px icon buttons, and `prefers-reduced-motion` honored.

## Credits

- 3D chest: "Mythical Chest Draft 1" (https://sketchfab.com/3d-models/mythical-chest-draft-1-cc3d58d1c409436eb2f1ab1f47f8f0cd) by ArtsGareau (https://sketchfab.com/ArtsGareau), licensed under CC-BY-4.0 (http://creativecommons.org/licenses/by/4.0/). Recoloured per chest level and optimised for the web (models/chest.glb, img/chest_l*.webp). Original licence text in models/chest-license.txt.
- 3D rendering: three.js (MIT), vendored in vendor/.
