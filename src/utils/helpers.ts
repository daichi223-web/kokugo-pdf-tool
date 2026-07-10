// =============================================================================
// ヘルパー関数
// =============================================================================

/**
 * ユニークIDを生成
 */
export function generateId(): string {
  return `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
}

/**
 * ファイルサイズをフォーマット
 */
export function formatFileSize(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

/**
 * 時間をフォーマット（秒 → mm:ss）
 */
export function formatTime(seconds: number): string {
  const mins = Math.floor(seconds / 60);
  const secs = Math.floor(seconds % 60);
  return `${mins}:${secs.toString().padStart(2, '0')}`;
}

/**
 * Base64データURLから画像を作成
 */
export function createImageFromDataURL(dataURL: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = dataURL;
  });
}

/**
 * ルビを括弧表記に変換
 * 例: 漢字《かんじ》 → 漢字（かんじ）
 */
export function convertRubyToBrackets(text: string): string {
  // 《》形式のルビを（）形式に変換
  return text.replace(/(.+?)《(.+?)》/g, '$1（$2）');
}

/**
 * ルビを除去
 */
export function removeRuby(text: string): string {
  return text.replace(/《.+?》/g, '').replace(/（[ぁ-んァ-ン]+?）/g, '');
}

/**
 * 縦書きテキストを横書きに変換（表示用）
 */
export function verticalToHorizontal(text: string): string {
  return text;
}

/**
 * サムネイル用の縮小画像を生成（K-13）
 * 一覧表示でフル解像度ビットマップをデコードし続けないためのもの。
 * @param dataUrl 元画像
 * @param maxDim 長辺の最大ピクセル
 */
export async function createThumbnail(dataUrl: string, maxDim: number = 240): Promise<string> {
  const img = await createImageFromDataURL(dataUrl);
  const ratio = Math.min(1, maxDim / Math.max(img.naturalWidth, img.naturalHeight));
  if (ratio >= 1) return dataUrl;

  const canvas = document.createElement('canvas');
  canvas.width = Math.max(1, Math.round(img.naturalWidth * ratio));
  canvas.height = Math.max(1, Math.round(img.naturalHeight * ratio));
  const ctx = canvas.getContext('2d');
  if (!ctx) return dataUrl;
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = 'high';
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
  return canvas.toDataURL('image/jpeg', 0.75);
}

/**
 * mm を px に変換（300dpi基準）
 */
export function mmToPx(mm: number, dpi: number = 300): number {
  return Math.round((mm / 25.4) * dpi);
}

/**
 * px を mm に変換（300dpi基準）
 */
export function pxToMm(px: number, dpi: number = 300): number {
  return (px / dpi) * 25.4;
}

/**
 * K-33: 配置サイズでの実効印刷解像度（＝鮮明さ）を求める。
 *
 * スキャン原稿は解像度に物理的な天井があり、原寸より大きく置く（拡大）ほど
 * 出力でボケる。逆に縮小はボケない。その境界を dpi で数値化する。
 * ソース解像度が不明（ベクターPDF／取得失敗）なら null。
 *
 * 導出:
 *   scanDpi       = 面積ベースの等方解像度（回転に強い）
 *   取り込み画像での切り出し幅 cropWidthPx は pdfRenderScale×72 dpi 座標系
 *   配置幅 placedWidthPx は 96dpi 座標系
 *   実効dpi = scanDpi × (cropWidthPx / placedWidthPx) × 96 / (72 × pdfRenderScale)
 */
export type SharpnessLevel = 'sharp' | 'ok' | 'soft' | 'blur';

export interface PrintSharpness {
  dpi: number;            // 実効印刷dpi（利用可能なディテール）
  level: SharpnessLevel;
}

export function computePrintDpi(params: {
  cropWidthPx: number;         // snippet.cropArea.width（取り込み画像px）
  placedWidthPx: number;       // 配置幅（96dpi px）
  sourceImageWidth?: number;   // スキャン本来の画素（幅）
  sourceImageHeight?: number;  // スキャン本来の画素（高さ）
  pageWidthPt: number;         // ページ幅（ポイント=72dpi）
  pageHeightPt: number;        // ページ高さ（ポイント=72dpi）
  pdfRenderScale: number;      // 取り込みスケール
}): PrintSharpness | null {
  const {
    cropWidthPx, placedWidthPx,
    sourceImageWidth, sourceImageHeight,
    pageWidthPt, pageHeightPt, pdfRenderScale,
  } = params;

  if (
    !sourceImageWidth || !sourceImageHeight ||
    cropWidthPx <= 0 || placedWidthPx <= 0 ||
    pageWidthPt <= 0 || pageHeightPt <= 0 || pdfRenderScale <= 0
  ) {
    return null;
  }

  const pageInchW = pageWidthPt / 72;
  const pageInchH = pageHeightPt / 72;
  const scanDpi = Math.sqrt((sourceImageWidth * sourceImageHeight) / (pageInchW * pageInchH));

  const dpi = scanDpi * (cropWidthPx / placedWidthPx) * (96 / (72 * pdfRenderScale));
  if (!isFinite(dpi) || dpi <= 0) return null;

  const level: SharpnessLevel =
    dpi >= 200 ? 'sharp' : dpi >= 150 ? 'ok' : dpi >= 120 ? 'soft' : 'blur';
  return { dpi, level };
}

/**
 * デバウンス関数
 */
export function debounce<T extends (...args: unknown[]) => unknown>(
  func: T,
  wait: number
): (...args: Parameters<T>) => void {
  let timeout: ReturnType<typeof setTimeout> | null = null;

  return function executedFunction(...args: Parameters<T>) {
    const later = () => {
      timeout = null;
      func(...args);
    };

    if (timeout !== null) {
      clearTimeout(timeout);
    }
    timeout = setTimeout(later, wait);
  };
}

/**
 * クリップボードにコピー
 */
export async function copyToClipboard(text: string): Promise<boolean> {
  try {
    await navigator.clipboard.writeText(text);
    return true;
  } catch (err) {
    console.error('Failed to copy text: ', err);
    return false;
  }
}
