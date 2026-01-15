// =============================================================================
// エクスポートユーティリティ
// P1-006: テキスト出力
// P1-007: Markdown出力
// P2-002: Word出力
// P2-003: PDF出力（テキスト）
// P3-006: 印刷用PDF出力
// =============================================================================

import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { PDFDocument } from 'pdf-lib';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import type { LayoutPage, Snippet } from '../types';
import { getPaperDimensions } from '../types';
import { applyRubyBrackets } from './ocrUtils';
import { mmToPx } from './helpers';

/**
 * テキスト形式でエクスポート
 * P1-006: テキスト出力
 */
export function exportToText(text: string, includeRuby: boolean): Blob {
  const processedText = applyRubyBrackets(text, includeRuby);
  return new Blob([processedText], { type: 'text/plain;charset=utf-8' });
}

/**
 * Markdown形式でエクスポート
 * P1-007: Markdown出力
 */
export function exportToMarkdown(
  text: string,
  title: string,
  includeRuby: boolean
): Blob {
  const processedText = applyRubyBrackets(text, includeRuby);

  const markdown = `# ${title.replace('.pdf', '')}

---

${processedText}

---

*このドキュメントは国語PDF編集ツールで生成されました。*
`;

  return new Blob([markdown], { type: 'text/markdown;charset=utf-8' });
}

/**
 * Word形式（.docx）でエクスポート
 * P2-002: Word出力
 */
export async function exportToDocx(
  text: string,
  title: string,
  includeRuby: boolean
): Promise<Blob> {
  const processedText = applyRubyBrackets(text, includeRuby);
  const paragraphs = processedText.split('\n\n');

  const doc = new Document({
    sections: [
      {
        properties: {},
        children: [
          new Paragraph({
            text: title.replace('.pdf', ''),
            heading: HeadingLevel.HEADING_1,
          }),
          ...paragraphs.map(
            (para) =>
              new Paragraph({
                children: [
                  new TextRun({
                    text: para,
                    font: 'Yu Mincho', // 游明朝（縦書き対応フォント）
                  }),
                ],
                spacing: {
                  after: 200,
                },
              })
          ),
        ],
      },
    ],
  });

  return await Packer.toBlob(doc);
}

/**
 * PDF形式でテキストをエクスポート
 * P2-003: PDF出力（テキスト）
 *
 * html2canvas + jsPDF を使用して日本語テキストを正しく出力
 */
export async function exportToPDF(
  text: string,
  includeRuby: boolean
): Promise<Blob> {
  const processedText = applyRubyBrackets(text, includeRuby);

  // 一時的なHTML要素を作成
  const container = document.createElement('div');
  container.style.cssText = `
    position: fixed;
    left: -9999px;
    top: 0;
    width: 595px;
    padding: 50px;
    background: white;
    font-family: "Yu Mincho", "游明朝", "Hiragino Mincho ProN", "MS Mincho", serif;
    font-size: 12px;
    line-height: 1.8;
    color: black;
    white-space: pre-wrap;
    word-wrap: break-word;
  `;
  container.textContent = processedText;
  document.body.appendChild(container);

  try {
    // HTML要素をCanvasに変換
    const canvas = await html2canvas(container, {
      scale: 2, // 高解像度
      useCORS: true,
      backgroundColor: '#ffffff',
    });

    // A4サイズのPDFを作成
    const pdf = new jsPDF({
      orientation: 'portrait',
      unit: 'mm',
      format: 'a4',
    });

    const pageWidth = 210; // A4幅（mm）
    const pageHeight = 297; // A4高さ（mm）
    const margin = 15; // 余白（mm）
    const contentWidth = pageWidth - margin * 2;
    const contentHeight = pageHeight - margin * 2;

    // Canvas画像をPDFページに分割して追加
    const imgData = canvas.toDataURL('image/png');
    const imgWidth = contentWidth;
    const imgHeight = (canvas.height * contentWidth) / canvas.width;

    let heightLeft = imgHeight;
    let position = margin;
    let pageNum = 0;

    while (heightLeft > 0) {
      if (pageNum > 0) {
        pdf.addPage();
      }

      pdf.addImage(
        imgData,
        'PNG',
        margin,
        position - pageNum * contentHeight,
        imgWidth,
        imgHeight
      );

      heightLeft -= contentHeight;
      pageNum++;
    }

    // PDFをBlobとして返す
    return pdf.output('blob');
  } finally {
    // クリーンアップ
    document.body.removeChild(container);
  }
}


/**
 * レイアウトをPDFとしてエクスポート
 * P3-006: 印刷用PDF出力
 */
export async function exportLayoutToPDF(
  layoutPages: LayoutPage[],
  snippets: Snippet[]
): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();

  for (const layoutPage of layoutPages) {
    const paperSize = getPaperDimensions(layoutPage.paperSize, layoutPage.orientation);
    const pageWidth = mmToPx(paperSize.width, 72); // 72 DPI for PDF points
    const pageHeight = mmToPx(paperSize.height, 72);

    const page = pdfDoc.addPage([pageWidth, pageHeight]);

    // 余白設定（15mm）
    const margin = mmToPx(15, 72);

    for (const placedSnippet of layoutPage.snippets) {
      const snippet = snippets.find((s) => s.id === placedSnippet.snippetId);
      if (!snippet || !snippet.imageData) continue;

      try {
        // Base64画像をPDFに埋め込み
        const imageBytes = await fetch(snippet.imageData).then((res) =>
          res.arrayBuffer()
        );
        const image = await pdfDoc.embedPng(imageBytes);

        // 配置位置とサイズを計算
        const x = margin + mmToPx(placedSnippet.position.x, 72);
        const y =
          pageHeight - margin - mmToPx(placedSnippet.position.y, 72) - mmToPx(placedSnippet.size.height, 72);
        const width = mmToPx(placedSnippet.size.width, 72);
        const height = mmToPx(placedSnippet.size.height, 72);

        page.drawImage(image, {
          x,
          y,
          width,
          height,
        });
      } catch (error) {
        console.error('Failed to embed snippet:', error);
      }
    }
  }

  const pdfBytes = await pdfDoc.save();
  return new Blob([new Uint8Array(pdfBytes)], { type: 'application/pdf' });
}

/**
 * クリップボードにコピー
 * P1-008: クリップボードコピー
 */
export async function copyTextToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (error) {
    console.error('Failed to copy to clipboard:', error);

    // フォールバック: 旧式の方法
    const textArea = document.createElement('textarea');
    textArea.value = text;
    textArea.style.position = 'fixed';
    textArea.style.left = '-999999px';
    document.body.appendChild(textArea);
    textArea.select();

    try {
      document.execCommand('copy');
      return true;
    } catch (err) {
      console.error('Fallback copy failed:', err);
      return false;
    } finally {
      document.body.removeChild(textArea);
    }
  }
}
