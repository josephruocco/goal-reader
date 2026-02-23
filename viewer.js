import * as pdfjsLib from "./pdfjs/pdf.mjs";
pdfjsLib.GlobalWorkerOptions.workerSrc = "./pdfjs/pdf.worker.mjs";

const qs = new URLSearchParams(location.search);
const pdfUrl = qs.get("pdf");

const el = (id) => document.getElementById(id);

const ui = {
  fileMeta: el("fileMeta"),

  startPage: el("startPage"),
  goalPages: el("goalPages"),
  goalMinutes: el("goalMinutes"),
  timerMode: el("timerMode"),
  applyGoal: el("applyGoal"),

  currentPage: el("currentPage"),
  totalPages: el("totalPages"),
  endPage: el("endPage"),
  remainingPages: el("remainingPages"),

  remainingTime: el("remainingTime"),
  paceNeeded: el("paceNeeded"),

  progressText: el("progressText"),
  barInner: el("progressBarInner"),

  canvasWrap: el("canvasWrap"),

  timerDisplay: el("timerDisplay"),
  timerToggle: el("timerToggle"),
  timerReset: el("timerReset")
};

function stableKeyForPdf(url) {
  return `goalReader:${url}`;
}

function clamp(n, lo, hi) {
  return Math.max(lo, Math.min(hi, n));
}

function fmtHMS(totalSeconds) {
  const s = Math.max(0, Math.floor(totalSeconds));
  const hh = String(Math.floor(s / 3600)).padStart(2, "0");
  const mm = String(Math.floor((s % 3600) / 60)).padStart(2, "0");
  const ss = String(s % 60).padStart(2, "0");
  return `${hh}:${mm}:${ss}`;
}

function fmtPace(pagesPerMin) {
  if (!Number.isFinite(pagesPerMin) || pagesPerMin <= 0) return "–";
  if (pagesPerMin >= 1) return `${pagesPerMin.toFixed(2)} pages/min`;
  const minPerPage = 1 / pagesPerMin;
  return `${minPerPage.toFixed(2)} min/page`;
}

/**
 * Persisted per PDF:
 * - startPage
 * - goalPages
 * - goalMinutes
 * - timerMode ("countup" | "countdown")
 * - lastPage
 * - elapsedSeconds (time actually spent in active timer)
 */
const state = {
  startPage: 1,
  goalPages: 10,
  goalMinutes: 20,
  timerMode: "countup",
  lastPage: 1,

  elapsedSeconds: 0,
  timerRunning: false,
  timerStartedAtMs: null
};

let pdfDoc = null;
let totalPages = 0;
let pageCanvases = [];

async function loadSavedState() {
  const key = stableKeyForPdf(pdfUrl);
  const saved = await chrome.storage.local.get(key);
  if (saved && saved[key]) {
    const s = saved[key];
    if (Number.isFinite(s.startPage)) state.startPage = s.startPage;
    if (Number.isFinite(s.goalPages)) state.goalPages = s.goalPages;
    if (Number.isFinite(s.goalMinutes)) state.goalMinutes = s.goalMinutes;
    if (typeof s.timerMode === "string") state.timerMode = s.timerMode;
    if (Number.isFinite(s.lastPage)) state.lastPage = s.lastPage;
    if (Number.isFinite(s.elapsedSeconds)) state.elapsedSeconds = s.elapsedSeconds;
  }
}

async function saveState() {
  const key = stableKeyForPdf(pdfUrl);
  const payload = {};
  payload[key] = {
    startPage: state.startPage,
    goalPages: state.goalPages,
    goalMinutes: state.goalMinutes,
    timerMode: state.timerMode,
    lastPage: state.lastPage,
    elapsedSeconds: state.elapsedSeconds
  };
  await chrome.storage.local.set(payload);
}

function syncInputsToState() {
  ui.startPage.value = String(state.startPage);
  ui.goalPages.value = String(state.goalPages);
  ui.goalMinutes.value = String(state.goalMinutes);
  ui.timerMode.value = state.timerMode;
}

