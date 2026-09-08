# G 63 hero film — 8 September 2026

## Source and delivered media

The owner supplied `b71d7224-31b7-41a3-941e-75f1b5247abc.mp4`: a red Mercedes-AMG G 63 already moving along a forest road. The input is 10.005 seconds, 240 frames, 1280 × 720 at 24 fps, with audio; 12,522,116 bytes.

- `public/assets/hero-g63-loop.mp4`: 205 frames / 8.541667 seconds, 1280 × 720, 24 fps, H.264, yuv420p, silent, faststart, 3,983,459 bytes.
- `public/assets/hero-g63-poster.webp`: the first output frame, 1280 × 720, 148,546 bytes.
- The previous `hero-loop.mp4` and `poster.jpg` are no longer referenced by the application.

## Loop construction

Zero-based output frames 0–195 use source frames 33–228. Output frames 196–204 blend source frames 229–237 with source frames 24–32. A linear crossfade spans 8 frame intervals / 0.333333 seconds. The final image returns to source frame 32, followed at file wrap by source frame 33: normal one-frame forward motion.

All source motion remains forwards at native speed. No reverse playback, freeze, artificial camera movement or spatial crop is encoded into the delivered video. The clip begins with the car already driving; there is no departure from a wall.

```sh
ffmpeg -i b71d7224-31b7-41a3-941e-75f1b5247abc.mp4 \
  -filter_complex '[0:v]split=2[body][lead];[body]trim=start_frame=33:end_frame=238,setpts=PTS-STARTPTS[long];[lead]trim=start_frame=24:end_frame=33,setpts=PTS-STARTPTS[head];[long][head]xfade=transition=fade:duration=0.3333333333:offset=8.1666666667,format=yuv420p[v]' \
  -map '[v]' -an -r 24 -frames:v 205 -c:v libx264 \
  -preset slow -crf 25 -movflags +faststart hero-g63-loop.mp4
```

The first frame and frames 194, 196, 199, 202 and 204 were visually inspected. A blurred, reduced-resolution car-region comparison puts the final-to-first change at 3.140 on a 0–255 mean-difference scale, within ordinary adjacent-frame variation (median 2.776; 95th percentile 3.493).

The brief blend dissolves background details between positions. Mild generated-source variations in reflections and wheel details remain. This removes the abrupt playback cut; it is not a claim that every transition is physically identical to an unedited continuous shot.

## Full-width presentation

`public/hero.css` removes the former video-shaped masks, side fields and rounded frame. The film fills the hero surface edge to edge. Text shading is confined to the copy area, with a vertical transition into the following section.

On wide desktop surfaces, `public/hero-film.js` draws the same decoded video into one canvas. The car, driver, wheels and shadow remain at their original proportions. Only the empty forest in the left 32% is expanded horizontally with a continuous monotonic mapping that reaches the unmodified image at its native scale. There is no mirrored car or second independently moving video. Canvas resolution is capped at 3840 pixels wide.

On screens up to 1100 pixels wide, the copy sits above a complete 16:9 film. Its sides reach the viewport edges and vertical fades join the surrounding page. If canvas is unavailable, the native video remains visible.

The visible pause control retains the visitor's choice across page navigation. Playback pauses outside the viewport and in hidden tabs; reduced-motion and data-saving preferences initially use the poster. The video is muted and plays inline. All animation callbacks and observers are released on route changes.

## Validation

The actual app and its real styles were inspected in a browser. A temporary iframe harness allowed layout checks at phone, tablet, desktop, 21:9 and 32:9 sizes without weakening the production content-security policy. The harness is excluded from publication. The browser checks cover layout and playback behavior, not physical iOS/Android hardware or GPU benchmarking.
