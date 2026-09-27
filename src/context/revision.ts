import { ReaderError, sameAttachment, type AttachmentIdentity, type PdfRevision } from '../model.ts';
import { attachmentFromReader } from './metadata.ts';
import type { HostReader, ZoteroHost } from '../host/types.ts';

interface PdfBytes { fingerprints?: string[]; getData(): Promise<ArrayBuffer | Uint8Array> }
interface FileIO { stat(path: string): Promise<{ size: number; lastModified: number }>; computeHexDigest(path: string, algorithm: 'sha256'): Promise<string> }
declare const IOUtils: FileIO;

function pdfOf(reader: HostReader): PdfBytes | undefined {
  const view = reader._internalReader?._primaryView ?? reader._internalReader?._lastView;
  return view?._iframeWindow?.PDFViewerApplication?.pdfDocument;
}

async function waitForPdf(reader: HostReader): Promise<PdfBytes> {
  for (let attempt = 0; attempt < 40; attempt++) {
    const pdf = pdfOf(reader);
    if (pdf?.getData) return pdf;
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new ReaderError('PDF_UNAVAILABLE', 'The PDF is still loading. Wait and try again.');
}

/** Match the loaded bytes to the current disk file; neither path nor bytes leave this function. */
export async function captureRevision(host: ZoteroHost, reader: HostReader, identity: AttachmentIdentity): Promise<PdfRevision> {
  const current = attachmentFromReader(host, reader);
  if (!current || !sameAttachment(current, identity)) throw new ReaderError('ATTACHMENT_MISSING', 'The selected attachment is no longer open. Reopen it and select again.');
  const item = host.Items.get(reader.itemID);
  const pdf = await waitForPdf(reader);
  const afterLoad = attachmentFromReader(host, reader);
  if (!afterLoad || !sameAttachment(afterLoad, identity) || pdfOf(reader) !== pdf) {
    throw new ReaderError('ATTACHMENT_MISSING', 'The Reader changed PDF while its version was being checked. Select the passage again.');
  }
  const path = await item?.getFilePathAsync?.();
  if (!path || !IOUtils?.computeHexDigest) throw new ReaderError('PDF_UNAVAILABLE', 'The PDF version cannot be checked. Reopen it and try again.');
  try {
    const [loaded, disk, stat] = await Promise.all([pdf.getData(), IOUtils.computeHexDigest(path, 'sha256'), IOUtils.stat(path)]);
    const bytes = loaded instanceof Uint8Array ? loaded : new Uint8Array(loaded);
    const stableBytes = new Uint8Array(bytes.byteLength);
    stableBytes.set(bytes);
    const digest = await crypto.subtle.digest('SHA-256', stableBytes);
    const hex = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
    if (hex !== disk) throw new ReaderError('PDF_CHANGED', 'The PDF file changed while open. Reopen it and select the passage again.');
    const finalIdentity = attachmentFromReader(host, reader);
    if (!finalIdentity || !sameAttachment(finalIdentity, identity) || pdfOf(reader) !== pdf) {
      throw new ReaderError('ATTACHMENT_MISSING', 'The Reader changed PDF while its version was being checked. Select the passage again.');
    }
    return { fingerprint: (pdf.fingerprints ?? []).filter(Boolean).join(':'), size: stat.size, modifiedAt: stat.lastModified, sha256: disk };
  } catch (error) {
    if (error instanceof ReaderError) throw error;
    throw new ReaderError('PDF_UNAVAILABLE', 'The PDF version could not be checked. Reopen it and try again.');
  }
}

export async function assertRevision(host: ZoteroHost, reader: HostReader, identity: AttachmentIdentity, frozen: PdfRevision): Promise<void> {
  const current = await captureRevision(host, reader, identity);
  if (JSON.stringify(current) !== JSON.stringify(frozen)) throw new ReaderError('PDF_CHANGED', 'The PDF version changed. Reopen it and select the passage again.');
}
