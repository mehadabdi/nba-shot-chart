// static/main.js

/* ------------------------------- Elements -------------------------------- */

const teamSelect = document.getElementById("teamSelect");
const seasonSelect = document.getElementById("seasonSelect");
const playerSelect = document.getElementById("playerSelect");

const compareToggle = document.getElementById("compareToggle");
const singleGameRow = document.getElementById("singleGameRow");
const compareGameRow = document.getElementById("compareGameRow");

const gameSelect = document.getElementById("gameSelect");
const gameSelectA = document.getElementById("gameSelectA");
const gameSelectB = document.getElementById("gameSelectB");

const clusterToggle = document.getElementById("clusterToggle");
const kSelect = document.getElementById("kSelect");
const xptsToggle = document.getElementById("xptsToggle");
const xptsLabel = document.getElementById("xptsLabel");

const loadShotsBtn = document.getElementById("loadShotsBtn");
const modelStatus = document.getElementById("modelStatus");
const errorBox = document.getElementById("errorBox");

const singleView = document.getElementById("singleView");
const compareView = document.getElementById("compareView");

// Maps a render "slot" to its chart + stats-panel element ids.
const SLOTS = {
  single: { chart: "chart", panel: "statsPanel" },
  A: { chart: "chartA", panel: "statsPanelA" },
  B: { chart: "chartB", panel: "statsPanelB" },
};

// Last fetched response per slot, so display toggles can re-render without
// hitting the NBA API again.
const cache = { single: null, A: null, B: null };

/* ------------------------------- Helpers --------------------------------- */

function setError(msg) {
  errorBox.textContent = msg || "";
}

function setDisabled(el, disabled) {
  el.disabled = !!disabled;
}

function selectedText(selectEl) {
  const opt = selectEl.options[selectEl.selectedIndex];
  return opt ? opt.textContent.trim() : "";
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
  }[c]));
}

function clearSelect(selectEl, placeholderText) {
  selectEl.innerHTML = "";
  const opt = document.createElement("option");
  opt.value = "";
  opt.textContent = placeholderText;
  selectEl.appendChild(opt);
}

function fillSelect(selectEl, items, getValue, getLabel) {
  for (const item of items) {
    const opt = document.createElement("option");
    opt.value = String(getValue(item));
    opt.textContent = String(getLabel(item));
    selectEl.appendChild(opt);
  }
}

async function fetchJson(url) {
  const res = await fetch(url);
  const data = await res.json();
  if (!res.ok) {
    const msg = data && data.error ? data.error : `Request failed: ${res.status}`;
    throw new Error(msg);
  }
  if (data && data.error) throw new Error(data.error);
  return data;
}

function fetchShots(teamId, playerId, gameId, season, k) {
  const params = new URLSearchParams({
    team_id: teamId, player_id: playerId, game_id: gameId, season: season, k: k,
  });
  return fetchJson(`/api/shots?${params.toString()}`);
}

// Red -> yellow -> green ramp for hot-zone shading (0% .. 100% FG).
function pctColor(pct, alpha) {
  const t = Math.max(0, Math.min(1, (pct || 0) / 100));
  let r;
  let g;
  if (t < 0.5) {
    r = 255;
    g = Math.round(2 * t * 255);
  } else {
    r = Math.round((1 - 2 * (t - 0.5)) * 255);
    g = 255;
  }
  return `rgba(${r}, ${g}, 60, ${alpha})`;
}

/* ----------------------------- Court Overlay ----------------------------- */

