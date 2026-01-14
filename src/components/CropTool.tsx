// =============================================================================
// トリミングツールコンポーネント
// P3-001: トリミング機能
// =============================================================================

import { useState, useRef, useCallback } from 'react';
import { Crop, Check, X, AlertCircle } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import type { CropArea } from '../types';

interface CropToolProps {
  imageData: string;
  sourceFileId: string;
  sourcePageNumber: number;
  zoom: number;
}

export function CropTool({
  imageData,
  sourceFileId,
  sourcePageNumber,
  zoom,
}: CropToolProps) {
  const { addSnippet } = useAppStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const [isSelecting, setIsSelecting] = useState(false);
  const [selection, setSelection] = useState<CropArea | null>(null);
  const [startPoint, setStartPoint] = useState<{ x: number; y: number } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const x = (e.clientX - rect.left) / zoom;
    const y = (e.clientY - rect.top) / zoom;

    setStartPoint({ x, y });
    setSelection({ x, y, width: 0, height: 0 });
    setIsSelecting(true);
  }, [zoom]);

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!isSelecting || !startPoint || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const currentX = (e.clientX - rect.left) / zoom;
    const currentY = (e.clientY - rect.top) / zoom;

    const x = Math.min(startPoint.x, currentX);
    const y = Math.min(startPoint.y, currentY);
    const width = Math.abs(currentX - startPoint.x);
    const height = Math.abs(currentY - startPoint.y);

    setSelection({ x, y, width, height });
  }, [isSelecting, startPoint, zoom]);

  const handleMouseUp = useCallback(() => {
    setIsSelecting(false);
    setStartPoint(null);
  }, []);

  const handleConfirm = useCallback(async () => {
    setErrorMessage(null);
    if (!selection || selection.width < 10 || selection.height < 10) {
      setErrorMessage('選択範囲が小さすぎます（最小10x10ピクセル）');
      return;
    }

    // 選択範囲を切り出してスニペットとして追加
    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      setErrorMessage('キャンバスの作成に失敗しました');
      return;
    }

    const img = new Image();
    img.src = imageData;

    try {
      await new Promise((resolve, reject) => {
        img.onload = resolve;
        img.onerror = () => reject(new Error('画像の読み込みに失敗しました'));
      });
    } catch (error) {
      setErrorMessage(error instanceof Error ? error.message : '画像エラー');
      return;
    }

    // キャンバスサイズを選択範囲に設定
    canvas.width = selection.width;
    canvas.height = selection.height;

    // 選択範囲を描画
    ctx.drawImage(
      img,
      selection.x,
      selection.y,
      selection.width,
      selection.height,
      0,
      0,
      selection.width,
      selection.height
    );

    const croppedImageData = canvas.toDataURL('image/png');

    addSnippet({
      sourceFileId,
      sourcePageNumber,
      cropArea: selection,
      imageData: croppedImageData,
    });

    setSelection(null);
  }, [selection, imageData, sourceFileId, sourcePageNumber, addSnippet]);

  const handleCancel = useCallback(() => {
    setSelection(null);
    setIsSelecting(false);
    setStartPoint(null);
    setErrorMessage(null);
  }, []);

  return (
    <div className="relative">
      {/* 操作説明 */}
      <div className="absolute top-2 left-2 z-10 bg-black bg-opacity-50 text-white text-sm px-2 py-1 rounded">
        <Crop className="w-4 h-4 inline mr-1" />
        ドラッグで範囲を選択
      </div>

      {/* エラーメッセージ */}
      {errorMessage && (
        <div className="absolute top-12 left-2 z-10 bg-red-500 text-white text-sm px-2 py-1 rounded flex items-center gap-1">
          <AlertCircle className="w-4 h-4" />
          {errorMessage}
        </div>
      )}

      {/* 選択確定ボタン */}
      {selection && selection.width > 10 && selection.height > 10 && !isSelecting && (
        <div className="absolute top-2 right-2 z-10 flex gap-1">
          <button
            className="flex items-center gap-1 px-2 py-1 bg-green-500 text-white rounded hover:bg-green-600"
            onClick={handleConfirm}
            aria-label="選択範囲を切り出し"
          >
            <Check className="w-4 h-4" />
            切り出し
          </button>
          <button
            className="flex items-center gap-1 px-2 py-1 bg-gray-500 text-white rounded hover:bg-gray-600"
            onClick={handleCancel}
            aria-label="選択をキャンセル"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
      )}

      {/* 画像コンテナ */}
      <div
        ref={containerRef}
        className="relative cursor-crosshair select-none"
        style={{ transform: `scale(${zoom})`, transformOrigin: 'top left' }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUp}
        onMouseLeave={handleMouseUp}
      >
        <img
          src={imageData}
          alt="PDF Page"
          className="max-w-none"
          draggable={false}
        />

        {/* 選択範囲表示 */}
        {selection && (
          <div
            className="absolute border-2 border-blue-500 bg-blue-200 bg-opacity-30 pointer-events-none"
            style={{
              left: selection.x,
              top: selection.y,
              width: selection.width,
              height: selection.height,
            }}
          >
            {/* サイズ表示 */}
            <div className="absolute -bottom-6 left-0 bg-blue-500 text-white text-xs px-1 py-0.5 rounded">
              {Math.round(selection.width)} x {Math.round(selection.height)}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
