import test from 'node:test';
import assert from 'node:assert/strict';
import {
  findChatGPTComposer,
  getPageGate,
  hasAcceptedRequestMarker,
  inspectChatGPTComposer,
  inspectChatGPTSendControl,
  isChatGPTDocument,
} from '../../actors/chatgpt-dom.mjs';

function fixture({ href = 'https://chatgpt.com/', editors = [], nested = false } = {}) {
  const document = {
    location: { href, pathname: new URL(href).pathname },
    querySelectorAll(selector) {
      if (selector === '#prompt-textarea') return editors.filter(editor => editor.id === 'prompt-textarea');
      if (selector === 'textarea#mobile-composer-prompt') return editors.filter(editor => editor.id === 'mobile-composer-prompt');
      if (selector === '[data-testid="composer-text-input"]') return editors.filter(editor => editor.testId === 'composer-text-input');
      if (selector === '.ProseMirror[contenteditable="true"]') return editors.filter(editor => editor.proseMirror);
      if (selector === 'textarea, [contenteditable="true"]') return editors;
      return [];
    },
    querySelector() { return null; },
  };
  const view = { top: null };
  view.top = nested ? {} : view;
  document.defaultView = view;
  return document;
}

test('regression: recognizes the official ProseMirror composer used by current ChatGPT pages', () => {
  const editor = {
    localName: 'div',
    className: 'ProseMirror',
    proseMirror: true,
    classList: { contains: name => name === 'ProseMirror' },
    getAttribute(name) { return name === 'contenteditable' ? 'true' : null; },
  };
  assert.equal(findChatGPTComposer(fixture({ editors: [editor] })), editor);
});

test('only exact official HTTPS origin and top frame are eligible', () => {
  assert.equal(isChatGPTDocument(fixture()), true);
  assert.equal(isChatGPTDocument(fixture({ nested: true })), false);
  assert.equal(isChatGPTDocument(fixture({ href: 'http://chatgpt.com/' })), false);
  assert.equal(isChatGPTDocument(fixture({ href: 'https://chatgpt.com.evil.test/' })), false);
});

test('ambiguous recognized editors fail closed', () => {
  const first = { localName: 'div', proseMirror: true, classList: { contains: name => name === 'ProseMirror' }, getAttribute: name => name === 'contenteditable' ? 'true' : null };
  const second = { localName: 'textarea', id: 'prompt-textarea', type: 'text', getAttribute: () => null };
  const result = inspectChatGPTComposer(fixture({ editors: [first, second] }));
  assert.equal(result.status, 'ambiguous-composer');
  assert.equal(result.composer, null);
});

test('unknown editable controls are reported as unsupported', () => {
  const unknown = { localName: 'div', getAttribute: name => name === 'contenteditable' ? 'true' : null };
  assert.equal(inspectChatGPTComposer(fixture({ editors: [unknown] })).status, 'unsupported-composer');
});

test('send control must be unique and explicitly identified', () => {
  const editor = { localName: 'div', proseMirror: true, classList: { contains: name => name === 'ProseMirror' }, getAttribute: name => name === 'contenteditable' ? 'true' : null };
  const first = { localName: 'button', disabled: false, getAttribute: name => name === 'data-testid' ? 'send-button' : null };
  const second = { localName: 'button', disabled: false, getAttribute: name => name === 'data-testid' ? 'send-button' : null };
  const form = {
    contains: element => element === first || element === second,
    querySelectorAll: selector => selector === 'button[data-testid="send-button"], button[aria-label="Send prompt"]' ? [first, second] : [],
    querySelector: () => null,
  };
  editor.closest = selector => selector === 'form' ? form : null;
  const document = fixture({ editors: [editor] });
  document.querySelectorAll = selector => {
    if (selector === 'button[data-testid="send-button"], button[aria-label="Send prompt"]') return [first, second];
    if (selector === 'input[type="password"], input[type="email"], input[autocomplete="username"], input[autocomplete="current-password"]') return [];
    return fixture({ editors: [editor] }).querySelectorAll(selector);
  };
  assert.equal(inspectChatGPTSendControl(document, editor).status, 'ambiguous-send');
});

