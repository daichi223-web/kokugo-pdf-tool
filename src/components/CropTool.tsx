// =============================================================================
// トリミングツールコンポーネント（改良版）
// P3-001: トリミング機能
// CROP-001〜006: 画面外ドラッグ、移動、リサイズ、テンプレート
// =============================================================================

import { useState, useRef, useCallback, useEffect } from 'react';
import { Crop, Check, X, AlertCircle, Move } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import type { CropArea } from '../types';
import {
  saveTemplate,
  clampSelectionToImage,
  type TemplateScope,
  type CropTemplate,
} from '../utils/cropTemplateUtils';

interface CropToolProps {
  imageData: string;
  sourceFileId: string;
  sourcePageNumber: number;
  zoom: number;
  templateScope: TemplateScope;
  templateToApply?: CropTemplate | null;
  onTemplateApplied?: () => void;
  batchMode?: boolean;
  onBatchCrop?: (cropArea: CropArea) => void;
  onCropComplete?: () => void;
  updateSnippetId?: string | null;  // 更新モード用：既存スニペットのID
}

type DragMode = 'none' | 'select' | 'move' | 'resize-nw' | 'resize-n' | 'resize-ne' | 'resize-e' | 'resize-se' | 'resize-s' | 'resize-sw' | 'resize-w';

const HANDLE_SIZE = 10;

