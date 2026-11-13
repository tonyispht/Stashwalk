// Landmark chests: always on the map, in every region of the US, from day one.
// Coordinates are approximate (typed from public-place knowledge), so these open from a wider ring
// (LANDMARK_UNLOCK_FT in config.js). Edit or add rows freely: [name, lat, lon, kind]
// kind: landmark | camp | view | peak | picnic | park
// Besides these, the game auto-finds campsites, parks, picnic tables, viewpoints, summits, shelters,
// playgrounds and fire rings within ~15 miles of each player (OpenStreetMap), and players can hide chests.
(function () {
  const ROWS = [
    // ---- National parks ----
    ['Jordan Pond, Acadia', 44.3253, -68.2536, 'view'], ['Cadillac Mountain, Acadia', 44.3525, -68.2253, 'peak'],
    ['Delicate Arch Viewpoint, Arches', 38.7436, -109.5200, 'view'], ['Ben Reifel Visitor Center, Badlands', 43.7480, -102.2405, 'landmark'],
    ['Chisos Basin, Big Bend', 29.2700, -103.3010, 'camp'], ['South Rim, Black Canyon of the Gunnison', 38.5540, -107.6860, 'view'],
    ['Sunset Point, Bryce Canyon', 37.6283, -112.1659, 'view'], ['Mesa Arch, Canyonlands', 38.3875, -109.8686, 'view'],
    ['Fruita Campground, Capitol Reef', 38.2870, -111.2450, 'camp'], ['Carlsbad Caverns Entrance', 32.1780, -104.4400, 'landmark'],
    ['Rim Village, Crater Lake', 42.8962, -122.1370, 'view'], ['Brandywine Falls, Cuyahoga Valley', 41.2470, -81.5420, 'landmark'],
    ['Badwater Basin, Death Valley', 36.2300, -116.7670, 'landmark'], ['Denali Visitor Center, Alaska', 63.7320, -148.9140, 'landmark'],
    ['Fort Jefferson, Dry Tortugas', 24.6288, -82.8731, 'landmark'], ['Anhinga Trail, Everglades', 25.3810, -80.5850, 'park'],
    ['Gateway Arch, St. Louis', 38.6247, -90.1848, 'landmark'], ['Logan Pass, Glacier', 48.6967, -113.7180, 'view'],
    ['Mather Point, Grand Canyon', 36.0615, -112.1076, 'view'], ['Jenny Lake, Grand Teton', 43.7460, -110.7230, 'view'],
    ['Lehman Caves, Great Basin', 39.0050, -114.2200, 'landmark'], ['Dunes Lot, Great Sand Dunes', 37.7340, -105.5120, 'park'],
    ['Clingmans Dome, Smokies', 35.5628, -83.4985, 'peak'], ['Cades Cove, Smokies', 35.6000, -83.8060, 'park'],
    ['Pine Springs, Guadalupe Mountains', 31.8960, -104.8230, 'camp'], ['Haleakala Summit, Maui', 20.7097, -156.2533, 'peak'],
    ['Kilauea Visitor Center, Hawaii', 19.4300, -155.2570, 'landmark'], ['Bathhouse Row, Hot Springs', 34.5140, -93.0540, 'landmark'],
    ['West Beach, Indiana Dunes', 41.6180, -87.0540, 'park'], ['Rock Harbor, Isle Royale', 48.0980, -88.5530, 'camp'],
    ['Hidden Valley, Joshua Tree', 34.0120, -116.1680, 'camp'], ['Exit Glacier, Kenai Fjords', 60.1890, -149.6320, 'view'],
    ['Grant Grove, Kings Canyon', 36.7390, -118.9620, 'park'], ['Manzanita Lake, Lassen', 40.5340, -121.5640, 'camp'],
    ['Mammoth Cave Visitor Center', 37.1870, -86.1000, 'landmark'], ['Spruce Tree House, Mesa Verde', 37.1960, -108.4880, 'landmark'],
    ['Paradise, Mount Rainier', 46.7861, -121.7352, 'view'], ['Canyon Rim, New River Gorge', 38.0690, -81.0760, 'view'],
    ['Diablo Lake Overlook, North Cascades', 48.7120, -121.1360, 'view'], ['Hurricane Ridge, Olympic', 47.9700, -123.4990, 'view'],
    ['Painted Desert Inn, Petrified Forest', 35.0840, -109.7870, 'landmark'], ['Bear Gulch, Pinnacles', 36.4730, -121.1790, 'park'],
    ['Lady Bird Johnson Grove, Redwood', 41.3010, -124.0180, 'park'], ['Bear Lake, Rocky Mountain', 40.3128, -105.6451, 'camp'],
    ['Saguaro East Visitor Center, Tucson', 32.2130, -110.7380, 'landmark'], ['General Sherman Tree, Sequoia', 36.5817, -118.7515, 'landmark'],
    ['Big Meadows, Shenandoah', 38.5214, -78.4372, 'camp'], ['Wind Cave Visitor Center', 43.5570, -103.4780, 'landmark'],
    ['Trunk Bay, Virgin Islands', 18.3540, -64.7740, 'park'], ['Old Faithful, Yellowstone', 44.4605, -110.8281, 'landmark'],
    ['Grand Prismatic Spring, Yellowstone', 44.5251, -110.8383, 'view'], ['Tunnel View, Yosemite', 37.7155, -119.6770, 'view'],
    ['Lower Yosemite Fall, Yosemite', 37.7442, -119.5977, 'landmark'], ['Zion Canyon Visitor Center', 37.2000, -112.9870, 'landmark'],
    ['The Grotto, Zion', 37.2590, -112.9490, 'picnic'],
    // ---- Peaks, trails, scenic spots ----
    ['Mount Washington Summit, NH', 44.2706, -71.3033, 'peak'], ['Katahdin, Baxter Peak, ME', 45.9044, -68.9213, 'peak'],
    ['Mount Mitchell Summit, NC', 35.7650, -82.2650, 'peak'], ['Springer Mountain, GA (AT start)', 34.6268, -84.1938, 'peak'],
    ['Cape Hatteras Lighthouse, NC', 35.2509, -75.5287, 'landmark'], ['Pikes Peak Summit, CO', 38.8409, -105.0423, 'peak'],
    ['Garden of the Gods, CO', 38.8783, -104.8697, 'park'], ['Mount Rushmore, SD', 43.8791, -103.4591, 'landmark'],
    ['Devils Tower, WY', 44.5902, -104.7146, 'landmark'], ['Monument Valley, AZ/UT', 36.9980, -110.0985, 'view'],
    ['Horseshoe Bend, AZ', 36.8791, -111.5103, 'view'], ['Emerald Bay, Lake Tahoe, CA', 38.9540, -120.1100, 'view'],
    ['Timberline Lodge, Mount Hood, OR', 45.3311, -121.7113, 'view'], ['Johnston Ridge, Mount St. Helens, WA', 46.2750, -122.2170, 'view'],
    ['Multnomah Falls, OR', 45.5762, -122.1158, 'landmark'], ['Haystack Rock, Cannon Beach, OR', 45.8837, -123.9690, 'landmark'],
    ['Bixby Bridge, Big Sur, CA', 36.3715, -121.9018, 'view'], ['Niagara Falls, Goat Island, NY', 43.0817, -79.0737, 'landmark'],
    ['Southernmost Point, Key West, FL', 24.5465, -81.7975, 'landmark'], ['Alamo Plaza, San Antonio, TX', 29.4260, -98.4861, 'landmark'],
    // ---- City parks ----
    ['Bethesda Terrace, Central Park, NYC', 40.7806, -73.9712, 'landmark'], ['Prospect Park Long Meadow, Brooklyn', 40.6602, -73.9690, 'park'],
    ['Riverside Park, NYC', 40.8000, -73.9720, 'park'], ['Boston Public Garden, MA', 42.3541, -71.0708, 'park'],
    ['Boston Common, MA', 42.3550, -71.0656, 'park'], ['Boathouse Row, Philadelphia, PA', 39.9690, -75.1870, 'view'],
    ['Washington Monument Grounds, DC', 38.8895, -77.0353, 'landmark'], ['Reflecting Pool, Washington DC', 38.8893, -77.0502, 'landmark'],
    ['Rock Creek Park, DC', 38.9700, -77.0500, 'park'], ['Piedmont Park, Atlanta, GA', 33.7850, -84.3730, 'park'],
    ['Centennial Olympic Park, Atlanta, GA', 33.7603, -84.3933, 'park'], ['Bayfront Park, Miami, FL', 25.7745, -80.1860, 'park'],
    ['Lake Eola Park, Orlando, FL', 28.5434, -81.3735, 'park'], ['Waterfront Park, Charleston, SC', 32.7770, -79.9250, 'park'],
    ['Jackson Square, New Orleans, LA', 29.9575, -90.0620, 'landmark'], ['Audubon Park, New Orleans, LA', 29.9300, -90.1280, 'park'],
    ['Hermann Park, Houston, TX', 29.7160, -95.3900, 'park'], ['Discovery Green, Houston, TX', 29.7530, -95.3590, 'park'],
    ['Zilker Park, Austin, TX', 30.2670, -97.7730, 'park'], ['Riverwalk, San Antonio, TX', 29.4240, -98.4940, 'park'],
    ['Forest Park, St. Louis, MO', 38.6392, -90.2860, 'park'], ['Millennium Park, Chicago, IL', 41.8827, -87.6233, 'landmark'],
    ['Minnehaha Falls, Minneapolis, MN', 44.9153, -93.2108, 'landmark'], ['Cherokee Park, Louisville, KY', 38.2370, -85.6980, 'park'],
    ['Cheesman Park, Denver, CO', 39.7330, -104.9660, 'park'], ['Liberty Park, Salt Lake City, UT', 40.7490, -111.8750, 'park'],
    ['Balboa Park, San Diego, CA', 32.7313, -117.1500, 'park'], ['Griffith Observatory Lawn, LA', 34.1184, -118.3004, 'view'],
    ['Conservatory of Flowers, San Francisco', 37.7725, -122.4602, 'landmark'], ['Gas Works Park, Seattle, WA', 47.6456, -122.3344, 'view'],
    ['Rose Garden, Washington Park, Portland', 45.5190, -122.7070, 'park']
  ];
  const slug = n => 'L_' + n.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '');
  window.LANDMARKS = ROWS.map(r => ({ id: slug(r[0]), name: r[0], lat: r[1], lon: r[2], kind: r[3] }));
})();
