import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.JSWindowActorParent = class {};
const { ZoteroChatGPTWebOfficialChatParent, CHATGPT_WEB_BRIDGE_EVENT, CHATGPT_WEB_EMBED_ATTR, CHATGPT_WEB_BINDING_ATTR } =
  await import('../../actors/ChatGPTWebParent.mjs');

function parentFixture({ topLevel = true, binding = 'test-binding', changeBindingAfterPrepare = false } = {}) {
  let currentBinding = binding;
  const dispatched = [];
  const ownerGlobal = {
    CustomEvent: class { constructor(type, init) { this.type = type; this.detail = init.detail; } },
    setTimeout,
    clearTimeout,
  };
  const browser = {
    currentURI: { spec: 'https://chatgpt.com/' },
    ownerGlobal,
    hasAttribute: name => name === CHATGPT_WEB_EMBED_ATTR,
    getAttribute: name => name === CHATGPT_WEB_BINDING_ATTR ? currentBinding : null,
    dispatchEvent(event) {
      dispatched.push(event);
      if (event.type === CHATGPT_WEB_BRIDGE_EVENT && event.detail.kind === 'prepare') {
        event.detail.respond({ status: 'allow', marker: event.detail.transaction });
        if (changeBindingAfterPrepare) currentBinding = 'new-session-binding';
      }
    },
  };
  const manager = { documentURI: { spec: 'https://chatgpt.com/' } };
  const context = { currentWindowGlobal: manager, embedderElement: browser };
  context.top = topLevel ? context : { top: null };
  const actor = new ZoteroChatGPTWebOfficialChatParent();
  actor.manager = manager;
  actor.browsingContext = context;
  return { actor, dispatched };
}

test('prepare relays only a transaction-bound response through the plugin browser binding', async () => {
  assert.equal(CHATGPT_WEB_EMBED_ATTR, 'data-zchatgptweb-embed-browser');
  assert.equal(CHATGPT_WEB_BINDING_ATTR, 'data-zchatgptweb-embed-binding');
  const { actor, dispatched } = parentFixture();
  const response = await actor.receiveMessage({ name: 'prepare', data: { question: 'Explain this synthetic passage', transaction: 'request-123' } });
  assert.deepEqual(response, { status: 'allow', marker: 'request-123' });
  assert.equal(dispatched.length, 1);
  assert.equal(dispatched[0].detail.binding, 'test-binding');
  assert.equal(dispatched[0].detail.transaction, 'request-123');
});

test('subframes cannot relay a request into the official page bridge', async () => {
  const { actor, dispatched } = parentFixture({ topLevel: false });
  const response = await actor.receiveMessage({ name: 'prepare', data: { question: 'Synthetic', transaction: 'request-123' } });
  assert.deepEqual(response, { status: 'blocked', reason: 'context-changed' });
  assert.equal(dispatched.length, 0);
});

test('a context binding change during preparation invalidates the response', async () => {
  const { actor } = parentFixture({ changeBindingAfterPrepare: true });
  const response = await actor.receiveMessage({ name: 'prepare', data: { question: 'Synthetic', transaction: 'request-123' } });
  assert.deepEqual(response, { status: 'blocked', reason: 'context-changed', marker: 'request-123' });
});
