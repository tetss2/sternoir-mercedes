// One decoded video, one continuous scene. On wide displays only the empty
// woodland to the left is expanded; the car and driver keep their proportions.
export function bindHeroFilm(video, control, icon) {
  const surface = video.closest('.hero-film');
  const canvas = surface.querySelector('canvas');
  let context = null;
  const poster = surface.querySelector('.hero-poster');
  const events = new AbortController();
  const motion = matchMedia('(prefers-reduced-motion: reduce)');
  const compact = matchMedia('(max-width: 1100px)').matches;
  const touch = matchMedia('(pointer: coarse)').matches || navigator.maxTouchPoints > 0;
  const ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (/Macintosh/.test(navigator.userAgent) && touch);
  // Mobile uses the lightweight film and the native inline video surface.
  // Device type must not disable autoplay; keep the user's motion/data choice.
  const reducedPlayback = motion.matches || !!navigator.connection?.saveData;
  const allowPanorama = !compact && !touch && !ios;
  let wantsPlayback = !reducedPlayback;
  let gesturePlayback = false;
  let visible = false, disposed = false, suspended = false, frame = null, lastTime = -1;
  let pendingPlay = false;
  let width = 0, height = 0, panorama = false;

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
    if (!allowPanorama || disposed) return;
    const box = surface.getBoundingClientRect();
    // The supplied film is 720p. Cap the canvas to avoid unnecessary GPU work
    // on high-density ultrawide displays while retaining full scene coverage.
    const resolution = Math.min(devicePixelRatio || 1, 1.5, 3840 / Math.max(box.width, 1));
    width = Math.max(1, Math.round(box.width * resolution));
    height = Math.max(1, Math.round(box.height * resolution));
    const wide = box.width > 1100 && box.width / box.height > 16 / 9;
    // Do not allocate a graphics context for the normal video or mobile view.
    if (wide && !context) context = canvas.getContext('2d', { alpha: false });
    panorama = !!context && wide;
    surface.classList.toggle('is-panorama', false);
    if (panorama) { canvas.width = width; canvas.height = height; draw();if(!video.paused){cancelFrame();nextFrame();} }
    else { cancelFrame(); canvas.width = 1; canvas.height = 1; }
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
    video.autoplay = wantsPlayback && visible && !suspended && !document.hidden;
    if (video.autoplay) {
      // Let the lightweight poster arrive first. A real play gesture can start
      // the film immediately even while that image is still downloading.
      if (!video.getAttribute('src') && (poster.complete || gesturePlayback)) {
        video.src = (compact || touch || ios) ? video.dataset.mobileSrc : video.dataset.desktopSrc;
      }
      if (video.getAttribute('src') && video.paused && !pendingPlay) {
        pendingPlay = true;
        video.play().catch(() => {
          // A rejected autoplay must wait for a real click, not retry whenever
          // an observer or poster event fires in a restricted WKWebView.
          if (!disposed && visible && !suspended && !document.hidden) {
            wantsPlayback = false;
            video.autoplay = false;
          }
        }).finally(() => { pendingPlay = false; if (!disposed) updateControl(); });
      }
    }
    else video.pause();
    updateControl();
  }

  listen(video, 'playing', () => { surface.classList.add('is-playing'); cancelFrame(); nextFrame(); updateControl(); });
  listen(video, 'pause', () => { cancelFrame(); draw(); updateControl(); });
  listen(video, 'loadeddata', draw);
  listen(video, 'seeked', draw);
  function releaseMedia() {
    cancelFrame();
    video.autoplay = false;
    video.pause();
    if (video.getAttribute('src')) { video.removeAttribute('src'); video.load(); }
    canvas.width = 1; canvas.height = 1;
    surface.classList.remove('is-panorama', 'is-playing');
    lastTime = -1;
  }

  listen(video, 'error', () => { wantsPlayback = false; video.autoplay = false; surface.classList.remove('is-panorama','is-playing'); updateControl(); });
  listen(control, 'click', () => {
    wantsPlayback = video.paused;
    // The control can be visible before IntersectionObserver's first callback.
    if (wantsPlayback) { visible = true; gesturePlayback = true; }
    reconcile();
  });
  listen(document, 'visibilitychange', reconcile);
  listen(window, 'pagehide', () => {
    suspended = true;
    releaseMedia();
  });
  listen(window, 'pageshow', () => { suspended = false; resize(); reconcile(); });
  listen(motion, 'change', () => { if (motion.matches) wantsPlayback = false; reconcile(); });
  const observer = new IntersectionObserver(([entry]) => { visible = entry.isIntersecting; reconcile(); }, { threshold: 0.04 });
  observer.observe(surface);
  const sizeObserver = allowPanorama ? new ResizeObserver(resize) : null;
  sizeObserver?.observe(surface);
  listen(poster,'load',()=>{if(!disposed){draw();reconcile();}});
  video.muted = true;
  video.playsInline = true;
  video.preload = 'none';
  resize();
  reconcile();

  return () => {
    disposed = true;
    cancelFrame();
    events.abort();
    observer.disconnect();
    sizeObserver?.disconnect();
    releaseMedia();
    context = null;
  };
}
