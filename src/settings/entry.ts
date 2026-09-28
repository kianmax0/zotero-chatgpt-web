interface PreferencesHost {
  automaticBibliography(): boolean;
  setAutomaticBibliography(value: boolean): void;
}

interface ZoteroPreferencesGlobal {
  ZoteroChatGPTWebPreferencesHost?: PreferencesHost;
  ZoteroChatGPTWebPreferencesPane?: { mount(root: Element): void; unmount(root: Element): void };
  logError?(error: unknown): void;
}

const global = globalThis as unknown as { Zotero?: ZoteroPreferencesGlobal };
const owners = new WeakMap<Element, () => void>();

function mount(root: Element): void {
  if (owners.has(root)) return;
  const host = global.Zotero?.ZoteroChatGPTWebPreferencesHost;
  const doc = root.ownerDocument;
  const namespace = 'http://www.w3.org/1999/xhtml';
  const make = (tag: string) => doc.createElementNS(namespace, tag);
  const section = make('section'); section.className = 'zchatgptweb-preferences';
  if (!host) {
    const message = make('p'); message.setAttribute('role', 'alert'); message.textContent = 'The plugin is not running. Reopen Preferences after enabling it.';
    section.append(message); root.replaceChildren(section); return;
  }
  const label = make('label');
  const checkbox = make('input') as HTMLInputElement; checkbox.type = 'checkbox'; checkbox.checked = host.automaticBibliography();
  const text = make('span'); text.textContent = 'Include paper details with messages';
  label.append(checkbox, text);
  const detail = make('p'); detail.textContent = 'PDF text is excluded. Selected passages are sent explicitly.';
  const onChange = () => {
    try { host.setAutomaticBibliography(checkbox.checked); }
    catch (error) { global.Zotero?.logError?.(error); checkbox.checked = host.automaticBibliography(); }
  };
  checkbox.addEventListener('change', onChange);
  section.append(label, detail); root.replaceChildren(section);
  owners.set(root, () => checkbox.removeEventListener('change', onChange));
}

function unmount(root: Element): void { owners.get(root)?.(); owners.delete(root); }

if (global.Zotero) global.Zotero.ZoteroChatGPTWebPreferencesPane = { mount, unmount };
