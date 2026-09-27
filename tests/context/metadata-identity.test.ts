import { describe, expect, it } from 'vitest';
import { attachmentFromReader, metadataForAttachment } from '../../src/context/metadata.ts';
import { attachmentBinding, type AttachmentIdentity } from '../../src/model.ts';
import type { HostItem, HostReader, ZoteroHost } from '../../src/host/types.ts';

function item(fields: Record<string, string>, options: Partial<HostItem> = {}): HostItem {
  return {
    key: 'item',
    libraryID: 1,
    ...options,
    getField: name => fields[name] ?? '',
    getCreators: () => [{ firstName: 'Ada', lastName: 'Lovelace', creatorType: 'author' }],
  };
}

function hostFixture() {
  const parent = item({ title: 'Synthetic shared paper', date: '2026', DOI: '10.1000/example', abstractNote: 'Synthetic abstract.' }, { id: 10, key: 'PARENT', itemType: 'journalArticle' });
  const first = item({ title: 'paper-a.pdf' }, { id: 11, key: 'PDF-A', parentItemID: 10, itemType: 'attachment' });
  const second = item({ title: 'paper-b.pdf' }, { id: 12, key: 'PDF-B', parentItemID: 10, itemType: 'attachment' });
  const byId = new Map([[10, parent], [11, first], [12, second]]);
  const byKey = new Map([['PDF-A', first], ['PDF-B', second]]);
  const host = {
    Items: {
      get: (id: number) => byId.get(id),
      getByLibraryAndKey: (libraryId: number, key: string) => libraryId === 1 ? byKey.get(key) : undefined,
    },
  } as unknown as ZoteroHost;
  const reader = (itemID: number) => ({ itemID }) as HostReader;
  return { host, reader, first, second };
}

describe('Reader attachment identity and local metadata', () => {
  it('keeps two PDFs under one parent as distinct Reader bindings', () => {
    const { host, reader } = hostFixture();
    const first = attachmentFromReader(host, reader(11));
    const second = attachmentFromReader(host, reader(12));

    expect(first?.attachmentKey).toBe('PDF-A');
    expect(second?.attachmentKey).toBe('PDF-B');
    expect(first).not.toBeNull();
    expect(second).not.toBeNull();
    expect(attachmentBinding(first!)).not.toBe(attachmentBinding(second!));
    expect(first!.libraryId).toBe(1);
    expect(metadataForAttachment(host, first!)).toMatchObject({
      title: 'Synthetic shared paper',
      doi: '10.1000/example',
      abstract: 'Synthetic abstract.',
    });
    expect(metadataForAttachment(host, second!)).toEqual(metadataForAttachment(host, first!));
  });

  it('keeps same attachment keys in separate libraries distinct', () => {
    const one: AttachmentIdentity = { libraryId: 1, attachmentKey: 'SAME', attachmentTitle: 'first.pdf' };
    const two: AttachmentIdentity = { libraryId: 2, attachmentKey: 'SAME', attachmentTitle: 'second.pdf' };
    expect(attachmentBinding(one)).not.toBe(attachmentBinding(two));
  });
});
