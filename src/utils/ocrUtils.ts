// =============================================================================
// OCR処理ユーティリティ
// P1-003: 縦書きOCR対応
// NF-004: UI応答性 - Web Worker使用
// =============================================================================

import Tesseract from 'tesseract.js';

export interface OCRResult {
  text: string;
  confidence: number;
  blocks: OCRBlock[];
}

export interface OCRBlock {
  text: string;
  bbox: {
    x0: number;
    y0: number;
    x1: number;
    y1: number;
  };
  confidence: number;
}

// OCRワーカーのインスタンス（再利用）
let worker: Tesseract.Worker | null = null;

/**
 * OCRワーカーを初期化
 * P1-003: 縦書きOCR対応 - Tesseract.js使用
 */
async function getWorker(): Promise<Tesseract.Worker> {
  if (worker) return worker;

  const maxRetries = 3;
  let lastError: Error | null = null;

  for (let attempt = 0; attempt < maxRetries; attempt++) {
    try {
      worker = await Tesseract.createWorker('jpn_vert', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text') {
            // Progress callback handled separately
          }
        },
      });

      // 縦書き日本語用の設定
      await worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.SINGLE_BLOCK_VERT_TEXT, // 縦書きテキストブロック
        preserve_interword_spaces: '1',
      });

      return worker;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error('OCRワーカー初期化失敗');
      console.warn(`OCR worker initialization attempt ${attempt + 1} failed:`, error);
      worker = null;
      // 次のリトライ前に少し待つ
      await new Promise((resolve) => setTimeout(resolve, 1000 * (attempt + 1)));
    }
  }

  throw new Error(`OCRワーカーの初期化に失敗しました: ${lastError?.message || '不明なエラー'}`);
}

/**
 * 画像に対してOCRを実行
 * P1-003: 縦書きOCR対応
 */
export async function runOCR(
  imageData: string,
  onProgress?: (progress: number) => void
): Promise<OCRResult> {
  if (!imageData) {
    throw new Error('画像データが指定されていません');
  }
  if (!imageData.startsWith('data:image/')) {
    throw new Error('無効な画像データ形式です');
  }

  const ocrWorker = await getWorker();

  const result = await ocrWorker.recognize(imageData, {
    // @ts-expect-error Tesseract types issue
    logger: (m: { status: string; progress: number }) => {
      if (m.status === 'recognizing text' && onProgress) {
        onProgress(Math.round(m.progress * 100));
      }
    },
  });

  const blocks: OCRBlock[] = result.data.blocks?.map((block) => ({
    text: block.text,
    bbox: block.bbox,
    confidence: block.confidence,
  })) || [];

  return {
    text: result.data.text,
    confidence: result.data.confidence,
    blocks,
  };
}

/**
 * OCRワーカーを終了
 */
export async function terminateOCR(): Promise<void> {
  if (worker) {
    await worker.terminate();
    worker = null;
  }
}

/**
 * テーブル構造を検出してOCR
 * P2-004: 表抽出
 */
export async function extractTable(imageData: string): Promise<string[][]> {
  const result = await runOCR(imageData);

  // ブロックを位置情報でグループ化してテーブル構造を推定
  const blocks = result.blocks;
  if (blocks.length === 0) return [];

  // Y座標でグループ化（同じ行）
  const rows: OCRBlock[][] = [];
  let currentRow: OCRBlock[] = [];
  let lastY = blocks[0]?.bbox.y0 || 0;

  for (const block of blocks) {
    const y = block.bbox.y0;
    if (Math.abs(y - lastY) > 20) {
      if (currentRow.length > 0) {
        rows.push([...currentRow]);
      }
      currentRow = [block];
      lastY = y;
    } else {
      currentRow.push(block);
    }
  }
  if (currentRow.length > 0) {
    rows.push(currentRow);
  }

  // 各行をX座標でソート
  return rows.map((row) => {
    const sorted = row.sort((a, b) => a.bbox.x0 - b.bbox.x0);
    return sorted.map((block) => block.text.trim());
  });
}

/**
 * テーブルをMarkdown形式に変換
 */
export function tableToMarkdown(table: string[][]): string {
  if (table.length === 0) return '';

  const lines: string[] = [];

  // ヘッダー行
  if (table[0]) {
    lines.push('| ' + table[0].join(' | ') + ' |');
    lines.push('|' + table[0].map(() => '---').join('|') + '|');
  }

  // データ行
  for (let i = 1; i < table.length; i++) {
    if (table[i]) {
      lines.push('| ' + table[i].join(' | ') + ' |');
    }
  }

  return lines.join('\n');
}

/**
 * ルビ（ふりがな）を検出
 * P2-001: ルビ括弧表記オプション
 */
export function detectRuby(text: string): { main: string; ruby: string }[] {
  const rubyPattern = /(.+?)《(.+?)》/g;
  const matches: { main: string; ruby: string }[] = [];

  let match;
  while ((match = rubyPattern.exec(text)) !== null) {
    matches.push({
      main: match[1],
      ruby: match[2],
    });
  }

  return matches;
}

/**
 * テキストにルビを括弧表記で付与
 */
export function applyRubyBrackets(text: string, includeRuby: boolean): string {
  if (!includeRuby) {
    // ルビを除去
    return text.replace(/《.+?》/g, '');
  }

  // 《》を（）に変換
  return text.replace(/《(.+?)》/g, '（$1）');
}
