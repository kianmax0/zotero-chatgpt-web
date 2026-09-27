const EDITOR_SELECTORS = [
  '#prompt-textarea',
  'textarea#mobile-composer-prompt',
  '[data-testid="composer-text-input"]',
  '.ProseMirror[contenteditable="true"]',
];
const EDITABLE_SELECTOR = 'textarea, [contenteditable="true"]';
const SEND_SELECTOR = 'button[data-testid="send-button"], button[aria-label="Send prompt"]';
const USER_MESSAGE_SELECTOR = '[data-message-author-role="user"]';

function unique(elements) {
  return [...new Set(elements)];
}

function isTopLevel(document) {
  const view = document?.defaultView;
  return Boolean(view && view.top === view);
}

export function isChatGPTDocument(document) {
  try {
    const url = new URL(document.location.href);
    return isTopLevel(document)
      && url.protocol === 'https:'
      && url.hostname === 'chatgpt.com'
      && !url.username && !url.password
      && (!url.port || url.port === '443');
  } catch {
    return false;
  }
}

function supportedEditor(element) {
  const tag = String(element?.localName || '').toLowerCase();
  if (tag === 'textarea') {
    return element.id === 'prompt-textarea' || element.id === 'mobile-composer-prompt'
      ? String(element.type || element.getAttribute?.('type') || '').toLowerCase() !== 'password'
      : element.getAttribute?.('data-testid') === 'composer-text-input'
        && String(element.type || '').toLowerCase() !== 'password';
  }
  return element?.getAttribute?.('contenteditable') === 'true'
    && (element.id === 'prompt-textarea' || element.classList?.contains?.('ProseMirror')
      || element.getAttribute?.('data-testid') === 'composer-text-input');
}

export function inspectChatGPTComposer(document) {
  if (!isChatGPTDocument(document)) return { status: 'context-changed', composer: null };
  const candidates = unique(EDITOR_SELECTORS.flatMap(selector => [...document.querySelectorAll(selector)]));
  const editors = candidates.filter(supportedEditor);
  if (editors.length > 1) return { status: 'ambiguous-composer', composer: null };
  if (editors.length === 1) return { status: 'found', composer: editors[0] };
  const unknown = [...document.querySelectorAll(EDITABLE_SELECTOR)];
  return { status: unknown.length ? 'unsupported-composer' : 'missing', composer: null };
}

/** Return a composer only when exactly one recognized official editor exists. */
export function findChatGPTComposer(document) {
  const result = inspectChatGPTComposer(document);
  return result.status === 'found' ? result.composer : null;
}

export function inspectChatGPTSendControl(document, composer = findChatGPTComposer(document)) {
  if (!isChatGPTDocument(document)) return { status: 'context-changed', control: null };
  if (!composer) return { status: 'composer-missing', control: null };
  const form = composer.closest?.('form') ?? null;
  // A globally unique page button still may belong to a different surface (for example a dialog).
  // Require the known control to share the editor's form before allowing automation to click it.
  const allKnown = form ? unique([...form.querySelectorAll(SEND_SELECTOR)]) : [];
  const nearby = form ? allKnown.filter(control => form.contains(control)) : allKnown;
  if (nearby.length > 1) return { status: 'ambiguous-send', control: null };
  if (nearby.length === 1) return { status: 'found', control: nearby[0] };
  if (composer.localName === 'textarea' && composer.id === 'mobile-composer-prompt' && form && safeMobileForm(document, composer)) {
    const submits = unique([...form.querySelectorAll('button[type="submit"]')])
      .filter(button => button.localName === 'button' && !button.disabled);
    if (submits.length > 1) return { status: 'ambiguous-send', control: null };
    if (submits.length === 1) return { status: 'found', control: submits[0] };
  }
  return { status: 'missing', control: null };
}

function safeMobileForm(document, composer) {
  if (composer?.localName !== 'textarea' || composer.id !== 'mobile-composer-prompt') return false;
  const form = composer.closest?.('form');
  if (!form || !form.contains(composer)) return false;
  if (form.querySelector('input[type="password"], input[type="email"], input[autocomplete="username"], input[autocomplete="current-password"], input[autocomplete="new-password"]')) return false;
  const action = String(form.getAttribute('action') || '').trim();
  if (!action) return true;
  try {
    const target = new URL(action, document.location.href);
    return target.protocol === 'https:' && target.hostname === 'chatgpt.com'
      && !target.username && !target.password && (!target.port || target.port === '443');
  } catch { return false; }
}

