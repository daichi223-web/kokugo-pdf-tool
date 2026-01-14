// =============================================================================
// パフォーマンス計測ユーティリティ
// NF-003: 処理時間計測
// =============================================================================

export interface PerformanceMetrics {
  operation: string;
  startTime: number;
  endTime: number;
  duration: number;
  metadata?: Record<string, unknown>;
}

export interface BenchmarkResult {
  totalDuration: number;
  operations: PerformanceMetrics[];
  summary: {
    pdfLoad: number;
    imageRender: number;
    ocr: number;
    export: number;
  };
  memoryUsage?: {
    usedJSHeapSize: number;
    totalJSHeapSize: number;
  };
}

// 計測結果を保存
const metricsStore: PerformanceMetrics[] = [];

/**
 * パフォーマンス計測を開始
 */
export function startMeasure(operation: string): (metadata?: Record<string, unknown>) => PerformanceMetrics {
  const startTime = performance.now();

  return (metadata?: Record<string, unknown>) => {
    const endTime = performance.now();
    const metrics: PerformanceMetrics = {
      operation,
      startTime,
      endTime,
      duration: endTime - startTime,
      metadata,
    };
    metricsStore.push(metrics);
    return metrics;
  };
}

/**
 * 計測結果をクリア
 */
export function clearMetrics(): void {
  metricsStore.length = 0;
}

/**
 * 計測結果を取得
 */
export function getMetrics(): PerformanceMetrics[] {
  return [...metricsStore];
}

/**
 * ベンチマーク結果を生成
 */
export function generateBenchmarkResult(): BenchmarkResult {
  const operations = getMetrics();

  const summary = {
    pdfLoad: 0,
    imageRender: 0,
    ocr: 0,
    export: 0,
  };

  for (const op of operations) {
    if (op.operation.includes('pdf') || op.operation.includes('load')) {
      summary.pdfLoad += op.duration;
    } else if (op.operation.includes('render') || op.operation.includes('image')) {
      summary.imageRender += op.duration;
    } else if (op.operation.includes('ocr')) {
      summary.ocr += op.duration;
    } else if (op.operation.includes('export')) {
      summary.export += op.duration;
    }
  }

  const totalDuration = operations.reduce((sum, op) => sum + op.duration, 0);

  // メモリ使用量を取得（対応ブラウザのみ）
  let memoryUsage: BenchmarkResult['memoryUsage'];
  if ('memory' in performance) {
    const memory = (performance as unknown as { memory: { usedJSHeapSize: number; totalJSHeapSize: number } }).memory;
    memoryUsage = {
      usedJSHeapSize: memory.usedJSHeapSize,
      totalJSHeapSize: memory.totalJSHeapSize,
    };
  }

  return {
    totalDuration,
    operations,
    summary,
    memoryUsage,
  };
}

/**
 * ベンチマーク結果をフォーマット
 */
export function formatBenchmarkResult(result: BenchmarkResult): string {
  const lines: string[] = [
    '=== パフォーマンスベンチマーク結果 ===',
    '',
    `合計処理時間: ${(result.totalDuration / 1000).toFixed(2)}秒`,
    '',
    '--- 処理別時間 ---',
    `PDF読み込み: ${(result.summary.pdfLoad / 1000).toFixed(2)}秒`,
    `画像レンダリング: ${(result.summary.imageRender / 1000).toFixed(2)}秒`,
    `OCR処理: ${(result.summary.ocr / 1000).toFixed(2)}秒`,
    `エクスポート: ${(result.summary.export / 1000).toFixed(2)}秒`,
  ];

  if (result.memoryUsage) {
    lines.push('');
    lines.push('--- メモリ使用量 ---');
    lines.push(`使用中: ${(result.memoryUsage.usedJSHeapSize / 1024 / 1024).toFixed(2)} MB`);
    lines.push(`合計: ${(result.memoryUsage.totalJSHeapSize / 1024 / 1024).toFixed(2)} MB`);
  }

  lines.push('');
  lines.push('--- 詳細操作ログ ---');
  for (const op of result.operations) {
    lines.push(`${op.operation}: ${op.duration.toFixed(2)}ms`);
  }

  return lines.join('\n');
}

/**
 * パフォーマンス要件チェック
 * NF-003: 処理時間 - 20P:30秒、50P:90秒、10ファイル:5分
 */
export function checkPerformanceRequirements(
  pageCount: number,
  durationMs: number
): { passed: boolean; message: string } {
  // 要件: 20ページ=30秒、50ページ=90秒
  // 1ページあたり約1.5〜1.8秒が目安
  const expectedMs = pageCount <= 20
    ? 30000
    : pageCount <= 50
      ? 90000
      : pageCount * 1800; // 50ページ以上は1.8秒/ページ

  const passed = durationMs <= expectedMs;
  const message = passed
    ? `✅ 合格: ${pageCount}ページを${(durationMs / 1000).toFixed(1)}秒で処理（目標: ${(expectedMs / 1000).toFixed(0)}秒以内）`
    : `❌ 不合格: ${pageCount}ページに${(durationMs / 1000).toFixed(1)}秒（目標: ${(expectedMs / 1000).toFixed(0)}秒以内）`;

  return { passed, message };
}
