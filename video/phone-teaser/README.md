# Phone teaser

Two story-size clips (1080x1920) over a real phone on a table:

1. `teaser.json`: a message from the expert arrives, the notification lifts out of the screen, then "Coming soon." (9.5 s)
2. `reveal.json`: the same message, then "That wasn't Abdelaziz. It was his AI." and the oovi end card (13 s)

- `scene.html` draws second `t` with `window.seek(t)`; the two json files hold the words, the screen corners and the timing; `audio.py` makes the sound from the same timing.
- The phone clip is "Phone on round end table" from Mixkit (mixkit.co/free-stock-video/phone-on-round-end-table-248/). It is not in the repo. Check Mixkit's licence page before publishing.
- The clip is wide, so the top and bottom of the story are a blurred stretch of it (`footage-filter.txt`).

Make them again:

    ffmpeg -ss 2 -i 248-2160.mp4 -frames:v 324 -filter_complex "$(cat footage-filter.txt)" -q:v 2 footage/f%04d.jpg
    python3 audio.py teaser.json out/teaser.wav && node render.cjs teaser.json out/benkirat-1-teaser-story.mp4 --audio out/teaser.wav
    python3 audio.py reveal.json out/reveal.wav && node render.cjs reveal.json out/benkirat-2-reveal-story.mp4 --audio out/reveal.wav

`node render.cjs teaser.json out/x.mp4 --at 1.3,3,7.4` saves still pictures only.
