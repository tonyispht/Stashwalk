import duckdb, time, sys
out = sys.argv[1]
con = duckdb.connect()
con.execute("INSTALL httpfs; LOAD httpfs; SET s3_region='us-west-2';")
# Outdoor public places only. Everything else Overture labels (cemetery, school, golf, military,
# medical, religious, residential, industrial, quarry, landfill, ski) is deliberately left out.
KEEP = """
 (subtype='park'        AND class IN ('park','dog_park'))
 OR (subtype='protected'   AND class IN ('nature_reserve','wilderness_area','protected_landscape_seascape','national_park','state_park'))
 OR (subtype='campground'  AND class IN ('camp_site','caravan_site'))
 OR (subtype='recreation'  AND class IN ('recreation_ground','playground'))
 OR (subtype='horticulture' AND class='garden')
"""
q = f"""
COPY (
  SELECT names.primary AS name, class,
         round((bbox.ymin+bbox.ymax)/2, 5) AS lat,
         round((bbox.xmin+bbox.xmax)/2, 5) AS lon
  FROM read_parquet('s3://overturemaps-us-west-2/release/2026-10-21.0/theme=base/type=land_use/*', hive_partitioning=1)
  WHERE bbox.xmin > -180 AND bbox.xmax < -64 AND bbox.ymin > 17 AND bbox.ymax < 72
    AND names.primary IS NOT NULL AND length(names.primary) BETWEEN 2 AND 60
    AND ({KEEP})
) TO '{out}' (FORMAT PARQUET)
"""
t0 = time.time()
con.execute(q)
n = con.execute(f"SELECT count(*), count(DISTINCT class) FROM read_parquet('{out}')").fetchone()
print(f"extracted {n[0]} places ({n[1]} classes) in {time.time()-t0:.0f}s")
for r in con.execute(f"SELECT class, count(*) c FROM read_parquet('{out}') GROUP BY 1 ORDER BY c DESC").fetchall():
    print(f"   {r[1]:7d}  {r[0]}")
