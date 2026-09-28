import { MIN_SIDEBAR_WIDTH, sidebarWidthBounds } from './layout.ts';

export const DOCK_ATTR = 'data-zchatgptweb-dock';
export const DOCK_WIDTH_VAR = '--zchatgptweb-dock-width';
export const DOCK_OPEN_CLASS = 'zchatgptweb-dock-open';
/** One arrow press; Shift+Arrow moves four times as far. */
export const DOCK_RESIZE_STEP = 16;
export const DOCK_RESIZE_STEP_LARGE = 64;

function createHtmlElement(doc: Document, tag: string): HTMLElement {
  return doc.createElement(tag);
}

export function readerContentRoot(doc: Document): HTMLElement | null {
  return doc.getElementById('split-view');
}

function markDockOpen(doc: Document, split: HTMLElement): void {
  split.classList.add(DOCK_OPEN_CLASS);
  doc.documentElement.classList.add(DOCK_OPEN_CLASS);
  doc.body.classList.add(DOCK_OPEN_CLASS);
}

/** Inline flex so the PDF column shrinks before the injected stylesheet paints. */
function paintDockColumn(dock: HTMLElement, width?: number): void {
  const basis = width !== undefined ? Math.round(width) : MIN_SIDEBAR_WIDTH;
  const value = `${basis}px`;
  const pin = (name: string, next: string) => { dock.style.setProperty(name, next, 'important'); };
  pin('display', 'flex');
  pin('flex-direction', 'row');
  pin('flex-grow', '0');
  pin('flex-shrink', '0');
  pin('flex-basis', value);
  pin('width', value);
  pin('min-width', `${MIN_SIDEBAR_WIDTH}px`);
  pin('height', '100%');
  pin('align-self', 'stretch');
  pin('writing-mode', 'horizontal-tb');
  pin('direction', 'ltr');
  pin('unicode-bidi', 'isolate');
  pin('overflow', 'hidden');
  pin('box-sizing', 'border-box');
  pin('background', 'var(--material-background, var(--color-background, Canvas))');
  pin('color', 'var(--fill-primary, CanvasText)');
  pin('font-family', 'inherit');
  pin('font-size', '13px');
  pin('line-height', '1.4');
}

/**
 * Zotero 9.0.6's reader FocusManager installs a CAPTURE-phase `keydown` listener on the same
 * reader window our dock is mounted into. Before focus reaches a shell control, it runs
 * (resource/reader/reader.js:72538, `FocusManager._handleKeyDown`):
 *   if (pressedNextKey(e) && !e.target.closest('[contenteditable], input[type="text"], .preview-popup')) {
 *     e.preventDefault(); this.tabToItem();
 *   }
 * and the mirror branch for ArrowLeft (reader.js:72541). Because capture runs on the window
 * first, toolbar navigation can switch panes while a shell control has focus.
 * `closest('[contenteditable]')` matches any ancestor that merely carries the attribute, whatever
 * its value, so an explicit non-editable `contenteditable="false"` on the dock exempts every
 * control inside it; form controls are unaffected by an ancestor's contenteditable state and keep
 * native editing. The splitter also needs its own ArrowLeft/ArrowRight handling.
 */
function exemptFromReaderFocusManager(dock: HTMLElement): void {
  dock.setAttribute('contenteditable', 'false');
}

export function mountReaderDock(doc: Document): { dock: HTMLElement; body: HTMLElement } | undefined {
  const split = readerContentRoot(doc);
  const toolbar = doc.querySelector('.toolbar');
  if (!split || !toolbar) return undefined;
  const existing = split.querySelector<HTMLElement>(`[${DOCK_ATTR}]`);
  if (existing) {
    exemptFromReaderFocusManager(existing);
    markDockOpen(doc, split);
    const current = Number.parseFloat(existing.style.width || existing.style.flexBasis);
    paintDockColumn(existing, Number.isFinite(current) && current > 0 ? current : undefined);
    return { dock: existing, body: existing.querySelector<HTMLElement>('[data-zchatgptweb-dock-body]') ?? existing };
  }
  const dock = createHtmlElement(doc, 'aside');
  dock.className = 'zchatgptweb-dock zchatgptweb-paper';
  dock.setAttribute(DOCK_ATTR, '');
  dock.setAttribute('role', 'complementary');
  dock.setAttribute('aria-label', 'ChatGPT Web');
  exemptFromReaderFocusManager(dock);
  const resizer = createHtmlElement(doc, 'div');
  resizer.className = 'zchatgptweb-dock-resizer';
  resizer.dataset.zchatgptwebResizer = '';
  resizer.setAttribute('role', 'separator');
  resizer.setAttribute('aria-orientation', 'vertical');
  resizer.setAttribute('aria-label', 'Resize ChatGPT Web sidebar');
  resizer.setAttribute('tabindex', '0');
  const body = createHtmlElement(doc, 'div');
  body.className = 'zchatgptweb-dock-body';
  body.dataset.zchatgptwebDockBody = '';
  dock.append(resizer, body);
  paintDockColumn(dock);
  split.append(dock);
  markDockOpen(doc, split);
  return { dock, body };
}

