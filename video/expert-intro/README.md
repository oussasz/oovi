# Expert intro video (template)

A 25.6 s square video (1080x1080, 30 fps) that introduces an expert who joined oovi's Marketplace. Every word, the name card, the photo, the quote and the screenshot come from one small file, so a new expert needs no design work.

## Make a new one
1. Copy `experts/abdelaziz.json` to `experts/<name>.json` and change the words.
2. Put the expert's photo (square, at least 400x400) in `assets/` and point `photo` at it.
3. Take three real screenshots of the app (1920x1080) into `assets/`: the Marketplace, the Setups tab with the expert's card, and the expert's details window; list them in `screens`. (The ones in `assets/` were taken from the real app built from this repo, with a throwaway account.)
4. Make the sound once: `python3 audio.py` (music + sound effects, placed from `timeline.json`; `--voice voice.mp3` also writes a mix where the music ducks under the voice).
5. `node render.cjs experts/<name>.json out/<name>.mp4 --audio out/mix.wav` (or `out/mix-voice.wav`)
   - only still pictures to check the look: `--at 4.5,10,15` (seconds)
6. Needs Node, the repo's Playwright (Chromium) and `ffmpeg` on the machine. Nothing is uploaded anywhere.

## How it works
`scene.html` draws every frame as a pure function of the time (`window.seek(t)`), `render.cjs` takes one picture per frame and `ffmpeg` joins them. The timeline (what appears when) is `timeline.json`; the sound reads the same file, so picture and sound stay together. To speed up or slow down a scene, change its numbers there and run both steps again.
Font: Nunito (open licence), the same as the website.

## Before you publish a video
- The photo must be one the expert gave you (or approved) for this use.
- `assets/abdelaziz-photo-from-poster.png` is a small crop of the poster (blurry). Replace it with his real photo.
- The "Apply to join" page address is in the config (`applyUrl`): check it is live.
