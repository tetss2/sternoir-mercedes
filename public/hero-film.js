// One decoded video, one continuous scene. On wide displays only the empty
// woodland to the left is expanded; the car and driver keep their proportions.
let wantsPlayback;

export function bindHeroFilm(video, control, icon) {
  const surface = video.closest('.hero-film');
  const canvas = surface.querySelector('canvas');
  const context = canvas.getContext('2d', { alpha: false });
  const poster = surface.querySelector('.hero-poster');
  const events = new AbortController();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  let visible = true, disposed = false, frame = null, lastTime = -1;
  let width = 0, height = 0, panorama = false;
  if (wantsPlayback === undefined) wantsPlayback = !motion.matches && !navigator.connection?.saveData;

  const listen = (target, event, callback) => target.addEventListener(event, callback, { signal: events.signal });
  const updateControl = () => {
    control.innerHTML = icon(video.paused);
    control.setAttribute('aria-label', video.paused ? 'Включить фоновое видео' : 'Приостановить фоновое видео');
  };

  function draw() {
    if (!context || !panorama || disposed) return;
    const source = video.readyState >= 2 ? video : poster;
    const sw = source.videoWidth || source.naturalWidth;
    const sh = source.videoHeight || source.naturalHeight;
    if (!sw || !sh) return;
    const scale = height / sh;
    const extra = Math.max(0, width - sw * scale);
    // Across the whole selected clip the car starts beyond 39% of the frame.
    // Protect everything from 32% onwards, including its full shadow and wheels.
    const split = sw * 0.32;
    const join = split * scale + extra;
    context.imageSmoothingEnabled = true;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, split, 0, sw - split, sh, join, 0, width - join, height);
    // This monotonic mapping has exactly the original scale at the join.
    // Adjacent strips touch in source and output: no mirrored car, hard seam,
    // separate background video, oval mask or independently moving layer.
    const stretch = x => {
      const t = x / split;
      return x * scale + extra * (2 * t - t * t);
    };
    const strips = 96;
    for (let i = 0; i < strips; i++) {
      const left = split * i / strips, right = split * (i + 1) / strips;
      const x = stretch(left), next = stretch(right);
      context.drawImage(source, left, 0, right - left, sh, x, 0, next - x + 0.35, height);
    }
    surface.classList.add('is-panorama');
  }

  function resize() {
    const box = surface.getBoundingClientRect();
    // The supplied film is 720p. Cap the canvas to avoid unnecessary GPU work
    // on high-density ultrawide displays while retaining full scene coverage.
    const resolution = Math.min(devicePixelRatio || 1, 1.5, 3840 / Math.max(box.width, 1));
    width = Math.max(1, Math.round(box.width * resolution));
    height = Math.max(1, Math.round(box.height * resolution));
    panorama = !!context && box.width > 1100 && box.width / box.height > 16 / 9;
    surface.classList.toggle('is-panorama', false);
    if (panorama) { canvas.width = width; canvas.height = height; draw();if(!video.paused){cancelFrame();nextFrame();} } else cancelFrame();
  }

  function cancelFrame() {
    if (frame === null) return;
    if (video.cancelVideoFrameCallback) video.cancelVideoFrameCallback(frame);
    else cancelAnimationFrame(frame);
    frame = null;
  }

  function nextFrame() {
    frame = null;
    if (disposed || !panorama || video.paused || !visible || document.hidden) return;
    if (lastTime !== video.currentTime) { draw(); lastTime = video.currentTime; }
    frame = video.requestVideoFrameCallback ? video.requestVideoFrameCallback(nextFrame) : requestAnimationFrame(nextFrame);
  }

  function reconcile() {
    if (disposed) return;
    if (wantsPlayback && visible && !document.hidden) {
      if (!video.getAttribute('src') && poster.complete) { video.src=matchMedia('(max-width: 1100px)').matches?video.dataset.mobileSrc:video.dataset.desktopSrc;video.load(); }
      if(video.getAttribute('src'))video.play().catch(updateControl);
    }
    else video.pause();
    updateControl();
  }

  listen(video, 'playing', () => { surface.classList.add('is-playing'); cancelFrame(); nextFrame(); updateControl(); });
  listen(video, 'pause', () => { cancelFrame(); draw(); updateControl(); });
  listen(video, 'loadeddata', draw);
  listen(video, 'seeked', draw);
  listen(video, 'error', () => { surface.classList.remove('is-panorama','is-playing'); updateControl(); });
  listen(control, 'click', () => { wantsPlayback = video.paused; reconcile(); });
  listen(document, 'visibilitychange', reconcile);
  listen(motion, 'change', () => { if (motion.matches) wantsPlayback = false; reconcile(); });
  const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; reconcile(); }, { threshold: 0.04 });
  observer.observe(surface);
  const sizeObserver = new ResizeObserver(resize);
  sizeObserver.observe(surface);
  listen(poster,'load',()=>{if(!disposed){draw();reconcile();}});
  video.muted = true;
  resize();
  reconcile();

  return () => {
    disposed = true;
    cancelFrame();
    events.abort();
    observer.disconnect();
    sizeObserver.disconnect();
    video.pause();
  };
}