test('an unlabeled page button is not accepted as a send control', () => {
  const editor = { localName: 'div', proseMirror: true, classList: { contains: name => name === 'ProseMirror' }, getAttribute: name => name === 'contenteditable' ? 'true' : null };
  const form = { contains: () => true, querySelectorAll: () => [], querySelector: () => null };
  editor.closest = selector => selector === 'form' ? form : null;
  const document = fixture({ editors: [editor] });
  assert.equal(inspectChatGPTSendControl(document, editor).status, 'missing');
});

test('generic submit buttons are accepted only for the safe recognized mobile form', () => {
  const submit = { localName: 'button', type: 'submit', disabled: false };
  const mobile = { localName: 'textarea', id: 'mobile-composer-prompt', type: 'text', getAttribute: () => null };
  const form = { contains: value => value === mobile || value === submit,
    querySelectorAll: selector => selector === 'button[data-testid="send-button"], button[aria-label="Send prompt"]' ? [] : selector === 'button[type="submit"]' ? [submit] : [],
    querySelector: () => null, getAttribute: () => 'https://chatgpt.com/conversation' };
  mobile.closest = selector => selector === 'form' ? form : null;
  const document = fixture({ editors: [mobile] });
  assert.equal(inspectChatGPTSendControl(document, mobile).status, 'found');

  const desktop = { localName: 'div', proseMirror: true, classList: { contains: name => name === 'ProseMirror' },
    getAttribute: name => name === 'contenteditable' ? 'true' : null,
    closest: selector => selector === 'form' ? form : null };
  form.contains = value => value === desktop || value === submit;
  assert.equal(inspectChatGPTSendControl(fixture({ editors: [desktop] }), desktop).status, 'missing');
});

test('login and challenge pages have distinct recoverable gates', () => {
  const login = fixture({ href: 'https://chatgpt.com/auth/login' });
  login.readyState = 'complete';
  assert.equal(getPageGate(login), 'login-required');
  const challenge = fixture({ href: 'https://chatgpt.com/cdn-cgi/challenge' });
  challenge.readyState = 'complete';
  assert.equal(getPageGate(challenge), 'challenge-required');
  const titledChallenge = fixture();
  titledChallenge.readyState = 'complete';
  titledChallenge.title = 'Just a moment...';
  assert.equal(getPageGate(titledChallenge), 'challenge-required');
  const loading = fixture();
  loading.readyState = 'loading';
  assert.equal(getPageGate(loading), 'loading');
});

test('probe exposes loading, login, and challenge states instead of returning a generic block', async () => {
  globalThis.JSWindowActorChild = class {};
  const { ZoteroChatGPTWebOfficialChatChild } = await import('../../actors/ChatGPTWebChild.mjs');
  for (const [href, readyState, expected] of [
    ['https://chatgpt.com/', 'loading', 'loading'],
    ['https://chatgpt.com/auth/login', 'complete', 'login-required'],
    ['https://chatgpt.com/cdn-cgi/challenge', 'complete', 'challenge-required'],
  ]) {
    const document = fixture({ href });
    document.readyState = readyState;
    const actor = new ZoteroChatGPTWebOfficialChatChild();
    actor.document = document;
    const result = await actor.receiveMessage({ name: 'probe' });
    assert.deepEqual(result, { status: expected });
  }
});

test('Ask in sidechat stages text without calling a send control', async () => {
  globalThis.JSWindowActorChild = class {};
  const { ZoteroChatGPTWebOfficialChatChild } = await import('../../actors/ChatGPTWebChild.mjs');
  const events = [];
  const view = { top: null, setTimeout, InputEvent: class { constructor(type, options) { this.type = type; this.options = options; } } };
  view.top = view;
  const composer = {
    localName: 'textarea', id: 'prompt-textarea', type: 'text', value: '',
    getAttribute: () => null,
    dispatchEvent(event) { events.push(event.type); },
    focus() {},
  };
  const document = {
    location: { href: 'https://chatgpt.com/', pathname: '/' }, defaultView: view, readyState: 'complete',
    querySelectorAll(selector) {
      if (selector === '#prompt-textarea') return [composer];
      if (selector === 'textarea, [contenteditable="true"]') return [composer];
      return [];
    },
    querySelector() { return null; },
  };
  composer.ownerDocument = document;
  const actor = new ZoteroChatGPTWebOfficialChatChild();
  actor.document = document;
  actor.contentWindow = view;
  let clicks = 0;
  actor.sendAsyncMessage = () => { clicks += 1; };
  const result = await actor.receiveMessage({ name: 'stage', data: { text: 'Frozen excerpt' } });
  assert.deepEqual(result, { status: 'staged', sent: false });
  assert.equal(composer.value, 'Frozen excerpt');
  assert.equal(clicks, 0);
  assert.deepEqual(events, ['input']);
});