export function isKnownSendControl(control) {
  return Boolean(control?.matches?.(SEND_SELECTOR));
}

export function isSubmitControl(control) {
  if (!control) return false;
  return control.localName === 'button'
    && String(control.type || control.getAttribute?.('type') || '').toLowerCase() === 'submit';
}

export function getEditableControls(document) {
  return [...document.querySelectorAll(EDITABLE_SELECTOR)];
}

export function readChatGPTComposer(composer) {
  if (String(composer?.localName || '').toLowerCase() === 'textarea') return String(composer.value || '');
  return String(composer?.innerText ?? composer?.textContent ?? '');
}

/** Replace the single recognized editor through the page's normal input/editing event path. */
export function replaceChatGPTComposer(composer, text) {
  if (!composer || typeof text !== 'string') return false;
  const document = composer.ownerDocument;
  const view = document?.defaultView;
  if (String(composer.localName || '').toLowerCase() === 'textarea') {
    const prototype = view?.HTMLTextAreaElement?.prototype;
    const setter = prototype ? Object.getOwnPropertyDescriptor(prototype, 'value')?.set : null;
    if (setter) setter.call(composer, text);
    else composer.value = text;
    const EventCtor = view?.InputEvent ?? view?.Event;
    if (!EventCtor) return false;
    composer.dispatchEvent(new EventCtor('input', { bubbles: true, composed: true, inputType: 'insertText', data: text }));
    return true;
  }
  if (!supportedEditor(composer) || !document || !view?.getSelection || !document.execCommand) return false;
  const selection = view.getSelection();
  if (!selection || typeof document.createRange !== 'function') return false;
  const before = readChatGPTComposer(composer);
  const oldFocus = document.activeElement;
  const oldRanges = [];
  try {
    for (let index = 0; index < selection.rangeCount; index++) oldRanges.push(selection.getRangeAt(index).cloneRange());
  } catch { /* keep the current selection if Gecko denies access */ }
  const restore = () => {
    if (readChatGPTComposer(composer) !== before) return;
    try { if (oldFocus?.isConnected) oldFocus.focus(); } catch { /* detached focus target */ }
    try {
      selection.removeAllRanges();
      for (const range of oldRanges) if (range.commonAncestorContainer?.isConnected) selection.addRange(range);
    } catch { /* range became stale */ }
  };
  try {
    composer.focus?.();
    const range = document.createRange();
    range.selectNodeContents(composer);
    selection.removeAllRanges();
    selection.addRange(range);
    const changed = document.execCommand('insertText', false, text) === true;
    if (!changed) restore();
    return changed && readChatGPTComposer(composer).includes(text);
  } catch {
    restore();
    return false;
  }
}

/** Boolean-only receipt check; response text is never read or returned. */
export function hasAcceptedRequestMarker(document, marker) {
  if (!isChatGPTDocument(document) || typeof marker !== 'string' || !marker) return false;
  return [...document.querySelectorAll(USER_MESSAGE_SELECTOR)]
    .some(element => String(element.textContent || '').includes(`[Zotero ChatGPT Web request ${marker}]`));
}

export function getPageGate(document) {
  if (!isChatGPTDocument(document)) return 'context-changed';
  if (document.readyState && document.readyState !== 'complete') return 'loading';
  const path = String(document.location.pathname || '').toLowerCase();
  const title = String(document.title || '').toLowerCase();
  if (/just a moment|checking your browser|verify you are human/u.test(title)) return 'challenge-required';
  if (/\/(auth\/login|login|auth\/sign-in)(\/|$)/u.test(path)) return 'login-required';
  if (/challenge|captcha|checkpoint/u.test(path)
      || document.querySelector('iframe[src*="challenge"], [data-testid*="challenge"], #challenge-form, .cf-challenge')) return 'challenge-required';
  if (document.querySelector('input[type="password"], input[autocomplete="current-password"]')) return 'login-required';
  return null;
}

export function inspectPageStructure(document) {
  const candidates = unique(EDITOR_SELECTORS.flatMap(selector => [...document.querySelectorAll(selector)]));
  const supported = candidates.filter(supportedEditor);
  return {
    supportedEditors: supported.length,
    editableControls: document.querySelectorAll(EDITABLE_SELECTOR).length,
    knownSendControls: document.querySelectorAll(SEND_SELECTOR).length,
  };
}
