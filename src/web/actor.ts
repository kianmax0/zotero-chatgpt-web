/** The content actor is active only on top-level HTTPS chatgpt.com documents. */
export const OFFICIAL_CHAT_ACTOR = 'ZoteroChatGPTWebOfficialChat';
export const OFFICIAL_CHAT_BRIDGE_EVENT = 'ZoteroChatGPTWeb:OfficialChatBridge';
export const OFFICIAL_CHAT_RESOURCE = 'zotero-chatgpt-web-plugin';
export const OFFICIAL_CHAT_RESOURCE_ROOT = `resource://${OFFICIAL_CHAT_RESOURCE}/`;

interface Registry {
  registerWindowActor(name: string, options: Record<string, unknown>): void;
  unregisterWindowActor(name: string): void;
}

interface ResourceHost {
  Services: {
    io: {
      getProtocolHandler(name: string): { QueryInterface(iface: unknown): { setSubstitution(name: string, uri: unknown): void; setSubstitutionWithFlags(name: string, uri: unknown, flags: number): void } };
      newURI(uri: string): unknown;
    };
  };
  Ci: { nsIResProtocolHandler: unknown; nsISubstitutingProtocolHandler: { ALLOW_CONTENT_ACCESS: number; RESOLVE_JAR_URI: number } };
}

declare const ChromeUtils: Registry;
declare const Services: ResourceHost['Services'];
declare const Ci: ResourceHost['Ci'];

export function registerOfficialChatActor(rootURI: string, registry: Registry = ChromeUtils): void {
  registry.registerWindowActor(OFFICIAL_CHAT_ACTOR, {
    parent: { esModuleURI: `${rootURI}ChatGPTWebParent.mjs` },
    child: {
      esModuleURI: `${rootURI}ChatGPTWebChild.mjs`,
      events: { click: { capture: true }, input: { capture: true }, keydown: { capture: true }, submit: { capture: true } },
    },
    matches: ['https://chatgpt.com/*'],
    messageManagerGroups: ['zchatgptweb'],
    allFrames: false,
  });
}

export function installOfficialChatResource(rootURI: string, host: ResourceHost = { Services, Ci }): void {
  const handler = host.Services.io.getProtocolHandler('resource').QueryInterface(host.Ci.nsIResProtocolHandler);
  const flags = host.Ci.nsISubstitutingProtocolHandler.ALLOW_CONTENT_ACCESS | host.Ci.nsISubstitutingProtocolHandler.RESOLVE_JAR_URI;
  handler.setSubstitutionWithFlags(OFFICIAL_CHAT_RESOURCE, host.Services.io.newURI(`${rootURI}content/actors/`), flags);
}

export function removeOfficialChatResource(host: ResourceHost = { Services, Ci }): void {
  const handler = host.Services.io.getProtocolHandler('resource').QueryInterface(host.Ci.nsIResProtocolHandler);
  handler.setSubstitution(OFFICIAL_CHAT_RESOURCE, null);
}

export function unregisterOfficialChatActor(registry: Registry = ChromeUtils): void {
  registry.unregisterWindowActor(OFFICIAL_CHAT_ACTOR);
}
