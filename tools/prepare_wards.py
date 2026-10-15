"""Build backend/app/data/wards.geojson from the DataMeet AMC ward file.

Source: https://github.com/datameet/Municipal_Spatial_Data/tree/master/Ahmedabad (CC BY-SA 2.5 IN)

Usage: python tools/prepare_wards.py data_raw/Wards.geojson backend/app/data/wards.geojson
"""
import json
import sys

from shapely.geometry import mapping, shape
from shapely.ops import transform

# Ward -> AMC zone. Best-effort mapping for the 48-ward delimitation; verify against
# the latest AMC list before relying on zone-level escalation.
ZONES = {
    "North West": [1, 2, 7, 8, 19],
    "West": [3, 4, 5, 6, 9, 10, 18, 30, 31],
    "Central": [15, 16, 17, 21, 28, 29],
    "North": [11, 12, 13, 14, 22, 23, 26, 27],
    "East": [24, 25, 39, 40, 41, 43, 48],
    "South": [35, 36, 37, 38, 42, 44, 45, 46, 47],
    "South West": [20, 32, 33, 34],
}
ZONE_OF = {w: z for z, ws in ZONES.items() for w in ws}

NAME_FIX = {
    "S.P.STADIUM": "S.P. Stadium",
    "KUBERNAGR": "Kubernagar",
    "SARASPUR-RAKHIYAL": "Saraspur-Rakhiyal",
}


def nice(name: str) -> str:
    return NAME_FIX.get(name, name.title())


def main(src: str, dst: str) -> None:
    raw = json.load(open(src, encoding="utf8"))
    out = []
    for f in raw["features"]:
        no_str, name = f["properties"]["Name"].split(" ", 1)
        no = int(no_str)
        geom = transform(lambda x, y, z=None: (round(x, 6), round(y, 6)), shape(f["geometry"]))
        geom = geom.buffer(0).simplify(0.00008, preserve_topology=True)
        out.append({
            "type": "Feature",
            "properties": {"no": no, "name": nice(name), "zone": ZONE_OF[no]},
            "geometry": mapping(geom),
        })
    out.sort(key=lambda f: f["properties"]["no"])
    assert len(out) == 48 and len(ZONE_OF) == 48
    json.dump({"type": "FeatureCollection", "features": out}, open(dst, "w", encoding="utf8"), separators=(",", ":"))
    print(f"wrote {len(out)} wards to {dst}")


if __name__ == "__main__":
    main(sys.argv[1], sys.argv[2])
