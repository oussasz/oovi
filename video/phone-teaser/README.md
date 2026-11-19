# Phone teaser

A 13 second teaser: a real phone on a table gets a message from the expert, the notification lifts out of the screen, then the video says it was his AI.

- `scene.html` draws second `t` with `window.seek(t)`; `config.json` holds the words, the screen corners and the timing; `audio.py` makes the sound from the same timing.
- The phone clip is "Phone on round end table" from Mixkit (mixkit.co/free-stock-video/phone-on-round-end-table-248/). It is not in the repo. Check Mixkit's licence page before publishing.

Make it again:

    ffmpeg -ss 2 -i 248-2160.mp4 -frames:v 324 -vf "crop=2160:2160:0:0,scale=1104:1104:flags=lanczos" -q:v 2 footage/f%04d.jpg
    python3 audio.py
    node render.cjs out/benkirat-phone-teaser.mp4 --audio out/mix.wav

`node render.cjs out/x.mp4 --at 1.3,3,7.4` saves still pictures only.
