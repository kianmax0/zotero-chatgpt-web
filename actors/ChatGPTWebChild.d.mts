export type WebActorStatus = 'loading' | 'login-required' | 'challenge-required' | 'ready' | 'draft' | 'generating'
  | 'unsupported-composer' | 'ambiguous-composer' | 'unsupported-send' | 'ambiguous-send' | 'composer-missing'
  | 'accepted' | 'accepted-without-context' | 'not-accepted' | 'composer-ready' | 'submit-missing' | 'context-blocked';

export interface WebActorResponse {
  status: WebActorStatus | 'staged' | 'busy';
  accepted?: boolean;
  sent?: false;
  reason?: string;
  structure?: { supportedEditors: number; editableControls: number; knownSendControls: number };
}

export interface ZoteroChatGPTWebOfficialChatChild {
  receiveMessage(message: { name: 'probe' }): Promise<WebActorResponse>;
  receiveMessage(message: { name: 'stage'; data: { text: string } }): Promise<WebActorResponse>;
  receiveMessage(message: { name: 'submitQuestion'; data: { question: string } }): Promise<WebActorResponse>;
}
