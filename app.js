"use strict";

const STORAGE_KEY = "woodmanCDartsDataV2";
const ACTIVE_KEY = "woodmanCDartsActiveMatchV2";
const LEGACY_STORAGE_KEYS = ["woodmanCDartsDataV1", "woodmanCDartsActiveMatchV1"];
const DEFAULT_ROSTER_VERSION = 1;
const DEFAULT_PLAYER_NAMES = ["Dima", "Steve", "Oscar", "Karen", "Nik", "Norman", "Rob S", "Rob M", "Trevor", "Gareth"];

const blankStats = () => ({ band40: 0, band75: 0, band100: 0, band140: 0, band180: 0 });
const initialData = () => ({ profiles: [], history: [], rosterSeedVersion: 0 });

LEGACY_STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));

let data = loadJSON(STORAGE_KEY, initialData());
let match = loadJSON(ACTIVE_KEY, null);
let entry = "";
let pendingCheckout = null;
let selectedMatchId = null;
let selectedProfileId = null;
let detailBackView = "history";
let selectedVisitIndex = null;

if (!Array.isArray(data.profiles)) data.profiles = [];
if (!Array.isArray(data.history)) data.history = [];
if ((Number(data.rosterSeedVersion) || 0) < DEFAULT_ROSTER_VERSION) {
  const existingNames = new Set(data.profiles.map((profile) => String(profile.name).trim().toLowerCase()));
  DEFAULT_PLAYER_NAMES.forEach((name, index) => {
    if (existingNames.has(name.toLowerCase())) return;
    data.profiles.push({
      id: `default-player-${index + 1}-${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`,
      name,
      createdAt: new Date().toISOString(),
      builtIn: true
    });
  });
  data.rosterSeedVersion = DEFAULT_ROSTER_VERSION;
  saveData();
}
if (match) {
  match.stats = { ...blankStats(), ...(match.stats || {}) };
  match.visits = Array.isArray(match.visits) ? match.visits : [];
  match.undo = Array.isArray(match.undo) ? match.undo : [];
  match.opponentName = match.opponentName || "Opponent";
  match.mode = match.mode || "opponent";
}

const $ = (id) => document.getElementById(id);
const setupView = $("setupView");
const gameView = $("gameView");
const historyView = $("historyView");
const detailView = $("detailView");
const editView = $("editView");
const profileView = $("profileView");
const playerSelect = $("playerSelect");
const newPlayerName = $("newPlayerName");
const setupMessage = $("setupMessage");
const gameMessage = $("gameMessage");
const opponentDialog = $("opponentDialog");
const checkoutDialog = $("checkoutDialog");
const legEndDialog = $("legEndDialog");
const resultDialog = $("resultDialog");
const editVisitDialog = $("editVisitDialog");

function loadJSON(key, fallback) {
  try {
    const value = JSON.parse(localStorage.getItem(key));
    return value ?? fallback;
  } catch {
    return fallback;
  }
}

function saveData() { localStorage.setItem(STORAGE_KEY, JSON.stringify(data)); }
function saveMatch() {
  if (match) localStorage.setItem(ACTIVE_KEY, JSON.stringify(match));
  else localStorage.removeItem(ACTIVE_KEY);
}

