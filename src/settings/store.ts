import type { ZoteroHost } from '../host/types.ts';
import { parseOfficialConversationStore, rememberOfficialConversation } from '../web/history.ts';

const PREFIX = 'extensions.zchatgptweb.';
const AUTO = `${PREFIX}automaticBibliography`;
const DISCLOSURE = `${PREFIX}disclosureSeen`;
const CONVERSATIONS = `${PREFIX}conversationURLs`;
const WIDTH = `${PREFIX}sidebarWidth`;

/** The sole owner of plugin preferences; all keys are distinct from Zotero ChatGPT. */
export class SettingsStore {
  constructor(private host: ZoteroHost) {}

  automaticBibliography(): boolean { return this.host.Prefs.get(AUTO, true) !== false; }
  setAutomaticBibliography(value: boolean): void { this.host.Prefs.set(AUTO, value, true); }
  disclosureSeen(): boolean { return this.host.Prefs.get(DISCLOSURE, true) === true; }
  markDisclosureSeen(): void { this.host.Prefs.set(DISCLOSURE, true, true); }
  sidebarWidth(): number {
    const value = this.host.Prefs.get(WIDTH, true);
    return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 360;
  }
  setSidebarWidth(value: number): void {
    if (Number.isFinite(value) && value > 0) this.host.Prefs.set(WIDTH, Math.round(value), true);
  }
  conversation(binding: string): string | null {
    const store = parseOfficialConversationStore(this.host.Prefs.get(CONVERSATIONS, true));
    return store[binding]?.url ?? null;
  }
  rememberConversation(binding: string, url: string): void {
    const store = parseOfficialConversationStore(this.host.Prefs.get(CONVERSATIONS, true));
    const updated = rememberOfficialConversation(store, binding, url, new Date().toISOString());
    this.host.Prefs.set(CONVERSATIONS, JSON.stringify(updated), true);
  }
  forgetConversation(binding: string): void {
    const store = parseOfficialConversationStore(this.host.Prefs.get(CONVERSATIONS, true));
    delete store[binding];
    this.host.Prefs.set(CONVERSATIONS, JSON.stringify(store), true);
  }
}
