// =============================================================================
// PDF処理ユーティリティ
// P1-001: PDF読み込み（単体）
// P1-002: PDF読み込み（複数一括）
// P1-004: デジタルPDFテキスト抽出
// =============================================================================

import * as pdfjsLib from 'pdfjs-dist';
import type { ImageEnhancement } from '../types';

// PDF.jsのワーカー設定（jsdelivrはCORS対応）
pdfjsLib.GlobalWorkerOptions.workerSrc = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/build/pdf.worker.min.mjs`;

/**
 * オートレベル補正（ヒストグラムストレッチ）
 * 白を白に、黒を黒に調整
 */
function applyAutoLevels(imageData: ImageData): void {
  const data = imageData.data;
  let minVal = 255;
  let maxVal = 0;

  // 最小・最大輝度を検出
  for (let i = 0; i < data.length; i += 4) {
    const gray = (data[i] + data[i + 1] + data[i + 2]) / 3;
    if (gray < minVal) minVal = gray;
    if (gray > maxVal) maxVal = gray;
  }

  // 範囲が狭すぎる場合はスキップ
  if (maxVal - minVal < 10) return;

  // ヒストグラムストレッチ
  const range = maxVal - minVal;
  for (let i = 0; i < data.length; i += 4) {
    data[i] = Math.min(255, Math.max(0, ((data[i] - minVal) / range) * 255));
    data[i + 1] = Math.min(255, Math.max(0, ((data[i + 1] - minVal) / range) * 255));
    data[i + 2] = Math.min(255, Math.max(0, ((data[i + 2] - minVal) / range) * 255));
  }
}

/**
 * アンシャープマスク（エッジ強調）
 * 文字のエッジをシャープにする
 */
function applyUnsharpMask(imageData: ImageData, amount: number = 0.5): void {
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  const original = new Uint8ClampedArray(data);

  // 3x3カーネルによるボケ検出と強調
  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        // 周囲の平均を計算
        const blur = (
          original[((y - 1) * width + (x - 1)) * 4 + c] +
          original[((y - 1) * width + x) * 4 + c] +
          original[((y - 1) * width + (x + 1)) * 4 + c] +
          original[(y * width + (x - 1)) * 4 + c] +
          original[(y * width + x) * 4 + c] +
          original[(y * width + (x + 1)) * 4 + c] +
          original[((y + 1) * width + (x - 1)) * 4 + c] +
          original[((y + 1) * width + x) * 4 + c] +
          original[((y + 1) * width + (x + 1)) * 4 + c]
        ) / 9;

        // 差分を強調
        const diff = original[idx + c] - blur;
        data[idx + c] = Math.min(255, Math.max(0, original[idx + c] + diff * amount));
      }
    }
  }
}

/**
 * グレースケール変換
 */
function applyGrayscale(imageData: ImageData): void {
  const data = imageData.data;
  for (let i = 0; i < data.length; i += 4) {
    const gray = data[i] * 0.299 + data[i + 1] * 0.587 + data[i + 2] * 0.114;
    data[i] = gray;
    data[i + 1] = gray;
    data[i + 2] = gray;
  }
}

/**
 * ガンマ補正（文字を濃くする）
 * gamma < 1.0: 暗い部分（文字）をより濃く、白い背景はほぼそのまま
 * gamma > 1.0: 暗い部分を薄く
 */
function applyGammaCorrection(imageData: ImageData, gamma: number): void {
  if (gamma === 1.0) return;

  const data = imageData.data;
  // ガンマ補正用のルックアップテーブルを作成（高速化）
  const gammaLUT = new Uint8Array(256);
  const inverseGamma = 1.0 / gamma;
  for (let i = 0; i < 256; i++) {
    gammaLUT[i] = Math.min(255, Math.max(0, Math.round(255 * Math.pow(i / 255, inverseGamma))));
  }

  // ルックアップテーブルを使って変換
  for (let i = 0; i < data.length; i += 4) {
    data[i] = gammaLUT[data[i]];
    data[i + 1] = gammaLUT[data[i + 1]];
    data[i + 2] = gammaLUT[data[i + 2]];
  }
}

/**
 * 画像補正を適用
 * コントラスト・明るさ・シャープ化・オートレベル・アンシャープマスク・グレースケール
 */
export function applyImageEnhancement(
  canvas: HTMLCanvasElement,
  enhancement: ImageEnhancement
): HTMLCanvasElement {
  const ctx = canvas.getContext('2d');
  if (!ctx) return canvas;

  // フィルターが必要ない場合はそのまま返す
  const needsProcessing =
    enhancement.contrast !== 1.0 ||
    enhancement.brightness !== 1.0 ||
    (enhancement.textDarkness !== undefined && enhancement.textDarkness !== 1.0) ||
    enhancement.sharpness ||
    enhancement.autoLevels ||
    enhancement.unsharpMask ||
    enhancement.grayscale;

  if (!needsProcessing) {
    return canvas;
  }

  // 新しいキャンバスを作成
  const enhancedCanvas = document.createElement('canvas');
  enhancedCanvas.width = canvas.width;
  enhancedCanvas.height = canvas.height;
  const enhancedCtx = enhancedCanvas.getContext('2d');
  if (!enhancedCtx) return canvas;

  // シャープ化: imageSmoothingEnabledをOFFに
  if (enhancement.sharpness) {
    enhancedCtx.imageSmoothingEnabled = false;
  }

  // コントラスト・明るさフィルターを適用
  const filters: string[] = [];
  if (enhancement.contrast !== 1.0) {
    filters.push(`contrast(${enhancement.contrast})`);
  }
  if (enhancement.brightness !== 1.0) {
    filters.push(`brightness(${enhancement.brightness})`);
  }
  if (filters.length > 0) {
    enhancedCtx.filter = filters.join(' ');
  }

  // 元の画像を描画
  enhancedCtx.drawImage(canvas, 0, 0);

  // フィルターをリセット（ピクセル操作のため）
  enhancedCtx.filter = 'none';

  // ピクセル単位の処理が必要な場合
  const needsPixelProcessing =
    enhancement.autoLevels ||
    enhancement.unsharpMask ||
    enhancement.grayscale ||
    (enhancement.textDarkness !== undefined && enhancement.textDarkness !== 1.0);

  if (needsPixelProcessing) {
    const imageData = enhancedCtx.getImageData(0, 0, enhancedCanvas.width, enhancedCanvas.height);

    // グレースケール変換（最初に実行）
    if (enhancement.grayscale) {
      applyGrayscale(imageData);
    }

    // オートレベル補正
    if (enhancement.autoLevels) {
      applyAutoLevels(imageData);
    }

    // ガンマ補正（文字を濃くする）
    if (enhancement.textDarkness !== undefined && enhancement.textDarkness !== 1.0) {
      applyGammaCorrection(imageData, enhancement.textDarkness);
    }

    // アンシャープマスク（最後に実行）
    if (enhancement.unsharpMask) {
      applyUnsharpMask(imageData, 0.7); // 強度0.7
    }

    enhancedCtx.putImageData(imageData, 0, 0);
  }

  return enhancedCanvas;
}

export interface PDFData {
  pdf: pdfjsLib.PDFDocumentProxy;
  numPages: number;
  width: number;
  height: number;
}

/**
 * PDFファイルを読み込む
 * P1-001: PDF読み込み（単体）
 */
export async function loadPDF(file: File): Promise<PDFData> {
  // 入力検証
  if (!file) {
    throw new Error('ファイルが指定されていません');
  }
  if (file.size === 0) {
    throw new Error('ファイルが空です');
  }
  if (file.size > 50 * 1024 * 1024) {
    throw new Error('ファイルサイズが50MBを超えています');
  }
  if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
    throw new Error('PDFファイルではありません');
  }

  const arrayBuffer = await file.arrayBuffer();

  let pdf: pdfjsLib.PDFDocumentProxy;
  try {
    pdf = await pdfjsLib.getDocument({
      data: arrayBuffer,
      // 日本語フォント（CIDフォント）を正しくレンダリングするためのCMap設定
      // jsdelivrはCORSヘッダーを正しく設定している
      cMapUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/cmaps/`,
      cMapPacked: true,
      // 標準フォントのフォールバック
      standardFontDataUrl: `https://cdn.jsdelivr.net/npm/pdfjs-dist@${pdfjsLib.version}/standard_fonts/`,
      // フォントが埋め込まれていないPDF対策
      disableFontFace: false,
      // システムフォントを使用（埋め込みフォントがない場合のフォールバック）
      useSystemFonts: true,
    }).promise;
  } catch (error) {
    throw new Error(`PDFの読み込みに失敗しました: ${error instanceof Error ? error.message : '不明なエラー'}`);
  }

  if (pdf.numPages === 0) {
    throw new Error('PDFにページがありません');
  }

  // 最初のページからサイズを取得
  const firstPage = await pdf.getPage(1);
  const viewport = firstPage.getViewport({ scale: 1 });

  return {
    pdf,
    numPages: pdf.numPages,
    width: viewport.width,
    height: viewport.height,
  };
}

