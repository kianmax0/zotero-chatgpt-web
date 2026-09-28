export type StatusTone = 'info' | 'error' | 'success';

export interface ShellOptions {
  title: string;
  attachmentTitle: string;
  onClose: () => void;
  onReload: () => void;
  onCopyDetails: () => void;
  onCopyPdf: () => void;
  onReturnToSource: () => void;
  onSettings: () => void;
  onNewChat: () => void;
  onBindConversation?: () => void;
  onMenuOpen?: () => void;
  onMenuClose?: () => void;
}

export interface ShellView {
  /** The official ChatGPT browser surface is anchored to this element. */
  anchor: HTMLElement;
  status(
    text: string,
    tone?: StatusTone,
    action?: { label: string; run: () => void },
  ): void;
  setIdentity(title: string, attachmentTitle: string): void;
  dispose(): void;
}

type MenuAction = {
  label: string;
  icon: string;
  run: () => void;
  title: string;
};

const ICONS: Record<string, string> = {
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  more: '<circle cx="5" cy="12" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="19" cy="12" r="1"/>',
  reload: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.7-2L20 12M4 12l2.7 5a7 7 0 0 0 11.7-2"/>',
  details: '<path d="M8 6h12M8 12h12M8 18h12"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  pdf: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M9 14h6M9 17h4"/>',
  source: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6H4V5h6"/>',
  settings: '<path d="M12 8.5a3.5 3.5 0 1 0 0 7 3.5 3.5 0 0 0 0-7Z"/><path d="m19.4 15 .1.1 1.1.9-1.1 1.9-1.4-.5a7.8 7.8 0 0 1-1.4.8l-.3 1.5h-2.2l-.4-1.5a7.8 7.8 0 0 1-1.5-.1l-1.1 1-1.9-1.1.5-1.4a7.8 7.8 0 0 1-.8-1.4l-1.5-.3v-2.2l1.5-.4a7.8 7.8 0 0 1 .1-1.5l-1-1.1 1.1-1.9 1.4.5a7.8 7.8 0 0 1 1.4-.8l.3-1.5h2.2l.4 1.5a7.8 7.8 0 0 1 1.5.1l1.1-1 1.9 1.1-.5 1.4a7.8 7.8 0 0 1 .8 1.4l1.5.3v2.2l-1.5.4a7.8 7.8 0 0 1-.1 1.5Z" transform="translate(-1 -1) scale(.92)"/>',
  chat: '<path d="M20 11.5a7.5 7.5 0 0 1-7.5 7.5H5l1.2-3.2A7.5 7.5 0 1 1 20 11.5Z"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.1 0l2-2A5 5 0 0 0 12 3.9l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
  success: '<path d="m5 12 4 4L19 6"/>',
};
let menuSerial = 0;

function icon(name: string): string {
  return `<svg viewBox="0 0 24 24" aria-hidden="true" focusable="false">${ICONS[name] ?? ''}</svg>`;
}

function iconButton(doc: Document, label: string, glyph: string, className: string): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = className;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.innerHTML = icon(glyph);
  return button;
}

