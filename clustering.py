"""K-means clustering of shot locations into hot/cold zones.

Each cluster gets a convex-hull polygon (so the front end can shade it on the
court) and its own field-goal percentage. scikit-learn is an optional import:
if it is missing, compute_clusters returns an empty list and the rest of the
app keeps working.
"""

try:
    from sklearn.cluster import KMeans
    _SKLEARN_AVAILABLE = True
except ImportError:  # scikit-learn not installed yet
    _SKLEARN_AVAILABLE = False


def _convex_hull(points):
    """Andrew's monotone-chain convex hull. Returns ordered hull vertices."""
    unique = sorted(set(points))
    if len(unique) <= 2:
        return unique

    def cross(o, a, b):
        return (a[0] - o[0]) * (b[1] - o[1]) - (a[1] - o[1]) * (b[0] - o[0])

    lower = []
    for p in unique:
        while len(lower) >= 2 and cross(lower[-2], lower[-1], p) <= 0:
            lower.pop()
        lower.append(p)

    upper = []
    for p in reversed(unique):
        while len(upper) >= 2 and cross(upper[-2], upper[-1], p) <= 0:
            upper.pop()
        upper.append(p)

    return lower[:-1] + upper[:-1]


def clustering_available():
    return _SKLEARN_AVAILABLE


def compute_clusters(shots, k=5):
    """Group shots into k hot zones. Tags each shot with its cluster id in place.

    Returns a list of cluster dicts: id, centroid, hull, fga, fgm, fg_pct.
    Returns [] when scikit-learn is unavailable or there are too few shots.
    """
    if not _SKLEARN_AVAILABLE or len(shots) < 2:
        return []

    k = max(1, min(int(k), len(shots)))
    coords = [(s["x"], s["y"]) for s in shots]

    model = KMeans(n_clusters=k, n_init=10, random_state=42)
    labels = model.fit_predict(coords)

    clusters = []
    for cluster_id in range(k):
        members = [shots[i] for i, lbl in enumerate(labels) if lbl == cluster_id]
        if not members:
            continue

        fga = len(members)
        fgm = sum(1 for m in members if m["made"])
        member_points = [(m["x"], m["y"]) for m in members]
        hull = _convex_hull(member_points)

        clusters.append({
            "id": cluster_id,
            "centroid": [
                round(sum(x for x, _ in member_points) / fga, 1),
                round(sum(y for _, y in member_points) / fga, 1),
            ],
            "hull": [[float(x), float(y)] for x, y in hull],
            "fga": fga,
            "fgm": fgm,
            "fg_pct": round(100.0 * fgm / fga, 1),
        })

    for shot, label in zip(shots, labels):
        shot["cluster"] = int(label)

    return clusters