/**
 * PDFページを画像としてレンダリング
 * スキャンPDF・デジタルPDF両対応
 * @param pdf PDFドキュメント
 * @param pageNumber ページ番号
 * @param scale 解像度スケール（2〜4、デフォルト2）
 * @param enhancement 画像補正設定（オプション）
 */
export async function renderPageToImage(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  scale: number = 2,
  enhancement?: ImageEnhancement
): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  const canvas = document.createElement('canvas');
  const context = canvas.getContext('2d');
  if (!context) throw new Error('Failed to get canvas context');

  canvas.width = viewport.width;
  canvas.height = viewport.height;

  // 背景を白で塗りつぶし（透明背景対策）
  context.fillStyle = 'white';
  context.fillRect(0, 0, canvas.width, canvas.height);

  await page.render({
    canvasContext: context,
    viewport,
    intent: 'print',  // 印刷品質でレンダリング（文字がシャープに）
  }).promise;

  // 画像補正を適用
  let finalCanvas = canvas;
  if (enhancement) {
    finalCanvas = applyImageEnhancement(canvas, enhancement);
  }

  return finalCanvas.toDataURL('image/png');
}

/**
 * PDFページからテキストを抽出（デジタルPDF用）
 * P1-004: デジタルPDFテキスト抽出
 */
