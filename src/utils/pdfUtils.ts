// =============================================================================
// PDF処理ユーティリティ
// P1-001: PDF読み込み（単体）
// P1-002: PDF読み込み（複数一括）
// P1-004: デジタルPDFテキスト抽出
// =============================================================================

import * as pdfjsLib from 'pdfjs-dist';
// K-25: worker はビルドに同梱（従来は CDN 取得で、CDN 不通だと PDF 読み込み自体が失敗した）
import pdfWorkerUrl from 'pdfjs-dist/build/pdf.worker.min.mjs?url';
import type { ImageEnhancement, CropArea } from '../types';

pdfjsLib.GlobalWorkerOptions.workerSrc = pdfWorkerUrl;

/**
 * 取り込み時のデフォルト補正（addFiles と出力時再レンダリングで共通利用）
 * 変更する場合は両経路の見た目が揃うようここだけを直す
 */
export const IMPORT_ENHANCEMENT: ImageEnhancement = {
  contrast: 1.0,
  brightness: 1.05, // 背景を少し明るく
  textDarkness: 0.6, // 文字をしっかり濃く（ガンマ0.6）
  sharpness: false,
  autoLevels: true, // 白を白に、黒を黒に（正規化を最初に）
  unsharpMask: true, // エッジ強調（文字の輪郭をシャープに）
  grayscale: true, // グレースケール化（処理効率向上）
  sigmoidContrast: false, // S字コントラストは出力時に適用
  textBolden: false, // 文字太らせは出力時に適用
};

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
 * @param amount 強調量（0.5〜1.5）
 * @param threshold 閾値（0〜10）。差分がこの値以下のピクセルは無視（紙テクスチャ・ノイズ除去）
 */
