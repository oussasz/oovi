# Expert intro video (template)

A 25.6 s square video (1080x1080, 30 fps) that introduces an expert who joined oovi's Marketplace. Every word, the name card, the photo, the quote and the screenshot come from one small file, so a new expert needs no design work.

## Make a new one
1. Copy `experts/abdelaziz.json` to `experts/<name>.json` and change the words.
2. Put the expert's photo (square, at least 400x400) in `assets/` and point `photo` at it.
3. Put a real screenshot of the expert in oovi's Marketplace in `assets/` and point `shot` at it (16:9, 1920x1080 is ideal).
4. `node render.cjs experts/<name>.json out/<name>.mp4`
   - with a voice-over: add `--audio voice.mp3`
   - only still pictures to check the look: `--at 4.5,10,15` (seconds)
5. Needs Node, the repo's Playwright (Chromium) and `ffmpeg` on the machine. Nothing is uploaded anywhere.

## How it works
`scene.html` draws every frame as a pure function of the time (`window.seek(t)`), `render.cjs` takes one picture per frame and `ffmpeg` joins them. The timeline (what appears when) is at the bottom of `scene.html`.
Font: Nunito (open licence), the same as the website.

## Before you publish a video
- The photo must be one the expert gave you (or approved) for this use.
- `assets/abdelaziz-photo-from-poster.png` is a small crop of the poster (blurry). Replace it with his real photo.
- `assets/marketplace-old.png` is an OLD screenshot that does not show him. Replace it with a real one that does.
- The "Apply to join" page address is in the config (`applyUrl`): check it is live.
