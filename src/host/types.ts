/** Narrow Zotero 9 host surface, isolated from the layout state machine. Source-checked against 9.0.6. */
export interface PdfEventBus {
  on(name: string, callback: (event: { presetValue?: string; scale?: number }) => void): void;
  off(name: string, callback: (event: { presetValue?: string; scale?: number }) => void): void;
}
export interface PdfPageView { div: HTMLElement; viewport: { convertToViewportPoint(x: number, y: number): [number, number] } }
export interface PdfViewer {
  currentScale: number;
  currentScaleValue: number | string;
  /** Committed page. pdf.js sets this synchronously on a jump, before `_location` catches up. */
  currentPageNumber?: number;
  scrollPageIntoView(options: { pageNumber: number; destArray: [number, { name: string }, number, number, null]; allowNegativeOffset: boolean; ignoreDestinationZoom: boolean }): void;
  _location?: { pageNumber: number; left: number; top: number; scale: string | number };
  _pages?: PdfPageView[];
}
export interface PdfApplication {
  pdfDocument?: { fingerprints?: string[]; getData(): Promise<ArrayBuffer | Uint8Array> };
  pdfViewer: PdfViewer;
  eventBus?: PdfEventBus;
  zoomIn?(): void;
  zoomOut?(): void;
}
export interface PdfView {
  _iframeWindow?: { PDFViewerApplication?: PdfApplication };
  _iframe?: HTMLIFrameElement;
  initializedPromise?: Promise<void>;
}
export interface ReaderLocation { position?: { pageIndex: number; rects: number[][]; nextPageRects?: number[][] }; pageIndex?: number; dest?: [number, { name: string }, number, number, number | null] }
export interface HostReader {
  itemID: number;
  tabID?: string;
  type: string;
  _window: ZoteroWindow;
  /** The chrome `<browser>` that hosts the reader document; its rect is the reader viewport. */
  _iframe?: Element;
  _iframeWindow?: Window;
  _internalReader?: { _lastView?: PdfView; _primaryView?: PdfView };
  zoomPageWidth(): void;
  zoomPageHeight(): void;
  zoomAuto(): void;
  navigate(location: ReaderLocation): void | Promise<void>;
}
export interface ItemDetails extends HTMLElement { scrollToPane(id: string, behavior: string): Promise<void> }
export interface ZoteroWindow extends Window {
  MutationObserver: typeof MutationObserver;
  ResizeObserver: typeof ResizeObserver;
  Zotero_Tabs?: { selectedID: string };
  ZoteroContextPane?: { collapsed: boolean; context: HTMLElement & { mode: 'item' | 'notes' } };
}
/** Zotero item fields the reader may read; `getField` returns `''` for a valid field a type does not set. */
export interface HostCreator { firstName?: string; lastName?: string; name?: string; creatorType?: string; fieldMode?: number }
export interface HostItem {
  id?: number; key: string; libraryID: number; parentItemID?: number;
  /** Zotero item type name (`item.js:143-145`); `'attachment'` for the PDF itself. */
  itemType?: string;
  getField(name: string): string;
  getCreators?(): HostCreator[];
  getTags?(): Array<{ tag: string; type?: number }>;
  getFilePathAsync?(): Promise<string | false>;
}
export interface ToolbarEvent { reader: HostReader; doc: Document; append(...elements: HTMLElement[]): void }
export interface SectionEvent { doc: Document; body: HTMLElement; tabType: string; setEnabled(this: void, enabled: boolean): void }
export interface ZoteroHost {
  getMainWindows(): ZoteroWindow[];
  logError(error: unknown): void;
  launchURL(url: string): void;
  Prefs: { get(key: string, global?: boolean): unknown; set(key: string, value: string | number | boolean, global?: boolean): void };
  Items: { get(id: number): HostItem | undefined; getByLibraryAndKey?(libraryID: number, key: string): HostItem | false | undefined };
  Reader: {
    _readers: HostReader[];
    getByTabID(id: string): HostReader | undefined;
    open?(itemID: number, location?: ReaderLocation): Promise<HostReader | false>;
    registerEventListener(name: string, listener: (event: never) => void, pluginID: string): void;
  };
  ItemPaneManager: {
    registerSection(options: {
      paneID: string; pluginID: string;
      header: { l10nID: string; icon: string }; sidenav: { l10nID: string; icon: string };
      onItemChange(event: SectionEvent): void; onRender(event: SectionEvent): void;
    }): string;
    unregisterSection(id: string): void;
  };
  Notifier: { registerObserver(observer: { notify(): void }, types: string[], id: string): string; unregisterObserver(id: string): void };
  /** Zotero 7+ plugin preference panes; absent only on an incompatible host. */
  PreferencePanes?: {
    register(options: { pluginID: string; id?: string; label?: string; image?: string; src: string; scripts?: string[]; stylesheets?: string[]; helpURL?: string; defaultXUL?: boolean }): Promise<string>;
    unregister(id: string): void;
  };
}