export function applyDockWidth(doc: Document, width: number): void {
  const value = `${Math.round(width)}px`;
  doc.documentElement.style.setProperty(DOCK_WIDTH_VAR, value);
  const dock = doc.querySelector<HTMLElement>(`[${DOCK_ATTR}]`);
  if (!dock) return;
  paintDockColumn(dock, Math.round(width));
}

export interface DockResizeHost {
  currentWidth(): number;
  setWidth(cssPixels: number): void;
  measureAvailableWidth(): number;
}

/** The dock sits on the right, so ArrowLeft widens it and ArrowRight narrows it. */
const RESIZE_KEYS = new Set(['ArrowLeft', 'ArrowRight', 'Home', 'End']);

/** Text fields and focusable controls keep their own key handling instead of resizing the dock. */
function reservesResizeKeys(target: EventTarget | null): boolean {
  const element = target as (HTMLElement & { isContentEditable?: boolean }) | null;
  if (!element || typeof element !== 'object' || !('tagName' in element)) return false;
  const tag = String(element.tagName ?? '').toLowerCase();
  if (element.isContentEditable || tag === 'input' || tag === 'textarea' || tag === 'select' || tag === 'button' || tag === 'a') return true;
  // Only a genuinely editable ancestor reserves the keys. The dock carries an explicit
  // `contenteditable="false"` marker for Zotero's FocusManager guard (see mountReaderDock), so a
  // bare `[contenteditable]` match would wrongly treat the dock's own splitter as a text field.
  return typeof element.closest === 'function' && element.closest('[contenteditable="true"], [contenteditable=""], [role="textbox"]') !== null;
}

/** Pointer capture and keyboard resizing so the reader stays reachable without a mouse.
 * Width changes are coalesced into one host.setWidth per animation frame: applying a width
 * captures the PDF position and re-zooms, which is too expensive to run per event on a busy drag.
 * Pointer release (and every keyboard press) flushes the final position exactly once, so no move
 * is dropped. `host.setWidth` is the only write path, so keyboard and pointer both persist the
 * width and re-anchor the PDF identically. */
