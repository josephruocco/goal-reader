# Goal Reader (PDF) — Chrome Extension

Open PDFs in a goal-based reader with:

- Page goal tracking (start page + goal pages)
- Progress bar + % complete
- Timer toggle: **Count up** / **Countdown**
- “Read X pages in Y minutes” pacing (time remaining + pace needed)
- Auto-saves progress per PDF URL

---

## What This Is

Chrome’s built-in PDF viewer is restricted — extensions can’t reliably inject UI into it.

So this extension opens PDFs in its own viewer tab (`viewer.html`) where it can track:

- Current page (based on scroll position)
- Page progress toward goal
- Timer + pacing calculations

---

## Installation (Developer Mode)

1. Open Chrome and go to:
   ```
   chrome://extensions
   ```
2. Enable **Developer mode** (top right)
3. Click **Load unpacked**
4. Select the `goal-reader/` folder (the one containing `manifest.json`)

You should now see **Goal Reader (PDF)** in your extensions list.

---

## Add Mozilla PDF.js (Required)

This extension uses Mozilla’s PDF.js via `pdfjs-dist`.

From the directory that contains `goal-reader/`:

```bash
npm init -y
npm install pdfjs-dist

mkdir -p goal-reader/pdfjs
cp node_modules/pdfjs-dist/build/pdf.mjs goal-reader/pdfjs/pdf.mjs
cp node_modules/pdfjs-dist/build/pdf.worker.mjs goal-reader/pdfjs/pdf.worker.mjs
```

Optional (not required for functionality):

```bash
cp node_modules/pdfjs-dist/web/pdf_viewer.css goal-reader/pdfjs/viewer.css
```

Sanity check:

```bash
ls -la goal-reader/pdfjs
```

You should see:

- `pdf.mjs`
- `pdf.worker.mjs`

---

## How to Use

### Open a PDF in Goal Reader

- Find a PDF **link** on a webpage
- Right-click the link
- Click **Open in Goal Reader**

A new tab opens with the PDF + controls.

---

### Set a Reading Goal

In the header:

- **Start** → starting page number
- **Goal pages** → number of pages to read
- **Goal minutes** → time limit
- **Timer mode** → Count up or Countdown
- Click **Apply**

---

### Use the Timer

- **Start / Pause**
- **Reset**

Sidebar shows:

- Current page
- Target end page
- Remaining pages
- Time remaining
- Pace needed (pages/min or min/page)

Progress auto-saves per PDF URL.

---

## Limitations

Works best with:

- Public PDFs
- Direct `.pdf` URLs

May fail with:

- PDFs behind login
- Google Drive preview links
- Sites that block cross-origin PDF fetching (CORS)

If a PDF fails:

1. Open DevTools in the Goal Reader tab  
   (Right click → Inspect → Console)
2. Look for CORS or fetch errors.

---

## Development

After editing code:

1. Go to `chrome://extensions`
2. Click the refresh icon on the extension card
3. Reload the Goal Reader tab

---

## Project Structure

```
goal-reader/
  manifest.json
  sw.js
  viewer.html
  viewer.js
  viewer.css
  pdfjs/
    pdf.mjs
    pdf.worker.mjs
    viewer.css (optional)
```

---

## License

MIT (or your preferred license)