function computeEndPage() {
  return clamp(state.startPage + state.goalPages - 1, 1, totalPages || 1);
}

function goalSeconds() {
  return Math.max(1, Math.floor(state.goalMinutes * 60));
}

function currentElapsedSecondsLive() {
  if (!state.timerRunning) return state.elapsedSeconds;
  const now = Date.now();
  const elapsed = Math.floor((now - state.timerStartedAtMs) / 1000);
  return state.elapsedSeconds + Math.max(0, elapsed);
}

function timerDisplaySeconds() {
  const liveElapsed = currentElapsedSecondsLive();
  if (state.timerMode === "countdown") {
    return Math.max(0, goalSeconds() - liveElapsed);
  }
  return liveElapsed;
}

function updateTimerUI() {
  ui.timerDisplay.textContent = fmtHMS(timerDisplaySeconds());
  ui.timerToggle.textContent = state.timerRunning ? "Pause" : "Start";
}

async function pauseTimer() {
  if (!state.timerRunning) return;
  const now = Date.now();
  const elapsed = Math.floor((now - state.timerStartedAtMs) / 1000);
  state.elapsedSeconds += Math.max(0, elapsed);
  state.timerRunning = false;
  state.timerStartedAtMs = null;
  updateTimerUI();
  await saveState();
}

function startTimer() {
  if (state.timerRunning) return;

  // If countdown already finished, restarting from 0 is annoying; reset first.
  if (state.timerMode === "countdown") {
    const rem = goalSeconds() - state.elapsedSeconds;
    if (rem <= 0) {
      state.elapsedSeconds = 0;
    }
  }

  state.timerRunning = true;
  state.timerStartedAtMs = Date.now();
  updateTimerUI();
}

async function resetTimer() {
  state.elapsedSeconds = 0;
  state.timerRunning = false;
  state.timerStartedAtMs = null;
  updateTimerUI();
  await saveState();
}

function updateGoalUI() {
  const end = computeEndPage();

  ui.totalPages.textContent = totalPages ? String(totalPages) : "–";
  ui.endPage.textContent = totalPages ? String(end) : "–";

  const cur = clamp(state.lastPage, 1, totalPages || 1);
  ui.currentPage.textContent = totalPages ? String(cur) : "–";

  const remainingPages = totalPages ? Math.max(0, end - cur) : 0;
  ui.remainingPages.textContent = totalPages ? String(remainingPages) : "–";

  // Page progress %
  let pct = 0;
  if (totalPages) {
    const denom = Math.max(1, end - state.startPage);
    pct = clamp(((cur - state.startPage) / denom) * 100, 0, 100);
  }
  ui.barInner.style.width = `${pct.toFixed(1)}%`;

  // Time remaining + pace needed
  const liveElapsed = currentElapsedSecondsLive();
  const timeRemainingSec = Math.max(0, goalSeconds() - liveElapsed);
  ui.remainingTime.textContent = fmtHMS(timeRemainingSec);

  const timeRemainingMin = timeRemainingSec / 60;
  const pace = timeRemainingMin > 0 ? remainingPages / timeRemainingMin : Infinity;
  ui.paceNeeded.textContent = fmtPace(pace);

  if (!totalPages) {
    ui.progressText.textContent = "Loading…";
  } else {
    ui.progressText.textContent =
      `Pages: ${pct.toFixed(1)}% (goal: ${state.startPage} → ${end})  •  ` +
      `Time: ${fmtHMS(timeRemainingSec)} remaining  •  Pace: ${fmtPace(pace)}`;
  }
}

function getVisiblePage(viewerEl) {
  const center = viewerEl.scrollTop + viewerEl.clientHeight / 2;
  let best = { pageNum: 1, dist: Infinity };

  for (const p of pageCanvases) {
    const mid = p.topOffsetPx + p.heightPx / 2;
    const d = Math.abs(mid - center);
    if (d < best.dist) best = { pageNum: p.pageNum, dist: d };
  }
  return best.pageNum;
}

