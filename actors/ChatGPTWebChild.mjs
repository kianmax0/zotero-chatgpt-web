/* global JSWindowActorChild */
import {
  findChatGPTComposer,
  getEditableControls,
  getPageGate,
  hasAcceptedRequestMarker,
  inspectChatGPTComposer,
  inspectChatGPTSendControl,
  inspectPageStructure,
  isKnownSendControl,
  isChatGPTDocument,
  isSubmitControl,
  composerTextMatches,
  readChatGPTComposer,
  replaceChatGPTComposer,
} from './chatgpt-dom.mjs';

const STOP_SELECTOR = 'button[data-testid="stop-button"]';
const MAX_TEXT = 512_000;
const ACCEPT_TIMEOUT_MS = 20_000;
const SEND_READY_TIMEOUT_MS = 5_000;
const POLL_MS = 100;
const EMBED_GROUP = 'zchatgptweb';
const EMBED_MARKER_ATTR = 'data-zchatgptweb-embed-browser';
const requestMarker = marker => `[Zotero ChatGPT Web request ${marker}]`;

function inside(node, container) {
  const element = node?.nodeType === 3 ? node.parentNode : node;
  return element === container || Boolean(container?.contains?.(element));
}

function eventElement(node) {
  return node?.nodeType === 3 ? node.parentNode : node;
}

function firstDraft(editors) {
  for (const editor of editors) {
    const value = readChatGPTComposer(editor);
    if (value.trim()) return value;
  }
  return '';
}

function markerCount(text, marker) {
  return String(text).split(marker).length - 1;
}

function belongsToOwnedEmbed(actor) {
  try {
    const top = actor.browsingContext?.top;
    if (!top) return true; // Gecko's messageManagerGroups registration is the fallback gate.
    const browser = top.embedderElement;
    if (!browser || typeof browser.getAttribute !== 'function' || typeof browser.hasAttribute !== 'function') return true;
    return browser.getAttribute?.('messagemanagergroup') === EMBED_GROUP
      && browser.hasAttribute?.(EMBED_MARKER_ATTR) === true;
  } catch {
    return true; // Rely on the actor registration group when Gecko hides the chrome wrapper.
  }
}

export class ZoteroChatGPTWebOfficialChatChild extends JSWindowActorChild {
  inFlight = false;

  handleEvent(event) {
    if (!belongsToOwnedEmbed(this) || !event.isTrusted || !isChatGPTDocument(this.document)) return;
    if (event.type === 'input') {
      if (this.inFlight) return;
      const result = inspectChatGPTComposer(this.document);
      if (result.status !== 'found') {
        const editable = getEditableControls(this.document).find(control => inside(event.target, control));
        if (editable && readChatGPTComposer(editable).trim()) this.sendAsyncMessage('readiness', { status: result.status });
        return;
      }
      if (!inside(event.target, result.composer)) return;
      this.sendAsyncMessage('readiness', { status: this.probe().status });
      return;
    }

    const result = inspectChatGPTComposer(this.document);
    const editors = result.status === 'found' ? [result.composer] : getEditableControls(this.document);
    const targeted = editors.filter(editor => inside(event.target, editor));
    const button = eventElement(event.target)?.closest?.('button') ?? null;
    const buttonForm = button?.closest?.('form') ?? null;
    const formEditors = buttonForm ? editors.filter(editor => buttonForm.contains(editor)) : [];
    const targetForm = event.type === 'submit' ? event.target : null;
    const submittedEditors = targetForm ? editors.filter(editor => targetForm.contains?.(editor)) : [];
    let composer = null;
    let draft = '';
    let manualAttempt = false;

    if (event.type === 'keydown') {
      if (event.key !== 'Enter' || event.isComposing || event.keyCode === 229
          || event.shiftKey || event.altKey || event.ctrlKey || event.metaKey || !targeted.length) return;
      manualAttempt = true;
      if (targeted.length === 1) composer = targeted[0];
      draft = composer ? readChatGPTComposer(composer) : firstDraft(targeted);
    } else if (event.type === 'click' && button) {
      manualAttempt = isKnownSendControl(button) || isSubmitControl(button);
      if (!manualAttempt && result.status === 'found') {
        const send = inspectChatGPTSendControl(this.document, result.composer);
        manualAttempt = send.status === 'found' && send.control === button;
      }
      if (!manualAttempt) return;
      if (formEditors.length === 1) composer = formEditors[0];
      else if (result.status === 'found' && result.composer && isKnownSendControl(button)) composer = result.composer;
      draft = composer ? readChatGPTComposer(composer) : firstDraft(formEditors.length ? formEditors : editors);
    } else if (event.type === 'submit' && targetForm) {
      if (!submittedEditors.length) return;
      manualAttempt = true;
      if (submittedEditors.length === 1) composer = submittedEditors[0];
      draft = composer ? readChatGPTComposer(composer) : firstDraft(submittedEditors);
    }

    if (!manualAttempt || !draft.trim()) return;
    event.preventDefault();
    event.stopImmediatePropagation?.();
    event.stopPropagation?.();
    if (this.inFlight) { this.blocked('busy'); return; }

    if (!composer || result.status !== 'found' || composer !== result.composer) {
      this.blocked(result.status === 'ambiguous-composer' || targeted.length > 1 || submittedEditors.length > 1
        ? 'ambiguous-composer' : 'unsupported-composer');
      return;
    }
    const send = inspectChatGPTSendControl(this.document, composer);
    if (send.status !== 'found') {
      this.blocked(send.status === 'ambiguous-send' ? 'ambiguous-send' : 'unsupported-send');
      return;
    }
    if (event.type === 'click' && send.control !== button) {
      this.blocked('unsupported-send');
      return;
    }
    void this.submitQuestion(draft);
  }

