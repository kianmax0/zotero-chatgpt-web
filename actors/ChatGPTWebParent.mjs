/* global JSWindowActorParent */
const BRIDGE_EVENT = 'ZoteroChatGPTWeb:OfficialChatBridge';
const EMBED_ATTR = 'data-zchatgptweb-embed-browser';
const BINDING_ATTR = 'data-zchatgptweb-embed-binding';
const MAX_QUESTION = 200_000;
const MAX_PREPARED = 512_000;
const RESPONSE_TIMEOUT_MS = 60_000;
const MARKER = /^[0-9a-z-]{1,80}$/iu;
const REASONS = ['context-changed', 'context-disabled', 'context-empty', 'context-failed', 'invalid-response',
  'loading', 'login-required', 'challenge-required', 'unsupported-composer', 'ambiguous-composer',
  'unsupported-send', 'ambiguous-send', 'draft-changed', 'insert-failed', 'submit-failed', 'busy', 'composer-missing'];
const READINESS = ['loading', 'login-required', 'challenge-required', 'ready', 'draft', 'generating',
  'unsupported-composer', 'ambiguous-composer', 'unsupported-send', 'ambiguous-send', 'composer-missing', 'composer-ready', 'busy'];

function officialURL(value) {
  try {
    const url = new URL(String(value || ''));
    return url.protocol === 'https:' && url.hostname === 'chatgpt.com'
      && !url.username && !url.password && (!url.port || url.port === '443');
  } catch { return false; }
}

function browserFor(context, manager) {
  const top = context?.top;
  if (!context || context !== top || context.currentWindowGlobal !== manager) return null;
  const browser = context.embedderElement ?? null;
  if (!browser?.hasAttribute?.(EMBED_ATTR) || !officialURL(browser.currentURI?.spec)) return null;
  return officialURL(manager?.documentURI?.spec) ? browser : null;
}

function validateResponse(value, transaction) {
  if (!value || typeof value !== 'object' || value.marker !== transaction) return { status: 'blocked', reason: 'invalid-response' };
  if (value.status === 'allow') return { status: 'allow', marker: transaction };
  if (value.status === 'blocked') return {
    status: 'blocked',
    reason: REASONS.includes(value.reason) ? value.reason : 'invalid-response',
    marker: transaction,
  };
  if (value.status === 'prepared' && typeof value.text === 'string' && value.text.length <= MAX_PREPARED
      && typeof value.hasAutomaticContext === 'boolean') {
    return { status: 'prepared', text: value.text, hasAutomaticContext: value.hasAutomaticContext, marker: transaction };
  }
  return { status: 'blocked', reason: 'invalid-response', marker: transaction };
}

export class ZoteroChatGPTWebOfficialChatParent extends JSWindowActorParent {
  async receiveMessage(message) {
    const manager = this.manager;
    const browser = browserFor(this.browsingContext, manager);
    if (!browser) return { status: 'blocked', reason: 'context-changed' };
    const binding = browser.getAttribute(BINDING_ATTR);
    if (!binding) return { status: 'blocked', reason: 'context-changed' };

    if (message.name === 'readiness' || message.name === 'status') {
      const status = message.data?.status;
      if (message.name === 'readiness' && !READINESS.includes(status)) return null;
      if (message.name === 'status' && !['accepted', 'accepted-without-context', 'not-accepted', 'composer-missing', 'submit-missing', 'context-blocked'].includes(status)) return null;
      const marker = message.data?.marker;
      if (marker != null && (typeof marker !== 'string' || !MARKER.test(marker))) return null;
      const detail = message.name === 'readiness'
        ? { kind: 'readiness', binding, status }
        : { kind: 'status', binding, status, accepted: message.data?.accepted === true, marker: marker ?? null,
          reason: REASONS.includes(message.data?.reason) ? message.data.reason : null };
      browser.dispatchEvent(new browser.ownerGlobal.CustomEvent(BRIDGE_EVENT, { detail }));
      return null;
    }

    if (message.name !== 'prepare') return { status: 'blocked', reason: 'invalid-request' };
    const question = message.data?.question;
    const transaction = message.data?.transaction;
    if (typeof question !== 'string' || !question.trim() || question.length > MAX_QUESTION
        || typeof transaction !== 'string' || !MARKER.test(transaction)) return { status: 'blocked', reason: 'invalid-request' };

    const win = browser.ownerGlobal;
    const response = await new Promise(resolve => {
      let settled = false;
      const finish = value => {
        if (settled) return;
        settled = true;
        win.clearTimeout(timer);
        resolve(value);
      };
      const timer = win.setTimeout(() => finish({ status: 'blocked', reason: 'context-failed', marker: transaction }), RESPONSE_TIMEOUT_MS);
      browser.dispatchEvent(new win.CustomEvent(BRIDGE_EVENT, {
        detail: { kind: 'prepare', binding, transaction, question, respond: finish },
      }));
    });
    if (browser !== browserFor(this.browsingContext, manager)
        || browser.getAttribute(BINDING_ATTR) !== binding) {
      return { status: 'blocked', reason: 'context-changed', marker: transaction };
    }
    return validateResponse(response, transaction);
  }
}

export const CHATGPT_WEB_BRIDGE_EVENT = BRIDGE_EVENT;
export const CHATGPT_WEB_EMBED_ATTR = EMBED_ATTR;
export const CHATGPT_WEB_BINDING_ATTR = BINDING_ATTR;
