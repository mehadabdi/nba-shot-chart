from flask import Flask, render_template, request, jsonify
from nba_api.stats.static import teams
from nba_api.stats.endpoints import commonteamroster, playergamelog, shotchartdetail

from stats import compute_stats
from clustering import compute_clusters, clustering_available
from model import XptsModel

app = Flask(__name__)

DEFAULT_SEASON = "2023-24"
DEFAULT_SEASON_TYPE = "Regular Season"

# Loaded once at startup. If xpts_model.pkl is missing the app still runs;
# xpts_model.status explains what to do (run train_model.py).
xpts_model = XptsModel()


@app.get("/")
def home():
    nba_teams = sorted(teams.get_teams(), key=lambda t: t["full_name"])
    return render_template(
        "index.html",
        teams=nba_teams,
        default_season=DEFAULT_SEASON,
        model_loaded=xpts_model.loaded,
        model_status=xpts_model.status,
    )


@app.get("/api/roster")
def api_roster():
    """
    Return roster for a given team + season.
    Uses nba_api endpoint CommonTeamRoster, which *does* map players to a team.
    """
    team_id = request.args.get("team_id", type=int)
    season = request.args.get("season", default=DEFAULT_SEASON, type=str)

    if not team_id:
        return jsonify({"players": []})

    try:
        r = commonteamroster.CommonTeamRoster(team_id=team_id, season=season)
        df = r.get_data_frames()[0]

        # Columns include: PLAYER, PLAYER_ID, etc.
        players_out = []
        for _, row in df.iterrows():
            players_out.append({
                "id": int(row["PLAYER_ID"]),
                "full_name": str(row["PLAYER"])
            })

        players_out.sort(key=lambda p: p["full_name"])
        return jsonify({"players": players_out})

    except Exception as e:
        return jsonify({"error": str(e), "players": []}), 500


@app.get("/api/games")
def api_games():
    player_id = request.args.get("player_id", type=int)
    season = request.args.get("season", default=DEFAULT_SEASON, type=str)

    if not player_id:
        return jsonify({"games": []})

    try:
        gl = playergamelog.PlayerGameLog(
            player_id=player_id,
            season=season,
            season_type_all_star=DEFAULT_SEASON_TYPE
        )
        df = gl.get_data_frames()[0]

        # Helper: find the first column that exists (handles GAME_ID vs Game_ID, etc.)
        def pick_col(candidates):
            cols = set(df.columns)
            for c in candidates:
                if c in cols:
                    return c
            # also try case-insensitive match
            lower_map = {c.lower(): c for c in df.columns}
            for c in candidates:
                if c.lower() in lower_map:
                    return lower_map[c.lower()]
            return None

        game_id_col = pick_col(["GAME_ID", "Game_ID", "game_id"])
        date_col    = pick_col(["GAME_DATE", "Game_Date", "GAME_DATE_EST", "game_date"])
        matchup_col = pick_col(["MATCHUP", "Matchup", "matchup"])
        wl_col      = pick_col(["WL", "W/L", "wl"])

        if not game_id_col:
            # Send back columns so you can see what nba_api returned
            return jsonify({
                "error": "Could not find a GAME_ID column in PlayerGameLog response.",
                "columns": list(df.columns),
                "games": []
            }), 500

        games = []
        for _, row in df.iterrows():
            games.append({
                "game_id": str(row[game_id_col]),
                "game_date": str(row[date_col]) if date_col else "",
                "matchup": str(row[matchup_col]) if matchup_col else "",
                "wl": str(row[wl_col]) if wl_col else ""
            })

        return jsonify({"games": games})

    except Exception as e:
        return jsonify({"error": str(e), "games": []}), 500


@app.get("/api/shots")
def api_shots():
    """
    Given team_id + player_id + game_id + season, return shot locations with
    made/missed, plus computed shooting stats, k-means hot-zone clusters and
    expected-points (xPTS) scoring. Optional query param: k (cluster count).
    """
    team_id = request.args.get("team_id", type=int)
    player_id = request.args.get("player_id", type=int)
    game_id = request.args.get("game_id", type=str)
    season = request.args.get("season", default=DEFAULT_SEASON, type=str)
    k = request.args.get("k", default=5, type=int)

    empty = {"shots": [], "stats": None, "clusters": [], "xpts": None,
             "clustering_available": clustering_available()}

    if not (team_id and player_id and game_id):
        return jsonify(empty)

    try:
        sc = shotchartdetail.ShotChartDetail(
            team_id=team_id,
            player_id=player_id,
            game_id_nullable=game_id,
            context_measure_simple="FGA",
            season_nullable=season,
            season_type_all_star=DEFAULT_SEASON_TYPE
        )
        df = sc.get_data_frames()[0]

        shots = []
        for _, r in df.iterrows():
            shots.append({
                "x": float(r["LOC_X"]),
                "y": float(r["LOC_Y"]),
                "made": int(r["SHOT_MADE_FLAG"]) == 1,
                "shot_type": str(r.get("SHOT_TYPE", "")),
                "shot_distance": int(r.get("SHOT_DISTANCE", 0)),
                "action_type": str(r.get("ACTION_TYPE", "")),
                "zone": str(r.get("SHOT_ZONE_BASIC", "")),
            })

        # compute_clusters and score_shots annotate the shot dicts in place
        # (adding "cluster", "prob_make" and "xpts").
        stats = compute_stats(shots)
        clusters = compute_clusters(shots, k=k)
        xpts = xpts_model.score_shots(shots)

        return jsonify({
            "shots": shots,
            "stats": stats,
            "clusters": clusters,
            "clustering_available": clustering_available(),
            "xpts": xpts,
        })

    except Exception as e:
        return jsonify({"error": str(e), **empty}), 500


if __name__ == "__main__":
    app.run(debug=True)