  async receiveMessage(message) {
    if (!belongsToOwnedEmbed(this)) return { status: 'blocked', reason: 'unowned-page' };
    const gate = getPageGate(this.document);
    if (message.name === 'probe') return gate ? { status: gate } : this.probe();
    if (gate) return { status: 'blocked', reason: gate };
    if (message.name === 'stage') return this.stage(message.data?.text);
    if (message.name === 'submitQuestion') return this.submitQuestion(message.data?.question);
    return { status: 'blocked', reason: 'invalid-request' };
  }

  probe() {
    const gate = getPageGate(this.document);
    if (gate) return { status: gate };
    if (this.inFlight) return { status: 'busy' };
    if (this.document.querySelector(STOP_SELECTOR)) return { status: 'generating' };
    const composer = inspectChatGPTComposer(this.document);
    const structure = inspectPageStructure(this.document);
    if (composer.status !== 'found') return { status: composer.status === 'missing' ? 'composer-missing' : composer.status, structure };
    const content = readChatGPTComposer(composer.composer);
    if (content.trim()) return { status: 'draft', structure };
    const send = inspectChatGPTSendControl(this.document, composer.composer);
    if (send.status === 'ambiguous-send') return { status: 'ambiguous-send', structure };
    if (send.status !== 'found') return { status: 'composer-ready', structure };
    return { status: 'ready', structure };
  }

