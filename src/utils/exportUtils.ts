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
import type { LayoutPage, Snippet, TextElement, ImageEnhancement } from '../types';
import { getPaperDimensions } from '../types';
import { applyRubyBrackets } from './ocrUtils';
import { mmToPx } from './helpers';
import { applyImageEnhancement } from './pdfUtils';

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
 * PDF出力の画質設定
 */
export type PdfQuality = 'maximum' | 'high' | 'standard' | 'light';

export interface PdfQualitySettings {
  format: 'png' | 'jpeg';
  quality: number;  // JPEG品質 0-1
  scale: number;    // 解像度スケール（1以上で拡大、印刷品質向上）
  useOriginalSize: boolean;  // 元のサイズを維持（縮小しない）
}

export const PDF_QUALITY_PRESETS: Record<PdfQuality, PdfQualitySettings> = {
  maximum: { format: 'png', quality: 1, scale: 2, useOriginalSize: true },  // 最高：2倍解像度、PNG、元サイズ維持
  high: { format: 'png', quality: 1, scale: 1, useOriginalSize: false },
  standard: { format: 'jpeg', quality: 0.85, scale: 1, useOriginalSize: false },
  light: { format: 'jpeg', quality: 0.7, scale: 0.75, useOriginalSize: false },
};

/**
 * 画像をリサイズ・圧縮する
 * 最高画質モードでは元画像の解像度を維持しつつ、高品質な補間で拡大
 * @param imageData 元の画像データ（Base64）
 * @param settings 品質設定
 * @param enhancement 画像補正設定（オプション）
 */
async function processImageForPdf(
  imageData: string,
  settings: PdfQualitySettings,
  enhancement?: ImageEnhancement
): Promise<{ data: ArrayBuffer; isPng: boolean; originalWidth: number; originalHeight: number }> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      const ctx = canvas.getContext('2d');
      if (!ctx) {
        reject(new Error('Canvas context not available'));
        return;
      }

      // スケールを適用（最高画質モードでは2倍に拡大して高解像度化）
      canvas.width = Math.round(img.width * settings.scale);
      canvas.height = Math.round(img.height * settings.scale);

      // シャープ化が有効な場合はスムージングをOFF
      if (enhancement?.sharpness) {
        ctx.imageSmoothingEnabled = false;
      } else {
        // 高品質な補間を有効化
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
      }

      // 白背景（JPEG用）
      if (settings.format === 'jpeg') {
        ctx.fillStyle = '#ffffff';
        ctx.fillRect(0, 0, canvas.width, canvas.height);
      }

      ctx.drawImage(img, 0, 0, canvas.width, canvas.height);

      // 画像補正を適用
      let finalCanvas = canvas;
      if (enhancement) {
        const needsEnhancement =
          (enhancement.textDarkness !== undefined && enhancement.textDarkness !== 1.0) ||
          enhancement.contrast !== 1.0 ||
          enhancement.brightness !== 1.0 ||
          enhancement.autoLevels ||
          enhancement.unsharpMask ||
          enhancement.grayscale;
        if (needsEnhancement) {
          finalCanvas = applyImageEnhancement(canvas, enhancement);
        }
      }

      // 出力形式を選択
      const mimeType = settings.format === 'png' ? 'image/png' : 'image/jpeg';
      const dataUrl = finalCanvas.toDataURL(mimeType, settings.quality);

      fetch(dataUrl)
        .then(res => res.arrayBuffer())
        .then(buffer => resolve({
          data: buffer,
          isPng: settings.format === 'png',
          originalWidth: img.width,
          originalHeight: img.height
        }))
        .catch(reject);
    };
    img.onerror = reject;
    img.src = imageData;
  });
}

/**
 * レイアウトをPDFとしてエクスポート
 * P3-006: 印刷用PDF出力
 * @param layoutPages レイアウトページ配列
 * @param snippets スニペット配列
 * @param quality 出力品質
 * @param enhancement 画像補正設定（オプション）
 */
