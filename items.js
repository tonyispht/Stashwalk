// 106 base objects x 5 rarity versions = 530 collectible items.
(function () {
  const RARITIES = [
    { k: 'common',    n: 'Common',    w: 56, c: '#8fa39a' },
    { k: 'uncommon',  n: 'Uncommon',  w: 24, c: '#5ec27a' },
    { k: 'rare',      n: 'Rare',      w: 12, c: '#4aa3ff' },
    { k: 'epic',      n: 'Epic',      w: 6,  c: '#b46bff' },
    { k: 'legendary', n: 'Legendary', w: 2,  c: '#ffb02e' }
  ];
  const PREFIX = ['Worn', 'Mossy', 'Moonlit', 'Starforged', 'Mythic'];
  const HUE = [0, 80, 200, 285, 25];
  const FLAVOR = [
    ['Found under a log. Still good.', 'Smells faintly of woodsmoke.', 'Somebody loved this once.', 'Small, plain, and oddly comforting.'],
    ['Has a little more shine than expected.', 'Lichen has grown over one side.', 'Feels lucky in the pocket.', 'A trail-wise traveler left this behind.'],
    ['Glows faintly when nobody is looking.', 'Cool to the touch, even in summer.', 'Collectors whisper about these.', 'It hums a tune you almost recognise.'],
    ['Forged from fallen starlight.', 'Heavy with stories from far away.', 'Hardly anyone has held one.', 'The air shimmers around it.'],
    ['Legends say only one exists per mountain.', 'It has outlived the trail it was found on.', 'The forest goes quiet around it.', 'A true treasure of the wild.']
  ];
  const BASES = [
    ['🔦','Flashlight'],['🧭','Compass'],['🗺️','Trail Map'],['⛺','Tent'],['🎒','Backpack'],['🥾','Hiking Boot'],
    ['🔭','Telescope'],['🎣','Fishing Rod'],['⛏️','Pickaxe'],['🧲','Magnet'],['💎','Gemstone'],['🔑','Key'],
    ['🗝️','Old Key'],['📜','Scroll'],['🏺','Amphora'],['🕯️','Candle'],['🔔','Bell'],['🎲','Die'],
    ['🧩','Puzzle Piece'],['🎻','Fiddle'],['🎺','Trumpet'],['🥁','Drum'],['🍄','Mushroom'],['🌲','Pine'],
    ['🌰','Acorn'],['🍂','Fallen Leaf'],['🍁','Maple Leaf'],['🌻','Sunflower'],['🌵','Cactus'],['🌿','Herb Sprig'],
    ['☘️','Clover'],['🍀','Four-Leaf Clover'],['🌸','Blossom'],['🌷','Tulip'],['🌾','Wheat Bundle'],['🐚','Seashell'],
    ['🦴','Bone'],['💧','Dewdrop'],['❄️','Snowflake'],['⭐','Star'],['🌙','Crescent Moon'],['☀️','Sunstone'],
    ['⚡','Lightning Bolt'],['🌈','Rainbow Shard'],['☁️','Cloud Wisp'],['🔥','Ember'],['🌊','Wave'],['🦊','Fox'],
    ['🦉','Owl'],['🐻','Bear'],['🦌','Deer'],['🐇','Rabbit'],['🐿️','Squirrel'],['🦡','Badger'],
    ['🐸','Frog'],['🦎','Lizard'],['🐍','Snake'],['🐢','Turtle'],['🦋','Butterfly'],['🐝','Bee'],
    ['🐞','Ladybug'],['🦗','Cricket'],['🕷️','Spider'],['🦅','Eagle'],['🦆','Duck'],['🐟','Trout'],
    ['🦀','Crab'],['🐺','Wolf'],['🦔','Hedgehog'],['🐦','Songbird'],['🦇','Bat'],['🐌','Snail'],
    ['🦜','Parrot'],['🦢','Swan'],['🐉','Dragon'],['🦄','Unicorn'],['🍎','Apple'],['🍯','Honey Pot'],
    ['🌽','Corn Cob'],['🥕','Carrot'],['🍓','Strawberry'],['☕','Camp Mug'],['🍪','Cookie'],['🧀','Cheese Wedge'],
    ['🥨','Pretzel'],['🍞','Loaf'],['👑','Crown'],['🛡️','Shield'],['⚔️','Crossed Blades'],['🏹','Bow'],
    ['🔮','Crystal Ball'],['🧪','Potion'],['📖','Tome'],['🎩','Top Hat'],['🧢','Cap'],['🧣','Scarf'],
    ['🧤','Gloves'],['👒','Sun Hat'],['🕶️','Shades'],['⌚','Pocket Watch'],['📷','Camera'],['📻','Radio'],
    ['⚓','Anchor'],['⛵','Sailboat'],['🚀','Rocket'],['🎈','Balloon'],['🎁','Gift'],['🧸','Teddy Bear'],
    ['🏆','Trophy'],['🏮','Lantern']
  ];
  const ITEMS = [], ITEM_BY_ID = {}, ITEMS_BY_R = [[], [], [], [], []];
  BASES.forEach(([e, n], bi) => {
    for (let r = 0; r < 5; r++) {
      const it = { id: bi + '_' + r, e, n: PREFIX[r] + ' ' + n, r, h: HUE[r], base: bi, flavor: FLAVOR[r][bi % 4] };
      ITEMS.push(it); ITEM_BY_ID[it.id] = it; ITEMS_BY_R[r].push(it);
    }
  });
  Object.assign(window, { RARITIES, ITEMS, ITEM_BY_ID, ITEMS_BY_R });
})();
