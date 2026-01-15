// =============================================================================
// スニペットリストコンポーネント
// P3-001: トリミング機能 - スニペット管理
// =============================================================================

import { useState } from 'react';
import { Trash2, Move, Crop, LayoutGrid, ChevronLeft, ChevronRight, ChevronUp, ChevronDown } from 'lucide-react';
import { useAppStore } from '../stores/appStore';

type GridPattern = '4x2' | '4x3' | '3x2' | '2x2' | 'auto';

const GRID_PATTERNS: Record<GridPattern, { cols: number; rows: number; label: string }> = {
  '4x2': { cols: 4, rows: 2, label: '4×2' },
  '4x3': { cols: 4, rows: 3, label: '4×3' },
  '3x2': { cols: 3, rows: 2, label: '3×2' },
  '2x2': { cols: 2, rows: 2, label: '2×2' },
  'auto': { cols: 0, rows: 0, label: '自動' },
};

// スニペット数から最適なグリッドを自動判定
function getAutoGrid(count: number): { cols: number; rows: number } {
  if (count <= 2) return { cols: 2, rows: 1 };
  if (count <= 4) return { cols: 2, rows: 2 };
  if (count <= 6) return { cols: 3, rows: 2 };
  if (count <= 8) return { cols: 4, rows: 2 };
  if (count <= 12) return { cols: 4, rows: 3 };
  return { cols: 4, rows: Math.ceil(count / 4) };
}

