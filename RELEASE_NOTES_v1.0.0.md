# v1.0.0 - Goal Reader (PDF)

First public release of **Goal Reader (PDF)**.

## Highlights

- Open PDF links in a dedicated Goal Reader tab
- Set reading goals by start page, goal pages, and goal minutes
- Track progress with a visual bar and percent complete
- Timer modes: **Count up** and **Countdown**
- Live pacing guidance: pages/min and min/page
- Auto-save progress per PDF URL

## Technical Notes

- Built with Chrome Extension MV3
- Uses Mozilla PDF.js for rendering and text layer support
- Includes required PDF.js assets (cmaps, standard fonts, wasm, image decoders)

## Distribution

- Chrome Web Store:  
  https://chromewebstore.google.com/detail/goal-reader-pdf/mchomnhnininjcncokmapokihmkmeeii?authuser=0&hl=en
- Release artifact: `goal-reader.zip`

## Known Limitations

- Works best with public, direct `.pdf` URLs
- Some authenticated or restricted sources may fail due to CORS/cookie restrictions
