import * as pdfjsLib from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";

pdfjsLib.GlobalWorkerOptions.workerSrc = workerUrl;

// IMPORTANT: these folders must exist in dist/ (copied by Vite build)
const ASSETS = {
  cMapUrl: chrome.runtime.getURL("pdfjs-assets/cmaps/"),
  cMapPacked: true,
  standardFontDataUrl: chrome.runtime.getURL("pdfjs-assets/standard_fonts/"),
  wasmUrl: chrome.runtime.getURL("pdfjs-assets/wasm/"),
  imageResourcesPath: chrome.runtime.getURL("pdfjs-assets/image_decoders/")
};

const qs = new URLSearchParams(location.search);
const pdfUrl = qs.get("pdf");

const el = (id) => document.getElementById(id);

const ui = {
  fileMeta: el("fileMeta"),
  fileInput: el("fileInput"),

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

function stableKeyForPdf(url) {
  return `goalReader:${url}`;
}

function stableKeyForLocalFile(file) {
  return `goalReader:local:${file.name}:${file.size}:${file.lastModified}`;
}

const state = {
  startPage: 1,
  goalPages: 15,
  goalMinutes: 45,
  timerMode: "countdown",
  lastPage: 1,

  elapsedSeconds: 0,
  timerRunning: false,
  timerStartedAtMs: null
};

let storageKey = null;

let pdfDoc = null;
let totalPages = 0;

// array of { pageNum, el } where el starts as placeholder and becomes canvas
let pageNodes = [];

// rendering control
const SCALE = 1.35;
const rendered = new Set();
const inFlight = new Set();

// observers
let renderObserver = null;
let visibleObserver = null;

async function loadSavedState(key) {
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
  if (!storageKey) return;
  const payload = {};
  payload[storageKey] = {
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
  return state.timerMode === "countdown"
    ? Math.max(0, goalSeconds() - liveElapsed)
    : liveElapsed;
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

  if (state.timerMode === "countdown") {
    const rem = goalSeconds() - state.elapsedSeconds;
    if (rem <= 0) state.elapsedSeconds = 0;
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

  let pct = 0;
  if (totalPages) {
    const denom = Math.max(1, end - state.startPage);
    pct = clamp(((cur - state.startPage) / denom) * 100, 0, 100);
  }
  ui.barInner.style.width = `${pct.toFixed(1)}%`;

  const liveElapsed = currentElapsedSecondsLive();
  const timeRemainingSec = Math.max(0, goalSeconds() - liveElapsed);
  ui.remainingTime.textContent = fmtHMS(timeRemainingSec);

  const timeRemainingMin = timeRemainingSec / 60;
  const pace = timeRemainingMin > 0 ? remainingPages / timeRemainingMin : Infinity;
  ui.paceNeeded.textContent = fmtPace(pace);

  ui.progressText.textContent = totalPages
    ? `Pages: ${pct.toFixed(1)}% (goal: ${state.startPage} → ${end})  •  Time: ${fmtHMS(timeRemainingSec)} remaining  •  Pace: ${fmtPace(pace)}`
    : "Open a PDF (URL or local file).";
}

async function renderPage(pageNum) {
  if (rendered.has(pageNum) || inFlight.has(pageNum)) return;
  inFlight.add(pageNum);

  try {
    const page = await pdfDoc.getPage(pageNum);
    const viewport = page.getViewport({ scale: SCALE });

    const canvas = document.createElement("canvas");
    canvas.className = "pageCanvas";
    canvas.width = Math.floor(viewport.width);
    canvas.height = Math.floor(viewport.height);
    canvas.dataset.pageNum = String(pageNum);

    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");

    const item = pageNodes[pageNum - 1];
    item.el.replaceWith(canvas);
    item.el = canvas;

    await page.render({ canvasContext: ctx, viewport }).promise;
    rendered.add(pageNum);

    if (visibleObserver) visibleObserver.observe(canvas);
  } catch (e) {
    console.error("Render failed", pageNum, e);
  } finally {
    inFlight.delete(pageNum);
  }
}

function teardownObservers() {
  if (renderObserver) renderObserver.disconnect();
  if (visibleObserver) visibleObserver.disconnect();
  renderObserver = null;
  visibleObserver = null;
}

async function initPlaceholdersAndObservers() {
  teardownObservers();

  ui.canvasWrap.innerHTML = "";
  pageNodes = [];
  rendered.clear();
  inFlight.clear();

  // Placeholder size from page 1
  const p1 = await pdfDoc.getPage(1);
  const vp1 = p1.getViewport({ scale: SCALE });
  const w = Math.floor(vp1.width);
  const h = Math.floor(vp1.height);

  for (let pageNum = 1; pageNum <= totalPages; pageNum++) {
    const holder = document.createElement("div");
    holder.className = "pagePlaceholder";
    holder.style.width = `${w}px`;
    holder.style.height = `${h}px`;
    holder.dataset.pageNum = String(pageNum);

    ui.canvasWrap.appendChild(holder);
    pageNodes.push({ pageNum, el: holder });
  }

  const viewerEl = document.getElementById("viewer");

  renderObserver = new IntersectionObserver(
    (entries) => {
      for (const ent of entries) {
        if (!ent.isIntersecting) continue;
        const pageNum = Number(ent.target.dataset.pageNum);
        if (Number.isFinite(pageNum)) renderPage(pageNum);
      }
    },
    { root: viewerEl, rootMargin: "1200px 0px 1200px 0px", threshold: 0.01 }
  );

  let best = { pageNum: 1, ratio: 0 };

  visibleObserver = new IntersectionObserver(
    (entries) => {
      for (const ent of entries) {
        const pageNum = Number(ent.target.dataset.pageNum);
        const ratio = ent.intersectionRatio;
        if (ratio > best.ratio) best = { pageNum, ratio };
      }

      if (best.ratio > 0) {
        const p = clamp(best.pageNum, 1, totalPages);
        if (p !== state.lastPage) {
          state.lastPage = p;
          updateGoalUI();
          saveState();
        }
        best = { pageNum: state.lastPage, ratio: 0 };
      }
    },
    { root: viewerEl, threshold: [0.15, 0.3, 0.5, 0.7] }
  );

  for (const item of pageNodes) {
    renderObserver.observe(item.el);
    visibleObserver.observe(item.el);
  }

  const startAt = clamp(state.lastPage, 1, totalPages);
  const target = pageNodes[startAt - 1]?.el;
  if (target) viewerEl.scrollTop = Math.max(0, target.offsetTop - 10);
}

async function setupAfterPdfLoaded() {
  state.startPage = clamp(state.startPage, 1, totalPages);
  state.goalPages = clamp(state.goalPages, 1, totalPages);
  state.lastPage = clamp(state.lastPage, 1, totalPages);
  state.goalMinutes = Math.max(1, Math.floor(state.goalMinutes));

  syncInputsToState();
  updateTimerUI();
  updateGoalUI();

  await initPlaceholdersAndObservers();

  const start = clamp(state.lastPage, 1, totalPages);
  renderPage(start);
  renderPage(clamp(start + 1, 1, totalPages));
  renderPage(clamp(start + 2, 1, totalPages));
}

async function loadPdfFromUrl(url) {
  const loadingTask = pdfjsLib.getDocument({ url, withCredentials: false, ...ASSETS });
  pdfDoc = await loadingTask.promise;
  totalPages = pdfDoc.numPages;
}

async function loadPdfFromBytes(uint8) {
  const loadingTask = pdfjsLib.getDocument({ data: uint8, ...ASSETS });
  pdfDoc = await loadingTask.promise;
  totalPages = pdfDoc.numPages;
}

async function loadPdf() {
  updateGoalUI();

  if (pdfUrl && !pdfUrl.startsWith("file:")) {
    storageKey = stableKeyForPdf(pdfUrl);
    await loadSavedState(storageKey);

    ui.fileMeta.textContent = pdfUrl;

    await loadPdfFromUrl(pdfUrl);
    await setupAfterPdfLoaded();
    return;
  }

  if (pdfUrl && pdfUrl.startsWith("file:")) {
    ui.fileMeta.textContent = "Local file URL blocked by Chrome. Use file picker.";
    ui.progressText.textContent = "Pick a local PDF using “Open local PDF”.";
    return;
  }

  ui.fileMeta.textContent = "Open a PDF using the file picker (or via context menu).";
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

ui.fileInput.addEventListener("change", async () => {
  const file = ui.fileInput.files?.[0];
  if (!file) return;

  teardownObservers();
  pdfDoc = null;
  totalPages = 0;
  pageNodes = [];
  rendered.clear();
  inFlight.clear();

  storageKey = stableKeyForLocalFile(file);
  await loadSavedState(storageKey);

  ui.fileMeta.textContent = file.name;

  const buf = await file.arrayBuffer();
  const bytes = new Uint8Array(buf);

  await loadPdfFromBytes(bytes);
  await setupAfterPdfLoaded();
});

/* ===== Live tick ===== */
setInterval(async () => {
  updateTimerUI();

  if (state.timerRunning && state.timerMode === "countdown") {
    const rem = timerDisplaySeconds();
    if (rem <= 0) await pauseTimer();
  }

  updateGoalUI();
}, 500);

/* ===== Boot ===== */
(async function main() {
  updateTimerUI();
  await loadPdf();
})();