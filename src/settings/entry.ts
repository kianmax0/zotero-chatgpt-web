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
  const heading = make('h2'); heading.textContent = 'Zotero ChatGPT Web';
  const description = make('p');
  description.textContent = 'The official ChatGPT website handles your account, models, messages, and history. Opening a Reader sidebar sends nothing.';
  section.append(heading, description);
  if (!host) {
    const message = make('p'); message.setAttribute('role', 'alert'); message.textContent = 'The plugin is not running. Reopen Preferences after enabling it.';
    section.append(message); root.replaceChildren(section); return;
  }
  const label = make('label');
  const checkbox = make('input') as HTMLInputElement; checkbox.type = 'checkbox'; checkbox.checked = host.automaticBibliography();
  const text = make('span'); text.textContent = 'Add available title, authors, year, DOI, publication, and stored abstract when I send a message';
  label.append(checkbox, text);
  const detail = make('p'); detail.textContent = 'This setting never includes PDF body text. A passage you explicitly select can still be sent when this setting is off.';
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
