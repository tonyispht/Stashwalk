// Landmark chests that exist everywhere from day one. Coordinates are approximate - edit/add your own.
// kind: landmark | camp | view | peak | picnic | park
// On top of these, the game auto-finds campsites, parks, picnic tables, viewpoints, summits, shelters,
// playgrounds and fire rings near each player from OpenStreetMap, and players can hide their own chests.
window.LANDMARKS = [
  { id: 'L_central_park',  name: 'Bethesda Terrace, Central Park',    lat: 40.7806, lon: -73.9712,  kind: 'landmark' },
  { id: 'L_golden_gate',   name: 'Conservatory of Flowers, SF',       lat: 37.7725, lon: -122.4602, kind: 'landmark' },
  { id: 'L_griffith',      name: 'Griffith Observatory Lawn',         lat: 34.1184, lon: -118.3004, kind: 'view' },
  { id: 'L_millennium',    name: 'Millennium Park, Chicago',          lat: 41.8827, lon: -87.6233,  kind: 'landmark' },
  { id: 'L_boston_common', name: 'Boston Common',                     lat: 42.3550, lon: -71.0656,  kind: 'park' },
  { id: 'L_lincoln',       name: 'Reflecting Pool, Washington DC',    lat: 38.8893, lon: -77.0502,  kind: 'landmark' },
  { id: 'L_old_faithful',  name: 'Old Faithful, Yellowstone',         lat: 44.4605, lon: -110.8281, kind: 'landmark' },
  { id: 'L_mather',        name: 'Mather Point, Grand Canyon',        lat: 36.0615, lon: -112.1076, kind: 'view' },
  { id: 'L_tunnel_view',   name: 'Tunnel View, Yosemite',             lat: 37.7155, lon: -119.6770, kind: 'view' },
  { id: 'L_clingmans',     name: 'Clingmans Dome, Smokies',           lat: 35.5628, lon: -83.4985,  kind: 'peak' },
  { id: 'L_cadillac',      name: 'Cadillac Mountain, Acadia',         lat: 44.3525, lon: -68.2253,  kind: 'peak' },
  { id: 'L_bear_lake',     name: 'Bear Lake, Rocky Mountain NP',      lat: 40.3128, lon: -105.6451, kind: 'camp' },
  { id: 'L_paradise',      name: 'Paradise, Mount Rainier',           lat: 46.7861, lon: -121.7352, kind: 'view' },
  { id: 'L_hyde_park',     name: 'Serpentine, Hyde Park London',      lat: 51.5073, lon: -0.1657,   kind: 'park' }
];
