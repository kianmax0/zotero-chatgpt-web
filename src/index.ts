import { attachmentBinding, ReaderError, sameAttachment, type AttachmentIdentity, type Citation } from './model.ts';
import { attachmentFromReader, bibliographyText, metadataForAttachment } from './context/metadata.ts';
import { assertRevision, captureRevision } from './context/revision.ts';
import { captureSelection, freezeSelectionVersion, openCitation, selectionForPrompt, type SelectionPopupEvent } from './context/selection.ts';
import { copyPdfFile } from './host/clipboard.ts';
import { injectReaderStyles } from './host/dock.ts';
import { NativeReaderPane } from './host/reader-pane.ts';
import { SelectionActionBar } from './host/selection-actions.ts';
import { createToolbarButton, insertToolbarButton } from './host/toolbar.ts';
import type { HostReader, ToolbarEvent, ZoteroHost, ZoteroWindow } from './host/types.ts';
import { SettingsStore } from './settings/store.ts';
import { mountShell, type ShellView } from './ui/shell.ts';
import { installOfficialChatResource, OFFICIAL_CHAT_RESOURCE_ROOT, registerOfficialChatActor, removeOfficialChatResource, unregisterOfficialChatActor } from './web/actor.ts';
import { createChatEmbedSurface, type ChatEmbedSurface } from './web/embed.ts';
import { canonicalOfficialConversationURL } from './web/history.ts';

declare const Zotero: ZoteroHost & {
  Utilities?: { Internal?: { copyTextToClipboard?(text: string): void; openPreferences?(paneId: string): void } };
  ZoteroChatGPTWebPreferencesHost?: unknown;
  ZoteroChatGPTWebPreferencesPane?: unknown;
};

export interface PluginContext { rootURI: string; pluginID: string; version?: string }

interface Session {
  identity: AttachmentIdentity;
  surface: ChatEmbedSurface;
  shell: ShellView | null;
  latestCitation: Citation | null;
  stagedCitation: Citation | null;
  pendingDirect: { question: string; citation: Citation; automatic: boolean } | null;
  lastStatus: string;
}

interface ReaderEntry { pane: NativeReaderPane; buttons: Set<HTMLButtonElement>; selection: SelectionActionBar; usedSelections: Set<string> }

const PREF_PANE = 'zchatgptweb-prefpane-settings';
const sessions = new Map<ZoteroWindow, Map<string, Session>>();
const readers = new Map<HostReader, ReaderEntry>();
const windows = new Map<ZoteroWindow, () => void>();
const frozenVersions = new WeakMap<Citation, Promise<Citation>>();
let settings: SettingsStore | null = null;
let active = false;
let notifierId: string | null = null;
let preferencePane: string | null = null;
let preferenceRegistration: Promise<string | undefined> | null = null;

function copyText(text: string): boolean {
  try {
    if (!Zotero.Utilities?.Internal?.copyTextToClipboard) return false;
    Zotero.Utilities.Internal.copyTextToClipboard(text);
    return true;
  } catch { return false; }
}

function report(session: Session, status: string, reason?: string): void {
  const shell = session.shell;
  if (!shell) return;
  const previous = session.lastStatus;
  const retry = { label: 'Reload page', run: () => session.surface.reload() };
  const notice = (message: string, error = false, action?: typeof retry) => shell.status(message, error ? 'error' : 'info', action);
  session.lastStatus = status;
  switch (status) {
    case 'ready': case 'composer-ready':
      if (settings && !settings.disclosureSeen()) notice(settings.automaticBibliography()
        ? 'Sends include paper details and abstract. PDF text is included only when selected.'
        : 'Automatic paper context is off. Only your draft and selected text are sent.');
      else if (!['accepted', 'accepted-without-context', 'staged'].includes(previous)) shell.status('');
      return;
    case 'draft':
      if (session.stagedCitation) notice('Selection added to draft. Not sent.');
      return;
    case 'loading': case 'checking': notice('Loading ChatGPT…', false, retry); return;
    case 'login-required': notice('Sign in to ChatGPT.', true, retry); return;
    case 'challenge-required': notice('Complete ChatGPT’s browser verification.', true, retry); return;
    case 'unsupported-composer': case 'ambiguous-composer': notice('Editor unavailable. Draft kept.', true, retry); return;
    case 'unsupported-send': case 'ambiguous-send': case 'submit-missing': notice('Send unavailable. Draft kept; not sent.', true, retry); return;
    case 'composer-missing': notice('Waiting for ChatGPT’s editor.', false, retry); return;
    case 'preparing': notice('Preparing paper context…'); return;
    case 'staged': notice('Selection added to draft. Not sent.'); return;
    case 'accepted': case 'accepted-without-context':
      settings?.markDisclosureSeen(); session.stagedCitation = null;
      shell.status(''); return;
    case 'not-accepted': notice('Send unconfirmed. Check the chat before retrying.', true); return;
    case 'context-blocked': notice(reason === 'draft-changed' ? 'Draft changed. Review before sending.' : 'Context unavailable. Draft kept; not sent.', true); return;
    default: if (reason) notice(`Action stopped: ${reason}. Draft kept.`, true, retry);
  }
}