function applyUnsharpMask(imageData: ImageData, amount: number = 0.5, threshold: number = 3): void {
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

        // 差分を強調（threshold以下の差分はスキップ → ノイズ除去）
        const diff = original[idx + c] - blur;
        if (Math.abs(diff) > threshold) {
          data[idx + c] = Math.min(255, Math.max(0, original[idx + c] + diff * amount));
        }
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
 * シグモイド（S字カーブ）コントラスト
 * 中間調を強力に分離し、文字と背景のコントラストを上げる
 * 通常のコントラストと違い、白飛び・黒つぶれしにくい
 * @param midpoint カーブの中心（0.4〜0.5、低いほど暗い部分を濃く）
 * @param gain カーブの急峻さ（6〜14、高いほど白黒に近づく）
 */
function applySigmoidContrast(imageData: ImageData, midpoint: number = 0.45, gain: number = 10): void {
  const data = imageData.data;

  // LUTを作成（高速化）
  const sigLUT = new Uint8Array(256);
  const sigMin = 1 / (1 + Math.exp(-gain * (0 - midpoint)));
  const sigMax = 1 / (1 + Math.exp(-gain * (1 - midpoint)));
  const sigRange = sigMax - sigMin;

  for (let i = 0; i < 256; i++) {
    const x = i / 255;
    const sig = 1 / (1 + Math.exp(-gain * (x - midpoint)));
    sigLUT[i] = Math.min(255, Math.max(0, Math.round(255 * (sig - sigMin) / sigRange)));
  }

  for (let i = 0; i < data.length; i += 4) {
    data[i] = sigLUT[data[i]];
    data[i + 1] = sigLUT[data[i + 1]];
    data[i + 2] = sigLUT[data[i + 2]];
  }
}

/**
 * モルフォロジー膨張（文字を太らせる）
 * 十字型カーネルで暗いピクセルを周囲に広げる
 * 文字線を物理的に太くする唯一の手法
 * フル3x3だと漢字の画が潰れるため、十字型（N,S,E,W,Center）を使用
 */
function applyMorphologicalDilation(imageData: ImageData): void {
  const data = imageData.data;
  const width = imageData.width;
  const height = imageData.height;
  const original = new Uint8ClampedArray(data);

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      const idx = (y * width + x) * 4;
      for (let c = 0; c < 3; c++) {
        // 十字型カーネル: center, N, S, E, W の最小値（最も暗い値）を取る
        const min = Math.min(
          original[idx + c],                          // center
          original[((y - 1) * width + x) * 4 + c],   // north
          original[((y + 1) * width + x) * 4 + c],   // south
          original[(y * width + (x - 1)) * 4 + c],   // west
          original[(y * width + (x + 1)) * 4 + c]    // east
        );
        data[idx + c] = min;
      }
    }
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
 * 処理順序（調査に基づく最適順序）:
 *   1. CSS filter: コントラスト・明るさ
 *   2. グレースケール変換
 *   3. オートレベル（ヒストグラム正規化）
 *   4. ガンマ補正（文字を濃く）
 *   5. シグモイドコントラスト（文字と背景を強力に分離）
 *   6. モルフォロジー膨張（文字を物理的に太く）
 *   7. アンシャープマスク（エッジ強調、必ず最後）
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
    enhancement.grayscale ||
    enhancement.sigmoidContrast ||
    enhancement.textBolden;

  if (!needsProcessing) {
    return canvas;
  }

  // 新しいキャンバスを作成
  const enhancedCanvas = document.createElement('canvas');
  enhancedCanvas.width = canvas.width;
  enhancedCanvas.height = canvas.height;
  const enhancedCtx = enhancedCanvas.getContext('2d');
  if (!enhancedCtx) return canvas;

  // 背景を白で塗りつぶし（透明背景対策）
  enhancedCtx.fillStyle = 'white';
  enhancedCtx.fillRect(0, 0, enhancedCanvas.width, enhancedCanvas.height);

  // シャープ化: imageSmoothingEnabledをOFFに
  if (enhancement.sharpness) {
    enhancedCtx.imageSmoothingEnabled = false;
  }

  // [Step 1] コントラスト・明るさフィルターを適用（CSS filter）
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
    enhancement.sigmoidContrast ||
    enhancement.textBolden ||
    (enhancement.textDarkness !== undefined && enhancement.textDarkness !== 1.0);

  if (needsPixelProcessing) {
    const imageData = enhancedCtx.getImageData(0, 0, enhancedCanvas.width, enhancedCanvas.height);

    // [Step 2] グレースケール変換（最初に実行）
    if (enhancement.grayscale) {
      applyGrayscale(imageData);
    }

    // [Step 3] オートレベル補正（正規化してから濃度調整）
    if (enhancement.autoLevels) {
      applyAutoLevels(imageData);
    }

    // [Step 4] ガンマ補正（文字を濃くする）
    if (enhancement.textDarkness !== undefined && enhancement.textDarkness !== 1.0) {
      applyGammaCorrection(imageData, enhancement.textDarkness);
    }

    // [Step 5] シグモイドコントラスト（文字と背景を強力に分離）
    if (enhancement.sigmoidContrast) {
      applySigmoidContrast(imageData, 0.45, 10);
    }

    // [Step 6] モルフォロジー膨張（文字を太くする）
    if (enhancement.textBolden) {
      applyMorphologicalDilation(imageData);
    }

    // [Step 7] アンシャープマスク（エッジ強調、必ず最後）
    if (enhancement.unsharpMask) {
      applyUnsharpMask(imageData, 0.7, 3); // 強度0.7, threshold=3
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

// =============================================================================
// K-33: 元スキャン画像のネイティブ解像度取得
// 「拡大するとボケる」の判定に使う。取り込み画像(pdfRenderScale基準=低解像度)では
// なく、元PDFに埋め込まれたスキャン画像そのものの画素数を測る。これが鮮明さの物理的
// な天井（出力時 renderCropHighRes が到達できる上限）を決める。
// =============================================================================

/** page.objs から画像データを取得（未解決なら待つ）。ハングしないよう timeout 付き。 */
function getPdfObjWithTimeout(
  objs: { get: (id: string, cb?: (data: unknown) => void) => unknown },
  name: string,
  ms: number
): Promise<{ width?: number; height?: number } | null> {
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: { width?: number; height?: number } | null) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve(v);
    };
    const timer = setTimeout(() => finish(null), ms);
    try {
      objs.get(name, (data) => finish((data as { width?: number; height?: number }) ?? null));
    } catch {
      finish(null);
    }
  });
}

/**
 * ページに埋め込まれた最大画像のネイティブ画素数を返す。
 * スキャンPDFは1ページ＝1枚の大きな画像なので、それがスキャン原稿の実解像度。
 * ベクターPDF（画像なし）や取得失敗時は null（＝解像度無制限扱い／判定不能）。
 * @param page レンダリング済みの PageProxy（objs が解決済みだと即返る）
 */