test('acceptance reads only the marked user message and returns a boolean', () => {
  const document = fixture();
  const userMessage = { textContent: 'Question [Zotero ChatGPT Web request abc-123]' };
  const assistantMessage = { textContent: 'private answer abc-123' };
  document.querySelectorAll = selector => selector === '[data-message-author-role="user"]' ? [userMessage] : [];
  assert.equal(hasAcceptedRequestMarker(document, 'abc-123'), true);
  userMessage.textContent = 'Question';
  document.querySelectorAll = selector => selector === '[data-message-author-role="user"]' ? [userMessage, assistantMessage] : [];
  assert.equal(hasAcceptedRequestMarker(document, 'abc-123'), false);
});

test('submission clicks once, rejects duplicate requests, and returns boolean acknowledgement', async () => {
  globalThis.JSWindowActorChild = class {};
  const { ZoteroChatGPTWebOfficialChatChild } = await import('../../actors/ChatGPTWebChild.mjs');
  const window = { top: null, setTimeout, crypto: { randomUUID: () => 'request-123' }, InputEvent: class {} };
  window.top = window;
  const messages = [];
  const userMessages = [];
  let sendClicks = 0;
  let submittedText = '';
  const sendButton = { localName: 'button', disabled: false, getAttribute: name => name === 'data-testid' ? 'send-button' : null,
    click() { sendClicks += 1; submittedText = composer.value; userMessages.push({ textContent: submittedText }); } };
  const form = {
    contains: element => element === sendButton,
    querySelectorAll: selector => selector === 'button[data-testid="send-button"], button[aria-label="Send prompt"]' ? [sendButton] : [],
    querySelector: () => null,
  };
  const composer = { localName: 'textarea', id: 'prompt-textarea', type: 'text', value: '', ownerDocument: null,
    getAttribute: () => null, closest: selector => selector === 'form' ? form : null,
    dispatchEvent() {}, focus() {} };
  const document = {
    location: { href: 'https://chatgpt.com/', pathname: '/' }, defaultView: window, readyState: 'complete',
    querySelector(selector) { return selector === 'button[data-testid="stop-button"]' ? null : null; },
    querySelectorAll(selector) {
      if (selector === '#prompt-textarea') return [composer];
      if (selector === 'textarea, [contenteditable="true"]') return [composer];
      if (selector === '[data-message-author-role="user"]') return userMessages;
      return [];
    },
  };
  composer.ownerDocument = document;
  const actor = new ZoteroChatGPTWebOfficialChatChild();
  actor.document = document;
  actor.contentWindow = window;
  actor.sendAsyncMessage = (name, data) => messages.push({ name, data });
  actor.sendQuery = async (_name, data) => ({
    status: 'prepared', marker: data.transaction, hasAutomaticContext: true,
    text: 'Explain this synthetic passage.\n\n[Zotero ChatGPT Web request request-123]',
  });

  const first = actor.receiveMessage({ name: 'submitQuestion', data: { question: 'Explain this synthetic passage.' } });
  const duplicate = await actor.receiveMessage({ name: 'submitQuestion', data: { question: 'Explain this synthetic passage.' } });
  const accepted = await first;
  assert.equal(duplicate.reason, 'busy');
  assert.equal(accepted.status, 'accepted', JSON.stringify(accepted));
  assert.equal(accepted.accepted, true);
  assert.equal(sendClicks, 1);
  assert.equal(submittedText.split('[Zotero ChatGPT Web request request-123]').length - 1, 1);
  assert.equal(messages.at(-1).data.accepted, true);
});