function sessionFor(reader: HostReader, identity: AttachmentIdentity): Session {
  const win = reader._window;
  let pool = sessions.get(win);
  if (!pool) { pool = new Map(); sessions.set(win, pool); }
  const binding = attachmentBinding(identity);
  const existing = pool.get(binding);
  if (existing) return existing;
  if (pool.size >= 4) {
    const idle = [...pool].find(([, value]) => value.surface.evictable());
    if (!idle) throw new ReaderError('CHAT_UNAVAILABLE', 'Four ChatGPT pages already contain drafts or work. Finish one before opening another.');
    idle[1].surface.destroy(); pool.delete(idle[0]);
  }
  const surface = createChatEmbedSurface(win);
  const session: Session = { identity: { ...identity }, surface, shell: null, latestCitation: null, stagedCitation: null, pendingDirect: null, lastStatus: '' };
  pool.set(binding, session);
  return session;
}

async function prepareContext(reader: HostReader, session: Session, question: string) {
  const direct = session.pendingDirect?.question === question ? session.pendingDirect : null;
  const automatic = direct?.automatic ?? settings?.automaticBibliography() ?? true;
  const identity = session.identity;
  const current = attachmentFromReader(Zotero, reader);
  if (!current || !sameAttachment(identity, current)) return { status: 'blocked' as const, reason: 'context-failed' as const };
  const originalMetadata = automatic ? direct?.citation.metadata ?? metadataForAttachment(Zotero, identity) : null;
  const metadata = originalMetadata ? { ...originalMetadata, authors: [...originalMetadata.authors] } : null;
  if (automatic && !metadata) return { status: 'blocked' as const, reason: 'context-failed' as const };
  try {
    if (direct?.citation.revision) await assertRevision(Zotero, reader, identity, direct.citation.revision);
    else if (session.stagedCitation?.revision && question.includes(selectionForPrompt(session.stagedCitation))) {
      await assertRevision(Zotero, reader, identity, session.stagedCitation.revision);
    } else await captureRevision(Zotero, reader, identity);
  } catch { return { status: 'blocked' as const, reason: 'context-failed' as const }; }
  return { status: 'ready' as const, metadata, selectedText: direct ? selectionForPrompt(direct.citation) : null };
}