function getHalfCourtShapes() {
  const shapes = [];

  // Hoop
  shapes.push({ type: "circle", xref: "x", yref: "y", x0: -7.5, x1: 7.5, y0: -7.5, y1: 7.5, line: { width: 2 } });

  // Backboard
  shapes.push({ type: "line", xref: "x", yref: "y", x0: -30, x1: 30, y0: -12.5, y1: -12.5, line: { width: 2 } });

  // Baseline
  shapes.push({ type: "line", xref: "x", yref: "y", x0: -250, x1: 250, y0: -47.5, y1: -47.5, line: { width: 2 } });

  // Outer paint
  shapes.push({ type: "rect", xref: "x", yref: "y", x0: -80, x1: 80, y0: -47.5, y1: 142.5, line: { width: 2 } });

  // Inner paint
  shapes.push({ type: "rect", xref: "x", yref: "y", x0: -60, x1: 60, y0: -47.5, y1: 142.5, line: { width: 2 } });

  // Free throw circle (full circle; simple + clean)
  shapes.push({ type: "circle", xref: "x", yref: "y", x0: -60, x1: 60, y0: 82.5, y1: 202.5, line: { width: 2 } });

  // Restricted area (dotted)
  shapes.push({ type: "circle", xref: "x", yref: "y", x0: -40, x1: 40, y0: -40, y1: 40, line: { width: 2, dash: "dot" } });

  // 3PT corners
  shapes.push({ type: "line", xref: "x", yref: "y", x0: -220, x1: -220, y0: -47.5, y1: 92.5, line: { width: 2 } });
  shapes.push({ type: "line", xref: "x", yref: "y", x0: 220, x1: 220, y0: -47.5, y1: 92.5, line: { width: 2 } });

  // 3PT arc (approximated with a path)
  const r = 237.5;
  const aStart = (22 * Math.PI) / 180;
  const aEnd = (158 * Math.PI) / 180;
  const n = 70;

  let path = "";
  for (let i = 0; i <= n; i++) {
    const t = aStart + ((aEnd - aStart) * i) / n;
    const x = r * Math.cos(t);
    const y = r * Math.sin(t);
    path += i === 0 ? `M ${x} ${y}` : ` L ${x} ${y}`;
  }
  shapes.push({ type: "path", xref: "x", yref: "y", path, line: { width: 2 } });

  return shapes;
}

/* ------------------------- Hot-zone (cluster) layer ----------------------- */

function buildClusterShapes(clusters) {
  const shapes = [];
  for (const c of clusters) {
    const fill = pctColor(c.fg_pct, 0.22);
    const stroke = pctColor(c.fg_pct, 0.9);

    if (c.hull && c.hull.length >= 3) {
      let path = "";
      c.hull.forEach((pt, i) => {
        path += i === 0 ? `M ${pt[0]} ${pt[1]}` : ` L ${pt[0]} ${pt[1]}`;
      });
      path += " Z";
      shapes.push({
        type: "path", xref: "x", yref: "y", path, layer: "below",
        fillcolor: fill, line: { width: 1.5, color: stroke },
      });
    } else {
      // 1-2 shot cluster: draw a small disc at the centroid instead of a hull.
      const [cx, cy] = c.centroid;
      const radius = 28;
      shapes.push({
        type: "circle", xref: "x", yref: "y", layer: "below",
        x0: cx - radius, x1: cx + radius, y0: cy - radius, y1: cy + radius,
        fillcolor: fill, line: { width: 1.5, color: stroke },
      });
    }
  }
  return shapes;
}

function buildClusterAnnotations(clusters) {
  return clusters.map((c) => ({
    x: c.centroid[0],
    y: c.centroid[1],
    text: `${c.fg_pct}%<br>${c.fgm}/${c.fga}`,
    showarrow: false,
    font: { size: 11, color: "#111" },
    bgcolor: "rgba(255,255,255,0.75)",
    borderpad: 2,
  }));
}

/* ------------------------------ Shot chart ------------------------------- */

function shotHoverText(shot) {
  let text = `${shot.action_type || "Shot"}<br>${shot.shot_type}, ${shot.shot_distance} ft`;
  if (shot.zone) text += `<br>${shot.zone}`;
  if (typeof shot.prob_make === "number") {
    text += `<br>P(make): ${(shot.prob_make * 100).toFixed(0)}%`;
    text += ` &middot; xPTS: ${shot.xpts.toFixed(2)}`;
  }
  return text;
}

function buildMarker(symbol, size, solidColor, shots, useXpts) {
  if (useXpts) {
    return {
      symbol: symbol,
      size: size,
      color: shots.map((s) => (typeof s.prob_make === "number" ? s.prob_make : 0)),
      coloraxis: "coloraxis",
      line: { width: 1, color: "#333" },
    };
  }
  return { symbol: symbol, size: size, color: solidColor, line: { width: 1, color: "#fff" } };
}

