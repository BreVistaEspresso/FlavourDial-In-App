# BreVista Studio: Espresso Dial-In

A taste-first espresso dial-in app (installable PWA). You tell it how the shot tasted and how long it ran; it gives you **one change** to make next, in your grinder's own terms.

## How it works

- **Taste picks the direction.** Sour means extract more; bitter means extract less; sour and bitter together points to uneven flow (channeling).
- **Shot time picks the lever.** The target window scales with the ratio (about 25-32s at 1:2). Depending on where the shot landed, the advice is grind, shot length, or puck prep. Never several at once.
- **It starts at 1:2 and learns your ratio.** When you lock in a balanced shot, your preferred ratio is remembered.
- **It learns your grinder.** After two shots of the same coffee where only the grind moved, it works out how many seconds one step is worth, and sizes later moves to land inside the window. No grinder presets are needed.
- **It catches overshoot.** If the last change flipped sour to bitter (or back), it suggests going back about halfway.

### Grinder setup

On first launch you choose: stepped, stepless, or a built-in grinder, and whether a higher number is coarser or finer. That is all. Stepless users get "small / moderate / big move" until the app has learned their dial, then decimal targets.

Temperature advice only appears if you tell the app your machine's temperature is adjustable.

## Run it

No build step. ES modules need a web server (not `file://`):

```bash
npm start        # serves http://localhost:8080
npm test         # engine tests (Node 18+)
```

Deploy by uploading the folder to any static host (Netlify, GitHub Pages). Bump `CACHE` in `sw.js` whenever a cached file changes so installed copies update.

## Look

The "Platinum" colourway of the Brevista kit: light grey ground, white panels, purple and amber as accents (amber is the gauge needle only). Barlow Condensed for headings and numerals, Montserrat for body text. In dark mode it switches to the plum ground with white text. Fonts load from Google Fonts and are cached by the service worker after first load; the system fallback is used until then.

## Layout

| Path | Purpose |
| --- | --- |
| `src/engine.js` | Pure diagnosis logic (no DOM, no storage) |
| `src/store.js` | localStorage wrapper (shot log, profile) |
| `src/app.js` | UI |
| `test/engine.test.js` | Scenario tests for the engine |
| `sw.js`, `manifest.webmanifest`, `icons/` | PWA and offline support |

Data stays on the device (localStorage). Export the log as JSON from the Logbook.