export async function exportLayoutToPDF(
  layoutPages: LayoutPage[],
  snippets: Snippet[],
  quality: PdfQuality = 'high',
  enhancement?: ImageEnhancement
): Promise<Blob> {
  const pdfDoc = await PDFDocument.create();
  const qualitySettings = PDF_QUALITY_PRESETS[quality];

  // 画面は96 DPI、PDFは72 DPI（ポイント）
  const screenDpi = 96;
  const pdfDpi = 72;
  const dpiRatio = pdfDpi / screenDpi;

  for (const layoutPage of layoutPages) {
    const paperSize = getPaperDimensions(layoutPage.paperSize, layoutPage.orientation);
    const pageWidth = mmToPx(paperSize.width, pdfDpi); // PDF points
    const pageHeight = mmToPx(paperSize.height, pdfDpi);

    const page = pdfDoc.addPage([pageWidth, pageHeight]);

    // ページごとの余白設定を使用（デフォルト15mm）
    const marginX = mmToPx(layoutPage.marginX ?? layoutPage.margin ?? 15, pdfDpi);
    const marginY = mmToPx(layoutPage.marginY ?? layoutPage.margin ?? 15, pdfDpi);

    for (const placedSnippet of layoutPage.snippets) {
      const snippet = snippets.find((s) => s.id === placedSnippet.snippetId);
      if (!snippet || !snippet.imageData) continue;

      try {
        // 画像を処理（圧縮・リサイズ）してPDFに埋め込み
        const processed = await processImageForPdf(snippet.imageData, qualitySettings, enhancement);
        const image = processed.isPng
          ? await pdfDoc.embedPng(processed.data)
          : await pdfDoc.embedJpg(processed.data);

        // 配置位置とサイズを計算（96 DPIピクセル → 72 DPIポイント）
        const x = marginX + placedSnippet.position.x * dpiRatio;
        const width = placedSnippet.size.width * dpiRatio;
        const height = placedSnippet.size.height * dpiRatio;
        const y = pageHeight - marginY - placedSnippet.position.y * dpiRatio - height;

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
          const x = marginX + textElement.position.x * dpiRatio;
          const width = textElement.size.width * dpiRatio;
          const height = textElement.size.height * dpiRatio;
          const y = pageHeight - marginY - textElement.position.y * dpiRatio - height;

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
          const x = marginX + shape.position.x * dpiRatio;
          const width = shape.size.width * dpiRatio;
          const height = shape.size.height * dpiRatio;
          const y = pageHeight - marginY - shape.position.y * dpiRatio - height;

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

/**
 * 直接印刷機能
 * PDFを生成せずにブラウザの印刷ダイアログを開く
 * @param layoutPages レイアウトページ配列
 * @param snippets スニペット配列
 * @param enhancement 画像補正設定（オプション）
 */
export async function printLayoutDirectly(
  layoutPages: LayoutPage[],
  snippets: Snippet[],
  enhancement?: ImageEnhancement
): Promise<void> {
  // 印刷用コンテナを作成
  const printContainer = document.createElement('div');
  printContainer.id = 'print-container';
  printContainer.style.cssText = `
    position: fixed;
    left: -9999px;
    top: 0;
    width: 100%;
    height: 100%;
    z-index: 9999;
    background: white;
  `;

  // 画面は96 DPI基準
  const screenDpi = 96;

  for (let pageIndex = 0; pageIndex < layoutPages.length; pageIndex++) {
    const layoutPage = layoutPages[pageIndex];
    const paperSize = getPaperDimensions(layoutPage.paperSize, layoutPage.orientation);
    const pageWidth = mmToPx(paperSize.width, screenDpi);
    const pageHeight = mmToPx(paperSize.height, screenDpi);

    // ページコンテナ
    const pageDiv = document.createElement('div');
    pageDiv.className = 'print-page';
    pageDiv.style.cssText = `
      width: ${pageWidth}px;
      height: ${pageHeight}px;
      position: relative;
      background: white;
      page-break-after: ${pageIndex < layoutPages.length - 1 ? 'always' : 'auto'};
      box-sizing: border-box;
    `;

    // ページごとの余白設定を使用（デフォルト15mm）
    const marginX = mmToPx(layoutPage.marginX ?? layoutPage.margin ?? 15, screenDpi);
    const marginY = mmToPx(layoutPage.marginY ?? layoutPage.margin ?? 15, screenDpi);

    // 画像補正フィルターを構築
    const filters: string[] = [];
    if (enhancement?.contrast && enhancement.contrast !== 1.0) {
      filters.push(`contrast(${enhancement.contrast})`);
    }
    if (enhancement?.brightness && enhancement.brightness !== 1.0) {
      filters.push(`brightness(${enhancement.brightness})`);
    }
    const filterStyle = filters.length > 0 ? `filter: ${filters.join(' ')};` : '';
    const imageRenderingStyle = enhancement?.sharpness ? 'image-rendering: crisp-edges;' : '';

    // スニペットを配置
    for (const placedSnippet of layoutPage.snippets) {
      const snippet = snippets.find((s) => s.id === placedSnippet.snippetId);
      if (!snippet || !snippet.imageData) continue;

      const img = document.createElement('img');
      img.src = snippet.imageData;
      img.style.cssText = `
        position: absolute;
        left: ${marginX + placedSnippet.position.x}px;
        top: ${marginY + placedSnippet.position.y}px;
        width: ${placedSnippet.size.width}px;
        height: ${placedSnippet.size.height}px;
        ${filterStyle}
        ${imageRenderingStyle}
      `;
      pageDiv.appendChild(img);
    }

    // テキスト要素を配置
    if (layoutPage.textElements) {
      for (const textElement of layoutPage.textElements) {
        const textDiv = document.createElement('div');
        textDiv.style.cssText = `
          position: absolute;
          left: ${marginX + textElement.position.x}px;
          top: ${marginY + textElement.position.y}px;
          width: ${textElement.size.width}px;
          height: ${textElement.size.height}px;
          font-size: ${textElement.fontSize}px;
          font-family: ${textElement.fontFamily};
          color: ${textElement.color};
          writing-mode: ${textElement.writingMode === 'vertical' ? 'vertical-rl' : 'horizontal-tb'};
          text-align: ${textElement.textAlign};
          white-space: pre-wrap;
          overflow: hidden;
        `;
        textDiv.textContent = textElement.content;
        pageDiv.appendChild(textDiv);
      }
    }

    // 図形要素を配置
    if (layoutPage.shapeElements) {
      for (const shape of layoutPage.shapeElements) {
        const shapeDiv = document.createElement('div');
        const baseStyle = `
          position: absolute;
          left: ${marginX + shape.position.x}px;
          top: ${marginY + shape.position.y}px;
          width: ${shape.size.width}px;
          height: ${shape.size.height}px;
          border: ${shape.strokeWidth}px solid ${shape.strokeColor};
          background-color: ${shape.fillColor === 'transparent' ? 'transparent' : shape.fillColor};
          box-sizing: border-box;
        `;

        if (shape.shapeType === 'circle') {
          shapeDiv.style.cssText = baseStyle + 'border-radius: 50%;';
        } else if (shape.shapeType === 'line') {
          // 線は高さ0で境界線のみ
          shapeDiv.style.cssText = `
            position: absolute;
            left: ${marginX + shape.position.x}px;
            top: ${marginY + shape.position.y + shape.size.height / 2}px;
            width: ${shape.size.width}px;
            height: 0;
            border-top: ${shape.strokeWidth}px solid ${shape.strokeColor};
            box-sizing: border-box;
          `;
        } else {
          shapeDiv.style.cssText = baseStyle;
        }
        pageDiv.appendChild(shapeDiv);
      }
    }

    printContainer.appendChild(pageDiv);
  }

  document.body.appendChild(printContainer);

  // 印刷用CSSを動的に追加
  const printStyle = document.createElement('style');
  printStyle.id = 'print-style';
  printStyle.textContent = `
    @media print {
      body > *:not(#print-container) {
        display: none !important;
      }
      #print-container {
        position: static !important;
        left: auto !important;
      }
      .print-page {
        margin: 0 !important;
        padding: 0 !important;
        box-shadow: none !important;
      }
      @page {
        margin: 0;
        size: auto;
      }
    }
  `;
  document.head.appendChild(printStyle);

  // 画像の読み込みを待つ
  const images = printContainer.querySelectorAll('img');
  await Promise.all(
    Array.from(images).map(
      (img) =>
        new Promise<void>((resolve) => {
          if (img.complete) {
            resolve();
          } else {
            img.onload = () => resolve();
            img.onerror = () => resolve();
          }
        })
    )
  );

  // 少し待ってから印刷
  await new Promise((resolve) => setTimeout(resolve, 100));

  // 印刷ダイアログを開く
  window.print();

  // クリーンアップ
  document.body.removeChild(printContainer);
  document.head.removeChild(printStyle);
}