export function bindDockResize(resizer: HTMLElement, host: DockResizeHost): () => void {
  const doc = resizer.ownerDocument;
  const view = doc.defaultView;
  const frame: (run: () => void) => number = typeof view?.requestAnimationFrame === 'function'
    ? run => view.requestAnimationFrame(() => run())
    : run => (view?.setTimeout(run, 16) ?? setTimeout(run, 16)) as unknown as number;
  const drop = (handle: number) => { if (typeof view?.cancelAnimationFrame === 'function') view.cancelAnimationFrame(handle); else view?.clearTimeout(handle); };
  // Screen readers need the same temporary clamp the controller applies, not the raw remembered wish.
  const syncAria = () => {
    const { min, max } = sidebarWidthBounds(host.measureAvailableWidth());
    const apply = (name: string, value: number) => resizer.setAttribute(name, String(value));
    apply('aria-valuemin', min);
    apply('aria-valuemax', max);
    apply('aria-valuenow', Math.min(Math.max(Math.round(host.currentWidth()), min), max));
  };
  let dragging = false;
  let activePointerId: number | null = null;
  let startX = 0;
  let startWidth = 0;
  let pendingWidth: number | null = null;
  let handle: number | null = null;
  const flush = () => { if (pendingWidth === null) return; const width = pendingWidth; pendingWidth = null; host.setWidth(width); syncAria(); };
  const schedule = (width: number) => {
    pendingWidth = width;
    if (handle === null) handle = frame(() => { handle = null; flush(); });
  };
  const settle = () => {
    if (handle !== null) { drop(handle); handle = null; }
    flush();
  };
  const onMove = (event: PointerEvent) => {
    if (!dragging || event.pointerId !== activePointerId) return;
    event.preventDefault();
    schedule(startWidth + (startX - event.clientX));
  };
  const finishPointer = (event: PointerEvent) => {
    if (!dragging || event.pointerId !== activePointerId) return;
    dragging = false;
    activePointerId = null;
    settle();
    try { resizer.releasePointerCapture(event.pointerId); } catch { /* capture may already be gone */ }
    doc.removeEventListener('pointermove', onMove);
    doc.removeEventListener('pointerup', onUp);
    doc.removeEventListener('pointercancel', onCancel);
  };
  const onUp = (event: PointerEvent) => finishPointer(event);
  const onCancel = (event: PointerEvent) => finishPointer(event);
  const onDown = (event: PointerEvent) => {
    if (event.button !== 0 || event.isPrimary === false) return;
    event.preventDefault();
    settle();
    dragging = true;
    activePointerId = event.pointerId;
    startX = event.clientX;
    startWidth = host.currentWidth();
    try { resizer.setPointerCapture(event.pointerId); } catch { /* happy-dom / older Gecko */ }
    doc.addEventListener('pointermove', onMove);
    doc.addEventListener('pointerup', onUp);
    doc.addEventListener('pointercancel', onCancel);
  };
  const onKeyDown = (event: KeyboardEvent) => {
    if (!RESIZE_KEYS.has(event.key) || event.defaultPrevented) return;
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (reservesResizeKeys(event.target)) return;
    const step = event.shiftKey ? DOCK_RESIZE_STEP_LARGE : DOCK_RESIZE_STEP;
    const next = event.key === 'Home' ? sidebarWidthBounds(host.measureAvailableWidth()).min
      : event.key === 'End' ? sidebarWidthBounds(host.measureAvailableWidth()).max
        : (pendingWidth ?? host.currentWidth()) + (event.key === 'ArrowLeft' ? step : -step);
    event.preventDefault();
    schedule(next);
  };
  // A width applied outside this binding (open, viewport clamp) still refreshes aria-valuenow.
  const Observer = (view as unknown as { ResizeObserver?: typeof ResizeObserver } | null)?.ResizeObserver;
  const dock = resizer.parentElement;
  const observer = dock && typeof Observer === 'function' ? new Observer(() => syncAria()) : undefined;
  if (observer && dock) observer.observe(dock);
  resizer.addEventListener('pointerdown', onDown);
  resizer.addEventListener('keydown', onKeyDown);
  view?.addEventListener?.('resize', syncAria);
  syncAria();
  return () => {
    dragging = false;
    activePointerId = null;
    if (handle !== null) { drop(handle); handle = null; }
    pendingWidth = null;
    observer?.disconnect();
    resizer.removeEventListener('pointerdown', onDown);
    resizer.removeEventListener('keydown', onKeyDown);
    view?.removeEventListener?.('resize', syncAria);
    doc.removeEventListener('pointermove', onMove);
    doc.removeEventListener('pointerup', onUp);
    doc.removeEventListener('pointercancel', onCancel);
  };
}

export function unmountReaderDock(doc: Document): void {
  const dock = doc.querySelector<HTMLElement>(`[${DOCK_ATTR}]`);
  dock?.remove();
  doc.getElementById('split-view')?.classList.remove(DOCK_OPEN_CLASS);
  doc.documentElement.classList.remove(DOCK_OPEN_CLASS);
  doc.body.classList.remove(DOCK_OPEN_CLASS);
  doc.documentElement.style.removeProperty(DOCK_WIDTH_VAR);
}

export function injectReaderStyles(doc: Document): void {
  const head = doc.head ?? doc.documentElement;
  /**
   * The stylesheet is inlined as text, and a reader document outlives one add-on version: reloading
   * the plugin re-renders the sidebar with the new bundle while this document still holds the text
   * injected by the previous one. That mismatch is how new markup ends up styled by old CSS, so the
   * text is refreshed whenever it differs from the running bundle's copy. Comparing the text needs no
   * version plumbing and rewrites nothing when it already matches.
   */
  const existing = doc.querySelector<HTMLElement>('style[data-zchatgptweb-sidebar-css]');
  if (!existing) {
    const css = createHtmlElement(doc, 'style');
    css.setAttribute('data-zchatgptweb-sidebar-css', '');
    head.append(css);
    css.append(doc.createTextNode(__ZCHATGPTWEB_SIDEBAR_CSS__));
  } else if (existing.textContent !== __ZCHATGPTWEB_SIDEBAR_CSS__) {
    // `replaceChildren` keeps exactly one text node, so reading `textContent` back is always the CSS.
    existing.replaceChildren(doc.createTextNode(__ZCHATGPTWEB_SIDEBAR_CSS__));
  }
}
