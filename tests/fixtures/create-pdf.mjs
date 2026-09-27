import { Buffer } from "node:buffer";

function pdfTextEscape(value) {
  return value.replaceAll("\\", "\\\\").replaceAll("(", "\\(").replaceAll(")", "\\)");
}

function pageStream(lines) {
  const commands = ["BT", "/F1 12 Tf", "72 740 Td", "16 TL"];
  for (const line of lines) commands.push(`(${pdfTextEscape(line)}) Tj`, "T*");
  commands.push("ET");
  return commands.join("\n");
}

/** Build a small, selectable-text PDF using only Node built-ins. */
export function createFixturePdf(title, verificationToken, pageLines = []) {
  if (!/^[A-Z0-9-]{20,80}$/u.test(verificationToken)) throw new Error("Fixture token must be a unique uppercase ASCII token");
  const pages = [
    ["Synthetic Zotero ChatGPT Web test document", title, "Page 1. Use only for isolated plugin validation.", `Verification content: ${verificationToken}`],
    ["Synthetic Zotero ChatGPT Web test document", title, "Page 2. This text is also selectable.", ...pageLines],
  ];
  const objects = [];
  const pageObjectIds = pages.map((_, index) => 5 + index * 2);
  const contentObjectIds = pageObjectIds.map(id => id + 1);
  objects.push("<< /Type /Catalog /Pages 2 0 R >>");
  objects.push(`<< /Type /Pages /Kids [${pageObjectIds.map(id => `${id} 0 R`).join(" ")}] /Count ${pages.length} >>`);
  objects.push("<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>");
  objects.push("<< /Producer (Zotero ChatGPT Web synthetic fixture generator) >>");
  for (let index = 0; index < pages.length; index += 1) {
    objects.push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 3 0 R >> >> /Contents ${contentObjectIds[index]} 0 R >>`);
    const stream = pageStream(pages[index]);
    objects.push(`<< /Length ${Buffer.byteLength(stream, "ascii")} >>\nstream\n${stream}\nendstream`);
  }

  let output = "%PDF-1.4\n%âãÏÓ\n";
  const offsets = [0];
  for (let index = 0; index < objects.length; index += 1) {
    offsets.push(Buffer.byteLength(output, "binary"));
    output += `${index + 1} 0 obj\n${objects[index]}\nendobj\n`;
  }
  const xrefOffset = Buffer.byteLength(output, "binary");
  output += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const offset of offsets.slice(1)) output += `${String(offset).padStart(10, "0")} 00000 n \n`;
  output += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R /Info 4 0 R >>\nstartxref\n${xrefOffset}\n%%EOF\n`;
  return Buffer.from(output, "binary");
}