export function SnippetList() {
  const {
    snippets,
    selectedSnippetId,
    setSelectedSnippet,
    removeSnippet,
    activeLayoutPageId,
    addSnippetToLayout,
    setReCropSnippet,
    arrangeAllSnippetsInGrid,
  } = useAppStore();

  const [gridPattern, setGridPattern] = useState<GridPattern>('4x2');
  const [gapX, setGapX] = useState(0); // 横の間隔（px）
  const [gapY, setGapY] = useState(0); // 縦の間隔（px）

  const handleDragStart = (e: React.DragEvent, snippetId: string) => {
    e.dataTransfer.setData('snippetId', snippetId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleAddToLayout = (snippetId: string) => {
    if (activeLayoutPageId) {
      addSnippetToLayout(activeLayoutPageId, snippetId, { x: 10, y: 10 });
    }
  };

  const handleArrangeAll = () => {
    if (!activeLayoutPageId || snippets.length === 0) return;

    let cols: number, rows: number;
    if (gridPattern === 'auto') {
      const auto = getAutoGrid(snippets.length);
      cols = auto.cols;
      rows = auto.rows;
    } else {
      cols = GRID_PATTERNS[gridPattern].cols;
      rows = GRID_PATTERNS[gridPattern].rows;
    }

    arrangeAllSnippetsInGrid(activeLayoutPageId, cols, rows, gapX, gapY);
  };

  const GAP_STEP = 10; // 間隔調整のステップ（px）

  // 間隔変更時に自動で再配置
  const handleGapChange = (newGapX: number, newGapY: number) => {
    setGapX(newGapX);
    setGapY(newGapY);

    if (!activeLayoutPageId || snippets.length === 0) return;

    let cols: number, rows: number;
    if (gridPattern === 'auto') {
      const auto = getAutoGrid(snippets.length);
      cols = auto.cols;
      rows = auto.rows;
    } else {
      cols = GRID_PATTERNS[gridPattern].cols;
      rows = GRID_PATTERNS[gridPattern].rows;
    }

    arrangeAllSnippetsInGrid(activeLayoutPageId, cols, rows, newGapX, newGapY);
  };

  return (
    <div className="w-48 bg-white rounded-lg shadow overflow-hidden flex flex-col">
      <div className="px-3 py-2 bg-gray-50 border-b font-medium text-sm">
        スニペット ({snippets.length})
      </div>

      <div className="flex-1 overflow-auto p-2">
        {snippets.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">
            トリミングツールで<br />範囲を選択してください
          </p>
        ) : (
          <div className="space-y-2">
            {snippets.map((snippet) => (
              <div
                key={snippet.id}
                className={`relative rounded border-2 cursor-move transition-colors ${
                  selectedSnippetId === snippet.id
                    ? 'border-blue-500'
                    : 'border-transparent hover:border-blue-300'
                }`}
                onClick={() => setSelectedSnippet(snippet.id)}
                draggable
                onDragStart={(e) => handleDragStart(e, snippet.id)}
              >
                <img
                  src={snippet.imageData}
                  alt={`Snippet ${snippet.id}`}
                  className="w-full h-auto rounded"
                />

                {/* オーバーレイ */}
                <div className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-30 transition-opacity flex items-center justify-center gap-1 opacity-0 hover:opacity-100">
                  <button
                    className="p-1.5 bg-green-500 text-white rounded hover:bg-green-600"
                    onClick={(e) => {
                      e.stopPropagation();
                      setReCropSnippet(snippet.id);
                    }}
                    title="再トリミング"
                  >
                    <Crop className="w-4 h-4" />
                  </button>
                  <button
                    className="p-1.5 bg-blue-500 text-white rounded hover:bg-blue-600"
                    onClick={(e) => {
                      e.stopPropagation();
                      handleAddToLayout(snippet.id);
                    }}
                    title="レイアウトに追加"
                  >
                    <Move className="w-4 h-4" />
                  </button>
                  <button
                    className="p-1.5 bg-red-500 text-white rounded hover:bg-red-600"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeSnippet(snippet.id);
                    }}
                    title="削除"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                </div>

                {/* 情報バッジ */}
                <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs px-1 py-0.5">
                  P{snippet.sourcePageNumber} •{' '}
                  {Math.round(snippet.cropArea.width)}x{Math.round(snippet.cropArea.height)}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* 全て配置ボタン */}
      {snippets.length > 0 && (
        <div className="p-2 border-t bg-gray-50 space-y-2">
          <div className="flex gap-1">
            <select
              className="flex-1 border rounded px-2 py-1 text-sm"
              value={gridPattern}
              onChange={(e) => setGridPattern(e.target.value as GridPattern)}
            >
              {Object.entries(GRID_PATTERNS).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.label}
                </option>
              ))}
            </select>
          </div>

          {/* 間隔調整 */}
          <div className="flex items-center justify-between text-xs">
            <span className="text-gray-500">間隔:</span>
            <div className="flex items-center gap-1">
              {/* 横間隔 */}
              <button
                className="p-0.5 border rounded hover:bg-gray-100 disabled:opacity-50"
                onClick={() => handleGapChange(Math.max(0, gapX - GAP_STEP), gapY)}
                disabled={!activeLayoutPageId}
                title="横間隔を狭める"
              >
                <ChevronLeft className="w-3 h-3" />
              </button>
              <span className="w-6 text-center">{gapX}</span>
              <button
                className="p-0.5 border rounded hover:bg-gray-100 disabled:opacity-50"
                onClick={() => handleGapChange(gapX + GAP_STEP, gapY)}
                disabled={!activeLayoutPageId}
                title="横間隔を広げる"
              >
                <ChevronRight className="w-3 h-3" />
              </button>

              <span className="mx-1 text-gray-300">|</span>

              {/* 縦間隔 */}
              <button
                className="p-0.5 border rounded hover:bg-gray-100 disabled:opacity-50"
                onClick={() => handleGapChange(gapX, Math.max(0, gapY - GAP_STEP))}
                disabled={!activeLayoutPageId}
                title="縦間隔を狭める"
              >
                <ChevronUp className="w-3 h-3" />
              </button>
              <span className="w-6 text-center">{gapY}</span>
              <button
                className="p-0.5 border rounded hover:bg-gray-100 disabled:opacity-50"
                onClick={() => handleGapChange(gapX, gapY + GAP_STEP)}
                disabled={!activeLayoutPageId}
                title="縦間隔を広げる"
              >
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
          </div>

          <button
            className="w-full flex items-center justify-center gap-1 px-3 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50 disabled:cursor-not-allowed text-sm"
            onClick={handleArrangeAll}
            disabled={!activeLayoutPageId}
            title={activeLayoutPageId ? '全スニペットをグリッド配置' : 'レイアウトページを先に作成してください'}
          >
            <LayoutGrid className="w-4 h-4" />
            全て配置
          </button>
        </div>
      )}
    </div>
  );
}
