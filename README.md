# NBA Shot Chart

A Flask web app for exploring NBA shot data. Pick a team, player, and game and
it draws every field-goal attempt on a half-court plot — then layers on
shooting stats, k-means "hot zones", a side-by-side game comparison, and an
expected-points (xPTS) model.

## Features

- **Shot chart** — made vs missed shots plotted on a half-court (Plotly).
- **Shot statistics** — FG%, 2PT/3PT splits, effective FG%, field-goal points,
  and a per-zone breakdown, all computed from the shots in the chart.
- **Compare two games** — render two games for the same player side by side,
  each with its own chart and stat panel.
- **Hot zones** — k-means clusters the shot locations into zones, each shaded
  red → green by its FG% and outlined with a convex hull.
- **xPTS (expected points)** — a logistic-regression model predicts every
  shot's make probability from its court location, giving expected points per
  shot and a "points vs expected" shot-quality number.

## Project structure

```
Project/
  app.py            Flask app + JSON API
  stats.py          shooting splits, eFG%, zone breakdown
  clustering.py     k-means hot zones + convex hulls
  model.py          loads and applies the trained xPTS model
  train_model.py    one-off script that trains xpts_model.pkl
  templates/
    index.html      page markup
  static/
    main.js         front-end logic (Plotly rendering + UI)
  requirements.txt
  out.csv           sample ShotChartDetail export (not used by the app)
```

## Setup

Requires **Python 3.11 or newer** (install from [python.org](https://www.python.org/downloads/)
and tick "Add Python to PATH" — do not use the Microsoft Store stub).

The `.venv/` folder shipped in the zip was built on another machine and will
not run here. Delete it and create a fresh one.

PowerShell (Windows):

```powershell
# from the Project folder
Remove-Item -Recurse -Force .venv

python -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
```

macOS / Linux:

```bash
rm -rf .venv
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

## Train the xPTS model

The expected-points feature needs a trained model. Run this once:

```bash
python train_model.py        # default: top 40 scorers of 2023-24
python train_model.py 60     # optional: use the top 60 scorers instead
```

It pulls each player's full 2023-24 regular-season shot data from the NBA API
(one request per player, so it takes a few minutes) and writes
`xpts_model.pkl`. The app loads that file automatically on startup.

The app runs fine without the model — the xPTS chart coloring and the
"expected points" stats simply stay switched off until `xpts_model.pkl` exists.

## Run

```bash
python app.py
```

Then open <http://localhost:5000>.

## API

| Endpoint | Returns |
|----------|---------|
| `GET /` | the page |
| `GET /api/roster?team_id&season` | players on a team for a season |
| `GET /api/games?player_id&season` | a player's games for a season |
| `GET /api/shots?team_id&player_id&game_id&season&k` | shots + stats + clusters + xPTS for one game (`k` = hot-zone count) |

## Notes and caveats

- **Data source:** the live NBA Stats API via the unofficial `nba_api`
  package. It is rate-limited — if a request fails, wait a moment and retry.
- **Field goals only:** `ShotChartDetail` contains no free throws, so the
  "points" stat and xPTS cover field goals only.
- **xPTS model:** a deliberately simple logistic regression on
  `(LOC_X, LOC_Y, SHOT_DISTANCE)`. It estimates make probability from *where*
  the shot was taken — it does not model defenders, shot clock, or game state.
- `app.py` runs with `debug=True` for local development. Turn that off before
  deploying anywhere public.
