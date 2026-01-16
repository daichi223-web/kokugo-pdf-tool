// =============================================================================
// エクスポートユーティリティ
// P1-006: テキスト出力
// P1-007: Markdown出力
// P2-002: Word出力
// P2-003: PDF出力（テキスト）
// P3-006: 印刷用PDF出力
// =============================================================================

import { Document, Packer, Paragraph, TextRun, HeadingLevel } from 'docx';
import { PDFDocument, rgb } from 'pdf-lib';
import { jsPDF } from 'jspdf';
import html2canvas from 'html2canvas';
import type { LayoutPage, Snippet, TextElement } from '../types';
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
 * 16進数カラーをRGBに変換（pdf-lib用）
 */
function hexToRgb(hex: string): { r: number; g: number; b: number } | null {
  const result = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex);
  if (!result) return null;
  return {
    r: parseInt(result[1], 16) / 255,
    g: parseInt(result[2], 16) / 255,
    b: parseInt(result[3], 16) / 255,
  };
}

/**
 * テキスト要素をCanvas画像として描画
 * 縦書き・横書きに対応
 */
async function renderTextElementToImage(textElement: TextElement): Promise<string | null> {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  // 高解像度で描画（2倍）
  const scale = 2;
  canvas.width = textElement.size.width * scale;
  canvas.height = textElement.size.height * scale;

  // 背景を透明に
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  // フォント設定
  ctx.font = `${textElement.fontSize * scale}px ${textElement.fontFamily}`;
  ctx.fillStyle = textElement.color;
  ctx.textBaseline = 'top';

  const padding = 4 * scale;
  const lineHeight = textElement.fontSize * scale * 1.5;

  if (textElement.writingMode === 'vertical') {
    // 縦書き: 右から左へ列を描画
    const chars = textElement.content.split('');
    let x = canvas.width - padding - textElement.fontSize * scale;
    let y = padding;

    for (const char of chars) {
      if (char === '\n') {
        x -= lineHeight;
        y = padding;
        continue;
      }

      // 列の終端に達したら次の列へ
      if (y + textElement.fontSize * scale > canvas.height - padding) {
        x -= lineHeight;
        y = padding;
      }

      ctx.fillText(char, x, y);
      y += textElement.fontSize * scale;
    }
  } else {
    // 横書き: 上から下へ行を描画
    const lines = textElement.content.split('\n');
    let y = padding;

    for (const line of lines) {
      ctx.fillText(line, padding, y);
      y += lineHeight;
    }
  }

  return canvas.toDataURL('image/png');
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

  // 画面は96 DPI、PDFは72 DPI（ポイント）
  const screenDpi = 96;
  const pdfDpi = 72;
  const dpiRatio = pdfDpi / screenDpi;

  for (const layoutPage of layoutPages) {
    const paperSize = getPaperDimensions(layoutPage.paperSize, layoutPage.orientation);
    const pageWidth = mmToPx(paperSize.width, pdfDpi); // PDF points
    const pageHeight = mmToPx(paperSize.height, pdfDpi);

    const page = pdfDoc.addPage([pageWidth, pageHeight]);

    // 余白設定（15mm）
    const margin = mmToPx(15, pdfDpi);

    for (const placedSnippet of layoutPage.snippets) {
      const snippet = snippets.find((s) => s.id === placedSnippet.snippetId);
      if (!snippet || !snippet.imageData) continue;

      try {
        // Base64画像をPDFに埋め込み
        const imageBytes = await fetch(snippet.imageData).then((res) =>
          res.arrayBuffer()
        );
        const image = await pdfDoc.embedPng(imageBytes);

        // 配置位置とサイズを計算（96 DPIピクセル → 72 DPIポイント）
        const x = margin + placedSnippet.position.x * dpiRatio;
        const width = placedSnippet.size.width * dpiRatio;
        const height = placedSnippet.size.height * dpiRatio;
        const y = pageHeight - margin - placedSnippet.position.y * dpiRatio - height;

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

    // テキスト要素を描画
    if (layoutPage.textElements) {
      for (const textElement of layoutPage.textElements) {
        try {
          // テキストをCanvasに描画
          const textImage = await renderTextElementToImage(textElement);
          if (!textImage) continue;

          const imageBytes = await fetch(textImage).then((res) => res.arrayBuffer());
          const image = await pdfDoc.embedPng(imageBytes);

          // 配置位置とサイズを計算
          const x = margin + textElement.position.x * dpiRatio;
          const width = textElement.size.width * dpiRatio;
          const height = textElement.size.height * dpiRatio;
          const y = pageHeight - margin - textElement.position.y * dpiRatio - height;

          page.drawImage(image, { x, y, width, height });
        } catch (error) {
          console.error('Failed to embed text element:', error);
        }
      }
    }

    // 図形要素を描画
    if (layoutPage.shapeElements) {
      for (const shape of layoutPage.shapeElements) {
        try {
          const x = margin + shape.position.x * dpiRatio;
          const width = shape.size.width * dpiRatio;
          const height = shape.size.height * dpiRatio;
          const y = pageHeight - margin - shape.position.y * dpiRatio - height;

          const strokeColor = hexToRgb(shape.strokeColor);
          const fillColor = shape.fillColor !== 'transparent' ? hexToRgb(shape.fillColor) : null;

          if (shape.shapeType === 'rectangle') {
            if (fillColor) {
              page.drawRectangle({
                x,
                y,
                width,
                height,
                color: rgb(fillColor.r, fillColor.g, fillColor.b),
              });
            }
            if (strokeColor) {
              page.drawRectangle({
                x,
                y,
                width,
                height,
                borderColor: rgb(strokeColor.r, strokeColor.g, strokeColor.b),
                borderWidth: shape.strokeWidth * dpiRatio,
              });
            }
          } else if (shape.shapeType === 'circle') {
            const cx = x + width / 2;
            const cy = y + height / 2;
            const rx = width / 2;
            const ry = height / 2;

            if (fillColor) {
              page.drawEllipse({
                x: cx,
                y: cy,
                xScale: rx,
                yScale: ry,
                color: rgb(fillColor.r, fillColor.g, fillColor.b),
              });
            }
            if (strokeColor) {
              page.drawEllipse({
                x: cx,
                y: cy,
                xScale: rx,
                yScale: ry,
                borderColor: rgb(strokeColor.r, strokeColor.g, strokeColor.b),
                borderWidth: shape.strokeWidth * dpiRatio,
              });
            }
          } else if (shape.shapeType === 'line') {
            if (strokeColor) {
              const lineY = y + height / 2;
              page.drawLine({
                start: { x, y: lineY },
                end: { x: x + width, y: lineY },
                color: rgb(strokeColor.r, strokeColor.g, strokeColor.b),
                thickness: shape.strokeWidth * dpiRatio,
              });
            }
          }
        } catch (error) {
          console.error('Failed to draw shape element:', error);
        }
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
