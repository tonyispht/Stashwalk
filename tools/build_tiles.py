import duckdb, json, math, re, sys, os, collections
ridb_path, ov_path, outdir = sys.argv[1], sys.argv[2], sys.argv[3]

KIND = {'camp_site':'camp','caravan_site':'camp','playground':'play','park':'park','dog_park':'park',
        'recreation_ground':'park','garden':'park','nature_reserve':'reserve','wilderness_area':'reserve',
        'protected_landscape_seascape':'reserve','national_park':'reserve','state_park':'reserve'}
BAD = re.compile(r"\b(cemetery|cemetary|burial|mausoleum|jail|prison|correctional|detention|hospital|"
                 r"elementary|middle school|high school|university|college|church|chapel|mosque|synagogue|"
                 r"monastery|golf|country club|airport|landfill|wastewater|sewage|quarry|mine|"
                 r"shooting range|gun club|rifle|military|army|navy|air force)\b", re.I)

con = duckdb.connect()
ov = con.execute(f"SELECT name, class, lat, lon FROM read_parquet('{ov_path}')").fetchall()
ridb = json.load(open(ridb_path))

stat = collections.Counter()
grid = collections.defaultdict(list)
STOP = {"park","the","of","and","area","state","national","recreation","site","lake","creek","city","county","park.","nature","preserve"}

def near_m(a, b):
    R=6371000; r=math.pi/180
    x=math.sin((b[1]-a[1])*r/2)**2+math.cos(a[1]*r)*math.cos(b[1]*r)*math.sin((b[2]-a[2])*r/2)**2
    return 2*R*math.asin(math.sqrt(x))

kept = []
def add(name, lat, lon, kind, src):
    name = re.sub(r"\s+", " ", name or "").strip()[:52]
    if not name: stat['no name'] += 1; return
    if BAD.search(name): stat['excluded by name'] += 1; return
    if not (17 < lat < 72 and -180 < lon < -64): stat['outside US'] += 1; return
    rec = [name, round(lat,5), round(lon,5), kind]
    gk = (int(lat/0.002), int(lon/0.002))
    for dk in [(gk[0]+i, gk[1]+j) for i in (-1,0,1) for j in (-1,0,1)]:
        for o in grid[dk]:
            if near_m(rec, o) < 150:
                w1 = set(re.findall(r"[a-z]+", rec[0].lower())) - STOP
                w2 = set(re.findall(r"[a-z]+", o[0].lower())) - STOP
                if w1 & w2: stat['merged duplicate'] += 1; return
    grid[gk].append(rec); kept.append(rec); stat['kept ' + src] += 1

for r in ridb: add(r[0], r[1], r[2], r[3], 'RIDB')
for name, cls, lat, lon in ov: add(name, lat, lon, KIND.get(cls, 'park'), 'Overture')

os.makedirs(outdir, exist_ok=True)
tiles = collections.defaultdict(list)
for r in kept: tiles[f"{math.floor(r[1])}_{math.floor(r[2])}"].append(r)
for k, v in tiles.items():
    v.sort(key=lambda r: (r[1], r[2]))
    json.dump(v, open(os.path.join(outdir, k + '.json'), 'w'), separators=(',',':'))
json.dump(sorted(tiles.keys()), open(os.path.join(outdir, 'index.json'), 'w'), separators=(',',':'))

sizes = sorted(os.path.getsize(os.path.join(outdir, k + '.json')) for k in tiles)
print("TOTAL PLACES:", len(kept))
print(dict(stat.most_common()))
print("by kind:", dict(collections.Counter(r[3] for r in kept).most_common()))
print(f"tiles: {len(tiles)} | median {sizes[len(sizes)//2]/1024:.0f} KB | p90 {sizes[int(len(sizes)*.9)]/1024:.0f} KB | max {sizes[-1]/1024:.0f} KB")
