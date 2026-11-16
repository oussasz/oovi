# Expert intro video (template)

A 25.6 s square video (1080x1080, 30 fps) that introduces an expert who joined oovi's Marketplace. Every word, the name card, the photo, the quote and the screenshot come from one small file, so a new expert needs no design work.

## Make a new one
1. Copy `experts/abdelaziz.json` to `experts/<name>.json` and change the words.
2. Put the expert's picture in `assets/` with the background removed (a face, square, at least 400x400, transparent PNG) and point `photo` at it. The slime in the scene wears his hair, beard, glasses and scarf: change them in `scene.html` (`#hair`, `#beard`, `#scarf`, the glasses) for another expert.
3. Take three real screenshots of the app (1920x1080) into `assets/`: the Marketplace, the Setups tab with the expert's card, and the expert's details window; list them in `screens`. (The ones in `assets/` were taken from the real app built from this repo, with a throwaway account.)
4. Put the sound files in `inputs/` (kept out of git): `narrator.mp3` (the narration), `abdelaziz-voice.wav` (the expert's own sentence), `portafilter.wav` (coffee-machine clicks and knocks). Then run `python3 audio.py`: it matches the two voices (tone, loudness, the same small room), adds music and sound effects placed from `timeline.json`, makes the expert's mouth move with his voice (`out/mouth.json`) and masters everything to -16 LUFS.
5. `node render.cjs experts/<name>.json out/<name>.mp4 --audio out/mix.wav`
   - only still pictures to check the look: `--at 4.5,10,15` (seconds)
6. Needs Node, the repo's Playwright (Chromium) and `ffmpeg` on the machine. Nothing is uploaded anywhere.

## How it works
`scene.html` draws every frame as a pure function of the time (`window.seek(t)`), `render.cjs` takes one picture per frame and `ffmpeg` joins them. The timeline (what appears when) is `timeline.json`; the sound reads the same file, so picture and sound stay together. To speed up or slow down a scene, change its numbers there and run both steps again.
Font: Nunito (open licence), the same as the website.

## Before you publish a video
- The photo must be one the expert gave you (or approved) for this use.
- `assets/abdelaziz-face.png` and `abdelaziz-character.png` are cut from the picture the owner gave (white background removed).
- The "Apply to join" page address is in the config (`applyUrl`): check it is live.
