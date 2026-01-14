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