function buildShotTraces(shots, useXpts) {
  const made = shots.filter((s) => s.made);
  const missed = shots.filter((s) => !s.made);

  const missedTrace = {
    x: missed.map((s) => s.x),
    y: missed.map((s) => s.y),
    mode: "markers",
    type: "scatter",
    name: `Missed (${missed.length})`,
    marker: buildMarker("x", 10, "#d62828", missed, useXpts),
    text: missed.map(shotHoverText),
    hovertemplate: "%{text}<extra></extra>",
  };

  const madeTrace = {
    x: made.map((s) => s.x),
    y: made.map((s) => s.y),
    mode: "markers",
    type: "scatter",
    name: `Made (${made.length})`,
    marker: buildMarker("circle", 11, "#1f9d3a", made, useXpts),
    text: made.map(shotHoverText),
    hovertemplate: "%{text}<extra></extra>",
  };

  return [missedTrace, madeTrace];
}

function renderChart(divId, data, title, opts) {
  const shots = data.shots || [];
  const useXpts = opts.useXpts && data.xpts && data.xpts.model_loaded && shots.length > 0;

  const shapes = getHalfCourtShapes();
  let annotations = [];
  if (opts.showClusters && data.clusters && data.clusters.length) {
    shapes.push(...buildClusterShapes(data.clusters));
    annotations = buildClusterAnnotations(data.clusters);
  }

  const layout = {
    title: { text: title, font: { size: 13 }, x: 0.5, xanchor: "center" },
    xaxis: { range: [-250, 250], showgrid: false, zeroline: false, visible: false },
    yaxis: {
      range: [-60, 470],
      showgrid: false,
      zeroline: false,
      visible: false,
      scaleanchor: "x",
      scaleratio: 1,
    },
    // Floated into the empty top-left of the court so it never collides
    // with the title or the colorbar.
    legend: {
      x: 0.02,
      y: 0.98,
      xanchor: "left",
      yanchor: "top",
      bgcolor: "rgba(255,255,255,0.75)",
      bordercolor: "#ddd",
      borderwidth: 1,
    },
    margin: { l: 10, r: useXpts ? 72 : 10, t: 44, b: 10 },
    shapes: shapes,
    annotations: annotations,
    plot_bgcolor: "white",
    paper_bgcolor: "white",
  };

  if (useXpts) {
    layout.coloraxis = {
      // Explicit red -> yellow -> green ramp ("RdYlGn" is not a built-in
      // Plotly.js colorscale name).
      colorscale: [
        [0.0, "#d62828"],
        [0.5, "#f4d35e"],
        [1.0, "#1f9d3a"],
      ],
      cmin: 0,
      cmax: 1,
      colorbar: { title: { text: "P(make)", side: "right" }, thickness: 12, len: 0.6 },
    };
  }

  Plotly.newPlot(divId, buildShotTraces(shots, useXpts), layout, {
    responsive: true,
    displayModeBar: false,
  });
}

/* ------------------------------ Stats panel ------------------------------ */

function renderStats(panelId, data, label) {
  const panel = document.getElementById(panelId);
  const stats = data.stats;

  if (!stats || stats.fga === 0) {
    panel.innerHTML = `<h3 class="stat-title">${escapeHtml(label)}</h3>`
      + `<p class="muted">No shots recorded for this game.</p>`;
    return;
  }

  const xpts = data.xpts || {};
  let xptsRows;
  if (xpts.model_loaded) {
    const diff = xpts.pts_above_expected;
    const cls = diff > 0 ? "pos" : diff < 0 ? "neg" : "";
    const sign = diff > 0 ? "+" : "";
    xptsRows =
      `<tr><td>Expected points (xPTS)</td><td class="num">${xpts.total_xpts.toFixed(1)}</td></tr>`
      + `<tr><td>Points vs expected</td><td class="num ${cls}">${sign}${diff.toFixed(1)}</td></tr>`;
  } else {
    xptsRows = `<tr><td>Expected points (xPTS)</td>`
      + `<td class="num muted">model not trained</td></tr>`;
  }

  const zoneRows = stats.zones
    .map(
      (z) =>
        `<tr><td>${escapeHtml(z.zone)}</td>`
        + `<td class="num">${z.fgm}/${z.fga}</td>`
        + `<td class="num">${z.fg_pct}%</td></tr>`
    )
    .join("");

  panel.innerHTML = `
    <h3 class="stat-title">${escapeHtml(label)}</h3>
    <table class="stats">
      <tr><td>Field goals</td><td class="num">${stats.fgm}/${stats.fga} &nbsp; ${stats.fg_pct}%</td></tr>
      <tr><td>2-pointers</td><td class="num">${stats.fg2m}/${stats.fg2a} &nbsp; ${stats.fg2_pct}%</td></tr>
      <tr><td>3-pointers</td><td class="num">${stats.fg3m}/${stats.fg3a} &nbsp; ${stats.fg3_pct}%</td></tr>
      <tr><td>Effective FG%</td><td class="num">${stats.efg_pct}%</td></tr>
      <tr><td>Points (field goals)</td><td class="num">${stats.points}</td></tr>
      ${xptsRows}
    </table>
    <h4 class="stat-title" style="margin-top: 14px;">By zone</h4>
    <table class="stats">
      <tr><th>Zone</th><th class="num">FGM/FGA</th><th class="num">FG%</th></tr>
      ${zoneRows}
    </table>`;
}