export async function extractTextFromPage(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNumber: number
): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const textContent = await page.getTextContent();

  // テキストアイテムを結合
  const textItems = textContent.items as { str: string; transform: number[] }[];

  // 位置情報を使ってテキストを整形
  let lastY: number | null = null;
  let text = '';

  for (const item of textItems) {
    const y = item.transform[5];

    // Y座標が変わったら改行
    if (lastY !== null && Math.abs(y - lastY) > 5) {
      text += '\n';
    } else if (lastY !== null) {
      text += '';
    }

    text += item.str;
    lastY = y;
  }

  return text.trim();
}

/**
 * PDFページの一部を切り出し（トリミング）
 * P3-001: トリミング機能
 */
export async function cropPageArea(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  cropArea: { x: number; y: number; width: number; height: number },
  scale: number = 2
): Promise<string> {
  const page = await pdf.getPage(pageNumber);
  const viewport = page.getViewport({ scale });

  // フルページをレンダリング
  const fullCanvas = document.createElement('canvas');
  const fullContext = fullCanvas.getContext('2d');
  if (!fullContext) throw new Error('Failed to get canvas context');

  fullCanvas.width = viewport.width;
  fullCanvas.height = viewport.height;

  // 背景を白で塗りつぶし
  fullContext.fillStyle = 'white';
  fullContext.fillRect(0, 0, fullCanvas.width, fullCanvas.height);

  await page.render({
    canvasContext: fullContext,
    viewport,
    intent: 'display',
  }).promise;

  // 切り出し領域を計算（スケール適用）
  const scaledCrop = {
    x: cropArea.x * scale,
    y: cropArea.y * scale,
    width: cropArea.width * scale,
    height: cropArea.height * scale,
  };

  // 切り出し用キャンバス
  const cropCanvas = document.createElement('canvas');
  const cropContext = cropCanvas.getContext('2d');
  if (!cropContext) throw new Error('Failed to get crop canvas context');

  cropCanvas.width = scaledCrop.width;
  cropCanvas.height = scaledCrop.height;

  // 切り出し
  cropContext.drawImage(
    fullCanvas,
    scaledCrop.x,
    scaledCrop.y,
    scaledCrop.width,
    scaledCrop.height,
    0,
    0,
    scaledCrop.width,
    scaledCrop.height
  );

  return cropCanvas.toDataURL('image/png');
}

/**
 * PDFのメタデータを取得
 */
export async function getPDFMetadata(
  pdf: pdfjsLib.PDFDocumentProxy
): Promise<{ title?: string; author?: string; creationDate?: string }> {
  const metadata = await pdf.getMetadata();
  const info = metadata.info as Record<string, unknown>;

  return {
    title: info?.Title as string | undefined,
    author: info?.Author as string | undefined,
    creationDate: info?.CreationDate as string | undefined,
  };
}
