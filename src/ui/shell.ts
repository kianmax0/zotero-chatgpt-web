export type StatusTone = 'info' | 'error' | 'success';

export interface ShellOptions {
  onReload: () => void;
  onCopyDetails: () => void;
  onCopyPdf: () => void;
  onReturnToSource: () => void;
  onBindConversation?: () => void;
}

export interface ShellView {
  /** The official ChatGPT browser surface is anchored to this element. */
  anchor: HTMLElement;
  status(
    text: string,
    tone?: StatusTone,
    action?: { label: string; run: () => void },
  ): void;
  dispose(): void;
}

const ICONS: Record<string, string> = {
  reload: '<path d="M20 7v5h-5M4 17v-5h5"/><path d="M5.6 9a7 7 0 0 1 11.7-2L20 12M4 12l2.7 5a7 7 0 0 0 11.7-2"/>',
  details: '<path d="M8 6h12M8 12h12M8 18h12"/><path d="M3 6h.01M3 12h.01M3 18h.01"/>',
  pdf: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5M9 14h6M9 17h4"/>',
  source: '<path d="M14 4h6v6M20 4l-9 9"/><path d="M18 13v6H4V5h6"/>',
  link: '<path d="M10 13a5 5 0 0 0 7.1 0l2-2A5 5 0 0 0 12 3.9l-1.1 1.1"/><path d="M14 11a5 5 0 0 0-7.1 0l-2 2A5 5 0 0 0 12 20.1l1.1-1.1"/>',
  info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
  alert: '<path d="m10.3 3.9-8 14A2 2 0 0 0 4 21h16a2 2 0 0 0 1.7-3.1l-8-14a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4M12 17h.01"/>',
};

function icon(doc: Document, name: string): SVGSVGElement {
  const svg = doc.createElementNS('http://www.w3.org/2000/svg', 'svg');
  svg.setAttribute('viewBox', '0 0 24 24');
  svg.setAttribute('width', '16');
  svg.setAttribute('height', '16');
  svg.setAttribute('aria-hidden', 'true');
  svg.setAttribute('focusable', 'false');
  svg.innerHTML = ICONS[name] ?? '';
  return svg;
}

function actionButton(
  doc: Document,
  label: string,
  glyph: string,
  className: string,
  run: () => void,
): HTMLButtonElement {
  const button = doc.createElement('button');
  button.type = 'button';
  button.className = className;
  button.setAttribute('aria-label', label);
  button.title = label;
  button.append(icon(doc, glyph));
  button.addEventListener('click', run);
  return button;
}

/** Mounts the Reader-owned shell around the official ChatGPT web surface. */
export function mountShell(container: HTMLElement, options: ShellOptions): ShellView {
  const doc = container.ownerDocument;
  const root = doc.createElement('section');
  root.className = 'zchatgptweb-shell';
  root.setAttribute('aria-label', 'ChatGPT in Zotero Reader');

  const header = doc.createElement('header');
  header.className = 'zchatgptweb-shell__header';

  const toolbar = doc.createElement('div');
  toolbar.className = 'zchatgptweb-shell__toolbar';
  toolbar.setAttribute('role', 'group');
  toolbar.setAttribute('aria-label', 'Reader actions');
  toolbar.append(
    actionButton(doc, 'Copy paper details', 'details', 'zchatgptweb-shell__icon-button', options.onCopyDetails),
    actionButton(doc, 'Copy PDF file', 'pdf', 'zchatgptweb-shell__icon-button', options.onCopyPdf),
    actionButton(doc, 'Return to selected passage', 'source', 'zchatgptweb-shell__icon-button', options.onReturnToSource),
  );
  if (options.onBindConversation) {
    toolbar.append(actionButton(
      doc,
      'Bind this conversation',
      'link',
      'zchatgptweb-shell__icon-button',
      options.onBindConversation,
    ));
  }
  toolbar.append(actionButton(doc, 'Reload ChatGPT', 'reload', 'zchatgptweb-shell__icon-button', options.onReload));

  const notice = doc.createElement('div');
  notice.className = 'zchatgptweb-shell__notice';
  notice.hidden = true;
  notice.setAttribute('role', 'status');
  notice.setAttribute('aria-live', 'polite');
  notice.setAttribute('aria-atomic', 'true');
  const noticeIcon = doc.createElement('span');
  noticeIcon.className = 'zchatgptweb-shell__notice-icon';
  noticeIcon.setAttribute('aria-hidden', 'true');
  const noticeText = doc.createElement('span');
  noticeText.className = 'zchatgptweb-shell__notice-text';
  const noticeAction = doc.createElement('button');
  noticeAction.type = 'button';
  noticeAction.className = 'zchatgptweb-shell__icon-button zchatgptweb-shell__notice-action';
  noticeAction.hidden = true;
  notice.append(noticeIcon, noticeText, noticeAction);

  const anchor = doc.createElement('div');
  anchor.className = 'zchatgptweb-shell__anchor';
  anchor.setAttribute('aria-label', 'Official ChatGPT page');

  header.append(toolbar, notice);
  root.append(header, anchor);
  container.replaceChildren(root);

  function status(text: string, tone: StatusTone = 'info', action?: { label: string; run: () => void }): void {
    noticeText.textContent = text;
    notice.dataset.tone = tone;
    notice.setAttribute('role', tone === 'error' ? 'alert' : 'status');
    notice.setAttribute('aria-live', tone === 'error' ? 'assertive' : 'polite');
    noticeIcon.replaceChildren(icon(doc, tone === 'error' ? 'alert' : 'info'));
    notice.hidden = !text;
    noticeAction.hidden = !text || !action;
    if (action) {
      noticeAction.setAttribute('aria-label', action.label);
      noticeAction.title = action.label;
      noticeAction.replaceChildren(icon(doc, 'reload'));
      noticeAction.onclick = () => action.run();
    } else {
      noticeAction.removeAttribute('aria-label');
      noticeAction.removeAttribute('title');
      noticeAction.replaceChildren();
      noticeAction.onclick = null;
    }
  }

  return {
    anchor,
    status,
    dispose() { root.remove(); },
  };
}