async function renderAllPages() {
  const viewerEl = document.getElementById("viewer");

  ui.canvasWrap.innerHTML = "";
  pageCanvases = [];

  const scale = 1.35;

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale });

    const canvas = document.createElement("canvas");
    canvas.className = "pageCanvas";
    const ctx = canvas.getContext("2d");

    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);

    ui.canvasWrap.appendChild(canvas);

    await page.render({ canvasContext: ctx, viewport }).promise;

    pageCanvases.push({
      pageNum,
      topOffsetPx: canvas.offsetTop,
      heightPx: canvas.offsetHeight
    });
  }

  // Jump to last saved page
  const startAt = clamp(state.lastPage, 1, totalPages);
  const target = pageCanvases.find((p) => p.pageNum === startAt);
  if (target) viewerEl.scrollTop = Math.max(0, target.topOffsetPx - 10);

  updateGoalUI();

  let saveDebounce = null;
  viewerEl.addEventListener("scroll", () => {
    const p = getVisiblePage(viewerEl);
    if (p !== state.lastPage) {
      state.lastPage = p;
      updateGoalUI();

      clearTimeout(saveDebounce);
      saveDebounce = setTimeout(() => {
        saveState();
      }, 250);
    }
  });
}

async function loadPdf() {
  if (!pdfUrl) {
    ui.progressText.textContent = "No PDF URL provided.";
    return;
  }

  ui.fileMeta.textContent = pdfUrl;

  const loadingTask = pdfjsLib.getDocument({ url: pdfUrl, withCredentials: false });
  pdfDoc = await loadingTask.promise;
  totalPages = pdfDoc.numPages;

  // Clamp
  state.startPage = clamp(state.startPage, 1, totalPages);
  state.goalPages = clamp(state.goalPages, 1, totalPages);
  state.lastPage = clamp(state.lastPage, 1, totalPages);
  state.goalMinutes = Math.max(1, Math.floor(state.goalMinutes));

  syncInputsToState();
  updateTimerUI();
  updateGoalUI();

  await renderAllPages();
}

/* ===== UI events ===== */

ui.applyGoal.addEventListener("click", async () => {
  const sp = Number(ui.startPage.value);
  const gp = Number(ui.goalPages.value);
  const gm = Number(ui.goalMinutes.value);
  const mode = ui.timerMode.value;

  state.startPage = clamp(Number.isFinite(sp) ? sp : 1, 1, totalPages || 1);
  state.goalPages = clamp(Number.isFinite(gp) ? gp : 1, 1, totalPages || 1);
  state.goalMinutes = Math.max(1, Math.floor(Number.isFinite(gm) ? gm : 20));
  state.timerMode = mode === "countdown" ? "countdown" : "countup";

  if (totalPages && state.lastPage < state.startPage) state.lastPage = state.startPage;

  updateTimerUI();
  updateGoalUI();
  await saveState();
});

// Change mode immediately (no need to hit Apply)
ui.timerMode.addEventListener("change", async () => {
  state.timerMode = ui.timerMode.value === "countdown" ? "countdown" : "countup";
  updateTimerUI();
  updateGoalUI();
  await saveState();
});

ui.timerToggle.addEventListener("click", async () => {
  if (state.timerRunning) await pauseTimer();
  else startTimer();
});

ui.timerReset.addEventListener("click", async () => {
  await resetTimer();
});

/* ===== Live tick ===== */
setInterval(async () => {
  // Refresh timer display regardless
  updateTimerUI();

  // If running and countdown reaches 0, auto-pause + persist
  if (state.timerRunning && state.timerMode === "countdown") {
    const rem = timerDisplaySeconds();
    if (rem <= 0) {
      await pauseTimer();
    }
  }

  // Update pace/time remaining text live
  updateGoalUI();
}, 500);

/* ===== Boot ===== */
(async function main() {
  await loadSavedState();
  syncInputsToState();
  updateTimerUI();
  await loadPdf();
})();