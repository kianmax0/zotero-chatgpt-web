import { ReaderError, type AttachmentIdentity, type Citation, type Rect } from '../model.ts';
import type { HostReader, ZoteroHost } from '../host/types.ts';
import { metadataForAttachment } from './metadata.ts';
import { captureRevision, assertRevision } from './revision.ts';

export interface SelectionPopupEvent {
  reader: HostReader;
  doc: Document;
  append(...nodes: Node[]): void;
  params: { annotation?: { text?: string; pageLabel?: string; position?: { pageIndex?: number; rects?: unknown; nextPageRects?: unknown } } };
}

function copyRects(value: unknown): Rect[] {
  if (!value || typeof value !== 'object') throw new ReaderError('INVALID_SELECTION', 'The selection position is unavailable.');
  const entries = value as ArrayLike<unknown>;
  if (!Number.isInteger(entries.length) || entries.length < 1 || entries.length > 512) throw new ReaderError('INVALID_SELECTION', 'The selection position is unavailable.');
  const result: Rect[] = [];
  for (let index = 0; index < entries.length; index++) {
    const raw = entries[index] as ArrayLike<unknown> | undefined;
    if (!raw || raw.length !== 4) throw new ReaderError('INVALID_SELECTION', 'The selection position is unavailable.');
    const rect = [raw[0], raw[1], raw[2], raw[3]];
    if (!rect.every(number => typeof number === 'number' && Number.isFinite(number))) throw new ReaderError('INVALID_SELECTION', 'The selection position is unavailable.');
    result.push(rect as Rect);
  }
  return result;
}

export function captureSelection(host: ZoteroHost, event: SelectionPopupEvent, attachment: AttachmentIdentity): Citation {
  const annotation = event.params?.annotation;
  const position = annotation?.position;
  if (!annotation?.text?.trim() || !position || !Number.isInteger(position.pageIndex) || Number(position.pageIndex) < 0) {
    throw new ReaderError('INVALID_SELECTION', 'Select text in the PDF and try again.');
  }
  if (position.nextPageRects) throw new ReaderError('INVALID_SELECTION', 'Select text on one page; cross-page selections are not supported.');
  const metadata = metadataForAttachment(host, attachment);
  if (!metadata) throw new ReaderError('ATTACHMENT_MISSING', 'The PDF attachment is unavailable.');
  return {
    id: crypto.randomUUID(), attachment: { ...attachment }, metadata: { ...metadata, authors: [...metadata.authors] }, text: annotation.text,
    pageIndex: Number(position.pageIndex), pageLabel: annotation.pageLabel?.trim() || String(Number(position.pageIndex) + 1),
    rects: copyRects(position.rects), capturedAt: new Date().toISOString(),
  };
}

export async function freezeSelectionVersion(host: ZoteroHost, reader: HostReader, citation: Citation): Promise<Citation> {
  return { ...citation, revision: await captureRevision(host, reader, citation.attachment) };
}

export async function openCitation(host: ZoteroHost, citation: Citation): Promise<void> {
  let reader = host.Reader._readers.find(candidate => {
    const item = host.Items.get(candidate.itemID);
    return item?.libraryID === citation.attachment.libraryId && item.key === citation.attachment.attachmentKey;
  });
  if (!reader) {
    const item = host.Items.getByLibraryAndKey?.(citation.attachment.libraryId, citation.attachment.attachmentKey);
    if (!item || !item.id || !host.Reader.open) throw new ReaderError('ATTACHMENT_MISSING', 'The cited PDF is unavailable.');
    reader = await host.Reader.open(item.id) || undefined;
  }
  if (!reader) throw new ReaderError('ATTACHMENT_MISSING', 'The cited PDF is unavailable.');
  if (citation.revision) await assertRevision(host, reader, citation.attachment, citation.revision);
  await reader.navigate({ position: { pageIndex: citation.pageIndex, rects: citation.rects.map(rect => [...rect]) } });
}

export function selectionForPrompt(citation: Citation): string {
  return `${citation.metadata.title}, page ${citation.pageLabel}\n${citation.text}`;
}