function escapeHTML(value) {
  return String(value).replace(/[&<>'"]/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function makeId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function setView(name) {
  const views = { setup: setupView, game: gameView, history: historyView, detail: detailView, edit: editView, profile: profileView };
  Object.entries(views).forEach(([viewName, element]) => element.classList.toggle("active", viewName === name));
  if (name === "setup") renderSetup();
  if (name === "game") renderMatch();
  if (name === "history") renderHistory();
  if (name === "detail") renderMatchDetail();
  if (name === "profile") renderProfileStats();
  window.scrollTo({ top: 0, behavior: "instant" });
}

function formatDate(value, includeTime = false) {
  if (!value) return "Date not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date not recorded";
  return date.toLocaleString(undefined, includeTime
    ? { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }
    : { day: "numeric", month: "short", year: "numeric" });
}

function getRecordStats(item) {
  const scoreVisits = Array.isArray(item.scoreVisits) ? item.scoreVisits : [];
  const points = Number.isFinite(item.points) ? item.points : scoreVisits.reduce((sum, visit) => sum + (Number(visit.score) || 0), 0);
  const darts = Number.isFinite(item.darts) ? item.darts : (scoreVisits.length ? scoreVisits.reduce((sum, visit) => sum + (Number(visit.darts) || 0), 0) : null);
  const visits = Number.isFinite(item.visits) ? item.visits : scoreVisits.length;
  const average = Number.isFinite(item.average) ? item.average : (darts ? (points / darts) * 3 : 0);
  const highestVisit = Number.isFinite(item.highestVisit) ? item.highestVisit : (scoreVisits.length ? Math.max(...scoreVisits.map((visit) => Number(visit.score) || 0)) : null);
  return { points, darts, visits, average, highestVisit };
}

function historyItemHTML(item) {
  const totals = getRecordStats(item);
  const isPractice = item.mode === "practice";
  const won = item.playerLegs > item.opponentLegs;
  return `<button class="history-item" type="button" data-match-id="${escapeHTML(item.id)}">
    <div><strong>${escapeHTML(item.playerName)}</strong><span>${isPractice ? "Practice" : `v ${escapeHTML(item.opponentName || "Opponent")}`} · Avg ${totals.average.toFixed(2)}</span></div>
    <div class="history-result">${isPractice ? `${totals.visits} visits` : `${item.playerLegs}–${item.opponentLegs}`}<span>${isPractice ? "PRACTICE" : won ? "WIN" : "LOSS"}</span></div>
  </button>`;
}

function historyGroupsHTML(records) {
  const groups = new Map();
  records.forEach((item) => {
    const date = new Date(item.finishedAt);
    const key = Number.isNaN(date.getTime()) ? "unknown" : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  });
  return [...groups.values()].map((items) => `<section class="history-day"><h3>${formatDate(items[0].finishedAt)}</h3><div class="history-day-results">${items.map(historyItemHTML).join("")}</div></section>`).join("");
}

function resultCategoryGroupsHTML(records) {
  const groups = new Map();
  records.forEach((item) => {
    const date = new Date(item.finishedAt);
    const dayKey = Number.isNaN(date.getTime()) ? "unknown" : `${date.getFullYear()}-${date.getMonth()}-${date.getDate()}`;
    const opponent = item.mode === "practice" ? "Practice" : (item.opponentName || "Opponent");
    const key = `${opponent.trim().toLowerCase()}|${dayKey}`;
    if (!groups.has(key)) groups.set(key, { opponent, date: item.finishedAt, items: [] });
    groups.get(key).items.push(item);
  });
  return [...groups.values()].map((group, index) => `<details class="result-category" ${index === 0 ? "open" : ""}>
    <summary><span class="result-category-title">${escapeHTML(group.opponent)} <small>· ${formatDate(group.date)}</small></span><span class="result-category-count">${group.items.length} ${group.items.length === 1 ? "result" : "results"}</span></summary>
    <div class="result-category-results">${group.items.map(historyItemHTML).join("")}</div>
  </details>`).join("");
}

function newestFirst(records) {
  return [...records].sort((a, b) => (new Date(b.finishedAt).getTime() || 0) - (new Date(a.finishedAt).getTime() || 0));
}

function attachHistoryListeners(container, backView = "history") {
  container.querySelectorAll("[data-match-id]").forEach((button) => button.addEventListener("click", () => openMatchDetail(button.dataset.matchId, backView)));
}

function selectedMode() {
  return document.querySelector('input[name="matchMode"]:checked')?.value || "";
}

function updateStartAvailability() {
  const mode = selectedMode();
  $("opponentFields").hidden = mode !== "opponent";
  $("startMatchButton").textContent = mode === "practice" ? "Start practice" : "Start match";
  $("startMatchButton").disabled = !data.profiles.length || !mode || (mode === "opponent" && !$("opponentName").value.trim());
}

function renderSetup() {
  const current = playerSelect.value;
  playerSelect.innerHTML = data.profiles.length
    ? data.profiles.map((p) => `<option value="${p.id}">${escapeHTML(p.name)}</option>`).join("")
    : '<option value="">Add a player first</option>';
  if (data.profiles.some((p) => p.id === current)) playerSelect.value = current;
  $("deletePlayerButton").disabled = !data.profiles.length;
  $("playerStatsButton").disabled = !data.profiles.length;
  updateStartAvailability();

  $("historyList").innerHTML = data.history.length
    ? historyGroupsHTML(newestFirst(data.history).slice(0, 5))
    : '<p class="empty-state">Completed matches will appear here.</p>';
  attachHistoryListeners($("historyList"), "setup");
}

function addPlayer() {
  const name = newPlayerName.value.trim();
  if (!name) return showSetupMessage("Enter a player name.");
  if (data.profiles.some((p) => p.name.toLowerCase() === name.toLowerCase())) return showSetupMessage("That player already exists.");
  const profile = { id: makeId(), name, createdAt: new Date().toISOString() };
  data.profiles.push(profile);
  saveData();
  newPlayerName.value = "";
  renderSetup();
  playerSelect.value = profile.id;
  showSetupMessage("");
}

function deletePlayer() {
  const id = playerSelect.value;
  const profile = data.profiles.find((p) => p.id === id);
  if (!profile || !confirm(`Delete ${profile.name}'s profile? Match history will be kept.`)) return;
  data.profiles = data.profiles.filter((p) => p.id !== id);
  saveData();
  renderSetup();
}

function renderHistory() {
  const filter = $("historyPlayerFilter");
  const current = filter.value;
  filter.innerHTML = '<option value="">All players</option>' + data.profiles
    .map((profile) => `<option value="${profile.id}">${escapeHTML(profile.name)}</option>`).join("");
  if (data.profiles.some((profile) => profile.id === current)) filter.value = current;
  const records = newestFirst(data.history.filter((item) => !filter.value || item.profileId === filter.value));
  $("allHistoryList").innerHTML = records.length
    ? resultCategoryGroupsHTML(records)
    : '<p class="empty-state">No completed matches for this player yet.</p>';
  attachHistoryListeners($("allHistoryList"));
}

function openMatchDetail(id, backView = "history") {
  selectedMatchId = id;
  detailBackView = backView;
  setView("detail");
}

function valueHTML(label, value) {
  return `<div class="metric"><span>${label}</span><strong>${value}</strong></div>`;
}

function deriveLegs(item) {
  if (Array.isArray(item.legs) && item.legs.length) return item.legs;
  if (!Array.isArray(item.scoreVisits) || !item.scoreVisits.length) return [];
  const grouped = new Map();
  item.scoreVisits.forEach((visit) => {
    const legNumber = Number(visit.leg) || 1;
    if (!grouped.has(legNumber)) grouped.set(legNumber, []);
    grouped.get(legNumber).push(visit);
  });
  return [...grouped.entries()].map(([number, visits]) => {
    const points = visits.reduce((sum, visit) => sum + (Number(visit.score) || 0), 0);
    const darts = visits.reduce((sum, visit) => sum + (Number(visit.darts) || 0), 0);
    return { number, points, darts, visits: visits.length, average: darts ? (points / darts) * 3 : 0, highestVisit: Math.max(...visits.map((visit) => Number(visit.score) || 0)), won: visits.some((visit) => visit.checkout) };
  });
}

function visitTimeline(item) {
  if (!Array.isArray(item.scoreVisits) || !item.scoreVisits.length) return [];
  const remainingByLeg = new Map();
  const visitNumberByLeg = new Map();
  return item.scoreVisits.map((visit, index) => {
    const leg = Number(visit.leg) || 1;
    const before = remainingByLeg.has(leg) ? remainingByLeg.get(leg) : 501;
    const remaining = before - (Number(visit.score) || 0);
    const number = (visitNumberByLeg.get(leg) || 0) + 1;
    remainingByLeg.set(leg, remaining);
    visitNumberByLeg.set(leg, number);
    return { ...visit, index, leg, number, before, remaining };
  });
}

function visitsHTML(item) {
  const timeline = visitTimeline(item);
  if (!timeline.length) return '<p class=\"empty-state compact\">Visit-by-visit data was not stored for this older match.</p>';
  const groups = new Map();
  timeline.forEach((visit) => {
    if (!groups.has(visit.leg)) groups.set(visit.leg, []);
    groups.get(visit.leg).push(visit);
  });
  return [...groups.entries()].map(([leg, visits]) => `<section class='visit-leg'><h4>Leg ${leg}</h4><div class='visit-list'>${visits.map((visit) => `
    <button class='visit-row' type='button' data-visit-index='${visit.index}'>
      <span><small>Visit ${visit.number}</small><strong>${visit.score}</strong></span>
      <span><small>${visit.darts} ${visit.darts === 1 ? 'dart' : 'darts'}${visit.checkout ? ' · checkout' : ''}</small><strong class='${visit.remaining < 0 ? 'invalid-remaining' : ''}'>${visit.remaining} left</strong></span>
    </button>`).join('')}</div></section>`).join('');
}

function attachVisitListeners() {
  $("matchDetail").querySelectorAll("[data-visit-index]").forEach((button) => button.addEventListener("click", () => openVisitEditor(Number(button.dataset.visitIndex))));
}

function openVisitEditor(index) {
  const item = data.history.find((record) => record.id === selectedMatchId);
  const visit = item ? visitTimeline(item).find((entry) => entry.index === index) : null;
  if (!visit) return;
  selectedVisitIndex = index;
  $("editVisitTitle").textContent = `Leg ${visit.leg} · Visit ${visit.number}`;
  $("editVisitContext").textContent = `${visit.before} before · ${visit.remaining} left`;
  $("editVisitScore").value = visit.score;
  $("editVisitDarts").value = String(visit.darts || 3);
  $("editVisitMessage").textContent = "";
  editVisitDialog.showModal();
  $("editVisitScore").select();
}

function recalculateFromVisits(item) {
  const visits = item.scoreVisits;
  const points = visits.reduce((sum, visit) => sum + Number(visit.score), 0);
  const darts = visits.reduce((sum, visit) => sum + Number(visit.darts), 0);
  item.points = points;
  item.darts = darts;
  item.visits = visits.length;
  item.average = darts ? (points / darts) * 3 : 0;
  item.highestVisit = visits.length ? Math.max(...visits.map((visit) => Number(visit.score))) : 0;
  item.stats = visits.reduce((stats, visit) => {
    const band = classify(Number(visit.score));
    if (band) stats[band] += 1;
    return stats;
  }, blankStats());
  const previousLegs = new Map((item.legs || []).map((leg) => [Number(leg.number), leg]));
  const grouped = new Map();
  visits.forEach((visit) => {
    const leg = Number(visit.leg) || 1;
    if (!grouped.has(leg)) grouped.set(leg, []);
    grouped.get(leg).push(visit);
  });
  item.legs = [...grouped.entries()].map(([number, legVisits]) => {
    const legPoints = legVisits.reduce((sum, visit) => sum + Number(visit.score), 0);
    const legDarts = legVisits.reduce((sum, visit) => sum + Number(visit.darts), 0);
    return {
      number, points: legPoints, darts: legDarts, visits: legVisits.length,
      average: legDarts ? (legPoints / legDarts) * 3 : 0,
      highestVisit: Math.max(...legVisits.map((visit) => Number(visit.score))),
      won: previousLegs.get(number)?.won ?? (legVisits.some((visit) => visit.checkout) ? true : null)
    };
  });
  item.editedAt = new Date().toISOString();
}

function saveVisitEdit(event) {
  event.preventDefault();
  const item = data.history.find((record) => record.id === selectedMatchId);
  if (!item || selectedVisitIndex == null || !item.scoreVisits?.[selectedVisitIndex]) {
    editVisitDialog.close();
    return;
  }
  const score = Number($("editVisitScore").value);
  const darts = Number($("editVisitDarts").value);
  if (!Number.isInteger(score) || score < 0 || score > 180) {
    $("editVisitMessage").textContent = "Enter a score from 0 to 180.";
    return;
  }
  const candidateVisits = item.scoreVisits.map((visit, index) => index === selectedVisitIndex ? { ...visit, score, darts } : visit);
  const editedLeg = Number(candidateVisits[selectedVisitIndex].leg) || 1;
  let remaining = 501;
  for (const visit of candidateVisits.filter((entry) => (Number(entry.leg) || 1) === editedLeg)) {
    if (Number(visit.score) > remaining) {
      $("editVisitMessage").textContent = "That change would make a later visit go below zero.";
      return;
    }
    remaining -= Number(visit.score);
  }
  item.scoreVisits = candidateVisits;
  recalculateFromVisits(item);
  saveData();
  editVisitDialog.close();
  selectedVisitIndex = null;
  renderMatchDetail();
}

function renderMatchDetail() {
  const item = data.history.find((record) => record.id === selectedMatchId);
  if (!item) return setView("history");
  const totals = getRecordStats(item);
  const stats = { ...blankStats(), ...(item.stats || {}) };
  const legs = deriveLegs(item);
  const isPractice = item.mode === "practice";
  const result = isPractice ? "Practice" : item.playerLegs > item.opponentLegs ? "Win" : "Loss";
  $("detailTitle").textContent = isPractice ? `${item.playerName} practice` : `${item.playerName} v ${item.opponentName || "Opponent"}`;
  $("detailView").querySelector("[data-back]").dataset.back = detailBackView;
  $("matchDetail").innerHTML = `
    <section class="card detail-hero">
      <div><span class="result-badge ${result.toLowerCase()}">${result}</span><h3>${isPractice ? `${escapeHTML(item.playerName)} practice session` : `${escapeHTML(item.playerName)} <strong>${item.playerLegs}–${item.opponentLegs}</strong> ${escapeHTML(item.opponentName || "Opponent")}`}</h3><p>${formatDate(item.finishedAt, true)}</p></div>
      <div class="average-callout"><span>Match average</span><strong>${totals.average.toFixed(2)}</strong></div>
    </section>
    <button id="editPastMatchButton" class="secondary-button edit-result-button" type="button">Edit this result</button>
    <section class="detail-grid">
      ${valueHTML("Darts thrown", totals.darts == null ? "Not recorded" : totals.darts)}
      ${valueHTML("Total scored", totals.points)}
      ${valueHTML("Highest visit", totals.highestVisit == null ? "Not recorded" : totals.highestVisit)}
      ${valueHTML("Scoring visits", totals.visits)}
    </section>
    <section class="card detail-section visit-section"><div class="visit-heading"><h3>Visits</h3><p>Tap a visit to change it. Later remaining scores update automatically.</p></div>${visitsHTML(item)}</section>
    <section class="card detail-section"><h3>Visit bands</h3><div class="band-grid">
      ${valueHTML("40–74", stats.band40)}${valueHTML("75–99", stats.band75)}${valueHTML("100–139", stats.band100)}${valueHTML("140–179", stats.band140)}${valueHTML("180", stats.band180)}
    </div></section>
    <section class="card detail-section"><h3>Leg breakdown</h3>
      ${legs.length ? `<div class="leg-list">${legs.map((leg) => `<div class="leg-row"><div><strong>Leg ${leg.number}</strong><span>${leg.won === true ? "Won" : leg.won === false ? "Lost" : "Result not recorded"}</span></div><div><strong>${Number(leg.average || 0).toFixed(2)} avg</strong><span>${leg.points} scored · ${leg.darts} darts · High ${leg.highestVisit ?? "—"}</span></div></div>`).join("")}</div>` : '<p class="empty-state compact">Per-leg data was not stored for this older match.</p>'}
    </section>`;
  $("editPastMatchButton").addEventListener("click", openEditMatch);
  attachVisitListeners();
}

function toDateTimeLocal(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000);
  return local.toISOString().slice(0, 16);
}

function openEditMatch() {
  const item = data.history.find((record) => record.id === selectedMatchId);
  if (!item) return;
  const totals = getRecordStats(item);
  const stats = { ...blankStats(), ...(item.stats || {}) };
  $("editFinishedAt").value = toDateTimeLocal(item.finishedAt);
  $("editMode").value = item.mode === "practice" ? "practice" : "opponent";
  $("editOpponentName").value = item.opponentName || "";
  $("editPlayerLegs").value = item.playerLegs ?? 0;
  $("editOpponentLegs").value = item.opponentLegs ?? 0;
  $("editAverage").value = totals.average.toFixed(2);
  $("editDarts").value = totals.darts ?? "";
  $("editPoints").value = totals.points;
  $("editHighestVisit").value = totals.highestVisit ?? 0;
  $("editBand40").value = stats.band40;
  $("editBand75").value = stats.band75;
  $("editBand100").value = stats.band100;
  $("editBand140").value = stats.band140;
  $("editBand180").value = stats.band180;
  const legs = deriveLegs(item);
  $("editLegs").innerHTML = legs.length ? legs.map((leg) => `<div class="edit-leg-row" data-edit-leg="${leg.number}">
    <strong>Leg ${leg.number}</strong>
    <label>Result<select data-leg-field="won"><option value="" ${leg.won == null ? "selected" : ""}>Not recorded</option><option value="true" ${leg.won === true ? "selected" : ""}>Won</option><option value="false" ${leg.won === false ? "selected" : ""}>Lost</option></select></label>
    <label>Scored<input data-leg-field="points" type="number" min="0" step="1" value="${Number(leg.points) || 0}"></label>
    <label>Darts<input data-leg-field="darts" type="number" min="0" step="1" value="${Number(leg.darts) || 0}"></label>
    <label>High<input data-leg-field="highestVisit" type="number" min="0" max="180" step="1" value="${Number(leg.highestVisit) || 0}"></label>
  </div>`).join("") : '<p class="empty-state compact">No per-leg data was stored for this match.</p>';
  $("editMessage").textContent = "";
  updateEditMode();
  setView("edit");
}

function updateEditMode() {
  const practice = $("editMode").value === "practice";
  $("editOpponentLabel").hidden = practice;
  $("editOpponentLegsLabel").hidden = practice;
}

function saveEditedMatch(event) {
  event.preventDefault();
  const item = data.history.find((record) => record.id === selectedMatchId);
  if (!item) return setView("history");
  const mode = $("editMode").value;
  const opponentName = $("editOpponentName").value.trim();
  if (mode === "opponent" && !opponentName) {
    $("editMessage").textContent = "Enter an opponent name.";
    return;
  }
  const finishedAt = new Date($("editFinishedAt").value);
  if (Number.isNaN(finishedAt.getTime())) {
    $("editMessage").textContent = "Choose a valid date and time.";
    return;
  }
  const editedLegs = [...$("editLegs").querySelectorAll("[data-edit-leg]")].map((row) => {
    const points = Number(row.querySelector('[data-leg-field="points"]').value);
    const darts = Number(row.querySelector('[data-leg-field="darts"]').value);
    const wonValue = row.querySelector('[data-leg-field="won"]').value;
    return {
      number: Number(row.dataset.editLeg), points, darts,
      visits: item.legs?.find((leg) => Number(leg.number) === Number(row.dataset.editLeg))?.visits ?? 0,
      average: darts ? (points / darts) * 3 : 0,
      highestVisit: Number(row.querySelector('[data-leg-field="highestVisit"]').value),
      won: wonValue === "" ? null : wonValue === "true"
    };
  });
  Object.assign(item, {
    mode,
    opponentName: mode === "practice" ? "Practice" : opponentName,
    finishedAt: finishedAt.toISOString(),
    playerLegs: Number($("editPlayerLegs").value),
    opponentLegs: mode === "practice" ? 0 : Number($("editOpponentLegs").value),
    average: Number($("editAverage").value),
    darts: $("editDarts").value === "" ? null : Number($("editDarts").value),
    points: Number($("editPoints").value),
    highestVisit: Number($("editHighestVisit").value),
    stats: {
      band40: Number($("editBand40").value), band75: Number($("editBand75").value),
      band100: Number($("editBand100").value), band140: Number($("editBand140").value), band180: Number($("editBand180").value)
    }, legs: editedLegs.length ? editedLegs : item.legs,
    editedAt: new Date().toISOString()
  });
  saveData();
  setView("detail");
}

function renderProfileStats() {
  const profile = data.profiles.find((item) => item.id === selectedProfileId);
  if (!profile) return setView("setup");
  const records = data.history.filter((item) => item.profileId === profile.id);
  const wins = records.filter((item) => item.playerLegs > item.opponentLegs).length;
  const totalPoints = records.reduce((sum, item) => sum + getRecordStats(item).points, 0);
  const knownDarts = records.map(getRecordStats).filter((item) => item.darts != null);
  const totalDarts = knownDarts.reduce((sum, item) => sum + item.darts, 0);
  const aggregateAverage = totalDarts ? (knownDarts.reduce((sum, item) => sum + item.points, 0) / totalDarts) * 3 : 0;
  const highest = records.map((item) => getRecordStats(item).highestVisit).filter((value) => value != null);
  const bands = records.reduce((totals, item) => {
    const stats = item.stats || {};
    Object.keys(totals).forEach((key) => { totals[key] += Number(stats[key]) || 0; });
    return totals;
  }, blankStats());
  $("profileStatsTitle").textContent = profile.name;
  $("profileStats").innerHTML = `
    <section class="profile-summary card"><p class="eyebrow">CAREER SUMMARY</p><div class="detail-grid profile-metrics">
      ${valueHTML("Matches", records.length)}${valueHTML("Wins", wins)}${valueHTML("Win rate", records.length ? `${Math.round((wins / records.length) * 100)}%` : "—")}${valueHTML("Overall average", totalDarts ? aggregateAverage.toFixed(2) : "—")}${valueHTML("Total scored", totalPoints)}${valueHTML("Highest visit", highest.length ? Math.max(...highest) : "—")}
    </div></section>
    <section class="card detail-section"><h3>Visit bands</h3><div class="band-grid">${valueHTML("40–74", bands.band40)}${valueHTML("75–99", bands.band75)}${valueHTML("100–139", bands.band100)}${valueHTML("140–179", bands.band140)}${valueHTML("180", bands.band180)}</div></section>
    <section class="card history-card profile-history"><div class="section-heading"><h3>Match history</h3><span>${records.length} ${records.length === 1 ? "match" : "matches"}</span></div><div id="profileHistoryList" class="history-list">${records.length ? historyGroupsHTML(newestFirst(records)) : '<p class="empty-state">No completed matches yet.</p>'}</div></section>`;
  attachHistoryListeners($("profileHistoryList"), "profile");
}

function startMatch() {
  const profile = data.profiles.find((p) => p.id === playerSelect.value);
  if (!profile) return showSetupMessage("Choose or add a player.");
  const mode = selectedMode();
  if (!mode) return showSetupMessage("Choose opponent or practice.");
  const opponentName = $("opponentName").value.trim();
  if (mode === "opponent" && !opponentName) return showSetupMessage("Enter who you are playing against.");
  if (match && !match.complete && !confirm("Replace the unfinished match?")) return;
  match = {
    id: makeId(), profileId: profile.id, playerName: profile.name,
    mode, opponentName: mode === "practice" ? "Practice" : opponentName,
    startedAt: new Date().toISOString(), remaining: 501, playerLegs: 0, opponentLegs: 0,
    legNumber: 1, visits: [], stats: blankStats(), undo: [], complete: false
  };
  saveMatch();
  entry = "";
  setView("game");
}

function getTotals() {
  const scoringVisits = match ? match.visits.filter((v) => v.type === "score") : [];
  const points = scoringVisits.reduce((sum, v) => sum + v.score, 0);
  const darts = scoringVisits.reduce((sum, v) => sum + v.darts, 0);
  return { visits: scoringVisits.length, points, darts, average: darts ? (points / darts) * 3 : 0 };
}

function renderMatch() {
  if (!match) return setView("setup");
  const totals = getTotals();
  $("playerName").textContent = match.playerName;
  $("legLabel").textContent = match.mode === "practice"
    ? `Practice · Leg ${match.legNumber}`
    : `v ${match.opponentName || "Opponent"} · Leg ${match.legNumber} · First to 2`;
  $("playerLegs").textContent = match.playerLegs;
  $("opponentLegs").textContent = match.opponentLegs;
  $("remainingScore").textContent = match.remaining;
  $("averageValue").textContent = totals.average.toFixed(2);
  $("visitCount").textContent = totals.visits;
  $("scoreEntry").textContent = entry || "0";
  $("stat40").textContent = match.stats.band40;
  $("stat75").textContent = match.stats.band75;
  $("stat100").textContent = match.stats.band100;
  $("stat140").textContent = match.stats.band140;
  $("stat180").textContent = match.stats.band180;
  $("undoButton").disabled = !match.undo.length || match.complete;
  $("submitScoreButton").disabled = match.complete;
  $("opponentWonButton").disabled = match.complete;
  $("opponentWonButton").textContent = match.mode === "practice" ? "Finish practice" : "Opponent won leg";
}

function enterKey(value) {
  if (!match || match.complete || entry.length >= 3) return;
  const next = `${entry}${value}`.replace(/^0+(?=\d)/, "");
  if (Number(next) <= 180) entry = next;
  else showGameMessage("Maximum visit is 180.");
  renderMatch();
}

function classify(score) {
  if (score === 180) return "band180";
  if (score >= 140) return "band140";
  if (score >= 100) return "band100";
  if (score >= 75) return "band75";
  if (score >= 40) return "band40";
  return null;
}

function snapshot() {
  match.undo.push({
    remaining: match.remaining, playerLegs: match.playerLegs, opponentLegs: match.opponentLegs,
    legNumber: match.legNumber, visits: match.visits.map((visit) => ({ ...visit })), stats: { ...match.stats }, complete: match.complete
  });
  if (match.undo.length > 30) match.undo.shift();
}

function submitScore() {
  const score = Number(entry);
  showGameMessage("");
  if (!entry) return showGameMessage("Enter a score first.");
  if (score < 0 || score > 180) return showGameMessage("Enter a score from 0 to 180.");
  if (score > match.remaining) return showGameMessage("Bust — score is higher than the remaining total.");
  if (match.remaining - score === 1) return showGameMessage("Bust — you cannot leave 1.");
  if (score === match.remaining) {
    pendingCheckout = score;
    checkoutDialog.showModal();
    return;
  }
  commitVisit(score, 3, false);
}

function commitVisit(score, darts, checkout) {
  snapshot();
  const band = classify(score);
  if (band) match.stats[band] += 1;
  match.visits.push({ type: "score", score, darts, checkout, leg: match.legNumber, at: new Date().toISOString() });
  match.remaining -= score;
  entry = "";
  if (checkout) {
    match.playerLegs += 1;
    match.remaining = 0;
    endLeg(match.playerName);
  } else {
    saveMatch();
    renderMatch();
  }
}

function confirmCheckout(darts) {
  if (pendingCheckout == null) return;
  const score = pendingCheckout;
  pendingCheckout = null;
  commitVisit(score, darts, true);
}

function opponentWonLeg() {
  snapshot();
  match.opponentLegs += 1;
  match.visits.push({ type: "opponent-leg", leg: match.legNumber, at: new Date().toISOString() });
  endLeg("Opponent");
}

function endLeg(winner) {
  saveMatch();
  renderMatch();
  const isComplete = match.playerLegs === 2 || match.opponentLegs === 2;
  $("legEndTitle").textContent = `${winner} won leg ${match.legNumber}`;
  $("legEndSummary").textContent = isComplete ? `Final score: ${match.playerLegs}–${match.opponentLegs}` : `Match score: ${match.playerLegs}–${match.opponentLegs}`;
  $("nextLegButton").hidden = isComplete;
  $("finishMatchButton").hidden = !isComplete;
  legEndDialog.showModal();
}

function nextLeg() {
  match.legNumber += 1;
  match.remaining = 501;
  entry = "";
  saveMatch();
  renderMatch();
}

function buildLegBreakdown() {
  return Array.from({ length: match.legNumber }, (_, index) => {
    const number = index + 1;
    const visits = match.visits.filter((visit) => visit.type === "score" && visit.leg === number);
    const points = visits.reduce((sum, visit) => sum + visit.score, 0);
    const darts = visits.reduce((sum, visit) => sum + visit.darts, 0);
    const playerWon = visits.some((visit) => visit.checkout);
    const opponentWon = match.visits.some((visit) => visit.type === "opponent-leg" && visit.leg === number);
    return {
      number, points, darts, visits: visits.length,
      average: darts ? (points / darts) * 3 : 0,
      highestVisit: visits.length ? Math.max(...visits.map((visit) => visit.score)) : 0,
      won: playerWon ? true : opponentWon ? false : null
    };
  });
}

function finishMatch() {
  match.complete = true;
  const totals = getTotals();
  const scoreVisits = match.visits.filter((visit) => visit.type === "score").map((visit) => ({ ...visit }));
  const record = {
    id: match.id, profileId: match.profileId, playerName: match.playerName,
    mode: match.mode || "opponent", opponentName: match.opponentName || "Opponent",
    startedAt: match.startedAt, finishedAt: new Date().toISOString(), playerLegs: match.playerLegs,
    opponentLegs: match.opponentLegs, average: totals.average, visits: totals.visits,
    points: totals.points, darts: totals.darts,
    highestVisit: scoreVisits.length ? Math.max(...scoreVisits.map((visit) => visit.score)) : 0,
    stats: { ...match.stats }, scoreVisits, legs: buildLegBreakdown()
  };
  if (!data.history.some((item) => item.id === record.id)) data.history.push(record);
  saveData();
  localStorage.removeItem(ACTIVE_KEY);
  $("resultTitle").textContent = match.mode === "practice" ? "Practice saved" : match.playerLegs > match.opponentLegs ? `${match.playerName} wins!` : `${match.opponentName || "Opponent"} wins`;
  $("resultSummary").textContent = match.mode === "practice" ? `${totals.visits} visits · Practice average ${totals.average.toFixed(2)}` : `${match.playerLegs}–${match.opponentLegs} · Match average ${totals.average.toFixed(2)}`;
  resultDialog.showModal();
}

function closeResult() {
  match = null;
  entry = "";
  setView("setup");
}

function undo() {
  if (!match?.undo.length || match.complete) return;
  const prior = match.undo.pop();
  Object.assign(match, prior, { undo: match.undo });
  entry = "";
  saveMatch();
  renderMatch();
  showGameMessage("Last action undone.");
}

function exportBackup() {
  const backup = { app: "Woodman C Darts", version: 2, exportedAt: new Date().toISOString(), data, activeMatch: match };
  const blob = new Blob([JSON.stringify(backup, null, 2)], { type: "application/json" });
  const link = document.createElement("a");
  link.href = URL.createObjectURL(blob);
  link.download = `woodman-c-darts-backup-${new Date().toISOString().slice(0, 10)}.json`;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 1000);
}

