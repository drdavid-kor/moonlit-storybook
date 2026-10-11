// Shared by the online reader and the exported, network-free book.
export function playSceneMotion(container, enabled) {
  const video = container.querySelector('video.story-motion');
  if (!video) return;
  video.muted = true;
  const poster = container.querySelector('.story-illustration');
  if (!enabled) { video.pause();video.hidden = true;poster.hidden = false;return; }
  video.hidden = false;
  const playing = () => { if (container.contains(video) && !video.paused) poster.hidden = true; };
  video.addEventListener('playing', playing, { once: true });
  video.addEventListener('error', () => { video.hidden = true;poster.hidden = false; }, { once: true });
  video.play().then(playing).catch(() => { video.hidden = true;poster.hidden = false; });
}
