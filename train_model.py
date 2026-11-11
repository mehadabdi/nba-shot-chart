"""Pre-train the xPTS (expected points) logistic-regression model.

The model learns P(make) from a shot's court location and distance, trained on
a sample of the league's top scorers and their full 2023-24 regular-season
shot data, pulled live from the NBA stats API.

Run once (this hits the NBA API once per player, so it takes a few minutes):

    python train_model.py            # default: top 40 scorers
    python train_model.py 60         # use the top 60 scorers instead

Output: xpts_model.pkl  -- app.py loads it automatically on startup.
"""

import pickle
import sys
import time

import numpy as np
import pandas as pd
from nba_api.stats.endpoints import leagueleaders, shotchartdetail
from sklearn.linear_model import LogisticRegression
from sklearn.metrics import accuracy_score, log_loss
from sklearn.model_selection import train_test_split
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler

SEASON = "2023-24"
SEASON_TYPE = "Regular Season"
FEATURES = ["LOC_X", "LOC_Y", "SHOT_DISTANCE"]
API_PAUSE_SECONDS = 0.6  # be polite to the NBA stats API


def get_top_scorer_ids(n):
    leaders = leagueleaders.LeagueLeaders(
        season=SEASON,
        season_type_all_star=SEASON_TYPE,
        stat_category_abbreviation="PTS",
    )
    df = leaders.get_data_frames()[0]
    return df.head(n)["PLAYER_ID"].astype(int).tolist()


def get_player_season_shots(player_id):
    chart = shotchartdetail.ShotChartDetail(
        team_id=0,  # 0 = every team the player appeared for that season
        player_id=player_id,
        season_nullable=SEASON,
        season_type_all_star=SEASON_TYPE,
        context_measure_simple="FGA",
    )
    return chart.get_data_frames()[0]


def collect_training_data(n_players):
    print(f"Fetching the top {n_players} scorers for {SEASON}...")
    player_ids = get_top_scorer_ids(n_players)

    frames = []
    for index, player_id in enumerate(player_ids, start=1):
        try:
            df = get_player_season_shots(player_id)
            if not df.empty:
                frames.append(df[FEATURES + ["SHOT_MADE_FLAG"]])
                print(f"  [{index}/{len(player_ids)}] player {player_id}: {len(df)} shots")
            else:
                print(f"  [{index}/{len(player_ids)}] player {player_id}: no shots")
        except Exception as exc:
            print(f"  [{index}/{len(player_ids)}] player {player_id}: ERROR {exc}")
        time.sleep(API_PAUSE_SECONDS)

    if not frames:
        raise SystemExit("No shot data was fetched - cannot train the model.")

    return pd.concat(frames, ignore_index=True).dropna(), len(frames)


def main():
    n_players = int(sys.argv[1]) if len(sys.argv) > 1 else 40

    data, n_players_used = collect_training_data(n_players)
    X = data[FEATURES].to_numpy(dtype=float)
    y = data["SHOT_MADE_FLAG"].to_numpy(dtype=int)
    print(f"\nCollected {len(y):,} shots from {n_players_used} players "
          f"({y.mean() * 100:.1f}% made).")

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42, stratify=y
    )

    pipeline = Pipeline([
        ("scaler", StandardScaler()),
        ("logreg", LogisticRegression(max_iter=1000)),
    ])
    pipeline.fit(X_train, y_train)

    predictions = pipeline.predict(X_test)
    probabilities = pipeline.predict_proba(X_test)[:, 1]
    accuracy = accuracy_score(y_test, predictions)
    loss = log_loss(y_test, probabilities)
    print(f"Test accuracy: {accuracy:.3f}    log-loss: {loss:.3f}")

    blob = {
        "pipeline": pipeline,
        "meta": {
            "season": SEASON,
            "n_players": n_players_used,
            "n_shots": int(len(y)),
            "base_make_rate": round(float(y.mean()), 4),
            "test_accuracy": round(float(accuracy), 4),
            "test_log_loss": round(float(loss), 4),
            "features": FEATURES,
        },
    }
    with open("xpts_model.pkl", "wb") as handle:
        pickle.dump(blob, handle)
    print("\nSaved xpts_model.pkl - restart app.py to load it.")


if __name__ == "__main__":
    main()