  async stage(text) {
    if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT) return { status: 'blocked', reason: 'invalid-request' };
    const result = inspectChatGPTComposer(this.document);
    if (result.status !== 'found') return { status: 'blocked', reason: result.status };
    const composer = result.composer;
    const current = readChatGPTComposer(composer);
    const staged = current ? `${current}\n\n${text}` : text;
    if (!replaceChatGPTComposer(composer, staged) || !composerTextMatches(composer, staged)) {
      return { status: 'blocked', reason: 'insert-failed' };
    }
    await new Promise(resolve => this.contentWindow.setTimeout(resolve, 0));
    if (findChatGPTComposer(this.document) !== composer || !composerTextMatches(composer, staged)) {
      return { status: 'blocked', reason: 'insert-failed' };
    }
    composer.focus?.();
    return { status: 'staged', sent: false };
  }

  async submitQuestion(question) {
    if (this.inFlight) return { status: 'blocked', reason: 'busy', accepted: false };
    if (typeof question !== 'string' || !question.trim() || question.length > MAX_TEXT) {
      return { status: 'blocked', reason: 'invalid-request', accepted: false };
    }
    const gate = getPageGate(this.document);
    if (gate) return { status: 'blocked', reason: gate, accepted: false };
    if (this.document.querySelector(STOP_SELECTOR)) return { status: 'blocked', reason: 'busy', accepted: false };

    this.inFlight = true;
    const originalDocument = this.document;
    const originalWindow = this.contentWindow;
    const originalComposer = findChatGPTComposer(originalDocument);
    const originalDraft = originalComposer ? readChatGPTComposer(originalComposer) : '';
    const transaction = originalWindow.crypto.randomUUID();
    try {
      if (!originalComposer) return this.blocked('unsupported-composer', transaction);
      if (originalDraft.trim() && originalDraft !== question) return this.blocked('draft-changed', transaction);
      const initialSend = inspectChatGPTSendControl(originalDocument, originalComposer);
      if (initialSend.status === 'ambiguous-send') return this.blocked('ambiguous-send', transaction);
      // ChatGPT can replace its voice control with Send only after the empty editor receives input.
      // Keep existing drafts untouched if their send control is unknown; a new frozen question can
      // be inserted and checked by waitForSend before its one deliberate click.
      if (initialSend.status !== 'found' && originalDraft.trim()) return this.blocked('unsupported-send', transaction);

      let prepared;
      try { prepared = await this.sendQuery('prepare', { question, transaction }); }
      catch { return this.blocked('context-failed', transaction); }
      if (!prepared || !['prepared', 'allow'].includes(prepared.status)
          || prepared.marker !== transaction) return this.blocked(prepared?.reason || 'invalid-response', transaction);
      if (!this.samePage(originalDocument, originalWindow)) return this.blocked('context-changed', transaction);

      const composer = findChatGPTComposer(originalDocument);
      if (!composer || composer !== originalComposer) return this.blocked('unsupported-composer', transaction);
      if (readChatGPTComposer(composer) !== originalDraft) return this.blocked('draft-changed', transaction);
      const questionText = prepared.status === 'prepared' ? prepared.text : question;
      if (typeof questionText !== 'string' || questionText.length > MAX_TEXT) return this.blocked('invalid-response', transaction);
      const marker = requestMarker(transaction);
      const markerOccurrences = markerCount(questionText, marker);
      if (markerOccurrences > 1) return this.blocked('invalid-response', transaction);
      const submission = markerOccurrences === 1 ? questionText : `${questionText}\n\n${marker}`;
      if (!replaceChatGPTComposer(composer, submission)
          || markerCount(readChatGPTComposer(composer), marker) !== 1) {
        return this.blocked('insert-failed', transaction);
      }

      const send = await this.waitForSend(originalDocument, originalWindow, composer, submission, transaction);
      if (!send) {
        const reason = composerTextMatches(composer, submission) ? 'unsupported-send' : 'draft-changed';
        return this.blocked(reason, transaction);
      }
      if (send.ambiguous) return this.blocked('ambiguous-send', transaction);
      if (send.busy) return this.blocked('busy', transaction);
      // One deliberate click only. An uncertain result remains unconfirmed and is never retried.
      try { send.control.click(); } catch { return this.blocked('submit-failed', transaction); }
      const accepted = await this.waitForAcceptance(transaction, originalDocument, originalWindow);
      const status = accepted
        ? (prepared.status === 'prepared' && prepared.hasAutomaticContext ? 'accepted' : 'accepted-without-context')
        : 'not-accepted';
      this.sendAsyncMessage('status', { status, marker: transaction, accepted });
      return { status, accepted };
    } finally {
      this.inFlight = false;
    }
  }

  blocked(reason, marker) {
    const status = reason === 'composer-missing' ? 'composer-missing'
      : reason === 'unsupported-send' ? 'submit-missing'
        : 'context-blocked';
    const readinessStatus = ['unsupported-send', 'ambiguous-send', 'unsupported-composer', 'ambiguous-composer'].includes(reason)
      ? reason : null;
    if (readinessStatus) this.sendAsyncMessage('readiness', { status: readinessStatus });
    this.sendAsyncMessage('status', { status, marker: marker ?? null, reason });
    return { status: 'blocked', accepted: false, reason };
  }

  samePage(document, window) {
    return this.document === document && this.contentWindow === window
      && belongsToOwnedEmbed(this) && isChatGPTDocument(document);
  }

  waitForSend(document, window, composer, expected, marker) {
    return this.pollUntil(document, window, SEND_READY_TIMEOUT_MS, () => {
      if (document.querySelector(STOP_SELECTOR)) return { done: true, value: { busy: true } };
      const current = readChatGPTComposer(composer);
      if (!current.includes(requestMarker(marker)) || !composerTextMatches(composer, expected)) return { done: true, value: null };
      const result = inspectChatGPTSendControl(document, composer);
      if (result.status === 'ambiguous-send') return { done: true, value: { ambiguous: true } };
      if (result.status === 'found' && !result.control.disabled) return { done: true, value: { control: result.control, busy: false } };
      return null;
    });
  }

  waitForAcceptance(marker, document, window) {
    return this.pollUntil(document, window, ACCEPT_TIMEOUT_MS, () => {
      if (hasAcceptedRequestMarker(document, marker)) return { done: true, value: true };
      return null;
    }).then(value => value === true);
  }

  pollUntil(document, window, timeout, check) {
    const started = Date.now();
    return new Promise(resolve => {
      const tick = () => {
        if (!this.samePage(document, window)) { resolve(null); return; }
        const result = check();
        if (result?.done) { resolve(result.value); return; }
        if (Date.now() - started >= timeout) { resolve(null); return; }
        window.setTimeout(tick, POLL_MS);
      };
      tick();
    });
  }
}
