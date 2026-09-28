import type { Citation, Rect } from '../model.ts';
import type { HostReader } from './types.ts';
import type { SelectionPopupEvent } from '../context/selection.ts';
export interface Box { left: number; top: number; right: number; bottom: number }
/** Geometry read from the PDF view; everything is CSS px of the reader document except PDF rects. */
export interface PageGeometry {
  pageRect(pageIndex: number): { left: number; top: number } | undefined;
  toViewport(pageIndex: number, rect: Rect): Rect | undefined;
  frameOffset(): { left: number; top: number };
}
const GAP = 8;
const INSET = 4;
/** Union of PDF rects → viewport (normalized, y flips) → PDF-iframe client px → reader-document client px. */
export function selectionViewRect(geometry: PageGeometry, pageIndex: number, rects: Rect[]): Box | null {
  const page = geometry.pageRect(pageIndex); if (!page) return null;
  const union: Rect = [Math.min(...rects.map(r => r[0])), Math.min(...rects.map(r => r[1])), Math.max(...rects.map(r => r[2])), Math.max(...rects.map(r => r[3]))];
  const view = geometry.toViewport(pageIndex, union); if (!view) return null;
  const frame = geometry.frameOffset();
  const left = Math.min(view[0], view[2]) + page.left + frame.left; const right = Math.max(view[0], view[2]) + page.left + frame.left;
  const top = Math.min(view[1], view[3]) + page.top + frame.top; const bottom = Math.max(view[1], view[3]) + page.top + frame.top;
  return { left, top, right, bottom };
}
function placedBox(left: number, top: number, bar: { width: number; height: number }): Box {
  return { left, top, right: left + bar.width, bottom: top + bar.height };
}
function intersects(a: Box, b: Box): boolean {
  return a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top;
}
function fits(box: Box, view: Box): boolean {
  return box.left >= view.left + INSET && box.right <= view.right - INSET
    && box.top >= view.top + INSET && box.bottom <= view.bottom - INSET;
}
/** Prefer above the selection; otherwise a side or below that stays in view and does not cover the native popup. */
export function barPosition(selection: Box, bar: { width: number; height: number }, view: Box, nativePopup: Box | null): { left: number; top: number } {
  const clampLeft = (left: number) => Math.min(Math.max(left, view.left + INSET), Math.max(view.left + INSET, view.right - bar.width - INSET));
  const clampTop = (top: number) => Math.min(Math.max(top, view.top + INSET), Math.max(view.top + INSET, view.bottom - bar.height - INSET));
  const centerLeft = clampLeft((selection.left + selection.right) / 2 - bar.width / 2);
  const belowTop = nativePopup && nativePopup.top >= selection.bottom - 1 ? nativePopup.bottom + GAP : selection.bottom + GAP;
  const candidates = [
    { left: centerLeft, top: selection.top - GAP - bar.height },
    { left: centerLeft, top: belowTop },
    { left: selection.left - GAP - bar.width, top: clampTop(selection.top) },
    { left: selection.right + GAP, top: clampTop(selection.top) },
  ];
  for (const candidate of candidates) {
    const box = placedBox(candidate.left, candidate.top, bar);
    if (!fits(box, view) || intersects(box, selection)) continue;
    if (nativePopup && intersects(box, nativePopup)) continue;
    return candidate;
  }
  return { left: centerLeft, top: clampTop(belowTop) };
}
export interface SelectionActionHandlers { explain(citation: Citation): void; ask(citation: Citation): void }
const STYLE_ID = 'zchatgptweb-selection-style';
const STYLE = `
.zchatgptweb-selection-bar { position: absolute; z-index: 100; display: flex; gap: 2px; padding: 3px; border-radius: 6px; color-scheme: inherit; background: var(--material-toolbar, var(--material-background, Canvas)); border: 1px solid var(--color-panedivider, GrayText); box-shadow: 0 2px 8px rgba(0,0,0,.12); font: -apple-system-body; font-size: 12px; color: var(--fill-primary, CanvasText); }
.zchatgptweb-selection-bar button { font: inherit; color: inherit; background: transparent; border: 0; border-radius: 4px; padding: 3px 8px; cursor: pointer; white-space: nowrap; }
.zchatgptweb-selection-bar button:hover { background: var(--fill-quinary, rgba(0,0,0,.06)); }
.zchatgptweb-selection-bar button:focus-visible { outline: 2px solid light-dark(#1d4ed8, #8ab4ff); outline-offset: 1px; }
.zchatgptweb-selection-bar .zchatgptweb-separator { width: 1px; background: var(--color-panedivider, GrayText); margin: 2px 0; }
.selection-popup .custom-sections .section:has(> [data-zchatgptweb-sentinel]) { display: none; }
`;
/**
 * The compact action bar above a text selection. It lives in the reader document, never inside or over
 * the native annotation popup, and disappears together with that popup. Only its buttons take pointer events.
 */
