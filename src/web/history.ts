import { isOfficialChatURL } from './prompt.ts';

export interface OfficialConversationEntry { url: string; updatedAt: string }
export type OfficialConversationStore = Record<string, OfficialConversationEntry>;

const MAX_PREFERENCE_BYTES = 128 * 1024;
const BINDING = /^[^\0]{1,512}$/u;
const CONVERSATION = /^\/c\/[A-Za-z0-9-]{8,128}\/?$/u;

/** A non-secret page identity only: no query, fragment, credentials, share URLs or other origins. */
export function canonicalOfficialConversationURL(value: string | null | undefined): string | null {
  if (!isOfficialChatURL(value)) return null;
  const url = new URL(value!);
  if (!CONVERSATION.test(url.pathname)) return null;
  return `https://chatgpt.com${url.pathname.replace(/\/$/u, '')}`;
}

export function parseOfficialConversationStore(raw: unknown): OfficialConversationStore {
  if (typeof raw !== 'string' || raw.length > MAX_PREFERENCE_BYTES) return {};
  try {
    const value = JSON.parse(raw) as unknown;
    if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
    const result: OfficialConversationStore = {};
    for (const [binding, entry] of Object.entries(value as Record<string, unknown>)) {
      if (!BINDING.test(binding) || !entry || typeof entry !== 'object') continue;
      const record = entry as Record<string, unknown>;
      const url = canonicalOfficialConversationURL(typeof record.url === 'string' ? record.url : null);
      if (!url || typeof record.updatedAt !== 'string' || !Number.isFinite(Date.parse(record.updatedAt))) continue;
      result[binding] = { url, updatedAt: record.updatedAt };
    }
    return result;
  } catch {
    return {};
  }
}

export function rememberOfficialConversation(
  store: OfficialConversationStore,
  binding: string,
  value: string,
  updatedAt: string,
  limit = 100,
): OfficialConversationStore {
  const url = canonicalOfficialConversationURL(value);
  if (!BINDING.test(binding) || !url || !Number.isFinite(Date.parse(updatedAt)) || !Number.isSafeInteger(limit) || limit < 1) return { ...store };
  const entries = Object.entries({ ...store, [binding]: { url, updatedAt } })
    .filter(([key, entry]) => BINDING.test(key) && canonicalOfficialConversationURL(entry.url) && Number.isFinite(Date.parse(entry.updatedAt)))
    .sort((a, b) => b[1].updatedAt.localeCompare(a[1].updatedAt) || a[0].localeCompare(b[0]))
    .slice(0, limit);
  return Object.fromEntries(entries);
}
