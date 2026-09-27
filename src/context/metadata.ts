import type { AttachmentIdentity, PaperMetadata } from '../model.ts';
import type { HostItem, HostReader, ZoteroHost } from '../host/types.ts';

function field(item: HostItem, key: string): string {
  try { return String(item.getField(key) || '').trim(); } catch { return ''; }
}

function parentOf(host: ZoteroHost, attachment: HostItem): HostItem {
  return (attachment.parentItemID ? host.Items.get(attachment.parentItemID) : undefined) ?? attachment;
}

function authors(item: HostItem): string[] {
  try {
    return (item.getCreators?.() ?? [])
      .filter(creator => !creator.creatorType || creator.creatorType === 'author')
      .map(creator => [creator.firstName, creator.lastName].filter(Boolean).join(' ') || creator.name || '')
      .filter(Boolean).slice(0, 40).map(value => value.slice(0, 300));
  } catch { return []; }
}

export function attachmentFromReader(host: ZoteroHost, reader: HostReader): AttachmentIdentity | null {
  const item = host.Items.get(reader.itemID);
  if (!item?.key || !Number.isSafeInteger(item.libraryID)) return null;
  return { libraryId: item.libraryID, attachmentKey: item.key, attachmentTitle: field(item, 'title') || 'PDF attachment' };
}

export function metadataForAttachment(host: ZoteroHost, identity: AttachmentIdentity): PaperMetadata | null {
  const item = host.Items.getByLibraryAndKey?.(identity.libraryId, identity.attachmentKey);
  if (!item) return null;
  const source = parentOf(host, item);
  const date = field(source, 'date');
  const year = /(?:1[5-9]|2[0-9])\d{2}/u.exec(date)?.[0];
  const doi = field(source, 'DOI');
  const abstract = field(source, 'abstractNote');
  const publication = field(source, 'publicationTitle') || field(source, 'bookTitle') || field(source, 'conferenceName');
  return {
    title: (field(source, 'title') || field(item, 'title') || identity.attachmentTitle).slice(0, 1000),
    authors: authors(source),
    ...(year ? { year } : {}),
    ...(doi ? { doi: doi.slice(0, 256) } : {}),
    ...(abstract ? { abstract: abstract.slice(0, 12000) } : {}),
    ...(publication ? { publication: publication.slice(0, 1000) } : {}),
  };
}

/** This text is prepared locally; only a deliberate send passes it to ChatGPT. */
export function bibliographyText(metadata: PaperMetadata): string {
  const lines = [`Title: ${metadata.title}`];
  if (metadata.authors.length) lines.push(`Authors: ${metadata.authors.join(', ')}`);
  if (metadata.year) lines.push(`Year: ${metadata.year}`);
  if (metadata.publication) lines.push(`Publication: ${metadata.publication}`);
  if (metadata.doi) lines.push(`DOI: ${metadata.doi}`);
  if (metadata.abstract) lines.push(`Abstract:\n${metadata.abstract}`);
  return lines.join('\n');
}