export function CropTool({
  imageData,
  sourceFileId,
  sourcePageNumber,
  zoom,
  templateScope,
  templateToApply,
  onTemplateApplied,
  batchMode = false,
  onBatchCrop,
  onCropComplete,
  updateSnippetId,
}: CropToolProps) {
  const { addSnippet, updateSnippet } = useAppStore();

  const containerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const [selection, setSelection] = useState<CropArea | null>(null);
  const [dragMode, setDragMode] = useState<DragMode>('none');
  const [dragStart, setDragStart] = useState<{ x: number; y: number; selection: CropArea | null } | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [imageSize, setImageSize] = useState<{ width: number; height: number }>({ width: 0, height: 0 });

  // 画像サイズを取得
  useEffect(() => {
    const img = new Image();
    img.onload = () => {
      setImageSize({ width: img.width, height: img.height });
    };
    img.src = imageData;
  }, [imageData]);

  // テンプレート適用
  useEffect(() => {
    if (!templateToApply || imageSize.width === 0 || imageSize.height === 0) return;

    // 画像中央に配置
    const newSelection = clampSelectionToImage(
      {
        x: (imageSize.width - templateToApply.width) / 2,
        y: (imageSize.height - templateToApply.height) / 2,
        width: templateToApply.width,
        height: templateToApply.height,
      },
      imageSize.width,
      imageSize.height
    );

    setSelection(newSelection);
    onTemplateApplied?.();
  }, [templateToApply, imageSize, onTemplateApplied]);

  // 座標変換（クライアント座標 → 画像座標）
  const clientToImage = useCallback((clientX: number, clientY: number): { x: number; y: number } => {
    if (!containerRef.current) return { x: 0, y: 0 };
    const rect = containerRef.current.getBoundingClientRect();
    return {
      x: (clientX - rect.left) / zoom,
      y: (clientY - rect.top) / zoom,
    };
  }, [zoom]);

  // ドラッグモードからカーソルを取得
  const getCursor = (mode: DragMode): string => {
    switch (mode) {
      case 'move': return 'move';
      case 'resize-nw': case 'resize-se': return 'nwse-resize';
      case 'resize-ne': case 'resize-sw': return 'nesw-resize';
      case 'resize-n': case 'resize-s': return 'ns-resize';
      case 'resize-e': case 'resize-w': return 'ew-resize';
      default: return 'crosshair';
    }
  };

  // マウスダウン
  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return;
    e.preventDefault();

    const pos = clientToImage(e.clientX, e.clientY);

    // 既存の選択範囲内かチェック
    if (selection) {
      const handle = getHandleAtPosition(pos, selection);
      if (handle !== 'none') {
        setDragMode(handle);
        setDragStart({ x: pos.x, y: pos.y, selection: { ...selection } });
        return;
      }
    }

    // 新規選択開始
    setDragMode('select');
    setDragStart({ x: pos.x, y: pos.y, selection: null });
    setSelection({ x: pos.x, y: pos.y, width: 0, height: 0 });
  }, [selection, clientToImage]);

  // ハンドル位置を判定
  const getHandleAtPosition = (pos: { x: number; y: number }, sel: CropArea): DragMode => {
    const handleHitSize = HANDLE_SIZE / zoom;
    const { x, y, width, height } = sel;

    // 4隅
    if (Math.abs(pos.x - x) < handleHitSize && Math.abs(pos.y - y) < handleHitSize) return 'resize-nw';
    if (Math.abs(pos.x - (x + width)) < handleHitSize && Math.abs(pos.y - y) < handleHitSize) return 'resize-ne';
    if (Math.abs(pos.x - x) < handleHitSize && Math.abs(pos.y - (y + height)) < handleHitSize) return 'resize-sw';
    if (Math.abs(pos.x - (x + width)) < handleHitSize && Math.abs(pos.y - (y + height)) < handleHitSize) return 'resize-se';

    // 4辺中央
    if (Math.abs(pos.x - (x + width / 2)) < handleHitSize && Math.abs(pos.y - y) < handleHitSize) return 'resize-n';
    if (Math.abs(pos.x - (x + width / 2)) < handleHitSize && Math.abs(pos.y - (y + height)) < handleHitSize) return 'resize-s';
    if (Math.abs(pos.x - x) < handleHitSize && Math.abs(pos.y - (y + height / 2)) < handleHitSize) return 'resize-w';
    if (Math.abs(pos.x - (x + width)) < handleHitSize && Math.abs(pos.y - (y + height / 2)) < handleHitSize) return 'resize-e';

    // 内部（移動）
    if (pos.x >= x && pos.x <= x + width && pos.y >= y && pos.y <= y + height) return 'move';

    return 'none';
  };

  // CROP-001: document監視でマウス移動
  useEffect(() => {
    if (dragMode === 'none') return;

    const handleMouseMove = (e: MouseEvent) => {
      if (!dragStart) return;

      const pos = clientToImage(e.clientX, e.clientY);
      const { x: startX, y: startY, selection: startSel } = dragStart;
      const dx = pos.x - startX;
      const dy = pos.y - startY;

      let newSelection: CropArea;

      switch (dragMode) {
        case 'select':
          newSelection = {
            x: Math.min(startX, pos.x),
            y: Math.min(startY, pos.y),
            width: Math.abs(pos.x - startX),
            height: Math.abs(pos.y - startY),
          };
          break;

        case 'move':
          if (!startSel) return;
          newSelection = {
            ...startSel,
            x: startSel.x + dx,
            y: startSel.y + dy,
          };
          break;

        case 'resize-nw':
          if (!startSel) return;
          newSelection = {
            x: startSel.x + dx,
            y: startSel.y + dy,
            width: startSel.width - dx,
            height: startSel.height - dy,
          };
          break;

        case 'resize-ne':
          if (!startSel) return;
          newSelection = {
            x: startSel.x,
            y: startSel.y + dy,
            width: startSel.width + dx,
            height: startSel.height - dy,
          };
          break;

        case 'resize-sw':
          if (!startSel) return;
          newSelection = {
            x: startSel.x + dx,
            y: startSel.y,
            width: startSel.width - dx,
            height: startSel.height + dy,
          };
          break;

        case 'resize-se':
          if (!startSel) return;
          newSelection = {
            x: startSel.x,
            y: startSel.y,
            width: startSel.width + dx,
            height: startSel.height + dy,
          };
          break;

        case 'resize-n':
          if (!startSel) return;
          newSelection = {
            ...startSel,
            y: startSel.y + dy,
            height: startSel.height - dy,
          };
          break;

        case 'resize-s':
          if (!startSel) return;
          newSelection = {
            ...startSel,
            height: startSel.height + dy,
          };
          break;

        case 'resize-w':
          if (!startSel) return;
          newSelection = {
            ...startSel,
            x: startSel.x + dx,
            width: startSel.width - dx,
          };
          break;

        case 'resize-e':
          if (!startSel) return;
          newSelection = {
            ...startSel,
            width: startSel.width + dx,
          };
          break;

        default:
          return;
      }

      // 幅・高さが負にならないよう調整
      if (newSelection.width < 0) {
        newSelection.x += newSelection.width;
        newSelection.width = Math.abs(newSelection.width);
      }
      if (newSelection.height < 0) {
        newSelection.y += newSelection.height;
        newSelection.height = Math.abs(newSelection.height);
      }

      // 画像境界にクランプ
      if (imageSize.width > 0 && imageSize.height > 0) {
        newSelection = clampSelectionToImage(newSelection, imageSize.width, imageSize.height);
      }

      setSelection(newSelection);
    };

    const handleMouseUp = () => {
      setDragMode('none');
      setDragStart(null);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [dragMode, dragStart, clientToImage, imageSize]);

  // 切り出し確定
  const handleConfirm = useCallback(async () => {
    setErrorMessage(null);
    if (!selection || selection.width < 10 || selection.height < 10) {
      setErrorMessage('選択範囲が小さすぎます（最小10x10ピクセル）');
      return;
    }

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

    canvas.width = selection.width;
    canvas.height = selection.height;

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

    // テンプレートとして保存
    saveTemplate(
      templateScope,
      { width: selection.width, height: selection.height, createdAt: Date.now() },
      sourceFileId,
      sourcePageNumber
    );

    // BATCH-002: 一括モードの場合はonBatchCropを呼び出し
    if (batchMode && onBatchCrop) {
      onBatchCrop(selection);
    } else if (updateSnippetId) {
      // 更新モード：既存スニペットを更新
      updateSnippet(updateSnippetId, {
        sourceFileId,
        sourcePageNumber,
        cropArea: selection,
        cropZoom: zoom,  // トリミング時のズーム値を保存
        imageData: croppedImageData,
      });
    } else {
      addSnippet({
        sourceFileId,
        sourcePageNumber,
        cropArea: selection,
        cropZoom: zoom,  // トリミング時のズーム値を保存
        imageData: croppedImageData,
      });
    }

    setSelection(null);

    // 再トリミング完了コールバック
    if (onCropComplete) {
      onCropComplete();
    }
  }, [selection, imageData, sourceFileId, sourcePageNumber, templateScope, zoom, addSnippet, updateSnippet, updateSnippetId, batchMode, onBatchCrop, onCropComplete]);

  const handleCancel = useCallback(() => {
    setSelection(null);
    setDragMode('none');
    setDragStart(null);
    setErrorMessage(null);
  }, []);

  // CROP-005: ボタン位置をクランプして常に見える位置に
  const getButtonPosition = useCallback(() => {
    if (!selection || !containerRef.current) return { top: 8, right: 8 };

    const rect = containerRef.current.getBoundingClientRect();
    const selRight = rect.left + (selection.x + selection.width) * zoom;
    const selTop = rect.top + selection.y * zoom;

    // ビューポート内にクランプ
    const buttonHeight = 40;
    const margin = 8;

    let top = selTop - buttonHeight - margin;
    let right = window.innerWidth - selRight;

    // 上に出る場合は下に配置
    if (top < margin) {
      top = rect.top + (selection.y + selection.height) * zoom + margin;
    }

    // 右に出る場合は左に寄せる
    if (right < margin) {
      right = margin;
    }

    // 下に出る場合は画面内に収める
    if (top + buttonHeight > window.innerHeight - margin) {
      top = window.innerHeight - buttonHeight - margin;
    }

    return { top, right };
  }, [selection, zoom]);

  const buttonPos = getButtonPosition();
  const isValidSelection = selection && selection.width > 10 && selection.height > 10;

  // カーソル判定
  const handleMouseMoveForCursor = useCallback((e: React.MouseEvent) => {
    if (dragMode !== 'none') return;
    if (!selection) return;

    const pos = clientToImage(e.clientX, e.clientY);
    const handle = getHandleAtPosition(pos, selection);
    const cursor = getCursor(handle);

    if (containerRef.current) {
      containerRef.current.style.cursor = cursor;
    }
  }, [selection, dragMode, clientToImage]);

  return (
    <div className="relative">
      {/* 操作説明 */}
      <div className="absolute top-2 left-2 z-10 bg-black bg-opacity-50 text-white text-sm px-2 py-1 rounded flex items-center gap-1">
        <Crop className="w-4 h-4" />
        ドラッグで範囲選択
        {selection && (
          <>
            <span className="mx-1">|</span>
            <Move className="w-4 h-4" />
            範囲内で移動・角でリサイズ
          </>
        )}
      </div>

      {/* エラーメッセージ */}
      {errorMessage && (
        <div className="absolute top-12 left-2 z-10 bg-red-500 text-white text-sm px-2 py-1 rounded flex items-center gap-1">
          <AlertCircle className="w-4 h-4" />
          {errorMessage}
        </div>
      )}

      {/* 選択確定ボタン（position: fixed でビューポート基準） */}
      {isValidSelection && dragMode === 'none' && (
        <div
          className="fixed z-50 flex gap-1"
          style={{ top: buttonPos.top, right: buttonPos.right }}
        >
          <button
            className={`flex items-center gap-1 px-3 py-2 text-white rounded shadow-lg ${
              batchMode ? 'bg-blue-500 hover:bg-blue-600' : 'bg-green-500 hover:bg-green-600'
            }`}
            onClick={handleConfirm}
            aria-label={batchMode ? '選択ページに一括適用' : '選択範囲を切り出し'}
          >
            <Check className="w-4 h-4" />
            {batchMode ? '一括適用' : '切り出し'}
          </button>
          <button
            className="flex items-center gap-1 px-2 py-2 bg-gray-500 text-white rounded shadow-lg hover:bg-gray-600"
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
        className="relative select-none"
        style={{
          transform: `scale(${zoom})`,
          transformOrigin: 'top left',
          cursor: getCursor(dragMode !== 'none' ? dragMode : 'select'),
        }}
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMoveForCursor}
      >
        <img
          ref={imageRef}
          src={imageData}
          alt="PDF Page"
          className="max-w-none"
          draggable={false}
        />

        {/* 選択範囲表示 */}
        {selection && (
          <>
            {/* 選択枠 */}
            <div
              className="absolute border-2 border-blue-500 bg-blue-200 bg-opacity-30"
              style={{
                left: selection.x,
                top: selection.y,
                width: selection.width,
                height: selection.height,
                pointerEvents: dragMode === 'none' ? 'auto' : 'none',
              }}
            >
              {/* サイズ表示 */}
              <div className="absolute -bottom-6 left-0 bg-blue-500 text-white text-xs px-1 py-0.5 rounded whitespace-nowrap">
                {Math.round(selection.width)} x {Math.round(selection.height)}
              </div>
            </div>

            {/* リサイズハンドル（8つ） */}
            {dragMode === 'none' && (
              <>
                {/* 4隅 */}
                <div className="absolute w-3 h-3 bg-white border-2 border-blue-500 cursor-nwse-resize" style={{ left: selection.x - 6, top: selection.y - 6 }} />
                <div className="absolute w-3 h-3 bg-white border-2 border-blue-500 cursor-nesw-resize" style={{ left: selection.x + selection.width - 6, top: selection.y - 6 }} />
                <div className="absolute w-3 h-3 bg-white border-2 border-blue-500 cursor-nesw-resize" style={{ left: selection.x - 6, top: selection.y + selection.height - 6 }} />
                <div className="absolute w-3 h-3 bg-white border-2 border-blue-500 cursor-nwse-resize" style={{ left: selection.x + selection.width - 6, top: selection.y + selection.height - 6 }} />
                {/* 4辺中央 */}
                <div className="absolute w-3 h-3 bg-white border-2 border-blue-500 cursor-ns-resize" style={{ left: selection.x + selection.width / 2 - 6, top: selection.y - 6 }} />
                <div className="absolute w-3 h-3 bg-white border-2 border-blue-500 cursor-ns-resize" style={{ left: selection.x + selection.width / 2 - 6, top: selection.y + selection.height - 6 }} />
                <div className="absolute w-3 h-3 bg-white border-2 border-blue-500 cursor-ew-resize" style={{ left: selection.x - 6, top: selection.y + selection.height / 2 - 6 }} />
                <div className="absolute w-3 h-3 bg-white border-2 border-blue-500 cursor-ew-resize" style={{ left: selection.x + selection.width - 6, top: selection.y + selection.height / 2 - 6 }} />
              </>
            )}
          </>
        )}
      </div>
    </div>
  );
}
