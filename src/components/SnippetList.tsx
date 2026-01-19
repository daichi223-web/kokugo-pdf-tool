// =============================================================================
// スニペットリストコンポーネント
// P3-001: トリミング機能 - スニペット管理
// =============================================================================

import { useState } from 'react';
import { Trash2, Move, Crop, CornerDownLeft, Grid, XCircle } from 'lucide-react';
import { useAppStore } from '../stores/appStore';

// グリッドパターン定義
const GRID_PATTERNS: Record<string, { cols: number; rows: number; label: string }> = {
  '4x2': { cols: 4, rows: 2, label: '4×2' },
  '4x3': { cols: 4, rows: 3, label: '4×3' },
  '3x2': { cols: 3, rows: 2, label: '3×2' },
  '2x2': { cols: 2, rows: 2, label: '2×2' },
};

export function SnippetList() {
  const {
    snippets,
    selectedSnippetId,
    setSelectedSnippet,
    removeSnippet,
    activeLayoutPageId,
    addSnippetToLayout,
    setReCropSnippet,
    setActiveFile,
    setActivePage,
    activeFileId,
    toggleSnippetPageBreak,
    arrangeAllSnippetsInGrid,
    layoutPages,
    settings,
    clearAllPlacements,
  } = useAppStore();

  const [gridPattern, setGridPattern] = useState<'4x2' | '4x3' | '3x2' | '2x2'>('4x2');

  // スニペットを選択した時にソースファイル・ページもアクティブに設定
  const handleSnippetClick = (snippet: typeof snippets[0]) => {
    setSelectedSnippet(snippet.id);
    // ファイルが異なる場合は切り替え
    if (snippet.sourceFileId !== activeFileId) {
      setActiveFile(snippet.sourceFileId);
    }
    // ページを設定
    setActivePage(snippet.sourcePageNumber);
  };

  const handleDragStart = (e: React.DragEvent, snippetId: string) => {
    e.dataTransfer.setData('snippetId', snippetId);
    e.dataTransfer.effectAllowed = 'move';
  };

  const handleAddToLayout = (snippetId: string) => {
    if (activeLayoutPageId) {
      addSnippetToLayout(activeLayoutPageId, snippetId, { x: 10, y: 10 });
    }
  };

  // 自動配置を実行
  const handleAutoArrange = () => {
    if (!activeLayoutPageId || snippets.length === 0) return;
    const { cols, rows } = GRID_PATTERNS[gridPattern];
    arrangeAllSnippetsInGrid(activeLayoutPageId, cols, rows, 0, 0);
  };

  // 配置を全削除
  const handleClearAllPlacements = () => {
    if (!confirm('全ページの配置を削除しますか？\n（スニペット自体は残ります）')) return;
    clearAllPlacements();
  };

  // レイアウトページがあるか
  const hasLayoutPage = layoutPages.length > 0;

  // 配置済みスニペットがあるか
  const hasPlacedSnippets = layoutPages.some(page => page.snippets.length > 0);

  return (
    <div className="w-48 bg-white rounded-lg shadow overflow-hidden flex flex-col">
      <div className="px-3 py-2 bg-gray-50 border-b font-medium text-sm">
        スニペット ({snippets.length})
      </div>

      {/* 自動配置ボタン */}
      {snippets.length > 0 && hasLayoutPage && (
        <div className="px-2 py-2 border-b bg-purple-50">
          <div className="flex items-center gap-1">
            <select
              className="flex-1 border rounded px-1 py-1 text-xs"
              value={gridPattern}
              onChange={(e) => setGridPattern(e.target.value as typeof gridPattern)}
            >
              {Object.entries(GRID_PATTERNS).map(([key, value]) => (
                <option key={key} value={key}>{value.label}</option>
              ))}
            </select>
            <button
              className="flex items-center gap-1 px-2 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600 disabled:opacity-50"
              onClick={handleAutoArrange}
              disabled={!activeLayoutPageId}
              title={`${settings.layoutAnchor === 'right-top' ? '右上' : settings.layoutAnchor === 'center' ? '中央' : '左上'}基準で自動配置`}
            >
              <Grid className="w-3 h-3" />
              配置
            </button>
            {hasPlacedSnippets && (
              <button
                className="flex items-center gap-1 px-2 py-1 text-xs bg-red-500 text-white rounded hover:bg-red-600"
                onClick={handleClearAllPlacements}
                title="全ページの配置を削除"
              >
                <XCircle className="w-3 h-3" />
                削除
              </button>
            )}
          </div>
        </div>
      )}

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
                onClick={() => handleSnippetClick(snippet)}
                draggable
                onDragStart={(e) => handleDragStart(e, snippet.id)}
              >
                <img
                  src={snippet.imageData}
                  alt={`Snippet ${snippet.id}`}
                  className="w-full h-auto rounded"
                />

                {/* 改ページマーク */}
                {snippet.pageBreakBefore && (
                  <div className="absolute top-0 left-0 bg-orange-500 text-white text-xs px-1 py-0.5 rounded-br">
                    改ページ
                  </div>
                )}

                {/* オーバーレイ */}
                <div className="absolute inset-0 bg-black bg-opacity-0 hover:bg-opacity-30 transition-opacity flex items-center justify-center gap-1 opacity-0 hover:opacity-100">
                  <button
                    className={`p-1.5 ${snippet.pageBreakBefore ? 'bg-orange-500 hover:bg-orange-600' : 'bg-gray-500 hover:bg-gray-600'} text-white rounded`}
                    onClick={(e) => {
                      e.stopPropagation();
                      toggleSnippetPageBreak(snippet.id);
                    }}
                    title={snippet.pageBreakBefore ? '改ページ解除' : '改ページ設定'}
                  >
                    <CornerDownLeft className="w-4 h-4" />
                  </button>
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
    </div>
  );
}