export async function getSourceImagePixelSize(
  page: pdfjsLib.PDFPageProxy
): Promise<{ width: number; height: number } | null> {
  try {
    const opList = await page.getOperatorList();
    const { OPS } = pdfjsLib;
    const candidates: { width: number; height: number }[] = [];
    const consider = (w?: number, h?: number) => {
      if (w && h) candidates.push({ width: w, height: h });
    };

    const imageNames: string[] = [];
    for (let i = 0; i < opList.fnArray.length; i++) {
      const fn = opList.fnArray[i];
      const args = opList.argsArray[i];
      if (fn === OPS.paintImageXObject || fn === OPS.paintImageXObjectRepeat) {
        if (typeof args?.[0] === 'string') imageNames.push(args[0] as string);
      } else if (fn === OPS.paintInlineImageXObject) {
        const img = args?.[0] as { width?: number; height?: number } | undefined;
        consider(img?.width, img?.height);
      }
    }

    const objs = page.objs as unknown as {
      get: (id: string, cb?: (data: unknown) => void) => unknown;
    };
    for (const name of imageNames) {
      const data = await getPdfObjWithTimeout(objs, name, 1500);
      consider(data?.width, data?.height);
    }

    if (candidates.length === 0) return null;
    // 最大面積の画像＝スキャン原稿本体
    return candidates.reduce((a, b) => (b.width * b.height > a.width * a.height ? b : a));
  } catch {
    return null;
  }
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

// =============================================================================
// K-31: 出力時高解像度再レンダリング
// 編集用の低解像度画像（pdfRenderScale 基準）ではなく、元 PDF から切り出し範囲を
// 印刷解像度で再レンダリングして出力に使う。編集は軽いまま、印刷は鮮明になる。
// =============================================================================

// 8GB 機保護のための上限（フルページ一時キャンバスの画素数とスケール）
const HIGHRES_MAX_SCALE = 8;
const HIGHRES_MAX_PAGE_PIXELS = 30_000_000;

/**
 * 元PDFから切り出し範囲を高解像度で再レンダリングする
 * @param pdf 読み込み済み PDF（呼び出し側でファイル単位に使い回し、終了時に destroy すること）
 * @param pageNumber ページ番号（1始まり）
 * @param cropArea 切り出し範囲（取り込み時レンダリング画像のピクセル座標）
 * @param renderedSize cropArea の座標系である取り込み画像の実寸（px）
 * @param targetPixelWidth 出力に必要な横ピクセル数（配置幅×目標dpiから算出）
 * @returns PNG dataURL。失敗時は null（呼び出し側で既存画像へフォールバック）
 */
export async function renderCropHighRes(
  pdf: pdfjsLib.PDFDocumentProxy,
  pageNumber: number,
  cropArea: CropArea,
  renderedSize: { width: number; height: number },
  targetPixelWidth: number
): Promise<string | null> {
  try {
    if (
      renderedSize.width <= 0 ||
      renderedSize.height <= 0 ||
      cropArea.width <= 0 ||
      cropArea.height <= 0 ||
      targetPixelWidth <= 0
    ) {
      return null;
    }

    const page = await pdf.getPage(pageNumber);
    const baseViewport = page.getViewport({ scale: 1 });

    // 取り込み画像ピクセル → 相対座標（0〜1）→ PDFポイント座標
    const relX = cropArea.x / renderedSize.width;
    const relY = cropArea.y / renderedSize.height;
    const relW = cropArea.width / renderedSize.width;
    const relH = cropArea.height / renderedSize.height;
    const cropWidthPt = relW * baseViewport.width;
    if (cropWidthPt <= 0) return null;

    // 必要スケール = 目標px / scale1でのcrop幅。メモリ上限でクランプ
    let scale = targetPixelWidth / cropWidthPt;
    const pagePixelLimitScale = Math.sqrt(
      HIGHRES_MAX_PAGE_PIXELS / (baseViewport.width * baseViewport.height)
    );
    scale = Math.min(scale, HIGHRES_MAX_SCALE, pagePixelLimitScale);
    if (!isFinite(scale) || scale <= 0) return null;

    const viewport = page.getViewport({ scale });
    const fullCanvas = document.createElement('canvas');
    const fullContext = fullCanvas.getContext('2d');
    if (!fullContext) return null;
    fullCanvas.width = Math.round(viewport.width);
    fullCanvas.height = Math.round(viewport.height);
    fullContext.fillStyle = 'white';
    fullContext.fillRect(0, 0, fullCanvas.width, fullCanvas.height);

    await page.render({
      canvasContext: fullContext,
      viewport,
      intent: 'print', // 印刷品質（文字がシャープに）
    }).promise;

    // 相対座標で切り出し
    const sx = relX * fullCanvas.width;
    const sy = relY * fullCanvas.height;
    const sw = relW * fullCanvas.width;
    const sh = relH * fullCanvas.height;

    const cropCanvas = document.createElement('canvas');
    const cropContext = cropCanvas.getContext('2d');
    if (!cropContext) return null;
    cropCanvas.width = Math.max(1, Math.round(sw));
    cropCanvas.height = Math.max(1, Math.round(sh));
    cropContext.drawImage(fullCanvas, sx, sy, sw, sh, 0, 0, cropCanvas.width, cropCanvas.height);

    // フルページキャンバスを即解放（8GB機対策）
    fullCanvas.width = 0;
    fullCanvas.height = 0;

    // 取り込み時と同じ補正を適用して見た目を揃える
    const enhanced = applyImageEnhancement(cropCanvas, IMPORT_ENHANCEMENT);
    return enhanced.toDataURL('image/png');
  } catch (error) {
    console.error('高解像度再レンダリングに失敗しました（既存画像で出力します）:', error);
    return null;
  }
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