async function waitForSurface(surface: ChatEmbedSurface, allowDraft: boolean): Promise<void> {
  for (let attempt = 0; attempt < 300; attempt++) {
    const status = surface.readiness();
    if (status === 'ready' || status === 'composer-ready' || (allowDraft && status === 'draft')) return;
    if (['login-required', 'challenge-required', 'unsupported-composer', 'ambiguous-composer', 'unsupported-send', 'ambiguous-send'].includes(status)) {
      throw new ReaderError('CHAT_UNAVAILABLE', `ChatGPT is not ready (${status}). Finish the page step and retry.`);
    }
    if (status === 'draft' && !allowDraft) throw new ReaderError('CHAT_UNAVAILABLE', 'ChatGPT already has an unsent draft. Finish or clear it before More details.');
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new ReaderError('CHAT_UNAVAILABLE', 'ChatGPT did not become ready. Reload the official page and retry.');
}

async function selectionAction(reader: HostReader, citation: Citation, action: 'explain' | 'ask', automatic: boolean): Promise<void> {
  const entry = readers.get(reader);
  if (!active || !entry) return;
  const current = attachmentFromReader(Zotero, reader);
  if (!current || !sameAttachment(current, citation.attachment)) throw new ReaderError('ATTACHMENT_MISSING', 'The Reader changed PDF. Return to the selected PDF and try again.');
  await entry.pane.controller.open();
  const frozen = await (frozenVersions.get(citation) ?? freezeSelectionVersion(Zotero, reader, citation));
  await assertRevision(Zotero, reader, citation.attachment, frozen.revision!);
  const session = sessionFor(reader, frozen.attachment);
  session.latestCitation = frozen;
  await waitForSurface(session.surface, action === 'ask');
  const stillOpen = attachmentFromReader(Zotero, reader);
  if (!active || !stillOpen || !sameAttachment(stillOpen, frozen.attachment)) {
    throw new ReaderError('ATTACHMENT_MISSING', 'The Reader changed PDF. Return to the selected PDF and try again.');
  }
  if (action === 'ask') {
    const result = await session.surface.stage(selectionForPrompt(frozen));
    if (result.status !== 'staged') throw new ReaderError('CHAT_UNAVAILABLE', `The selection was not inserted (${result.reason ?? result.status}). Review the official draft and retry.`);
    session.stagedCitation = frozen;
    report(session, 'staged');
    return;
  }
  const question = 'Explain the selected PDF passage in detail. Use the passage itself as evidence, and distinguish it from the paper abstract.';
  session.pendingDirect = { question, citation: frozen, automatic };
  try {
    const result = await session.surface.submitQuestion(question);
    if (!['accepted', 'accepted-without-context'].includes(result.status)) throw new ReaderError('CHAT_UNAVAILABLE', `ChatGPT did not confirm this request (${result.reason ?? result.status}). Check the official page before retrying.`);
  } finally { session.pendingDirect = null; }
}

function readerEntry(reader: HostReader): ReaderEntry {
  const cached = readers.get(reader);
  if (cached) return cached;
  const buttons = new Set<HTMLButtonElement>();
  const pane = new NativeReaderPane(Zotero, reader, buttons, (body, identity, close) => {
    let session: Session;
    try { session = sessionFor(reader, identity); }
    catch (error) { body.textContent = error instanceof Error ? error.message : 'ChatGPT is unavailable.'; return; }
    const metadata = metadataForAttachment(Zotero, identity);
    const binding = attachmentBinding(identity);
    const shell = mountShell(body, {
      title: metadata?.title ?? identity.attachmentTitle, attachmentTitle: identity.attachmentTitle,
      onClose: close,
      onReload: () => { if (reader._window.confirm('Reload the official ChatGPT page? An unsent draft may be lost.')) session.surface.reload(); },
      onCopyDetails: () => {
        const details = metadataForAttachment(Zotero, identity);
        if (!details || !copyText(bibliographyText(details))) shell.status('Paper details could not be copied.', 'error');
        else shell.status('Paper details copied.');
      },
      onCopyPdf: () => { void (async () => {
        const item = Zotero.Items.getByLibraryAndKey?.(identity.libraryId, identity.attachmentKey);
        const path = item ? await item.getFilePathAsync?.() : false;
        const copied = Boolean(path && copyPdfFile(path));
        shell.status(copied ? 'PDF copied. Paste into ChatGPT to attach.' : 'PDF copy failed.', copied ? 'info' : 'error');
      })().catch(() => shell.status('The PDF could not be copied.', 'error')); },
      onReturnToSource: () => { const citation = session.latestCitation; if (citation) void openCitation(Zotero, citation).catch(error => showError(session, error)); else shell.status('Select a passage first.', 'info'); },
      onSettings: () => {
        try {
          if (Zotero.Utilities?.Internal?.openPreferences) Zotero.Utilities.Internal.openPreferences(PREF_PANE);
          else shell.status('Open Zotero Settings → Zotero ChatGPT Web to change automatic context.', 'info');
        } catch { shell.status('Open Zotero Settings → Zotero ChatGPT Web to change automatic context.', 'error'); }
      },
      onNewChat: () => { void session.surface.newChat().then(started => {
        if (started) { settings?.forgetConversation(binding); shell.status(''); }
        else shell.status('Finish or clear the current draft before starting a new chat.', 'error');
      }).catch(() => shell.status('A new chat could not be opened. Review the current draft and retry.', 'error')); },
      onBindConversation: () => {
        const url = canonicalOfficialConversationURL(session.surface.snapshot().url);
        if (!url) shell.status('Open an official ChatGPT conversation before binding it.', 'error');
        else { settings?.rememberConversation(binding, url); shell.status('Conversation linked to this PDF.'); }
      },
      onMenuOpen: () => session.surface.hide(),
      onMenuClose: () => { if (session.shell === shell && pane.selected()) session.surface.show(shell.anchor, reader._iframe ?? null); },
    });
    session.shell = shell;
    session.surface.bindContext(binding, question => prepareContext(reader, session, question));
    session.surface.bindConversation(binding, settings?.conversation(binding) ?? null, url => settings?.rememberConversation(binding, url));
    session.surface.onStatus((status, reason) => report(session, status, reason));
    for (const pool of sessions.get(reader._window)?.values() ?? []) if (pool !== session) pool.surface.hide();
    session.surface.show(shell.anchor, reader._iframe ?? null);
    report(session, session.lastStatus || 'loading');
    return () => { if (session.shell === shell) session.shell = null; session.surface.onStatus(null); session.surface.hide(); shell.dispose(); };
  }, { read: () => settings?.sidebarWidth() ?? 360, write: width => settings?.setSidebarWidth(width) });
  const usedSelections = new Set<string>();
  const runSelection = (citation: Citation, action: 'explain' | 'ask') => {
    if (usedSelections.has(citation.id)) return;
    usedSelections.add(citation.id);
    const automatic = settings?.automaticBibliography() ?? true;
    void selectionAction(reader, citation, action, automatic).catch(error => showErrorForReader(reader, citation, error));
  };
  const selection = new SelectionActionBar({
    explain: citation => runSelection(citation, 'explain'),
    ask: citation => runSelection(citation, 'ask'),
  });
  const result = { pane, buttons, selection, usedSelections };
  readers.set(reader, result);
  return result;
}

function showError(session: Session, error: unknown): void {
  session.shell?.status(error instanceof Error ? error.message : 'The action failed. Try again.', 'error', { label: 'Reload page', run: () => session.surface.reload() });
  if (!(error instanceof ReaderError)) Zotero.logError(error);
}

function showErrorForReader(reader: HostReader, citation: Citation, error: unknown): void {
  const session = sessions.get(reader._window)?.get(attachmentBinding(citation.attachment));
  const message = `${error instanceof Error ? error.message : 'The ChatGPT action failed.'} Select the passage again to retry.`;
  if (session) session.shell?.status(message, 'error', { label: 'Reload page', run: () => session.surface.reload() });
  else reader._window.alert(message);
  if (!(error instanceof ReaderError)) Zotero.logError(error);
}

function onSelectionPopup(event: SelectionPopupEvent): void {
  if (!active) return;
  const entry = readerEntry(event.reader);
  if (!entry.pane.supported()) return;
  const identity = attachmentFromReader(Zotero, event.reader);
  if (!identity) return;
  try {
    const citation = captureSelection(Zotero, event, identity);
    entry.usedSelections.clear();
    const frozen = freezeSelectionVersion(Zotero, event.reader, citation);
    frozenVersions.set(citation, frozen);
    void frozen.catch(() => undefined);
    entry.selection.show(event, citation);
  } catch (error) {
    entry.selection.showNotice(event, error instanceof Error ? error.message : 'This selection is unavailable.');
  }
}

function onToolbar(event: ToolbarEvent): void {
  if (!active) return;
  injectReaderStyles(event.doc);
  const entry = readerEntry(event.reader);
  if (!entry.pane.supported()) return;
  const button = createToolbarButton(event.doc, () => { if (active && entry.pane.selected()) void entry.pane.controller.toggle().catch(error => Zotero.logError(error)); });
  for (const old of entry.buttons) if (!old.isConnected) entry.buttons.delete(old);
  insertToolbarButton(event, button);
  entry.buttons.add(button);
  entry.pane.setActive(entry.pane.controller.active);
}

function reconcile(): void {
  for (const [reader, entry] of readers) {
    if (!Zotero.Reader._readers.includes(reader)) {
      entry.pane.dispose(); entry.selection.dispose();
      for (const button of entry.buttons) button.remove();
      readers.delete(reader);
    } else entry.pane.reconcile();
  }
  for (const pool of sessions.values()) for (const session of pool.values()) session.surface.sync();
}

export function startup(options: PluginContext): void {
  if (active) return;
  settings = new SettingsStore(Zotero);
  let resourceInstalled = false;
  let actorRegistered = false;
  try {
    installOfficialChatResource(options.rootURI); resourceInstalled = true;
    registerOfficialChatActor(OFFICIAL_CHAT_RESOURCE_ROOT); actorRegistered = true;
    active = true;
    Zotero.ZoteroChatGPTWebPreferencesHost = {
      automaticBibliography: () => settings?.automaticBibliography() ?? true,
      setAutomaticBibliography: (value: boolean) => settings?.setAutomaticBibliography(value),
    };
    Zotero.Reader.registerEventListener('renderToolbar', onToolbar, options.pluginID);
    Zotero.Reader.registerEventListener('renderTextSelectionPopup', onSelectionPopup, options.pluginID);
    notifierId = Zotero.Notifier.registerObserver({ notify: reconcile }, ['tab'], options.pluginID);
  } catch (error) {
    active = false; settings = null;
    if (notifierId) Zotero.Notifier.unregisterObserver(notifierId);
    notifierId = null;
    if (actorRegistered) unregisterOfficialChatActor();
    if (resourceInstalled) removeOfficialChatResource();
    delete Zotero.ZoteroChatGPTWebPreferencesHost;
    throw error;
  }
  if (Zotero.PreferencePanes) {
    preferenceRegistration = Zotero.PreferencePanes.register({
      pluginID: options.pluginID, id: PREF_PANE, label: 'Zotero ChatGPT Web',
      image: `${options.rootURI}content/assets/icon.svg`, src: `${options.rootURI}content/preferences/preferences.xhtml`,
      scripts: [`${options.rootURI}content/preferences.js`], stylesheets: [`${options.rootURI}content/assets/sidebar.css`], defaultXUL: true,
    }).then(id => { if (!active) Zotero.PreferencePanes?.unregister(id); else preferencePane = id; return id; })
      .catch(error => { Zotero.logError(error); return undefined; });
  }
}

export function onMainWindowLoad(window: Window): void {
  const win = window as ZoteroWindow;
  if (!active || windows.has(win)) return;
  const observer = new win.MutationObserver(reconcile);
  const pane = win.document.getElementById('zotero-context-pane');
  if (pane) observer.observe(pane, { attributes: true, subtree: true, attributeFilter: ['collapsed', 'selectedIndex'] });
  windows.set(win, () => observer.disconnect());
}

export function onMainWindowUnload(window: Window): void {
  const win = window as ZoteroWindow;
  windows.get(win)?.(); windows.delete(win);
  for (const [reader, entry] of readers) {
    if (reader._window !== win) continue;
    entry.pane.dispose(); entry.selection.dispose();
    for (const button of entry.buttons) button.remove();
    readers.delete(reader);
  }
  const pool = sessions.get(win);
  if (pool) for (const session of pool.values()) session.surface.destroy();
  sessions.delete(win);
}

export async function shutdown(): Promise<void> {
  if (!active) return;
  active = false;
  for (const win of [...windows.keys()]) onMainWindowUnload(win);
  for (const entry of readers.values()) { entry.pane.dispose(); entry.selection.dispose(); for (const button of entry.buttons) button.remove(); }
  readers.clear();
  if (notifierId) Zotero.Notifier.unregisterObserver(notifierId);
  notifierId = null;
  await preferenceRegistration;
  if (preferencePane) Zotero.PreferencePanes?.unregister(preferencePane);
  preferencePane = null; preferenceRegistration = null;
  unregisterOfficialChatActor(); removeOfficialChatResource();
  delete Zotero.ZoteroChatGPTWebPreferencesHost;
  delete Zotero.ZoteroChatGPTWebPreferencesPane;
  settings = null;
}
