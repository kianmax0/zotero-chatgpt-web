import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { AttachmentIdentity, Citation } from '../../src/model.ts';
import type { HostReader, ZoteroHost, ZoteroWindow } from '../../src/host/types.ts';

const state = vi.hoisted(() => ({
  selectionHandlers: null as null | { explain(citation: Citation): void; ask(citation: Citation): void },
  eventListeners: new Map<string, (event: unknown) => void>(),
  identity: { libraryId: 4, attachmentKey: 'PDF-A', attachmentTitle: 'synthetic.pdf' },
  citation: null as Citation | null,
  submitResolution: null as null | ((result: { status: string }) => void),
  surface: null as null | Record<string, ReturnType<typeof vi.fn>>,
  preferences: new Map<string, unknown>(),
  shellStatus: null as null | ReturnType<typeof vi.fn>,
}));

vi.mock('../../src/context/metadata.ts', () => ({
  attachmentFromReader: () => state.identity,
  metadataForAttachment: () => ({ title: 'Synthetic paper', authors: ['Synthetic author'] }),
  bibliographyText: () => 'Synthetic bibliography',
}));
vi.mock('../../src/context/revision.ts', () => ({
  assertRevision: vi.fn(() => Promise.resolve(undefined)),
  captureRevision: vi.fn(() => Promise.resolve({ fingerprint: 'synthetic', size: 1, modifiedAt: 1, sha256: 'abc' })),
}));
vi.mock('../../src/context/selection.ts', () => ({
  captureSelection: () => state.citation,
  freezeSelectionVersion: (_host: ZoteroHost, _reader: HostReader, citation: Citation) => Promise.resolve({
    ...citation,
    revision: { fingerprint: 'synthetic', size: 1, modifiedAt: 1, sha256: 'abc' },
  }),
  openCitation: vi.fn(),
  selectionForPrompt: (citation: Citation) => `${citation.metadata.title}, page ${citation.pageLabel}\n${citation.text}`,
}));
vi.mock('../../src/host/clipboard.ts', () => ({ copyPdfFile: () => false }));
vi.mock('../../src/host/dock.ts', () => ({ injectReaderStyles: vi.fn() }));
vi.mock('../../src/host/reader-pane.ts', () => ({
  NativeReaderPane: class {
    controller = { open: () => Promise.resolve().then(() => {
      this.renderView({} as HTMLElement, state.identity, () => undefined, true);
    }) };
    constructor(
      _host: ZoteroHost,
      _reader: HostReader,
      _buttons: Set<HTMLButtonElement>,
      private renderView: (body: HTMLElement, identity: AttachmentIdentity, close: () => void, active: boolean) => void,
    ) {}
    supported() { return true; }
    selected() { return true; }
    reconcile() {}
    dispose() {}
  },
}));
vi.mock('../../src/host/selection-actions.ts', () => ({
  SelectionActionBar: class {
    constructor(handlers: typeof state.selectionHandlers) { state.selectionHandlers = handlers; }
    show() {}
    showNotice() {}
    dispose() {}
  },
}));
vi.mock('../../src/host/toolbar.ts', () => ({
  createToolbarButton: () => ({ isConnected: true, remove: vi.fn() }),
  insertToolbarButton: vi.fn(),
}));
vi.mock('../../src/ui/shell.ts', () => ({
  mountShell: () => ({ anchor: {} as HTMLElement, status: state.shellStatus = vi.fn(), dispose: vi.fn() }),
}));
vi.mock('../../src/web/actor.ts', () => ({
  OFFICIAL_CHAT_RESOURCE_ROOT: 'resource://zotero-chatgpt-web/',
  installOfficialChatResource: vi.fn(),
  registerOfficialChatActor: vi.fn(),
  removeOfficialChatResource: vi.fn(),
  unregisterOfficialChatActor: vi.fn(),
}));
vi.mock('../../src/web/embed.ts', () => ({
  createChatEmbedSurface: () => state.surface,
}));

import { shutdown, startup } from '../../src/index.ts';

function citation(): Citation {
  return {
    id: 'synthetic-selection',
    attachment: { ...state.identity },
    metadata: { title: 'Synthetic paper', authors: ['Synthetic author'] },
    text: 'A synthetic selected passage.',
    pageIndex: 2,
    pageLabel: '3',
    rects: [[1, 2, 3, 4]],
    capturedAt: '2026-09-27T00:00:00.000Z',
    revision: { fingerprint: 'synthetic', size: 1, modifiedAt: 1, sha256: 'abc' },
  };
}

function setupHost(): HostReader {
  const window = { confirm: () => true } as unknown as ZoteroWindow;
  const reader = { itemID: 11, type: 'pdf', _window: window } as HostReader;
  const attachment = { id: 11, key: state.identity.attachmentKey, libraryID: state.identity.libraryId };
  const host = {
    getMainWindows: () => [window],
    logError: vi.fn(),
    launchURL: vi.fn(),
    Prefs: { get: (key: string) => state.preferences.get(key), set: (key: string, value: unknown) => state.preferences.set(key, value) },
    Items: { get: (id: number) => id === 11 ? attachment : undefined },
    Reader: {
      _readers: [reader],
      getByTabID: () => reader,
      registerEventListener: (name: string, listener: (event: never) => void) => state.eventListeners.set(name, listener as unknown as (event: unknown) => void),
    },
    Notifier: { registerObserver: () => 'observer-id', unregisterObserver: vi.fn() },
  } as unknown as ZoteroHost;
  vi.stubGlobal('Zotero', host);
  return reader;
}

