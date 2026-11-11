"""Shot statistics computed from a list of shot dicts.

Each shot dict is expected to have: made (bool), shot_type (str),
shot_distance (int) and zone (str). app.py builds these from the nba_api
ShotChartDetail response.
"""


def _is_three(shot):
    return "3PT" in (shot.get("shot_type") or "")


def _pct(made, attempted):
    return round(100.0 * made / attempted, 1) if attempted else 0.0


def compute_zone_breakdown(shots):
    """Field-goal splits grouped by the NBA's SHOT_ZONE_BASIC label."""
    zones = {}
    for shot in shots:
        name = shot.get("zone") or "Unknown"
        bucket = zones.setdefault(name, {"zone": name, "fga": 0, "fgm": 0})
        bucket["fga"] += 1
        bucket["fgm"] += int(shot["made"])

    breakdown = []
    for bucket in zones.values():
        bucket["fg_pct"] = _pct(bucket["fgm"], bucket["fga"])
        breakdown.append(bucket)
    breakdown.sort(key=lambda b: b["fga"], reverse=True)
    return breakdown


def compute_stats(shots):
    """Aggregate shooting line for one game: splits, points, eFG% and zones.

    Points and eFG% cover field goals only -- ShotChartDetail does not include
    free throws.
    """
    fga = len(shots)
    fgm = sum(1 for s in shots if s["made"])

    threes = [s for s in shots if _is_three(s)]
    twos = [s for s in shots if not _is_three(s)]
    fg3a, fg3m = len(threes), sum(1 for s in threes if s["made"])
    fg2a, fg2m = len(twos), sum(1 for s in twos if s["made"])

    points = fg2m * 2 + fg3m * 3
    # Effective FG% credits a made 3 as 1.5x a made 2.
    efg_pct = round(100.0 * (fgm + 0.5 * fg3m) / fga, 1) if fga else 0.0

    return {
        "fga": fga,
        "fgm": fgm,
        "fg_pct": _pct(fgm, fga),
        "fg2a": fg2a,
        "fg2m": fg2m,
        "fg2_pct": _pct(fg2m, fg2a),
        "fg3a": fg3a,
        "fg3m": fg3m,
        "fg3_pct": _pct(fg3m, fg3a),
        "points": points,
        "efg_pct": efg_pct,
        "zones": compute_zone_breakdown(shots),
    }
