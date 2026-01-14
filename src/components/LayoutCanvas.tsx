// =============================================================================
// レイアウトキャンバスコンポーネント
// P3-002: 再配置エディタ
// P3-005: グリッド/ガイド表示
// =============================================================================

import { useState, useCallback, useRef } from 'react';
import { useAppStore } from '../stores/appStore';
import { mmToPx } from '../utils/helpers';
import type { LayoutPage, Snippet, Position } from '../types';
import { PAPER_SIZES } from '../types';

interface LayoutCanvasProps {
  layoutPage: LayoutPage;
  snippets: Snippet[];
  zoom: number;
  showGrid: boolean;
  gridSize: number;
  snapToGrid: boolean;
}

export function LayoutCanvas({
  layoutPage,
  snippets,
  zoom,
  showGrid,
  gridSize,
  snapToGrid,
}: LayoutCanvasProps) {
  const {
    updateSnippetPosition,
    removeSnippetFromLayout,
    selectedSnippetId,
    setSelectedSnippet,
    addSnippetToLayout,
  } = useAppStore();

  const canvasRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<Position>({ x: 0, y: 0 });
  const [_resizing, setResizing] = useState<string | null>(null); // TODO: リサイズ機能実装予定

  const paperSize = PAPER_SIZES[layoutPage.paperSize];
  const margin = 15; // 15mm余白
  const canvasWidth = mmToPx(paperSize.width, 96); // 96 DPI for screen
  const canvasHeight = mmToPx(paperSize.height, 96);
  const marginPx = mmToPx(margin, 96);

  // スナップ処理
  const snapPosition = useCallback(
    (pos: Position): Position => {
      if (!snapToGrid) return pos;
      const gridPx = mmToPx(gridSize, 96);
      return {
        x: Math.round(pos.x / gridPx) * gridPx,
        y: Math.round(pos.y / gridPx) * gridPx,
      };
    },
    [snapToGrid, gridSize]
  );

  // ドラッグ開始
  const handleDragStart = useCallback(
    (e: React.MouseEvent, snippetId: string) => {
      e.stopPropagation();
      const placed = layoutPage.snippets.find((s) => s.snippetId === snippetId);
      if (!placed) return;

      const rect = canvasRef.current?.getBoundingClientRect();
      if (!rect) return;

      setDragging(snippetId);
      setSelectedSnippet(snippetId);
      setDragOffset({
        x: (e.clientX - rect.left) / zoom - placed.position.x,
        y: (e.clientY - rect.top) / zoom - placed.position.y,
      });
    },
    [layoutPage.snippets, zoom, setSelectedSnippet]
  );

  // ドラッグ中
  const handleMouseMove = useCallback(
    (e: React.MouseEvent) => {
      if (!dragging || !canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const newPos = snapPosition({
        x: (e.clientX - rect.left) / zoom - dragOffset.x,
        y: (e.clientY - rect.top) / zoom - dragOffset.y,
      });

      updateSnippetPosition(layoutPage.id, dragging, newPos);
    },
    [dragging, dragOffset, zoom, snapPosition, layoutPage.id, updateSnippetPosition]
  );

  // ドラッグ終了
  const handleMouseUp = useCallback(() => {
    setDragging(null);
    setResizing(null);
  }, []);

  // ドロップ受付
  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      const snippetId = e.dataTransfer.getData('snippetId');
      if (!snippetId || !canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      const position = snapPosition({
        x: (e.clientX - rect.left) / zoom - marginPx,
        y: (e.clientY - rect.top) / zoom - marginPx,
      });

      addSnippetToLayout(layoutPage.id, snippetId, position);
    },
    [zoom, marginPx, snapPosition, layoutPage.id, addSnippetToLayout]
  );

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  return (
    <div
      ref={canvasRef}
      className="layout-canvas relative"
      style={{
        width: canvasWidth * zoom,
        height: canvasHeight * zoom,
        backgroundImage: showGrid
          ? `linear-gradient(to right, #e5e7eb 1px, transparent 1px),
             linear-gradient(to bottom, #e5e7eb 1px, transparent 1px)`
          : 'none',
        backgroundSize: `${mmToPx(gridSize, 96) * zoom}px ${mmToPx(gridSize, 96) * zoom}px`,
      }}
      onMouseMove={handleMouseMove}
      onMouseUp={handleMouseUp}
      onMouseLeave={handleMouseUp}
      onDrop={handleDrop}
      onDragOver={handleDragOver}
      onClick={() => setSelectedSnippet(null)}
    >
      {/* 余白ガイド */}
      <div
        className="absolute border border-dashed border-gray-300 pointer-events-none"
        style={{
          left: marginPx * zoom,
          top: marginPx * zoom,
          width: (canvasWidth - marginPx * 2) * zoom,
          height: (canvasHeight - marginPx * 2) * zoom,
        }}
      />

      {/* 配置されたスニペット */}
      {layoutPage.snippets.map((placed) => {
        const snippet = snippets.find((s) => s.id === placed.snippetId);
        if (!snippet) return null;

        const isSelected = selectedSnippetId === placed.snippetId;

        return (
          <div
            key={placed.snippetId}
            className={`snippet ${isSelected ? 'selected' : ''}`}
            style={{
              left: (marginPx + placed.position.x) * zoom,
              top: (marginPx + placed.position.y) * zoom,
              width: placed.size.width * zoom,
              height: placed.size.height * zoom,
            }}
            onMouseDown={(e) => handleDragStart(e, placed.snippetId)}
          >
            <img
              src={snippet.imageData}
              alt="Snippet"
              className="w-full h-full object-contain"
              draggable={false}
            />

            {/* リサイズハンドル */}
            {isSelected && (
              <>
                <div
                  className="snippet-handle -right-1.5 -bottom-1.5 cursor-se-resize"
                  onMouseDown={(e) => {
                    e.stopPropagation();
                    setResizing(placed.snippetId);
                  }}
                />
                <button
                  className="absolute -top-2 -right-2 w-5 h-5 bg-red-500 text-white rounded-full text-xs hover:bg-red-600"
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSnippetFromLayout(layoutPage.id, placed.snippetId);
                  }}
                >
                  ×
                </button>
              </>
            )}
          </div>
        );
      })}

      {/* キャンバスが空の場合 */}
      {layoutPage.snippets.length === 0 && (
        <div className="absolute inset-0 flex items-center justify-center text-gray-400 pointer-events-none">
          <div className="text-center">
            <p>スニペットをドラッグ&ドロップで配置</p>
            <p className="text-sm mt-1">
              または左のリストからスニペットをドラッグ
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
