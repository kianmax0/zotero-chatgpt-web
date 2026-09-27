import { createHash, webcrypto } from 'node:crypto';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { freezeSelectionVersion, captureSelection, selectionForPrompt } from '../../src/context/selection.ts';
import { assertRevision } from '../../src/context/revision.ts';
import type { HostItem, HostReader, ZoteroHost } from '../../src/host/types.ts';
import type { PdfRevision } from '../../src/model.ts';

const pdfBytes = new TextEncoder().encode('synthetic PDF bytes for version check');
const pdfDigest = createHash('sha256').update(pdfBytes).digest('hex');

function makeItem(key: string, fields: Record<string, string>, options: Partial<HostItem> = {}): HostItem {
  return {
    key,
    libraryID: 4,
    ...options,
    getField: name => fields[name] ?? '',
    getCreators: () => [{ firstName: 'Ada', lastName: 'Lovelace', creatorType: 'author' }],
  };
}

function makeHostAndReader() {
  const parent = makeItem('PARENT', { title: 'Synthetic PDF paper', date: '2026' }, { id: 10, itemType: 'journalArticle' });
  const attachment = makeItem('PDF-A', { title: 'first-version.pdf' }, {
    id: 11,
    parentItemID: 10,
    itemType: 'attachment',
    getFilePathAsync: () => Promise.resolve('/synthetic/first-version.pdf'),
  });
  const otherAttachment = makeItem('PDF-B', { title: 'second-version.pdf' }, { id: 12, parentItemID: 10, itemType: 'attachment' });
  const byId = new Map([[10, parent], [11, attachment], [12, otherAttachment]]);
  const byKey = new Map([['PDF-A', attachment], ['PDF-B', otherAttachment]]);
  const host = {
    Items: {
      get: (id: number) => byId.get(id),
      getByLibraryAndKey: (libraryId: number, key: string) => libraryId === 4 ? byKey.get(key) : undefined,
    },
  } as unknown as ZoteroHost;
  const reader = {
    itemID: 11,
    _internalReader: { _primaryView: { _iframeWindow: { PDFViewerApplication: {
      pdfDocument: { fingerprints: ['synthetic-fingerprint'], getData: () => Promise.resolve(pdfBytes) },
    } } } },
  } as unknown as HostReader;
  return { host, reader, attachment };
}

function popup(annotation: NonNullable<Parameters<typeof captureSelection>[1]['params']['annotation']>) {
  return { reader: {} as HostReader, doc: {} as Document, append: () => undefined, params: { annotation } };
}

afterEach(() => vi.unstubAllGlobals());

describe('selection capture and frozen PDF source', () => {
  it('copies selected text, page geometry, attachment and PDF revision at capture time', async () => {
    vi.stubGlobal('crypto', webcrypto);
    vi.stubGlobal('IOUtils', {
      computeHexDigest: () => Promise.resolve(pdfDigest),
      stat: () => Promise.resolve({ size: pdfBytes.byteLength, lastModified: 42 }),
    });
    const { host, reader } = makeHostAndReader();
    const annotation = {
      text: 'Synthetic passage A',
      pageLabel: '8',
      position: { pageIndex: 7, rects: [[10, 20, 30, 40]] },
    };
    const citation = captureSelection(host, popup(annotation), {
      libraryId: 4, attachmentKey: 'PDF-A', attachmentTitle: 'first-version.pdf',
    });
    const frozen = await freezeSelectionVersion(host, reader, citation);
    annotation.text = 'Changed after click';
    annotation.position.pageIndex = 0;
    annotation.position.rects[0]![0] = 999;

    expect(frozen).toMatchObject({
      attachment: { libraryId: 4, attachmentKey: 'PDF-A', attachmentTitle: 'first-version.pdf' },
      text: 'Synthetic passage A',
      pageIndex: 7,
      pageLabel: '8',
      rects: [[10, 20, 30, 40]],
      revision: {
        fingerprint: 'synthetic-fingerprint',
        size: pdfBytes.byteLength,
        modifiedAt: 42,
        sha256: pdfDigest,
      } satisfies PdfRevision,
    });
    expect(selectionForPrompt(frozen)).toContain('page 8\nSynthetic passage A');

    reader.itemID = 12;
    await expect(assertRevision(host, reader, frozen.attachment, frozen.revision!))
      .rejects.toMatchObject({ code: 'ATTACHMENT_MISSING' });
  });

  it('rejects a cross-page selection instead of silently truncating it', () => {
    const { host } = makeHostAndReader();
    const event = popup({
      text: 'Synthetic passage spans pages',
      pageLabel: '8',
      position: { pageIndex: 7, rects: [[10, 20, 30, 40]], nextPageRects: [[1, 2, 3, 4]] },
    });
    expect(() => captureSelection(host, event, { libraryId: 4, attachmentKey: 'PDF-A', attachmentTitle: 'first-version.pdf' }))
      .toThrow(/one page/u);
  });
});
