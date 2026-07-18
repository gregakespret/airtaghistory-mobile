# Slide assets — swapping in real screenshots

The deck (`../index.html`) ships with **hand-built CSS/SVG mockups** of every app
and web screen, so it's presentation-ready as-is. When you have real screenshots,
drop them here and swap them in. Each mockup on a slide has a faint `↔ swap → …`
hint naming the file it expects.

## How to swap one screen

1. Save the screenshot into this folder using the filename below.
2. In `../index.html`, find the device frame for that slide and replace the inner
   mockup markup with an `<img>`. The frames already support it:
   - **Phone:** inside `<div class="screen">…</div>`, add `<img class="shot" src="assets/app-map.png" alt="">` (it fills the screen; you can delete the mock `.map`, `.p-status`, `.sheet`, etc.).
   - **Browser:** inside `<div class="viewport">…</div>`, add `<img class="shot" src="assets/web-dashboard.png" alt="">`.

## Expected filenames

| File | Slide | Screen to capture |
|------|-------|-------------------|
| `map-move.png` | 2 · The move | Map with car + keys pins mid-journey |
| `app-map.png` | 4 & 6 · The app | Main map screen with pins + tag sheet |
| `panama-split.png` | 5 · Panama twist | Map showing car and keys separated |
| `app-timetravel.png` | 7 · Time travel | Map with trail + time slider dragged into the past |
| `app-tagsheet.png` | 8 · Freshness | Bottom sheet expanded, freshness dots visible |
| `web-dashboard.png` | 10 · Web app | airtaghistory.com dashboard map |
| `web-evidence.png` | 10 · Web app | PDF / evidence report view |

Portrait phone shots look best at ~1170×2532 (iPhone). Browser shots ~1600×1000.
