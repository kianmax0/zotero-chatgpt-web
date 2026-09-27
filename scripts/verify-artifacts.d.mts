export interface VerifiedXpi {
  files: string[];
  manifest: { applications: { zotero: { id: string } }; [key: string]: unknown };
  digest: string;
}

export const PRODUCT_ID: string;
export const REQUIRED_FILES: string[];
export function verifyXpi(filePath: string): Promise<VerifiedXpi>;