export class SelectionActionBar {
  private bar: HTMLElement | null = null;
  private sentinel: HTMLElement | null = null;
  private observer: MutationObserver | null = null;
  private detach: (() => void) | null = null;
  private citation: Citation | null = null;
  constructor(private handlers: SelectionActionHandlers) {}
  show(event: SelectionPopupEvent, citation: Citation): void {
    this.hide();
    const doc = event.doc; const win = doc.defaultView;
    if (!win) return;
    this.citation = citation;
    this.ensureStyle(doc);
    // A hidden node inside the native popup mirrors its lifetime: no dismissal event exists.
    const sentinel = doc.createElement('span'); sentinel.dataset.zchatgptwebSentinel = ''; sentinel.hidden = true;
    try { event.append(sentinel); } catch { return; }
    this.sentinel = sentinel;
    const bar = doc.createElement('div'); bar.className = 'zchatgptweb-selection-bar'; bar.dataset.zchatgptwebSelectionBar = ''; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'ChatGPT Web');
    const make = (label: string, action: string, run: () => void) => {
      const button = doc.createElement('button'); button.type = 'button'; button.textContent = label; button.dataset.zchatgptwebAction = action;
      // The citation was copied before this click; blur or resizing cannot swap it.
      button.addEventListener('click', e => { e.preventDefault(); e.stopPropagation(); const current = this.citation; if (current && current.id === citation.id) run(); });
      return button;
    };
    const separator = doc.createElement('span'); separator.className = 'zchatgptweb-separator';
    bar.append(make('More details', 'explain', () => this.handlers.explain(citation)), separator, make('Ask in sidechat', 'ask', () => this.handlers.ask(citation)));
    bar.style.visibility = 'hidden'; doc.body.append(bar); this.bar = bar;
    this.position(event.reader, doc, citation);
    bar.style.visibility = '';
    const reposition = () => { if (this.bar) this.position(event.reader, doc, citation); };
    const ui = doc.getElementById('reader-ui');
    // A chrome-created observer watching content nodes; content never calls into privileged code directly.
    this.observer = new event.reader._window.MutationObserver(() => { if (!sentinel.isConnected) this.hide(); else reposition(); });
    if (ui) this.observer.observe(ui, { childList: true, subtree: true, attributes: true, attributeFilter: ['style', 'class'] });
    const viewWindow = viewFrame(event.reader)?.contentWindow ?? null;
    const scroller = viewWindow?.document.getElementById('viewerContainer') ?? null;
    scroller?.addEventListener('scroll', reposition, { passive: true }); win.addEventListener('resize', reposition);
    this.detach = () => { scroller?.removeEventListener('scroll', reposition); win.removeEventListener('resize', reposition); };
  }
  private ensureStyle(doc: Document): void {
    if (doc.getElementById(STYLE_ID)) return;
    const style = doc.createElement('style'); style.id = STYLE_ID; style.textContent = STYLE; doc.head?.append(style);
  }
  private position(reader: HostReader, doc: Document, citation: Citation): void {
    const bar = this.bar; if (!bar) return;
    const geometry = readerGeometry(reader); const frame = viewFrame(reader);
    const selection = geometry ? selectionViewRect(geometry, citation.pageIndex, citation.rects) : null;
    if (!selection || !frame) { bar.hidden = true; return; }
    const viewBox = frame.getBoundingClientRect();
    const view: Box = { left: viewBox.left, top: viewBox.top, right: viewBox.right, bottom: viewBox.bottom };
    const native = doc.querySelector('.selection-popup')?.getBoundingClientRect();
    const size = { width: bar.offsetWidth || 180, height: bar.offsetHeight || 28 };
    const { left, top } = barPosition(selection, size, view, native ? { left: native.left, top: native.top, right: native.right, bottom: native.bottom } : null);
    bar.hidden = false; bar.style.left = `${Math.round(left)}px`; bar.style.top = `${Math.round(top)}px`;
  }
  /** A limit notice (for example a cross-page selection) inside the native popup's plugin area; no buttons. */
  showNotice(event: SelectionPopupEvent, text: string): void {
    this.hide();
    const note = event.doc.createElement('div'); note.dataset.zchatgptwebSelectionNotice = ''; note.textContent = text;
    note.style.fontSize = '11px'; note.style.color = 'var(--fill-secondary, GrayText)'; note.style.lineHeight = '1.4';
    try { event.append(note); } catch { /* the popup may already be gone */ }
  }
  hide(): void {
    this.detach?.(); this.detach = null;
    this.observer?.disconnect(); this.observer = null;
    this.bar?.remove(); this.bar = null;
    this.sentinel?.remove(); this.sentinel = null;
    this.citation = null;
  }
  dispose(): void { this.hide(); }
}
/** The PDF viewer iframe inside the reader document (reader.js:67924-67926, appended to #primary-view). */
function viewFrame(reader: HostReader): HTMLIFrameElement | null {
  const frame = reader._internalReader?._primaryView?._iframe;
  if (frame) return frame;
  return reader._iframeWindow?.document.querySelector<HTMLIFrameElement>('#primary-view > iframe') ?? null;
}
function readerGeometry(reader: HostReader): PageGeometry | null {
  const view = reader._internalReader?._primaryView ?? reader._internalReader?._lastView;
  const viewer = view?._iframeWindow?.PDFViewerApplication?.pdfViewer;
  const frame = viewFrame(reader);
  if (!viewer || !frame) return null;
  return {
    pageRect: pageIndex => { const page = viewer._pages?.[pageIndex]; if (!page?.div) return undefined; const r = page.div.getBoundingClientRect(); return { left: r.left, top: r.top }; },
    toViewport: (pageIndex, rect) => {
      const viewport = viewer._pages?.[pageIndex]?.viewport; if (!viewport) return undefined;
      const [x1, y2] = viewport.convertToViewportPoint(rect[0], rect[1]); const [x2, y1] = viewport.convertToViewportPoint(rect[2], rect[3]);
      return [Math.min(x1, x2), Math.min(y1, y2), Math.max(x1, x2), Math.max(y1, y2)];
    },
    frameOffset: () => { const r = frame.getBoundingClientRect(); return { left: r.left, top: r.top }; },
  };
}
