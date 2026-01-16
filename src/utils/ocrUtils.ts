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
// プログレスコールバック（グローバル管理）
let progressCallback: ((progress: number) => void) | null = null;

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
      // 修正: 'jpn_vert' から 'jpn' に変更して、縦書き・横書き両方に対応
      worker = await Tesseract.createWorker('jpn', 1, {
        logger: (m) => {
          if (m.status === 'recognizing text' && progressCallback) {
            progressCallback(Math.round(m.progress * 100));
          }
        },
      });

      // 修正: ページセグメンテーションモードを自動検出に変更
      await worker.setParameters({
        tessedit_pageseg_mode: Tesseract.PSM.AUTO, // 縦書き・横書きを自動検出
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

  // プログレスコールバックを設定
  progressCallback = onProgress || null;

  try {
    const ocrWorker = await getWorker();
    const result = await ocrWorker.recognize(imageData);

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
  } finally {
    // プログレスコールバックをクリア
    progressCallback = null;
  }
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

// =============================================================================
// 縦書きレイアウト再構成
// OCR-LAYOUT: 縦書きテキストの位置情報を使ってレイアウトを再構成
// =============================================================================

export interface LayoutColumn {
  blocks: OCRBlock[];
  x: number;  // 列の中心X座標
  width: number;
}

export interface VerticalLayout {
  columns: LayoutColumn[];
  isVertical: boolean;
  imageWidth: number;
  imageHeight: number;
}

/**
 * テキストが縦書きかどうかを判定
 * - ブロックの高さ > 幅 が多い場合は縦書き
 * - X座標の分散が大きく、Y座標の分散が小さい場合は縦書き
 */
export function detectVerticalText(blocks: OCRBlock[]): boolean {
  if (blocks.length === 0) return false;

  // 各ブロックのアスペクト比をチェック
  let verticalCount = 0;
  let horizontalCount = 0;

  for (const block of blocks) {
    const width = block.bbox.x1 - block.bbox.x0;
    const height = block.bbox.y1 - block.bbox.y0;

    if (height > width * 1.5) {
      verticalCount++;
    } else if (width > height * 1.5) {
      horizontalCount++;
    }
  }

  // 縦長ブロックが多ければ縦書き
  return verticalCount > horizontalCount;
}

/**
 * ブロックを列にグループ化（縦書き用: 右から左）
 */
export function groupBlocksIntoColumns(blocks: OCRBlock[], columnThreshold: number = 30): LayoutColumn[] {
  if (blocks.length === 0) return [];

  // X座標でソート（右から左）
  const sortedBlocks = [...blocks].sort((a, b) => {
    const centerA = (a.bbox.x0 + a.bbox.x1) / 2;
    const centerB = (b.bbox.x0 + b.bbox.x1) / 2;
    return centerB - centerA;  // 右から左
  });

  const columns: LayoutColumn[] = [];
  let currentColumn: OCRBlock[] = [sortedBlocks[0]];
  let currentCenterX = (sortedBlocks[0].bbox.x0 + sortedBlocks[0].bbox.x1) / 2;

  for (let i = 1; i < sortedBlocks.length; i++) {
    const block = sortedBlocks[i];
    const blockCenterX = (block.bbox.x0 + block.bbox.x1) / 2;

    // X座標が近いブロックは同じ列
    if (Math.abs(blockCenterX - currentCenterX) < columnThreshold) {
      currentColumn.push(block);
    } else {
      // 新しい列を開始
      columns.push(createColumn(currentColumn));
      currentColumn = [block];
      currentCenterX = blockCenterX;
    }
  }

  // 最後の列を追加
  if (currentColumn.length > 0) {
    columns.push(createColumn(currentColumn));
  }

  // 各列内でY座標でソート（上から下）
  for (const column of columns) {
    column.blocks.sort((a, b) => a.bbox.y0 - b.bbox.y0);
  }

  return columns;
}

function createColumn(blocks: OCRBlock[]): LayoutColumn {
  const minX = Math.min(...blocks.map(b => b.bbox.x0));
  const maxX = Math.max(...blocks.map(b => b.bbox.x1));
  return {
    blocks,
    x: (minX + maxX) / 2,
    width: maxX - minX,
  };
}

/**
 * OCR結果から縦書きレイアウトを生成
 */
export function createVerticalLayout(
  ocrResult: OCRResult,
  imageWidth: number,
  imageHeight: number
): VerticalLayout {
  const isVertical = detectVerticalText(ocrResult.blocks);

  let columns: LayoutColumn[];
  if (isVertical) {
    columns = groupBlocksIntoColumns(ocrResult.blocks);
  } else {
    // 横書きの場合は行としてグループ化
    columns = groupBlocksIntoRows(ocrResult.blocks);
  }

  return {
    columns,
    isVertical,
    imageWidth,
    imageHeight,
  };
}

/**
 * ブロックを行にグループ化（横書き用）
 */
function groupBlocksIntoRows(blocks: OCRBlock[], rowThreshold: number = 20): LayoutColumn[] {
  if (blocks.length === 0) return [];

  // Y座標でソート（上から下）
  const sortedBlocks = [...blocks].sort((a, b) => a.bbox.y0 - b.bbox.y0);

  const rows: LayoutColumn[] = [];
  let currentRow: OCRBlock[] = [sortedBlocks[0]];
  let currentY = sortedBlocks[0].bbox.y0;

  for (let i = 1; i < sortedBlocks.length; i++) {
    const block = sortedBlocks[i];

    if (Math.abs(block.bbox.y0 - currentY) < rowThreshold) {
      currentRow.push(block);
    } else {
      rows.push(createRow(currentRow));
      currentRow = [block];
      currentY = block.bbox.y0;
    }
  }

  if (currentRow.length > 0) {
    rows.push(createRow(currentRow));
  }

  // 各行内でX座標でソート（左から右）
  for (const row of rows) {
    row.blocks.sort((a, b) => a.bbox.x0 - b.bbox.x0);
  }

  return rows;
}

function createRow(blocks: OCRBlock[]): LayoutColumn {
  const minY = Math.min(...blocks.map(b => b.bbox.y0));
  const maxY = Math.max(...blocks.map(b => b.bbox.y1));
  return {
    blocks,
    x: minY, // 行の場合はY座標を使用
    width: maxY - minY,
  };
}

/**
 * 縦書きレイアウトをHTMLとして生成
 */
export function layoutToHTML(layout: VerticalLayout): string {
  if (layout.columns.length === 0) return '';

  if (layout.isVertical) {
    // 縦書きレイアウト
    const columnsHTML = layout.columns.map(column => {
      const textsHTML = column.blocks.map(block =>
        `<span class="ocr-block" style="display: block;">${escapeHTML(block.text.trim())}</span>`
      ).join('');
      return `<div class="ocr-column">${textsHTML}</div>`;
    }).join('');

    return `<div class="ocr-vertical-layout">${columnsHTML}</div>`;
  } else {
    // 横書きレイアウト
    const rowsHTML = layout.columns.map(row => {
      const textsHTML = row.blocks.map(block =>
        `<span class="ocr-block">${escapeHTML(block.text.trim())}</span>`
      ).join('');
      return `<div class="ocr-row">${textsHTML}</div>`;
    }).join('');

    return `<div class="ocr-horizontal-layout">${rowsHTML}</div>`;
  }
}

/**
 * 縦書きレイアウトをプレーンテキストとして生成（列ごとに改行）
 */
export function layoutToText(layout: VerticalLayout): string {
  if (layout.columns.length === 0) return '';

  return layout.columns.map(column =>
    column.blocks.map(block => block.text.trim()).join('')
  ).join('\n');
}

function escapeHTML(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
