/** Copy a real PDF file to the OS clipboard. The user must paste it on the official page. */
interface GeckoFile { initWithPath(path: string): void }
interface GeckoTransferable { init(context: null): void; addDataFlavor(flavor: string): void; setTransferData(flavor: string, file: GeckoFile, length: number): void }
interface GeckoClipboard { kGlobalClipboard: number; setData(transferable: GeckoTransferable, owner: null, type: number): void }
interface GeckoAccess {
  Cc: Record<string, { getService?(iface: unknown): unknown; createInstance?(iface: unknown): unknown } | undefined>;
  Ci: { nsIClipboard: unknown; nsITransferable: unknown; nsIFile: unknown };
}

declare const Cc: GeckoAccess['Cc'];
declare const Ci: GeckoAccess['Ci'];

export function copyPdfFile(path: string, access: GeckoAccess = { Cc, Ci }): boolean {
  if (!path) return false;
  try {
    const clipboard = access.Cc['@mozilla.org/widget/clipboard;1']?.getService?.(access.Ci.nsIClipboard) as GeckoClipboard | undefined;
    const transfer = access.Cc['@mozilla.org/widget/transferable;1']?.createInstance?.(access.Ci.nsITransferable) as GeckoTransferable | undefined;
    const file = access.Cc['@mozilla.org/file/local;1']?.createInstance?.(access.Ci.nsIFile) as GeckoFile | undefined;
    if (!clipboard || !transfer || !file) return false;
    file.initWithPath(path);
    transfer.init(null);
    transfer.addDataFlavor('application/x-moz-file');
    transfer.setTransferData('application/x-moz-file', file, 0);
    clipboard.setData(transfer, null, clipboard.kGlobalClipboard);
    return true;
  } catch { return false; }
}