async function importBackup(event) {
  const file = event.target.files[0];
  if (!file) return;
  try {
    const backup = JSON.parse(await file.text());
    if (backup.app !== "Woodman C Darts" || !Array.isArray(backup.data?.profiles) || !Array.isArray(backup.data?.history)) throw new Error("Invalid backup");
    if (!confirm("Import this backup? It will replace profiles, history and any active match.")) return;
    data = backup.data;
    match = backup.activeMatch || null;
    saveData(); saveMatch(); closeMenu();
    setView(match && !match.complete ? "game" : "setup");
  } catch {
    alert("That file is not a valid Woodman C Darts backup.");
  } finally {
    event.target.value = "";
  }
}

function showSetupMessage(text) { setupMessage.textContent = text; }
function showGameMessage(text) {
  gameMessage.textContent = text;
  if (text) setTimeout(() => { if (gameMessage.textContent === text) gameMessage.textContent = ""; }, 2600);
}

function openMenu() {
  $("menuPanel").classList.add("open");
  $("menuPanel").setAttribute("aria-hidden", "false");
  $("menuBackdrop").hidden = false;
  $("menuButton").setAttribute("aria-expanded", "true");
}

function closeMenu() {
  $("menuPanel").classList.remove("open");
  $("menuPanel").setAttribute("aria-hidden", "true");
  $("menuBackdrop").hidden = true;
  $("menuButton").setAttribute("aria-expanded", "false");
}