/* -------------------------------- Render --------------------------------- */

function currentOpts() {
  return { showClusters: clusterToggle.checked, useXpts: !!(xptsToggle && xptsToggle.checked) };
}

function renderSlot(slot, data, label) {
  const ids = SLOTS[slot];
  renderChart(ids.chart, data, label, currentOpts());
  renderStats(ids.panel, data, label);
}

// Re-draw whatever is cached (used when a display toggle changes).
function rerenderFromCache() {
  if (compareToggle.checked) {
    if (cache.A) renderSlot("A", cache.A.data, cache.A.label);
    if (cache.B) renderSlot("B", cache.B.data, cache.B.label);
  } else if (cache.single) {
    renderSlot("single", cache.single.data, cache.single.label);
  }
}

function purgeAllCharts() {
  for (const id of ["chart", "chartA", "chartB"]) {
    if (document.getElementById(id)) Plotly.purge(id);
  }
}

function resizeVisibleCharts() {
  const ids = compareToggle.checked ? ["chartA", "chartB"] : ["chart"];
  for (const id of ids) {
    const el = document.getElementById(id);
    if (el && el.data) Plotly.Plots.resize(el);
  }
}

/* ------------------------------ App workflow ----------------------------- */

function updateButtonState() {
  const ready = compareToggle.checked
    ? !!(gameSelectA.value && gameSelectB.value)
    : !!gameSelect.value;
  setDisabled(loadShotsBtn, !ready);
}

function applyMode() {
  const compare = compareToggle.checked;
  singleGameRow.classList.toggle("hidden", compare);
  compareGameRow.classList.toggle("hidden", !compare);
  singleView.classList.toggle("hidden", compare);
  compareView.classList.toggle("hidden", !compare);
  setError("");
  updateButtonState();
  resizeVisibleCharts();
}

function resetAfterTeamOrSeason() {
  clearSelect(playerSelect, "Select a player");
  [gameSelect, gameSelectA, gameSelectB].forEach((s) => clearSelect(s, "Select a game"));
  [playerSelect, gameSelect, gameSelectA, gameSelectB].forEach((s) => setDisabled(s, true));
  cache.single = cache.A = cache.B = null;
  setError("");
  purgeAllCharts();
  updateButtonState();
}

function resetAfterPlayer() {
  [gameSelect, gameSelectA, gameSelectB].forEach((s) => clearSelect(s, "Select a game"));
  [gameSelect, gameSelectA, gameSelectB].forEach((s) => setDisabled(s, true));
  cache.single = cache.A = cache.B = null;
  setError("");
  purgeAllCharts();
  updateButtonState();
}

async function loadRoster() {
  resetAfterTeamOrSeason();

  const teamId = teamSelect.value;
  const season = seasonSelect.value;
  if (!teamId) return;

  clearSelect(playerSelect, "Loading roster...");

  try {
    const data = await fetchJson(
      `/api/roster?team_id=${encodeURIComponent(teamId)}&season=${encodeURIComponent(season)}`
    );
    clearSelect(playerSelect, "Select a player");
    fillSelect(playerSelect, data.players || [], (p) => p.id, (p) => p.full_name);
    setDisabled(playerSelect, false);

    if (!data.players || data.players.length === 0) {
      setError("Roster returned empty. Try a different season.");
    }
  } catch (e) {
    clearSelect(playerSelect, "Select a player");
    setError(e.message);
  }
}

