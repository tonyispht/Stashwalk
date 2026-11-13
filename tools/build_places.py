import json, sys, re, math, collections
fac_path, rec_path, out_path = sys.argv[1], sys.argv[2], sys.argv[3]

SKIP_TYPES = {"Activity Pass","Permit","Ticket Facility","Tree Permit","Timed Entry",
              "Venue Reservations","Library","Archives","Museum","Federal","Kiosk"}
SKIP_NAME = re.compile(r"\b(permit|pass(es)?|ticket|lottery|reservation only|timed entry|christmas tree|firewood)\b", re.I)

# Regions the data legitimately covers: mainland+AK+HI+PR+VI, Guam/CNMI, American Samoa.
REGIONS = [(13.0, 72.0, -180.0, -64.0), (13.0, 21.5, 144.0, 146.5), (-15.0, -10.0, -171.5, -168.0)]
def in_us(lat, lon):
    return any(a <= lat <= b and c <= lon <= d for a, b, c, d in REGIONS)

def kind_of(name, ftype):
    n = name.lower()
    if ftype == "Campground" or re.search(r"\b(campground|camping|campsite|camp)\b", n): return "camp"
    if re.search(r"\b(picnic|day use|day-use)\b", n): return "picnic"
    if re.search(r"\b(overlook|viewpoint|vista|scenic view|lookout)\b", n): return "view"
    if re.search(r"\b(peak|summit|mountain|mtn)\b", n): return "peak"
    if re.search(r"\b(shelter|cabin|lookout tower|hut|yurt)\b", n): return "shelter"
    if re.search(r"\b(trailhead|trail head|trail)\b", n): return "park"
    if ftype == "Visitor Center": return "landmark"
    if re.search(r"\b(wilderness|refuge|preserve|reserve|forest|wildlife)\b", n): return "reserve"
    return "park"

rows, seen = [], set()
stat = collections.Counter()

def add(name, lat, lon, kind):
    try: lat, lon = float(lat), float(lon)
    except (TypeError, ValueError): stat["no coords"] += 1; return
    if not (math.isfinite(lat) and math.isfinite(lon)): stat["no coords"] += 1; return
    if abs(lat) < 0.01 and abs(lon) < 0.01: stat["null island"] += 1; return
    if not in_us(lat, lon):
        # Some source rows have the two values reversed; accept only if swapping lands in range.
        if in_us(lon, lat): lat, lon = lon, lat; stat["swapped lat/lon"] += 1
        else: stat["outside covered regions"] += 1; return
    name = re.sub(r"\s+", " ", (name or "")).strip()[:52]
    if not name: stat["no name"] += 1; return
    if SKIP_NAME.search(name): stat["permit/pass by name"] += 1; return
    key = (round(lat, 4), round(lon, 4))
    if key in seen: stat["duplicate location"] += 1; return
    seen.add(key)
    rows.append([name, round(lat, 5), round(lon, 5), kind])

for r in json.load(open(fac_path))["RECDATA"]:
    if not r.get("Enabled"): stat["disabled"] += 1; continue
    t = r.get("FacilityTypeDescription") or ""
    if t in SKIP_TYPES: stat["skipped type"] += 1; continue
    add(r.get("FacilityName"), r.get("FacilityLatitude"), r.get("FacilityLongitude"), kind_of(r.get("FacilityName") or "", t))
for r in json.load(open(rec_path))["RECDATA"]:
    if not r.get("Enabled"): stat["disabled"] += 1; continue
    add(r.get("RecAreaName"), r.get("RecAreaLatitude"), r.get("RecAreaLongitude"), kind_of(r.get("RecAreaName") or "", "RecArea"))

rows.sort(key=lambda r: (r[1], r[2]))
json.dump(rows, open(out_path, "w"), separators=(",", ":"))
print("KEPT:", len(rows), "places")
print("by kind:", dict(collections.Counter(r[3] for r in rows).most_common()))
print("dropped/repaired:", dict(stat.most_common()))
lats = [r[1] for r in rows]; lons = [r[2] for r in rows]
print("bounds: lat %.2f..%.2f  lon %.2f..%.2f" % (min(lats), max(lats), min(lons), max(lons)))
