// Pointer capture handles mouse, pen and touch; keyboard arrows offer the same move.
export function installSubtitles(panel, handle, reset, onSave = () => {}, initial = null) {
  let position = initial, drag = null;
  const limits = () => ({ x: Math.max(0, innerWidth - panel.offsetWidth - 16), y: Math.max(0, innerHeight - panel.offsetHeight - 16) });
  const place = () => {
    if (!position) { panel.style.left = '';panel.style.top = '';panel.style.bottom = '';panel.style.transform = '';return; }
    const limit = limits();
    panel.style.left = `${8 + position.x * limit.x}px`;
    panel.style.top = `${8 + position.y * limit.y}px`;
    panel.style.bottom = 'auto';panel.style.transform = 'none';
  };
  const move = (left, top) => {
    const limit = limits();
    position = { x: limit.x ? Math.max(0, Math.min(1, (left - 8) / limit.x)) : 0, y: limit.y ? Math.max(0, Math.min(1, (top - 8) / limit.y)) : 0 };
    place();
  };
  handle.addEventListener('pointerdown', event => {
    if (event.button !== 0) return;
    const rect = panel.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX - rect.left, y: event.clientY - rect.top };
    handle.setPointerCapture(event.pointerId);panel.classList.add('dragging');event.preventDefault();
  });
  handle.addEventListener('pointermove', event => { if (drag?.id === event.pointerId) move(event.clientX - drag.x, event.clientY - drag.y); });
  const finish = () => { if (drag) { drag = null;panel.classList.remove('dragging');onSave(position); } };
  handle.addEventListener('pointerup', finish);handle.addEventListener('pointercancel', finish);handle.addEventListener('lostpointercapture', finish);
  handle.addEventListener('keydown', event => {
    const delta = { ArrowLeft: [-20, 0], ArrowRight: [20, 0], ArrowUp: [0, -20], ArrowDown: [0, 20] }[event.key];
    if (!delta) return;
    event.preventDefault();event.stopPropagation();const rect = panel.getBoundingClientRect();move(rect.left + delta[0], rect.top + delta[1]);onSave(position);
  });
  reset.addEventListener('click', () => { position = null;place();onSave(null); });
  addEventListener('resize', place);
  new ResizeObserver(place).observe(panel);
  const dock = panel.parentElement?.querySelector('.reading-dock');
  if (dock) new ResizeObserver(() => panel.style.setProperty('--dock-height', `${dock.offsetHeight}px`)).observe(dock);
  place();
  return { refresh: place };
}