async function loadGames() {
  resetAfterPlayer();

  const playerId = playerSelect.value;
  const season = seasonSelect.value;
  if (!playerId) return;

  const gameSelects = [gameSelect, gameSelectA, gameSelectB];
  gameSelects.forEach((s) => clearSelect(s, "Loading games..."));

  try {
    const data = await fetchJson(
      `/api/games?player_id=${encodeURIComponent(playerId)}&season=${encodeURIComponent(season)}`
    );
    const games = data.games || [];
    gameSelects.forEach((s) => {
      clearSelect(s, "Select a game");
      fillSelect(
        s,
        games,
        (g) => g.game_id,
        (g) => `${g.game_date} — ${g.matchup}${g.wl ? ` (${g.wl})` : ""}`
      );
      setDisabled(s, false);
    });

    if (games.length === 0) setError("No games returned for that player/season.");
  } catch (e) {
    gameSelects.forEach((s) => clearSelect(s, "Select a game"));
    setError(e.message);
  }
}

async function loadShotsAndRender() {
  setError("");

  const teamId = teamSelect.value;
  const season = seasonSelect.value;
  const playerId = playerSelect.value;
  const playerName = selectedText(playerSelect) || "Player";
  const k = kSelect.value;

  if (!teamId || !playerId) {
    setError("Pick a team and player first.");
    return;
  }

  const compare = compareToggle.checked;
  const restoreLabel = loadShotsBtn.textContent;
  setDisabled(loadShotsBtn, true);
  loadShotsBtn.textContent = "Loading...";

  try {
    if (!compare) {
      const gameId = gameSelect.value;
      if (!gameId) {
        setError("Pick a game first.");
        return;
      }
      const data = await fetchShots(teamId, playerId, gameId, season, k);
      const label = `${playerName} — ${selectedText(gameSelect)}`;
      cache.single = { data, label };
      renderSlot("single", data, label);
      reportDataNotes([data]);
    } else {
      const gameA = gameSelectA.value;
      const gameB = gameSelectB.value;
      if (!gameA || !gameB) {
        setError("Pick both Game A and Game B.");
        return;
      }
      const [dataA, dataB] = await Promise.all([
        fetchShots(teamId, playerId, gameA, season, k),
        fetchShots(teamId, playerId, gameB, season, k),
      ]);
      const labelA = `${playerName} — ${selectedText(gameSelectA)}`;
      const labelB = `${playerName} — ${selectedText(gameSelectB)}`;
      cache.A = { data: dataA, label: labelA };
      cache.B = { data: dataB, label: labelB };
      renderSlot("A", dataA, labelA);
      renderSlot("B", dataB, labelB);
      reportDataNotes([dataA, dataB]);
    }
  } catch (e) {
    setError(e.message);
  } finally {
    loadShotsBtn.textContent = restoreLabel;
    updateButtonState();
  }
}

// Surface non-fatal notes after a successful render (empty games, missing
// scikit-learn for the hot-zone feature).
function reportDataNotes(responses) {
  const notes = [];
  if (responses.some((d) => (d.shots || []).length === 0)) {
    notes.push("A selected game returned no shots.");
  }
  if (clusterToggle.checked && responses.some((d) => d.clustering_available === false)) {
    notes.push("Hot zones need scikit-learn (pip install -r requirements.txt).");
  }
  setError(notes.join("\n"));
}

/* --------------------------------- Events -------------------------------- */

teamSelect.addEventListener("change", loadRoster);
seasonSelect.addEventListener("change", loadRoster);
playerSelect.addEventListener("change", loadGames);

gameSelect.addEventListener("change", updateButtonState);
gameSelectA.addEventListener("change", updateButtonState);
gameSelectB.addEventListener("change", updateButtonState);

compareToggle.addEventListener("change", applyMode);

clusterToggle.addEventListener("change", rerenderFromCache);
if (xptsToggle) xptsToggle.addEventListener("change", rerenderFromCache);

// Cluster count is computed server-side, so changing k needs a refetch.
kSelect.addEventListener("change", () => {
  const hasData = compareToggle.checked ? cache.A && cache.B : cache.single;
  if (hasData) loadShotsAndRender();
});

loadShotsBtn.addEventListener("click", loadShotsAndRender);

/* --------------------------------- Init ---------------------------------- */

function initModelStatus() {
  if (window.MODEL_LOADED) {
    modelStatus.textContent = "xPTS model: loaded";
  } else {
    modelStatus.textContent = "";
    if (xptsToggle) { xptsToggle.checked = false; xptsToggle.disabled = true; }
    if (xptsLabel) xptsLabel.classList.add("disabled");
  }
}

initModelStatus();
resetAfterTeamOrSeason();
applyMode();
