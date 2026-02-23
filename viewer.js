import * as pdfjsLib from "./pdfjs/pdf.mjs";

pdfjsLib.GlobalWorkerOptions.workerSrc = "./pdfjs/pdf.worker.mjs";

const qs = new URLSearchParams(location.search);
const pdfUrl = qs.get("pdf");

const el = (id) => document.getElementById(id);

const ui = {
  fileMeta: el("fileMeta"),
  startPage: el("startPage"),
  goalPages: el("goalPages"),
  applyGoal: el("applyGoal"),

  currentPage: el("currentPage"),
  totalPages: el("totalPages"),
  endPage: el("endPage"),
  remainingPages: el("remainingPages"),

  progressText: el("progressText"),
  barInner: el("progressBarInner"),

  canvasWrap: el("canvasWrap"),

  timerDisplay: el("timerDisplay"),
  timerToggle: el("timerToggle"),
  timerReset: el("timerReset")
};

function stableKeyForPdf(url) {
  // good enough: store by full URL
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

/**
 * State persisted per PDF:
 * - startPage
 * - goalPages
 * - lastPage
 * - timerSeconds (optional)
 */
const state = {
  startPage: 1,
  goalPages: 10,
  lastPage: 1,
  timerSeconds: 0,
  timerRunning: false,
  timerStartedAtMs: null
};

let pdfDoc = null;
let totalPages = 0;
let pageCanvases = []; // [{ pageNum, canvas, topOffsetPx, heightPx }]

async function loadSavedState() {
  const key = stableKeyForPdf(pdfUrl);
  const saved = await chrome.storage.local.get(key);
  if (saved && saved[key]) {
    const s = saved[key];
    if (Number.isFinite(s.startPage)) state.startPage = s.startPage;
    if (Number.isFinite(s.goalPages)) state.goalPages = s.goalPages;
    if (Number.isFinite(s.lastPage)) state.lastPage = s.lastPage;
    if (Number.isFinite(s.timerSeconds)) state.timerSeconds = s.timerSeconds;
  }
}

async function saveState() {
  const key = stableKeyForPdf(pdfUrl);
  const payload = {};
  payload[key] = {
    startPage: state.startPage,
    goalPages: state.goalPages,
    lastPage: state.lastPage,
    timerSeconds: state.timerSeconds
  };
  await chrome.storage.local.set(payload);
}

function syncGoalInputsToState() {
  ui.startPage.value = String(state.startPage);
  ui.goalPages.value = String(state.goalPages);
}

function computeEndPage() {
  // goalPages is a count from startPage inclusive
  return clamp(state.startPage + state.goalPages - 1, 1, totalPages);
}

function updateGoalUI() {
  const end = computeEndPage();

  ui.totalPages.textContent = totalPages ? String(totalPages) : "–";
  ui.endPage.textContent = totalPages ? String(end) : "–";

  const cur = clamp(state.lastPage, 1, totalPages || 1);
  ui.currentPage.textContent = totalPages ? String(cur) : "–";

  const remaining = totalPages ? Math.max(0, end - cur) : 0;
  ui.remainingPages.textContent = totalPages ? String(remaining) : "–";

  let pct = 0;
  if (totalPages) {
    const denom = Math.max(1, end - state.startPage);
    pct = clamp(((cur - state.startPage) / denom) * 100, 0, 100);
  }

  ui.barInner.style.width = `${pct.toFixed(1)}%`;

  if (!totalPages) {
    ui.progressText.textContent = "Loading…";
  } else {
    ui.progressText.textContent = `Progress: ${pct.toFixed(
      1
    )}% (goal: pages ${state.startPage} → ${end})`;
  }
}

function updateTimerUI() {
  ui.timerDisplay.textContent = fmtHMS(state.timerSeconds);
  ui.timerToggle.textContent = state.timerRunning ? "Pause" : "Start";
}

function startTimer() {
  if (state.timerRunning) return;
  state.timerRunning = true;
  state.timerStartedAtMs = Date.now();
  updateTimerUI();
}

async function pauseTimer() {
  if (!state.timerRunning) return;
  const now = Date.now();
  const elapsed = Math.floor((now - state.timerStartedAtMs) / 1000);
  state.timerSeconds += Math.max(0, elapsed);
  state.timerRunning = false;
  state.timerStartedAtMs = null;
  updateTimerUI();
  await saveState();
}

async function resetTimer() {
  state.timerSeconds = 0;
  state.timerRunning = false;
  state.timerStartedAtMs = null;
  updateTimerUI();
  await saveState();
}

setInterval(async () => {
  if (!state.timerRunning) return;
  const now = Date.now();
  const elapsed = Math.floor((now - state.timerStartedAtMs) / 1000);
  // don’t permanently add here, just render “live”
  ui.timerDisplay.textContent = fmtHMS(state.timerSeconds + Math.max(0, elapsed));
}, 250);

function getVisiblePage(viewerEl) {
  // choose the page whose canvas center is closest to viewer center
  const center = viewerEl.scrollTop + viewerEl.clientHeight / 2;

  let best = { pageNum: 1, dist: Infinity };
  for (const p of pageCanvases) {
    const top = p.topOffsetPx;
    const mid = top + p.heightPx / 2;
    const d = Math.abs(mid - center);
    if (d < best.dist) best = { pageNum: p.pageNum, dist: d };
  }
  return best.pageNum;
}

async function renderAllPages() {
  const viewerEl = document.getElementById("viewer");

  ui.canvasWrap.innerHTML = "";
  pageCanvases = [];

  // rendering scale: tweak if you want
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

    await page.render({
      canvasContext: ctx,
      viewport
    }).promise;

    // record offsets for page detection
    // offsetTop is relative to offsetParent; we want relative to scroll container,
    // so compute after insertion:
    const rect = canvas.getBoundingClientRect();
    // will update on scroll using offsetTop which is stable in layout:
    pageCanvases.push({
      pageNum,
      canvas,
      topOffsetPx: canvas.offsetTop,
      heightPx: canvas.offsetHeight
    });
  }

  // scroll to last page (saved)
  const startAt = clamp(state.lastPage, 1, totalPages);
  const target = pageCanvases.find((p) => p.pageNum === startAt);
  if (target) {
    viewerEl.scrollTop = Math.max(0, target.topOffsetPx - 10);
  }

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

  // Load PDF (extension page fetch usually bypasses normal CORS if host_permissions are set)
  const loadingTask = pdfjsLib.getDocument({
    url: pdfUrl,
    withCredentials: false
  });

  pdfDoc = await loadingTask.promise;
  totalPages = pdfDoc.numPages;

  // Clamp saved values
  state.startPage = clamp(state.startPage, 1, totalPages);
  state.goalPages = clamp(state.goalPages, 1, totalPages);
  state.lastPage = clamp(state.lastPage, 1, totalPages);

  syncGoalInputsToState();
  updateTimerUI();
  updateGoalUI();

  await renderAllPages();
}

ui.applyGoal.addEventListener("click", async () => {
  const sp = Number(ui.startPage.value);
  const gp = Number(ui.goalPages.value);

  state.startPage = clamp(Number.isFinite(sp) ? sp : 1, 1, totalPages || 1);
  state.goalPages = clamp(Number.isFinite(gp) ? gp : 1, 1, totalPages || 1);

  // If you're before the start, snap to start
  if (totalPages && state.lastPage < state.startPage) state.lastPage = state.startPage;

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

(async function main() {
  await loadSavedState();
  syncGoalInputsToState();
  updateTimerUI();
  await loadPdf();
})();