document.querySelectorAll("[data-key]").forEach((button) => button.addEventListener("click", () => enterKey(button.dataset.key)));
$("clearButton").addEventListener("click", () => { entry = ""; renderMatch(); });
$("backspaceButton").addEventListener("click", () => { entry = entry.slice(0, -1); renderMatch(); });
$("addPlayerButton").addEventListener("click", addPlayer);
$("deletePlayerButton").addEventListener("click", deletePlayer);
$("playerStatsButton").addEventListener("click", () => {
  selectedProfileId = playerSelect.value;
  if (selectedProfileId) setView("profile");
});
$("startMatchButton").addEventListener("click", startMatch);
$("submitScoreButton").addEventListener("click", submitScore);
$("undoButton").addEventListener("click", undo);
$("opponentWonButton").addEventListener("click", () => {
  if (match?.mode === "practice") finishMatch();
  else opponentDialog.showModal();
});
$("confirmOpponentButton").addEventListener("click", (event) => {
  event.preventDefault();
  opponentDialog.close("confirm");
  opponentWonLeg();
});
document.querySelectorAll("[data-darts]").forEach((button) => button.addEventListener("click", (event) => {
  event.preventDefault();
  checkoutDialog.close(button.dataset.darts);
  confirmCheckout(Number(button.dataset.darts));
}));
checkoutDialog.addEventListener("close", () => { if (checkoutDialog.returnValue === "cancel") pendingCheckout = null; });
$("nextLegButton").addEventListener("click", nextLeg);
$("finishMatchButton").addEventListener("click", (event) => {
  event.preventDefault();
  legEndDialog.close("finish");
  finishMatch();
});
$("resultDoneButton").addEventListener("click", (event) => {
  event.preventDefault();
  resultDialog.close("done");
  closeResult();
});
$("editVisitForm").addEventListener("submit", saveVisitEdit);
$("cancelVisitEditButton").addEventListener("click", () => {
  selectedVisitIndex = null;
  editVisitDialog.close();
});
$("viewAllHistoryButton").addEventListener("click", () => setView("history"));
$("historyPlayerFilter").addEventListener("change", renderHistory);
document.querySelectorAll('input[name="matchMode"]').forEach((input) => input.addEventListener("change", () => {
  showSetupMessage("");
  updateStartAvailability();
  if (input.value === "opponent" && input.checked) $("opponentName").focus();
}));
$("opponentName").addEventListener("input", updateStartAvailability);
$("editMode").addEventListener("change", updateEditMode);
$("editMatchForm").addEventListener("submit", saveEditedMatch);
$("cancelEditButton").addEventListener("click", () => setView("detail"));
document.querySelectorAll("[data-back]").forEach((button) => button.addEventListener("click", () => setView(button.dataset.back)));
$("menuExportButton").addEventListener("click", exportBackup);
$("importInput").addEventListener("change", importBackup);
$("menuButton").addEventListener("click", openMenu);
$("closeMenuButton").addEventListener("click", closeMenu);
$("menuBackdrop").addEventListener("click", closeMenu);
$("menuHomeButton").addEventListener("click", () => { closeMenu(); setView("setup"); });
$("menuHistoryButton").addEventListener("click", () => { closeMenu(); setView("history"); });
newPlayerName.addEventListener("keydown", (event) => { if (event.key === "Enter") addPlayer(); });
document.addEventListener("keydown", (event) => {
  if (!gameView.classList.contains("active") || document.querySelector("dialog[open]")) return;
  if (/^\d$/.test(event.key)) enterKey(event.key);
  if (event.key === "Backspace") { entry = entry.slice(0, -1); renderMatch(); }
  if (event.key === "Enter") submitScore();
});

if ("serviceWorker" in navigator) window.addEventListener("load", () => navigator.serviceWorker.register("service-worker.js"));

renderSetup();
setView(match && !match.complete ? "game" : "setup");