test('trusted Enter is frozen and routed through the actor; IME and Shift+Enter pass through', async () => {
  globalThis.JSWindowActorChild = class {};
  const { ZoteroChatGPTWebOfficialChatChild } = await import('../../actors/ChatGPTWebChild.mjs');
  const editor = { localName: 'textarea', id: 'prompt-textarea', value: 'Draft A', type: 'text',
    getAttribute: () => null };
  const send = { localName: 'button', disabled: false, getAttribute: name => name === 'data-testid' ? 'send-button' : null };
  const form = {
    contains: element => element === editor || element === send,
    querySelectorAll: selector => selector === 'button[data-testid="send-button"], button[aria-label="Send prompt"]' ? [send] : [],
    querySelector: () => null,
  };
  editor.closest = selector => selector === 'form' ? form : null;
  const view = { top: null };
  view.top = view;
  const document = {
    location: { href: 'https://chatgpt.com/', pathname: '/' }, defaultView: view,
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === '#prompt-textarea') return [editor];
      if (selector === 'textarea, [contenteditable="true"]') return [editor];
      return [];
    },
  };
  const actor = new ZoteroChatGPTWebOfficialChatChild();
  actor.document = document;
  const routed = [];
  actor.submitQuestion = question => { routed.push(question); return Promise.resolve({ status: 'accepted' }); };
  const key = (extra = {}) => ({ type: 'keydown', key: 'Enter', isTrusted: true, target: editor, prevented: false,
    preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; }, ...extra });
  const enter = key();
  actor.handleEvent(enter);
  assert.equal(enter.prevented, true);
  assert.deepEqual(routed, ['Draft A']);
  const composing = key({ isComposing: true, keyCode: 229 });
  actor.handleEvent(composing);
  const newline = key({ shiftKey: true });
  actor.handleEvent(newline);
  assert.equal(composing.prevented, false);
  assert.equal(newline.prevented, false);
  assert.deepEqual(routed, ['Draft A']);
});

test('trusted send-button click and form submit both route through the frozen actor path', async () => {
  globalThis.JSWindowActorChild = class {};
  const { ZoteroChatGPTWebOfficialChatChild } = await import('../../actors/ChatGPTWebChild.mjs');
  const editor = { localName: 'textarea', id: 'prompt-textarea', value: 'Frozen manual question', type: 'text', getAttribute: () => null };
  const send = { localName: 'button', disabled: false, type: 'button', matches: () => true,
    getAttribute: name => name === 'data-testid' ? 'send-button' : null,
    closest(selector) { return selector === 'button' ? this : selector === 'form' ? form : null; } };
  const form = { contains: value => value === editor || value === send,
    querySelectorAll: selector => selector === 'button[data-testid="send-button"], button[aria-label="Send prompt"]' ? [send] : [],
    querySelector: () => null };
  editor.closest = selector => selector === 'form' ? form : null;
  const view = { top: null }; view.top = view;
  const document = { location: { href: 'https://chatgpt.com/', pathname: '/' }, defaultView: view,
    querySelector() { return null; }, querySelectorAll(selector) {
      if (selector === '#prompt-textarea') return [editor];
      if (selector === 'textarea, [contenteditable="true"]') return [editor];
      return [];
    } };
  const actor = new ZoteroChatGPTWebOfficialChatChild();
  actor.document = document;
  const routed = [];
  actor.submitQuestion = question => { routed.push(question); return Promise.resolve(); };
  const click = { type: 'click', isTrusted: true, target: send, prevented: false,
    preventDefault() { this.prevented = true; }, stopImmediatePropagation() {} };
  actor.handleEvent(click);
  const submit = { type: 'submit', isTrusted: true, target: form, prevented: false,
    preventDefault() { this.prevented = true; }, stopImmediatePropagation() {} };
  actor.handleEvent(submit);
  assert.equal(click.prevented, true);
  assert.equal(submit.prevented, true);
  assert.deepEqual(routed, ['Frozen manual question', 'Frozen manual question']);
});

