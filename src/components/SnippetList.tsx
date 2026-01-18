// =============================================================================
// スニペットリストコンポーネント
// P3-001: トリミング機能 - スニペット管理
// =============================================================================

import { Trash2, Move, Crop } from 'lucide-react';
import { useAppStore } from '../stores/appStore';

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
  } = useAppStore();

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
                onClick={() => handleSnippetClick(snippet)}
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
    </div>
  );
}
