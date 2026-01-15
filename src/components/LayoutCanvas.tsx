// =============================================================================
// レイアウトキャンバスコンポーネント
// P3-002: 再配置エディタ
// P3-005: グリッド/ガイド表示
// =============================================================================

import { useState, useCallback, useRef, useEffect } from 'react';
import { useAppStore } from '../stores/appStore';
import { mmToPx, pxToMm } from '../utils/helpers';
import type { LayoutPage, Snippet, Position } from '../types';
import { getPaperDimensions } from '../types';

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
    updateSnippetSize,
    removeSnippetFromLayout,
    selectedSnippetId,
    setSelectedSnippet,
    addSnippetToLayout,
  } = useAppStore();

  const canvasRef = useRef<HTMLDivElement>(null);
  const [dragging, setDragging] = useState<string | null>(null);
  const [dragOffset, setDragOffset] = useState<Position>({ x: 0, y: 0 });
  const [resizing, setResizing] = useState<{
    snippetId: string;
    handle: string;
    startSize: { width: number; height: number };
    startPos: Position;
    startPosition: Position;
  } | null>(null);
  const [justDropped, setJustDropped] = useState(false); // ドロップ直後フラグ

  const paperSize = getPaperDimensions(layoutPage.paperSize, layoutPage.orientation);
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

      // 左クリック以外は無視
      if (e.button !== 0) return;

      // ドロップ直後は内部ドラッグを開始しない
      if (justDropped) return;

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
    [layoutPage.snippets, zoom, setSelectedSnippet, justDropped]
  );

  // リサイズ開始
  const handleResizeStart = useCallback(
    (e: React.MouseEvent, snippetId: string, handle: string) => {
      e.stopPropagation();
      const placed = layoutPage.snippets.find((s) => s.snippetId === snippetId);
      if (!placed || !canvasRef.current) return;

      const rect = canvasRef.current.getBoundingClientRect();
      setResizing({
        snippetId,
        handle,
        startSize: { ...placed.size },
        startPos: {
          x: (e.clientX - rect.left) / zoom,
          y: (e.clientY - rect.top) / zoom,
        },
        startPosition: { ...placed.position },
      });
      setSelectedSnippet(snippetId);
    },
    [layoutPage.snippets, zoom, setSelectedSnippet]
  );

  // document監視でリサイズ/ドラッグ（画面外でも追跡）
  useEffect(() => {
    if (!dragging && !resizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();

      // リサイズ処理
      if (resizing) {
        const currentX = (e.clientX - rect.left) / zoom;
        const currentY = (e.clientY - rect.top) / zoom;
        const dx = currentX - resizing.startPos.x;
        const dy = currentY - resizing.startPos.y;

        const minSize = 20;
        const startWidth = resizing.startSize.width;
        const startHeight = resizing.startSize.height;
        const leftEdge = resizing.startPosition.x;
        const rightEdge = resizing.startPosition.x + startWidth;
        const topEdge = resizing.startPosition.y;
        const bottomEdge = resizing.startPosition.y + startHeight;

        let newWidth = startWidth;
        let newHeight = startHeight;
        let newX = leftEdge;
        let newY = topEdge;

        switch (resizing.handle) {
          case 'e':
            newWidth = startWidth + dx;
            break;
          case 'w':
            newWidth = startWidth - dx;
            newX = rightEdge - newWidth;
            break;
          case 's':
            newHeight = startHeight + dy;
            break;
          case 'n':
            newHeight = startHeight - dy;
            newY = bottomEdge - newHeight;
            break;
          case 'se':
            newWidth = startWidth + dx;
            newHeight = startHeight + dy;
            break;
          case 'sw':
            newWidth = startWidth - dx;
            newHeight = startHeight + dy;
            newX = rightEdge - newWidth;
            break;
          case 'ne':
            newWidth = startWidth + dx;
            newHeight = startHeight - dy;
            newY = bottomEdge - newHeight;
            break;
          case 'nw':
            newWidth = startWidth - dx;
            newHeight = startHeight - dy;
            newX = rightEdge - newWidth;
            newY = bottomEdge - newHeight;
            break;
          default:
            break;
        }

        newWidth = Math.max(minSize, newWidth);
        newHeight = Math.max(minSize, newHeight);

        if (resizing.handle.includes('w')) {
          newX = rightEdge - newWidth;
        }
        if (resizing.handle.includes('n')) {
          newY = bottomEdge - newHeight;
        }

        if (snapToGrid) {
          const gridPx = mmToPx(gridSize, 96);
          const snap = (value: number) => Math.round(value / gridPx) * gridPx;
          const snappedWidth = Math.max(minSize, snap(newWidth));
          const snappedHeight = Math.max(minSize, snap(newHeight));

          if (resizing.handle.includes('w')) {
            newX = rightEdge - snappedWidth;
          }
          if (resizing.handle.includes('n')) {
            newY = bottomEdge - snappedHeight;
          }

          newWidth = snappedWidth;
          newHeight = snappedHeight;
        }

        updateSnippetPosition(layoutPage.id, resizing.snippetId, {
          x: newX,
          y: newY,
        });
        updateSnippetSize(layoutPage.id, resizing.snippetId, {
          width: newWidth,
          height: newHeight,
        });
        return;
      }

      // ドラッグ処理
      if (dragging) {
        const newPos = snapPosition({
          x: (e.clientX - rect.left) / zoom - dragOffset.x,
          y: (e.clientY - rect.top) / zoom - dragOffset.y,
        });
        updateSnippetPosition(layoutPage.id, dragging, newPos);
      }
    };

    const handleMouseUp = () => {
      setDragging(null);
      setResizing(null);
    };

    // HTML5 Drag終了時もドラッグ状態をリセット
    const handleDragEnd = () => {
      setDragging(null);
      setResizing(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);
    document.addEventListener('dragend', handleDragEnd);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
      document.removeEventListener('dragend', handleDragEnd);
    };
  }, [
    dragging,
    dragOffset,
    resizing,
    zoom,
    snapPosition,
    snapToGrid,
    gridSize,
    layoutPage.id,
    updateSnippetPosition,
    updateSnippetSize,
  ]);

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

      // ドロップ直後フラグを設定（内部ドラッグの誤発火を防ぐ）
      setJustDropped(true);
      setTimeout(() => setJustDropped(false), 150);

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

      {/* 1/2と1/3のガイドライン */}
      {showGrid && (
        <>
          {/* 縦方向 1/2 ライン */}
          <div
            className="absolute pointer-events-none"
            style={{
              left: (canvasWidth / 2) * zoom,
              top: 0,
              width: 2,
              height: canvasHeight * zoom,
              backgroundColor: 'rgba(59, 130, 246, 0.5)',
            }}
          />
          {/* 縦方向 1/3 ライン */}
          <div
            className="absolute pointer-events-none"
            style={{
              left: (canvasWidth / 3) * zoom,
              top: 0,
              width: 2,
              height: canvasHeight * zoom,
              backgroundColor: 'rgba(239, 68, 68, 0.4)',
            }}
          />
          {/* 縦方向 2/3 ライン */}
          <div
            className="absolute pointer-events-none"
            style={{
              left: (canvasWidth * 2 / 3) * zoom,
              top: 0,
              width: 2,
              height: canvasHeight * zoom,
              backgroundColor: 'rgba(239, 68, 68, 0.4)',
            }}
          />
          {/* 横方向 1/2 ライン */}
          <div
            className="absolute pointer-events-none"
            style={{
              left: 0,
              top: (canvasHeight / 2) * zoom,
              width: canvasWidth * zoom,
              height: 2,
              backgroundColor: 'rgba(59, 130, 246, 0.5)',
            }}
          />
          {/* 横方向 1/3 ライン */}
          <div
            className="absolute pointer-events-none"
            style={{
              left: 0,
              top: (canvasHeight / 3) * zoom,
              width: canvasWidth * zoom,
              height: 2,
              backgroundColor: 'rgba(239, 68, 68, 0.4)',
            }}
          />
          {/* 横方向 2/3 ライン */}
          <div
            className="absolute pointer-events-none"
            style={{
              left: 0,
              top: (canvasHeight * 2 / 3) * zoom,
              width: canvasWidth * zoom,
              height: 2,
              backgroundColor: 'rgba(239, 68, 68, 0.4)',
            }}
          />
        </>
      )}

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
            onClick={(e) => {
              e.stopPropagation();
              setSelectedSnippet(placed.snippetId);
            }}
          >
            <img
              src={snippet.imageData}
              alt="Snippet"
              className="w-full h-full object-contain"
              draggable={false}
            />

            {/* リサイズハンドル（8つ） */}
            {isSelected && (
              <>
                {/* 4隅 */}
                <div className="snippet-handle cursor-nwse-resize" style={{ left: -8, top: -8 }} onMouseDown={(e) => handleResizeStart(e, placed.snippetId, 'nw')} />
                <div className="snippet-handle cursor-nesw-resize" style={{ right: -8, top: -8 }} onMouseDown={(e) => handleResizeStart(e, placed.snippetId, 'ne')} />
                <div className="snippet-handle cursor-nesw-resize" style={{ left: -8, bottom: -8 }} onMouseDown={(e) => handleResizeStart(e, placed.snippetId, 'sw')} />
                <div className="snippet-handle cursor-nwse-resize" style={{ right: -8, bottom: -8 }} onMouseDown={(e) => handleResizeStart(e, placed.snippetId, 'se')} />
                {/* 4辺中央 */}
                <div className="snippet-handle cursor-ns-resize" style={{ left: '50%', top: -8, transform: 'translateX(-50%)' }} onMouseDown={(e) => handleResizeStart(e, placed.snippetId, 'n')} />
                <div className="snippet-handle cursor-ns-resize" style={{ left: '50%', bottom: -8, transform: 'translateX(-50%)' }} onMouseDown={(e) => handleResizeStart(e, placed.snippetId, 's')} />
                <div className="snippet-handle cursor-ew-resize" style={{ left: -8, top: '50%', transform: 'translateY(-50%)' }} onMouseDown={(e) => handleResizeStart(e, placed.snippetId, 'w')} />
                <div className="snippet-handle cursor-ew-resize" style={{ right: -8, top: '50%', transform: 'translateY(-50%)' }} onMouseDown={(e) => handleResizeStart(e, placed.snippetId, 'e')} />
                {/* 削除ボタン */}
                <button
                  className="absolute w-6 h-6 bg-red-500 text-white rounded-full text-sm font-bold hover:bg-red-600 flex items-center justify-center"
                  style={{ right: -12, top: -12, zIndex: 30 }}
                  onClick={(e) => {
                    e.stopPropagation();
                    removeSnippetFromLayout(layoutPage.id, placed.snippetId);
                  }}
                >
                  ×
                </button>
                {/* サイズ表示（mm単位） */}
                <div className="absolute -bottom-6 left-0 bg-blue-600 text-white text-xs px-2 py-0.5 rounded whitespace-nowrap" style={{ zIndex: 25 }}>
                  {Math.round(pxToMm(placed.size.width, 96))}mm × {Math.round(pxToMm(placed.size.height, 96))}mm
                </div>
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