test('unknown submit controls are blocked without changing the user draft', async () => {
  globalThis.JSWindowActorChild = class {};
  const { ZoteroChatGPTWebOfficialChatChild } = await import('../../actors/ChatGPTWebChild.mjs');
  const editor = { localName: 'div', proseMirror: true, classList: { contains: name => name === 'ProseMirror' },
    textContent: 'Keep this draft', getAttribute: name => name === 'contenteditable' ? 'true' : null };
  const unknownButton = { localName: 'button', type: 'submit', getAttribute: () => null, matches: () => false,
    closest(selector) { return selector === 'button' ? this : selector === 'form' ? form : null; } };
  const form = { contains: element => element === editor || element === unknownButton,
    querySelectorAll: () => [], querySelector: () => null };
  editor.closest = selector => selector === 'form' ? form : null;
  const view = { top: null };
  view.top = view;
  const document = { location: { href: 'https://chatgpt.com/', pathname: '/' }, defaultView: view,
    querySelector() { return null; },
    querySelectorAll(selector) {
      if (selector === '.ProseMirror[contenteditable="true"]') return [editor];
      if (selector === 'textarea, [contenteditable="true"]') return [editor];
      return [];
    } };
  const actor = new ZoteroChatGPTWebOfficialChatChild();
  actor.document = document;
  let routed = 0;
  const signals = [];
  actor.submitQuestion = () => { routed += 1; };
  actor.sendAsyncMessage = (_name, data) => signals.push(data);
  const event = { type: 'click', isTrusted: true, target: unknownButton, prevented: false,
    preventDefault() { this.prevented = true; }, stopImmediatePropagation() { this.stopped = true; } };
  actor.handleEvent(event);
  assert.equal(event.prevented, true);
  assert.equal(routed, 0);
  assert.equal(editor.textContent, 'Keep this draft');
  assert.ok(signals.some(signal => signal.status === 'unsupported-send'));
});

test('unmarked top-level ChatGPT pages receive no event interception or actor commands', async () => {
  globalThis.JSWindowActorChild = class {};
  const { ZoteroChatGPTWebOfficialChatChild } = await import('../../actors/ChatGPTWebChild.mjs');
  const editor = { localName: 'textarea', id: 'prompt-textarea', type: 'text', value: 'ordinary page draft', getAttribute: () => null };
  const view = { top: null }; view.top = view;
  const document = { location: { href: 'https://chatgpt.com/', pathname: '/' }, defaultView: view,
    querySelector() { return null; }, querySelectorAll(selector) {
      if (selector === '#prompt-textarea' || selector === 'textarea, [contenteditable="true"]') return [editor];
      return [];
    } };
  const actor = new ZoteroChatGPTWebOfficialChatChild(); actor.document = document;
  let routed = false;
  actor.submitQuestion = () => { routed = true; };
  actor.browsingContext = { top: { embedderElement: {
    getAttribute: name => name === 'messagemanagergroup' ? 'other-group' : null,
    hasAttribute: () => false,
  } } };
  const event = { type: 'keydown', key: 'Enter', isTrusted: true, target: editor, preventDefault() { this.prevented = true; } };
  actor.handleEvent(event);
  assert.equal(event.prevented, undefined);
  assert.equal(routed, false);
  assert.deepEqual(await actor.receiveMessage({ name: 'probe' }), { status: 'blocked', reason: 'unowned-page' });
});

test('ambiguous editors block a trusted send attempt when either has a draft', async () => {
  globalThis.JSWindowActorChild = class {};
  const { ZoteroChatGPTWebOfficialChatChild } = await import('../../actors/ChatGPTWebChild.mjs');
  const first = { localName: 'textarea', id: 'prompt-textarea', type: 'text', value: 'Preserve this draft', getAttribute: () => null };
  const second = { localName: 'textarea', id: 'mobile-composer-prompt', type: 'text', value: '', getAttribute: () => null };
  const send = { localName: 'button', disabled: false, matches: () => true, type: 'button', getAttribute: () => null,
    closest(selector) { return selector === 'button' ? this : selector === 'form' ? form : null; } };
  const form = { contains: value => [first, second, send].includes(value), querySelectorAll: () => [], querySelector: () => null };
  first.closest = second.closest = selector => selector === 'form' ? form : null;
  const view = { top: null }; view.top = view;
  const document = { location: { href: 'https://chatgpt.com/', pathname: '/' }, defaultView: view,
    querySelector() { return null; }, querySelectorAll(selector) {
      if (selector === '#prompt-textarea') return [first];
      if (selector === 'textarea#mobile-composer-prompt') return [second];
      if (selector === 'textarea, [contenteditable="true"]') return [first, second];
      return [];
    } };
  const actor = new ZoteroChatGPTWebOfficialChatChild(); actor.document = document;
  actor.sendAsyncMessage = () => {};
  let routed = false;
  actor.submitQuestion = () => { routed = true; };
  const event = { type: 'click', isTrusted: true, target: send, preventDefault() { this.prevented = true; }, stopImmediatePropagation() {} };
  actor.handleEvent(event);
  assert.equal(event.prevented, true);
  assert.equal(routed, false);
  assert.equal(first.value, 'Preserve this draft');
});
