export interface AttachmentIdentity {
  libraryId: number;
  attachmentKey: string;
  attachmentTitle: string;
}

export interface PaperMetadata {
  title: string;
  authors: string[];
  year?: string;
  doi?: string;
  abstract?: string;
  publication?: string;
}

export interface PdfRevision {
  fingerprint: string;
  size: number;
  modifiedAt: number;
  sha256: string;
}

export type Rect = [number, number, number, number];

/** A Reader selection copied at popup creation, including its attachment identity. */
export interface Citation {
  id: string;
  attachment: AttachmentIdentity;
  metadata: PaperMetadata;
  text: string;
  pageIndex: number;
  pageLabel: string;
  rects: Rect[];
  capturedAt: string;
  revision?: PdfRevision;
}

export class ReaderError extends Error {
  constructor(readonly code: 'INVALID_SELECTION' | 'PDF_CHANGED' | 'PDF_UNAVAILABLE' | 'ATTACHMENT_MISSING' | 'CHAT_UNAVAILABLE', message: string) {
    super(message);
    this.name = 'ReaderError';
  }
}

export function attachmentBinding(identity: AttachmentIdentity): string {
  return `${identity.libraryId}:${identity.attachmentKey}`;
}

export function sameAttachment(left: AttachmentIdentity, right: AttachmentIdentity): boolean {
  return left.libraryId === right.libraryId && left.attachmentKey === right.attachmentKey;
}
