import type { jsPDF } from 'jspdf';

let fontReady: Promise<void> | null = null;
let fontCache: { regular: string; bold: string } | null = null;

function arrayBufferToBase64(buffer: ArrayBuffer) {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}

/** Embed Noto Sans (Cyrillic + Latin) into a jsPDF document. */
export async function ensurePdfFonts(doc: jsPDF) {
  if (!fontCache) {
    fontReady ??= (async () => {
      const [regular, bold] = await Promise.all([
        fetch(`${import.meta.env.BASE_URL}fonts/NotoSans-Regular.ttf`).then(r => {
          if (!r.ok) throw new Error('NotoSans-Regular topilmadi');
          return r.arrayBuffer();
        }),
        fetch(`${import.meta.env.BASE_URL}fonts/NotoSans-Bold.ttf`).then(r => {
          if (!r.ok) throw new Error('NotoSans-Bold topilmadi');
          return r.arrayBuffer();
        }),
      ]);
      fontCache = {
        regular: arrayBufferToBase64(regular),
        bold: arrayBufferToBase64(bold),
      };
    })();
    await fontReady;
  }
  doc.addFileToVFS('NotoSans-Regular.ttf', fontCache!.regular);
  doc.addFileToVFS('NotoSans-Bold.ttf', fontCache!.bold);
  doc.addFont('NotoSans-Regular.ttf', 'NotoSans', 'normal');
  doc.addFont('NotoSans-Bold.ttf', 'NotoSans', 'bold');
  doc.setFont('NotoSans', 'normal');
}
