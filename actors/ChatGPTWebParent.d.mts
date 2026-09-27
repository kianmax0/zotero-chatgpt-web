export const CHATGPT_WEB_BRIDGE_EVENT: 'ZoteroChatGPTWeb:OfficialChatBridge';
export const CHATGPT_WEB_EMBED_ATTR: 'data-zchatgptweb-embed-browser';
export const CHATGPT_WEB_BINDING_ATTR: 'data-zchatgptweb-embed-binding';

export class ZoteroChatGPTWebOfficialChatParent {
  receiveMessage(message: { name: 'prepare'; data: { question: string; transaction: string } }): Promise<unknown>;
  receiveMessage(message: { name: 'readiness' | 'status'; data: Record<string, unknown> }): Promise<null>;
}
