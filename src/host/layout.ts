export type Scale = number | 'auto' | 'page-fit' | 'page-width';
export interface Anchor { pageIndex: number; left: number; top: number }
export interface ViewPosition { anchor: Anchor; scale: Scale }
export interface DockState { collapsed: boolean; mode: 'item' | 'notes'; scrollTop: number; width: number }
export const DEFAULT_SIDEBAR_WIDTH = 360;
export const MIN_SIDEBAR_WIDTH = 320;
/** Keep at least this much of the reader+sidebar strip for the PDF so the pane cannot cover it. */
export const MIN_READER_WIDTH = 360;
/**
 * The temporary viewport clamp bounds for the sidebar. `clampSidebarWidth` and the resizer's
 * ARIA value range share this formula, so a screen reader always announces the same limits.
 */
export function sidebarWidthBounds(availableWidth: number): { min: number; max: number } {
  const available = Number.isFinite(availableWidth) && availableWidth > 0 ? availableWidth : DEFAULT_SIDEBAR_WIDTH + MIN_READER_WIDTH;
  const max = Math.max(0, Math.floor(available - MIN_READER_WIDTH));
  const min = Math.min(MIN_SIDEBAR_WIDTH, max);
  return { min, max };
}
/** User-chosen width is stored separately; this only applies a temporary viewport clamp. */
export function clampSidebarWidth(desired: number, availableWidth: number): number {
  const { min, max } = sidebarWidthBounds(availableWidth);
  const target = Number.isFinite(desired) && desired > 0 ? desired : DEFAULT_SIDEBAR_WIDTH;
  return Math.min(Math.max(Math.round(target), min), Math.max(min, max));
}
export interface LayoutHost {
  captureDock(): DockState;
  capturePosition(): ViewPosition | undefined;
  showDock(): void;
  restoreDock(state: DockState): void;
  mountChat(): Promise<boolean>;
  unmountChat(): void;
  setZoom(scale: Scale, anchor: Anchor): void;
  keepAnchor(anchor: Anchor): void;
  setActive(active: boolean): void;
  readDesiredWidth(): number;
  rememberWidth(cssPixels: number): void;
  measureAvailableWidth(): number;
  applyWidth(cssPixels: number): void;
  currentWidth(): number;
}
/** Owns only the temporary changes made while chat is active. Host DOM lives in the adapter. */
export class ReaderLayoutController {
  private opened = false;
  private disposed = false;
  private generation = 0;
  private previousDock: DockState | undefined;
  private previousScale: Scale | undefined;
  private previousFixedScale: number | undefined;
  private userZoomed = false;
  private desiredWidth = DEFAULT_SIDEBAR_WIDTH;
  constructor(private host: LayoutHost) {}
  get active(): boolean { return this.opened; }
  /** Selection actions only show: an already open sidebar must never be closed by them. */
  async open(): Promise<void> { if (this.opened || this.disposed) return; await this.toggle(); }
  async toggle(): Promise<void> {
    if (this.disposed) return;
    if (this.opened) { this.close(); return; }
    const generation = ++this.generation;
    this.previousDock = this.host.captureDock();
    const position = this.host.capturePosition();
    this.previousScale = position?.scale;
    this.previousFixedScale = typeof position?.scale === 'number' ? position.scale : undefined;
    this.userZoomed = false;
    this.desiredWidth = this.host.readDesiredWidth();
    this.opened = true;
    this.host.showDock();
    this.applyWidth(false);
    try {
      const ready = await this.host.mountChat();
      if (generation !== this.generation) {
        // A newer opening may now own the same DOM.
        if (!this.opened) this.host.unmountChat();
        return;
      }
      if (!ready) { this.close(); return; }
      const currentPosition = this.host.capturePosition();
      if (currentPosition) this.reflow(currentPosition);
      this.host.setActive(true);
    } catch (error) {
      if (generation === this.generation) this.close();
      throw error;
    }
  }
  close(restore = true): void {
    if (!this.opened) return;
    ++this.generation;
    this.opened = false;
    const position = this.host.capturePosition();
    this.host.unmountChat();
    if (restore && this.previousDock) this.host.restoreDock(this.previousDock);
    if (position && !this.userZoomed) {
      if (this.previousFixedScale !== undefined) this.host.setZoom(this.previousFixedScale, position.anchor);
      else if (this.previousScale !== undefined) this.host.setZoom(this.previousScale, position.anchor);
    }
    this.previousDock = undefined;
    this.previousScale = undefined;
    this.previousFixedScale = undefined;
    this.userZoomed = false;
    this.host.setActive(false);
  }
  nativeAction(): void { this.close(false); }
  manualZoom(): void { this.previousFixedScale = undefined; this.userZoomed = true; }
  /** Window or host layout changed: clamp the applied width, keep the remembered choice. */
  viewportChanged(): void { if (this.opened && !this.disposed) this.relayout(false); }
  /** Native splitter drag: persist the chosen width and restore the current PDF anchor. */
  setWidth(cssPixels: number): Promise<void> {
    if (this.opened && !this.disposed) {
      this.desiredWidth = cssPixels;
      this.relayout(true);
    }
    return Promise.resolve();
  }
  dispose(): void { this.close(); this.disposed = true; }
  private applyWidth(persist: boolean): number {
    const applied = clampSidebarWidth(this.desiredWidth, this.host.measureAvailableWidth());
    this.host.applyWidth(applied);
    if (persist) this.host.rememberWidth(this.desiredWidth);
    return applied;
  }
  private reflow(position: ViewPosition): void {
    if (this.userZoomed) this.host.keepAnchor(position.anchor);
    else if (this.previousFixedScale !== undefined) this.host.setZoom('page-width', position.anchor);
    else this.host.setZoom(position.scale, position.anchor);
  }
  private relayout(persist: boolean): void {
    const position = this.host.capturePosition();
    this.applyWidth(persist);
    if (position) this.reflow(position);
  }
}
