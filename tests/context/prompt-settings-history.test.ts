import { describe, expect, it } from 'vitest';
import { composeOfficialChatPrompt, isOfficialChatURL } from '../../src/web/prompt.ts';
import { canonicalOfficialConversationURL, parseOfficialConversationStore, rememberOfficialConversation } from '../../src/web/history.ts';
import { SettingsStore } from '../../src/settings/store.ts';
import type { ZoteroHost } from '../../src/host/types.ts';

function preferencesHost() {
  const values = new Map<string, unknown>();
  const writes: string[] = [];
  const host = {
    Prefs: {
      get: (key: string) => values.get(key),
      set: (key: string, value: unknown) => { values.set(key, value); writes.push(key); },
    },
  } as unknown as ZoteroHost;
  return { host, values, writes };
}

describe('official Chat prompt, settings, and conversation identity', () => {
  it('omits automatic bibliography when opted out while preserving explicit selection', () => {
    const { host } = preferencesHost();
    const settings = new SettingsStore(host);
    expect(settings.automaticBibliography()).toBe(true);
    expect(settings.disclosureSeen()).toBe(false);
    settings.markDisclosureSeen();
    expect(settings.disclosureSeen()).toBe(true);
    settings.setAutomaticBibliography(false);
    const metadata = settings.automaticBibliography()
      ? { title: 'Synthetic title', authors: ['Synthetic author'], abstract: 'Synthetic abstract' }
      : null;
    const prompt = composeOfficialChatPrompt({
      question: 'Explain this passage',
      metadata,
      selectedText: 'A synthetic selected sentence.',
      requestMarker: 'request-123',
    });

    expect(prompt).not.toContain('Synthetic title');
    expect(prompt).not.toContain('Synthetic abstract');
    expect(prompt).toContain('A synthetic selected sentence.');
    expect(prompt).toContain('Explain this passage');
  });

  it('uses an explicit selection in a prompt independently of metadata', () => {
    const prompt = composeOfficialChatPrompt({
      question: 'What does this sentence mean?',
      metadata: null,
      selectedText: 'Synthetic selected content.',
      requestMarker: 'request-456',
    });
    expect(prompt).toContain('Synthetic selected content.');
    expect(prompt).not.toContain('bibliographic context');
    expect(prompt).not.toContain('PDF body text');
  });

  it('persists independent preferences and conversation URLs under this plugin namespace', () => {
    const { host, writes } = preferencesHost();
    const settings = new SettingsStore(host);
    const bindingA = '4:PDF-A';
    const bindingB = '4:PDF-B';
    settings.rememberConversation(bindingA, 'https://chatgpt.com/c/conversation-a1b2c3d4?source=reader#answer');
    settings.rememberConversation(bindingB, 'https://chatgpt.com/c/conversation-b1c2d3e4');

    expect(settings.conversation(bindingA)).toBe('https://chatgpt.com/c/conversation-a1b2c3d4');
    expect(settings.conversation(bindingB)).toBe('https://chatgpt.com/c/conversation-b1c2d3e4');
    expect(writes.length).toBeGreaterThan(0);
    expect(writes.every(key => key.startsWith('extensions.zchatgptweb.'))).toBe(true);
    expect(settings.sidebarWidth()).toBe(360);
  });

  it('accepts only canonical official conversation paths and rejects unsafe or malformed URLs', () => {
    expect(isOfficialChatURL('https://chatgpt.com/c/conversation-a1b2c3d4')).toBe(true);
    expect(canonicalOfficialConversationURL('https://chatgpt.com/c/conversation-a1b2c3d4/?q=private#fragment'))
      .toBe('https://chatgpt.com/c/conversation-a1b2c3d4');
    for (const value of [
      'http://chatgpt.com/c/conversation-a1b2c3d4',
      'https://chatgpt.com.evil.example/c/conversation-a1b2c3d4',
      'https://user:secret@chatgpt.com/c/conversation-a1b2c3d4',
      'https://chatgpt.com/share/conversation-a1b2c3d4',
      'https://chatgpt.com/c/short',
    ]) expect(canonicalOfficialConversationURL(value)).toBeNull();
  });

  it('drops unsafe persisted conversations and enforces the store size limit', () => {
    const safe = 'https://chatgpt.com/c/conversation-a1b2c3d4';
    const parsed = parseOfficialConversationStore(JSON.stringify({
      '4:PDF-A': { url: safe, updatedAt: '2026-09-27T00:00:00.000Z' },
      '4:PDF-B': { url: 'https://chatgpt.com/share/not-canonical', updatedAt: '2026-09-27T00:00:00.000Z' },
      'bad\u0000key': { url: safe, updatedAt: '2026-09-27T00:00:00.000Z' },
    }));
    expect(parsed).toEqual({ '4:PDF-A': { url: safe, updatedAt: '2026-09-27T00:00:00.000Z' } });
    expect(parseOfficialConversationStore('x'.repeat(128 * 1024 + 1))).toEqual({});
    expect(Object.keys(rememberOfficialConversation({}, '4:PDF-A', safe, '2026-09-27T00:00:00.000Z', 1))).toEqual(['4:PDF-A']);
  });
});