/** Mounts the compact Reader-owned shell around the official ChatGPT web surface. */
export function mountShell(container: HTMLElement, options: ShellOptions): ShellView {
  const doc = container.ownerDocument;
  const root = doc.createElement('section');
  root.className = 'zchatgptweb-shell';
  root.setAttribute('aria-label', 'ChatGPT in Zotero Reader');

  const header = doc.createElement('header');
  header.className = 'zchatgptweb-shell__header';

  const identity = doc.createElement('div');
  identity.className = 'zchatgptweb-shell__identity';
  identity.setAttribute('aria-label', 'Current paper and PDF');
  const paperName = doc.createElement('div');
  paperName.className = 'zchatgptweb-shell__paper';
  const pdfName = doc.createElement('div');
  pdfName.className = 'zchatgptweb-shell__pdf';
  identity.append(paperName, pdfName);

  const tools = doc.createElement('div');
  tools.className = 'zchatgptweb-shell__tools';
  const menuButton = iconButton(doc, 'More Reader actions', 'more', 'zchatgptweb-shell__icon-button');
  menuButton.setAttribute('aria-haspopup', 'menu');
  menuButton.setAttribute('aria-expanded', 'false');
  const closeButton = iconButton(doc, 'Close ChatGPT sidebar', 'close', 'zchatgptweb-shell__icon-button');
  closeButton.addEventListener('click', options.onClose);

  const menu = doc.createElement('div');
  menu.className = 'zchatgptweb-shell__menu';
  menu.id = `zchatgptweb-menu-${++menuSerial}`;
  menu.setAttribute('role', 'menu');
  menu.setAttribute('aria-label', 'Reader actions');
  menu.hidden = true;
  menuButton.setAttribute('aria-controls', menu.id);

  const actionItems: MenuAction[] = [
    { label: 'Reload ChatGPT', icon: 'reload', title: 'Reload the official ChatGPT page', run: options.onReload },
    { label: 'Copy paper details', icon: 'details', title: 'Copy bibliographic details and abstract', run: options.onCopyDetails },
    { label: 'Copy PDF file', icon: 'pdf', title: 'Copy the PDF file; paste it into ChatGPT to attach it', run: options.onCopyPdf },
    { label: 'Return to selected passage', icon: 'source', title: 'Return to the selected passage in the PDF', run: options.onReturnToSource },
    { label: 'New ChatGPT chat', icon: 'chat', title: 'Start a new official ChatGPT conversation', run: options.onNewChat },
    ...(options.onBindConversation ? [{ label: 'Bind this conversation', icon: 'link', title: 'Bind the current official conversation to this PDF', run: options.onBindConversation }] : []),
    { label: 'Settings', icon: 'settings', title: 'Open Zotero ChatGPT Web settings', run: options.onSettings },
  ];
  const menuItems = actionItems.map(action => {
    const button = doc.createElement('button');
    button.type = 'button';
    button.className = 'zchatgptweb-shell__menu-item';
    button.setAttribute('role', 'menuitem');
    button.setAttribute('aria-label', action.label);
    button.tabIndex = -1;
    button.title = action.title;
    button.innerHTML = icon(action.icon);
    button.addEventListener('click', () => {
      closeMenu(false);
      action.run();
    });
    menu.append(button);
    return button;
  });

  const notice = doc.createElement('div');
  notice.className = 'zchatgptweb-shell__notice';
  notice.hidden = true;
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  const noticeIcon = doc.createElement('span');
  noticeIcon.className = 'zchatgptweb-shell__notice-icon';
  noticeIcon.setAttribute('aria-hidden', 'true');
  const noticeText = doc.createElement('span');
  noticeText.className = 'zchatgptweb-visually-hidden';
  const noticeAction = doc.createElement('button');
  noticeAction.type = 'button';
  noticeAction.className = 'zchatgptweb-shell__icon-button zchatgptweb-shell__notice-action';
  noticeAction.hidden = true;
  notice.append(noticeIcon, noticeText, noticeAction);

  const anchor = doc.createElement('div');
  anchor.className = 'zchatgptweb-shell__anchor';
  anchor.setAttribute('aria-label', 'Official ChatGPT page');

  let outsideListener: ((event: PointerEvent) => void) | null = null;
  let disposed = false;

  function closeMenu(restoreFocus: boolean): void {
    if (menu.hidden) return;
    menu.hidden = true;
    menuButton.setAttribute('aria-expanded', 'false');
    if (outsideListener) doc.removeEventListener('pointerdown', outsideListener, true);
    outsideListener = null;
    options.onMenuClose?.();
    if (restoreFocus && menuButton.isConnected) menuButton.focus();
  }

  function openMenu(moveFocus: boolean): void {
    if (disposed || !menu.hidden) return;
    menu.hidden = false;
    menuButton.setAttribute('aria-expanded', 'true');
    options.onMenuOpen?.();
    outsideListener = event => {
      const target = event.target as Node;
      if (!menu.contains(target) && !menuButton.contains(target)) closeMenu(false);
    };
    doc.addEventListener('pointerdown', outsideListener, true);
    if (moveFocus) menuItems[0]?.focus();
  }

  menuButton.addEventListener('click', () => {
    if (menu.hidden) openMenu(false);
    else closeMenu(false);
  });
  menuButton.addEventListener('keydown', event => {
    if (event.key === 'ArrowDown') { event.preventDefault(); openMenu(true); }
  });
  menu.addEventListener('keydown', event => {
    if (event.key === 'Escape') { event.preventDefault(); closeMenu(true); return; }
    if (event.key !== 'ArrowDown' && event.key !== 'ArrowUp' && event.key !== 'Home' && event.key !== 'End') return;
    event.preventDefault();
    const current = menuItems.indexOf(doc.activeElement as HTMLButtonElement);
    const next = event.key === 'Home' ? 0
      : event.key === 'End' ? menuItems.length - 1
        : (current + (event.key === 'ArrowDown' ? 1 : -1) + menuItems.length) % menuItems.length;
    menuItems[next]?.focus();
  });
  menu.addEventListener('focusout', event => {
    if (!menu.contains(event.relatedTarget as Node | null)) closeMenu(false);
  });

  const bar = doc.createElement('div');
  bar.className = 'zchatgptweb-shell__bar';
  bar.append(identity, tools);
  tools.append(notice, menuButton, closeButton);
  header.append(bar);
  root.append(header, anchor, menu);
  container.replaceChildren(root);
  setIdentity(options.title, options.attachmentTitle);

  function setIdentity(title: string, attachmentTitle: string): void {
    paperName.textContent = title.trim() || 'Untitled paper';
    paperName.title = paperName.textContent;
    pdfName.textContent = attachmentTitle.trim() || 'PDF attachment';
    pdfName.title = pdfName.textContent;
  }

  function status(text: string, tone: StatusTone = 'info', action?: { label: string; run: () => void }): void {
    noticeText.textContent = text;
    notice.setAttribute('aria-label', text);
    notice.title = text;
    notice.dataset.tone = tone;
    notice.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    notice.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
    noticeIcon.innerHTML = icon(tone === 'error' ? 'alert' : tone === 'success' ? 'success' : 'info');
    notice.hidden = !text;
    noticeAction.hidden = !text || !action;
    if (action) {
      noticeAction.setAttribute('aria-label', action.label);
      noticeAction.title = action.label;
      noticeAction.innerHTML = icon('reload');
    } else {
      noticeAction.removeAttribute('aria-label');
      noticeAction.removeAttribute('title');
      noticeAction.replaceChildren();
    }
    noticeAction.onclick = action ? () => action.run() : null;
  }

  return {
    anchor,
    status,
    setIdentity,
    dispose() {
      if (disposed) return;
      disposed = true;
      closeMenu(false);
      closeButton.removeEventListener('click', options.onClose);
      root.remove();
    },
  };
}