function selectionEvent(reader: HostReader) {
  return {
    reader,
    doc: {} as Document,
    append: () => undefined,
    params: { annotation: { text: 'A synthetic selected passage.', pageLabel: '3', position: { pageIndex: 2, rects: [[1, 2, 3, 4]] } } },
  } as never;
}

beforeEach(() => {
  state.eventListeners.clear();
  state.selectionHandlers = null;
  state.preferences.clear();
  state.citation = citation();
  state.submitResolution = null;
  state.shellStatus = null;
  state.surface = {
    bindContext: vi.fn(), bindConversation: vi.fn(), onStatus: vi.fn(), show: vi.fn(), hide: vi.fn(),
    readiness: vi.fn(() => 'ready'), stage: vi.fn(() => Promise.resolve({ status: 'staged' })),
    submitQuestion: vi.fn(() => new Promise<{ status: string }>(resolve => { state.submitResolution = resolve; })),
    reload: vi.fn(),
    snapshot: vi.fn(() => ({ url: 'https://chatgpt.com/c/synthetic-12345678', loading: false, loaded: true })),
    evictable: vi.fn(() => false), sync: vi.fn(), destroy: vi.fn(),
  };
});

afterEach(() => {
  shutdown();
  vi.unstubAllGlobals();
});

describe('Reader selection handoff to the official ChatGPT page', () => {
  function startAndCapture() {
    const reader = setupHost();
    startup({ pluginID: 'zotero-chatgpt-web@example.invalid', rootURI: 'jar:file:///synthetic.xpi!/' });
    state.eventListeners.get('renderTextSelectionPopup')?.(selectionEvent(reader));
    return reader;
  }

  it('Ask in sidechat stages the frozen passage and does not submit a question', async () => {
    startAndCapture();
    const handlers = state.selectionHandlers;
    expect(handlers).not.toBeNull();
    handlers!.ask(state.citation!);

    await vi.waitFor(() => expect(state.surface!.stage).toHaveBeenCalledTimes(1));
    expect(state.surface!.stage).toHaveBeenCalledWith('Synthetic paper, page 3\nA synthetic selected passage.');
    expect(state.surface!.submitQuestion).not.toHaveBeenCalled();
  });

  it('More details submits only through the official page surface', async () => {
    startAndCapture();
    const handlers = state.selectionHandlers;
    expect(handlers).not.toBeNull();
    handlers!.explain(state.citation!);

    await vi.waitFor(() => expect(state.surface!.submitQuestion).toHaveBeenCalledTimes(1));
    const question = String(state.surface!.submitQuestion!.mock.calls[0]?.[0]);
    expect(question).not.toContain('A synthetic selected passage.');
    const provider = state.surface!.bindContext!.mock.calls[0]?.[1] as (value: string) => Promise<unknown>;
    const prepared = await provider(question);
    expect(prepared).toMatchObject({ status: 'ready', selectedText: 'Synthetic paper, page 3\nA synthetic selected passage.' });
    state.submitResolution?.({ status: 'accepted' });
    expect(state.surface!.stage).not.toHaveBeenCalled();
  });

  it('More details keeps the explicit passage with automatic bibliography off', async () => {
    state.preferences.set('extensions.zchatgptweb.automaticBibliography', false);
    startAndCapture();
    state.selectionHandlers!.explain(state.citation!);
    await vi.waitFor(() => expect(state.surface!.submitQuestion).toHaveBeenCalledTimes(1));
    const question = String(state.surface!.submitQuestion!.mock.calls[0]?.[0]);
    const provider = state.surface!.bindContext!.mock.calls[0]?.[1] as (value: string) => Promise<unknown>;
    expect(await provider(question)).toMatchObject({
      status: 'ready', metadata: null, selectedText: 'Synthetic paper, page 3\nA synthetic selected passage.',
    });
    state.submitResolution?.({ status: 'accepted-without-context' });
  });

  it('does not queue a second submission for a repeated selection click', async () => {
    startAndCapture();
    state.selectionHandlers!.explain(state.citation!);
    state.selectionHandlers!.explain(state.citation!);
    await vi.waitFor(() => expect(state.surface!.submitQuestion).toHaveBeenCalledTimes(1));
    state.submitResolution?.({ status: 'accepted' });
    state.selectionHandlers!.explain(state.citation!);
    expect(state.surface!.submitQuestion).toHaveBeenCalledTimes(1);
  });

  it('keeps an unsent draft when reload recovery is cancelled', async () => {
    const reader = startAndCapture();
    const confirmReload = vi.fn(() => false);
    reader._window.confirm = confirmReload;
    state.selectionHandlers!.ask(state.citation!);
    await vi.waitFor(() => expect(state.surface!.stage).toHaveBeenCalledTimes(1));
    const reportStatus = state.surface!.onStatus!.mock.calls[0]?.[0] as (status: string) => void;
    reportStatus('unsupported-send');
    const recovery = state.shellStatus!.mock.calls.at(-1)?.[2] as { run(): void };
    recovery.run();

    expect(confirmReload).toHaveBeenCalledTimes(1);
    expect(state.surface!.reload).not.toHaveBeenCalled();
    expect(state.surface!.submitQuestion).not.toHaveBeenCalled();
  });
});
