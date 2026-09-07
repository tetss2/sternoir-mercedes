# Hero loop production report

- Input: `Создай_динамичный_фотореалисти.mp4`, 10.005 seconds, 1280 × 720, 24 fps.
- Output: `hero-loop.mp4`, 3.375 seconds / 81 frames, 1280 × 720, 24 fps, H.264, yuv420p, silent, faststart. File size: 1,479,468 bytes (1.48 MB).
- Poster: `poster.jpg`, full 1280 × 720 first output frame.

## Exact trim and seam

Zero-based input frames 69–161 are the only source frames used, covering timestamps 2.875–6.708333 seconds. Initial stationary wall footage is excluded.

Output frames 0–68 use source frames 81–149 unchanged in chronological order. Output frames 69–80 blend source frames 150–161 with source frames 69–80, using a linear 12-frame / 0.5-second crossfade: weight of the early segment increases from 0 to 1 inclusive. The final output frame is therefore source frame 80, followed on playback wrap by source frame 81: normal one-frame forward motion at the actual file boundary.

The source window was selected after comparing low-resolution blurred car-pose and background differences across candidate intervals. Shorter ~3.4-second periods preserved car pose better than 5-second candidates. Every source segment runs forwards at native speed. No reverse, freeze, spatial shift, zoom, shake, cropping, interpolation, or synthesized frames were added. Full original 16:9 framing is preserved.

## Verification and limits

Probed encoded file for duration, codec, resolution, frame rate, and 81-frame count. Inspected a labeled-by-order contact sheet of first output frame and seam frames 69, 72, 75, 78, 80 at 640 × 360 each (`seam-inspection.jpg`). The body silhouette stays close enough that there is no strongly separated second car outline in those sampled frames. Native wheel motion and road movement continue forwards.

This is an edited loop, not a physically perfect continuous shot. During the brief seam blend, background columns and road markings dissolve between different positions; faint ghosting of wheel spokes, reflections, and background edges remains visible on inspection. The source has mild generated-footage variation in body reflections and wheel detail that this temporal-only edit does not correct. There is no hard file-boundary pose jump, but do not describe the entire transition as mathematically seamless or completely artifact-free.

CSS fades, page integration, and display sizing are outside this asset task. Use `object-fit: contain` or an exact 16:9 surface to retain the entire source frame.
