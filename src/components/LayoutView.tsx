// =============================================================================
// レイアウトビュー（トリミング・再配置）
// P3-001: トリミング機能
// P3-002: 再配置エディタ
// P3-004: 用紙サイズ選択
// P3-005: グリッド/ガイド表示
// P3-006: 印刷用PDF出力
// =============================================================================

import { useState, useCallback, useRef, useEffect } from 'react';
import {
  Plus,
  Download,
  Grid,
  Trash2,
  ZoomIn,
  ZoomOut,
  History,
  RotateCcw,
  Layers,
  AlignStartVertical,
  AlignStartHorizontal,
  AlignEndVertical,
  AlignEndHorizontal,
  Type,
  Square,
  Circle,
  Minus,
  ChevronLeft,
  ChevronRight,
  ChevronUp,
  ChevronDown,
  Printer,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { SnippetList } from './SnippetList';
import { LayoutCanvas } from './LayoutCanvas';
import { CropTool } from './CropTool';
import { PageThumbnails } from './PageThumbnails';
import { PAPER_SIZES, type PaperOrientation, type PaperSize, type CropArea, getPaperDimensions } from '../types';
import { mmToPx } from '../utils/helpers';
import {
  type TemplateScope,
  type CropTemplate,
  getLatestTemplateAny,
  getTemplates,
} from '../utils/cropTemplateUtils';
import { exportLayoutToPDF, printLayoutDirectly, type PdfQuality } from '../utils/exportUtils';
import { applyImageEnhancement } from '../utils/pdfUtils';

const REPACK_GRIDS: Record<string, { cols: number; rows: number; label: string }> = {
  '4x2': { cols: 4, rows: 2, label: '4×2' },
  '4x3': { cols: 4, rows: 3, label: '4×3' },
  '3x2': { cols: 3, rows: 2, label: '3×2' },
  '2x2': { cols: 2, rows: 2, label: '2×2' },
  '1x1': { cols: 1, rows: 1, label: '1×1' },
};

// グリッドの配置順を計算（縦書き: 列優先↓←、横書き: 行優先→↓）
function getGridFillOrder(cols: number, rows: number, isVertical: boolean): number[][] {
  const grid: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
  let order = 1;
  if (isVertical) {
    // 列優先: 右列から左列、各列は上→下
    for (let c = cols - 1; c >= 0; c--) {
      for (let r = 0; r < rows; r++) {
        grid[r][c] = order++;
      }
    }
  } else {
    // 行優先: 上行から下行、各行は左→右
    for (let r = 0; r < rows; r++) {
      for (let c = 0; c < cols; c++) {
        grid[r][c] = order++;
      }
    }
  }
  return grid;
}

// 配置順をミニグリッドで表示するコンポーネント
function GridOrderPreview({ cols, rows, isVertical }: { cols: number; rows: number; isVertical: boolean }) {
  const grid = getGridFillOrder(cols, rows, isVertical);
  const cellSize = cols <= 2 ? 16 : cols <= 3 ? 14 : 12;
  return (
    <div
      className="inline-grid border border-purple-300 rounded bg-purple-50"
      style={{ gridTemplateColumns: `repeat(${cols}, ${cellSize}px)`, gap: '1px' }}
      title={`配置順（${isVertical ? '縦書き: 列優先 ↓←' : '横書き: 行優先 →↓'}）`}
    >
      {grid.flat().map((num, i) => (
        <div
          key={i}
          className="flex items-center justify-center text-purple-600 font-bold bg-white"
          style={{ width: cellSize, height: cellSize, fontSize: cellSize <= 12 ? 7 : 8 }}
        >
          {num}
        </div>
      ))}
    </div>
  );
}

export function LayoutView() {
  const {
    files,
    activeFileId,
    activePageNumber,
    snippets,
    layoutPages,
    activeLayoutPageId,
    settings,
    selectedSnippetId,
    addLayoutPage,
    removeLayoutPage,
    moveLayoutPage,
    setActiveLayoutPage,
    updateSettings,
    selectedPageNumbers,
    addSnippet,
    applySnippetWidthToLayout,
    applySnippetHeightToLayout,
    applySnippetXPositionToLayout,
    applySnippetYPositionToLayout,
    reCropSnippetId,
    setReCropSnippet,
    selectedSnippetIds,
    alignSnippets,
    unifySnippetSize,
    addTextElement,
    updateTextElement,
    selectedTextId,
    addShapeElement,
    packSnippets,
    adjustPageSnippetsGap,
    updateLayoutPageMarginX,
    updateLayoutPageMarginY,
    repackAllSnippets,
    repackAcrossPages,
    unifyAllPagesSnippetSize,
  } = useAppStore();

  const [layoutZoom, setLayoutZoom] = useState(1);
  const [cropZoom, setCropZoom] = useState(1);
  const [mode, setMode] = useState<'crop' | 'layout'>('crop');
  const [layoutViewMode, setLayoutViewMode] = useState<'tab' | 'continuous'>('continuous'); // 連続表示がデフォルト
  const [pageGapX, setPageGapX] = useState(0); // ページ内間隔調整（横）
  const [pageGapY, setPageGapY] = useState(0); // ページ内間隔調整（縦）
  const [autoRepack, setAutoRepack] = useState(true); // 自動全詰め機能

  // 再トリミング時の元のレイアウトページIDとスクロール位置を記憶
  const reCropSourceLayoutPageIdRef = useRef<string | null>(null);
  const reCropSourceScrollTopRef = useRef<number>(0);
  const [arrangeScope, setArrangeScope] = useState<'page' | 'all'>('page'); // 配置スコープ
  const [repackGrid, setRepackGrid] = useState<'4x2' | '4x3' | '3x2' | '2x2' | '1x1'>('4x2'); // 詰めるグリッド
  const [pdfQuality, setPdfQuality] = useState<PdfQuality>('standard'); // PDF出力画質
  const [isPrinting, setIsPrinting] = useState(false);
  const [showEnhancementPreview, setShowEnhancementPreview] = useState(false); // 補正プレビュー
  const [previewImage, setPreviewImage] = useState<{ original: string; enhanced: string } | null>(null);

  // 現在のモードに応じたズーム値
  const zoom = mode === 'layout' ? layoutZoom : cropZoom;
  const setZoom = mode === 'layout' ? setLayoutZoom : setCropZoom;
  const [newPageSize, setNewPageSize] = useState<PaperSize>(
    settings.defaultPaperSize ?? 'A3'
  );
  const [newPageOrientation, setNewPageOrientation] = useState<PaperOrientation>(
    settings.defaultPaperOrientation ?? 'landscape'
  );
  const [templateScope, setTemplateScope] = useState<TemplateScope>('global');
  const [showTemplateHistory, setShowTemplateHistory] = useState(false);
  const [pendingTemplate, setPendingTemplate] = useState<CropTemplate | null>(null);
  const [isBatchProcessing, setIsBatchProcessing] = useState(false);
  const [isExporting, setIsExporting] = useState(false);

  const layoutContainerRef = useRef<HTMLDivElement>(null);
  const [cropImageSize, setCropImageSize] = useState<{ width: number; height: number } | null>(null);

  const activeFile = files.find((f) => f.id === activeFileId);
  const activePage = activeFile?.pages.find((p) => p.pageNumber === activePageNumber);
  const activeLayout = layoutPages.find((p) => p.id === activeLayoutPageId);
  const reCropSnippet = snippets.find((s) => s.id === reCropSnippetId);
  // 再トリミング時は元のページ画像を取得
  const reCropSourceFile = reCropSnippet ? files.find((f) => f.id === reCropSnippet.sourceFileId) : null;
  const reCropSourcePage = reCropSourceFile?.pages.find((p) => p.pageNumber === reCropSnippet?.sourcePageNumber);
  const selectedPlacedSnippet = activeLayout?.snippets.find(
    (snippet) => snippet.snippetId === selectedSnippetId
  );
  const selectedTextElement = activeLayout?.textElements?.find(
    (t) => t.id === selectedTextId
  );

  // 用紙を画面内に収めるための自動ズーム計算（レイアウトモード）
  const calculateLayoutFitZoom = useCallback(() => {
    if (!layoutContainerRef.current || !activeLayout) return;

    const container = layoutContainerRef.current;
    const containerWidth = container.clientWidth - 32; // padding分を引く
    const containerHeight = container.clientHeight - 80; // タブとpadding分を引く

    const paperSize = getPaperDimensions(activeLayout.paperSize, activeLayout.orientation);
    const paperWidth = mmToPx(paperSize.width, 96);
    const paperHeight = mmToPx(paperSize.height, 96);

    const scaleX = containerWidth / paperWidth;
    const scaleY = containerHeight / paperHeight;
    const fitZoom = Math.min(scaleX, scaleY, 1); // 最大100%まで

    setLayoutZoom(Math.max(0.25, Math.floor(fitZoom * 20) / 20)); // 5%刻みで切り捨て
  }, [activeLayout]);

  // 画像を画面内に収めるための自動ズーム計算（トリミングモード）
  const calculateCropFitZoom = useCallback(() => {
    if (!layoutContainerRef.current || !cropImageSize) return;

    const container = layoutContainerRef.current;
    const containerWidth = container.clientWidth - 32;
    const containerHeight = container.clientHeight - 80;

    const scaleX = containerWidth / cropImageSize.width;
    const scaleY = containerHeight / cropImageSize.height;
    const fitZoom = Math.min(scaleX, scaleY, 1);

    setCropZoom(Math.max(0.25, Math.floor(fitZoom * 20) / 20));
  }, [cropImageSize]);

  // レイアウトページ変更時に自動フィット
  useEffect(() => {
    if (mode === 'layout' && activeLayout) {
      calculateLayoutFitZoom();
    }
  }, [mode, activeLayout?.id, activeLayout?.paperSize, activeLayout?.orientation, calculateLayoutFitZoom]);

  // トリミング画像の読み込みとサイズ取得
  useEffect(() => {
    // 再トリミング時は元のページ画像を使用
    const imageData = reCropSourcePage?.imageData || activePage?.imageData;
    if (!imageData) {
      setCropImageSize(null);
      return;
    }

    const img = new Image();
    img.onload = () => {
      setCropImageSize({ width: img.width, height: img.height });
    };
    img.src = imageData;
  }, [activePage?.imageData, reCropSourcePage?.imageData]);

  // トリミング画像サイズ変更時に自動フィット
  useEffect(() => {
    if (mode === 'crop' && cropImageSize) {
      calculateCropFitZoom();
    }
  }, [mode, cropImageSize, calculateCropFitZoom]);

  // ウィンドウリサイズ時に再計算
  useEffect(() => {
    const handleResize = () => {
      if (mode === 'layout') {
        calculateLayoutFitZoom();
      } else if (mode === 'crop') {
        calculateCropFitZoom();
      }
    };

    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, [mode, calculateLayoutFitZoom, calculateCropFitZoom]);

  // 再トリミングモード開始時に自動でトリミングモードに切り替え
  useEffect(() => {
    if (reCropSnippetId) {
      // 現在のレイアウトページIDとスクロール位置を記憶（再トリミング完了後に戻るため）
      reCropSourceLayoutPageIdRef.current = activeLayoutPageId;
      if (layoutContainerRef.current) {
        reCropSourceScrollTopRef.current = layoutContainerRef.current.scrollTop;
      }

      // トリミングモードに切り替え
      // 注: reCropSourcePageはスニペットのsourceFileId/sourcePageNumberから直接取得するため、
      // setActivePage/setActiveFileは呼ばない（PDFのページ選択状態を変えない）
      setMode('crop');

      // スクロール位置を上部にリセット（再トリミング画面を上部に表示）
      if (layoutContainerRef.current) {
        layoutContainerRef.current.scrollTop = 0;
      }
    }
  }, [reCropSnippetId, activeLayoutPageId]);

  const handleAddPage = () => {
    addLayoutPage(newPageSize, newPageOrientation);
  };

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.25, 3));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.25));

  // テンプレート関連
  const handleApplyLastTemplate = useCallback(() => {
    if (!activeFileId) return;
    const result = getLatestTemplateAny(activeFileId, activePageNumber);
    if (result) {
      setPendingTemplate(result.template);
    }
  }, [activeFileId, activePageNumber]);

  const handleApplyTemplate = useCallback((template: CropTemplate) => {
    setPendingTemplate(template);
    setShowTemplateHistory(false);
  }, []);

  // 現在のスコープに基づくテンプレート履歴取得
  const getTemplateHistory = useCallback((): CropTemplate[] => {
    if (!activeFileId) return [];
    switch (templateScope) {
      case 'page':
        return getTemplates('page', activeFileId, activePageNumber);
      case 'file':
        return getTemplates('file', activeFileId);
      case 'global':
      default:
        return getTemplates('global');
    }
  }, [templateScope, activeFileId, activePageNumber]);

  const templateHistory = getTemplateHistory();

  // BATCH-002: 一括トリミング
  const handleBatchCrop = useCallback(async (cropArea: CropArea) => {
    if (!activeFile || selectedPageNumbers.length === 0) return;

    setIsBatchProcessing(true);

    try {
      for (const pageNumber of selectedPageNumbers) {
        const page = activeFile.pages.find((p) => p.pageNumber === pageNumber);
        if (!page?.imageData) continue;

        // 画像を切り出し
        const canvas = document.createElement('canvas');
        const ctx = canvas.getContext('2d');
        if (!ctx) continue;

        const img = new Image();
        await new Promise<void>((resolve, reject) => {
          img.onload = () => resolve();
          img.onerror = () => reject();
          img.src = page.imageData!;
        });

        canvas.width = cropArea.width;
        canvas.height = cropArea.height;

        ctx.drawImage(
          img,
          cropArea.x,
          cropArea.y,
          cropArea.width,
          cropArea.height,
          0,
          0,
          cropArea.width,
          cropArea.height
        );

        const croppedImageData = canvas.toDataURL('image/png');

        addSnippet({
          sourceFileId: activeFile.id,
          sourcePageNumber: pageNumber,
          cropArea,
          imageData: croppedImageData,
          cropZoom, // 修正: cropZoomプロパティを追加
        });
      }
    } finally {
      setIsBatchProcessing(false);
    }
  }, [activeFile, selectedPageNumbers, addSnippet, cropZoom]); // 修正: 依存配列にcropZoomを追加

  // 自動全詰め処理（トリミング後に実行）
  const handleAutoRepack = useCallback(() => {
    if (!autoRepack || !activeLayoutPageId) return;
    repackAllSnippets(activeLayoutPageId);
  }, [autoRepack, activeLayoutPageId, repackAllSnippets]);


  // PDF出力
  const handleExportPDF = useCallback(async () => {
    if (layoutPages.length === 0) return;

    setIsExporting(true);
    try {
      const blob = await exportLayoutToPDF(layoutPages, snippets, pdfQuality, settings.imageEnhancement, settings);
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `layout_${new Date().toISOString().slice(0, 10)}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    } catch (error) {
      console.error('PDF出力エラー:', error);
      alert('PDF出力に失敗しました');
    } finally {
      setIsExporting(false);
    }
  }, [layoutPages, snippets, pdfQuality, settings.imageEnhancement]);

  // 直接印刷
  const handlePrint = useCallback(async () => {
    if (layoutPages.length === 0) return;

    setIsPrinting(true);
    try {
      await printLayoutDirectly(layoutPages, snippets, settings.imageEnhancement, settings);
    } catch (error) {
      console.error('印刷エラー:', error);
      alert('印刷の準備に失敗しました');
    } finally {
      setIsPrinting(false);
    }
  }, [layoutPages, snippets, settings.imageEnhancement]);

  // 補正プレビュー生成
  const generateEnhancementPreview = useCallback(async () => {
    if (snippets.length === 0) return;

    // 最初のスニペットをプレビュー対象に
    const firstSnippet = snippets[0];
    const originalImage = firstSnippet.imageData;

    // Canvasに画像を描画して補正を適用
    const img = new Image();
    img.onload = () => {
      const canvas = document.createElement('canvas');
      canvas.width = img.width;
      canvas.height = img.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) return;

      ctx.drawImage(img, 0, 0);

      // 補正を適用
      const enhancedCanvas = applyImageEnhancement(canvas, settings.imageEnhancement);
      const enhancedImage = enhancedCanvas.toDataURL('image/png');

      setPreviewImage({
        original: originalImage,
        enhanced: enhancedImage,
      });
    };
    img.src = originalImage;
  }, [snippets, settings.imageEnhancement]);

  // プレビュー表示時に画像生成
  useEffect(() => {
    if (showEnhancementPreview && snippets.length > 0) {
      generateEnhancementPreview();
    }
  }, [showEnhancementPreview, generateEnhancementPreview, snippets.length]);

  return (
    <div className="h-full flex flex-col gap-2">
      {/* ===== ツールバー上段: 基本設定 ===== */}
      <div className="bg-white rounded-lg shadow px-2 md:px-4 py-2 flex items-center gap-2 md:gap-4 flex-wrap">
        {/* モード切り替え */}
        <div className="flex bg-gray-200 rounded-lg p-1">
          <button
            className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${
              mode === 'crop'
                ? 'bg-blue-500 text-white shadow-md'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
            onClick={() => setMode('crop')}
          >
            トリミング
          </button>
          <button
            className={`px-4 py-2 rounded-md text-sm font-bold transition-all ${
              mode === 'layout'
                ? 'bg-blue-500 text-white shadow-md'
                : 'text-gray-600 hover:bg-gray-100'
            }`}
            onClick={() => setMode('layout')}
          >
            配置
          </button>
        </div>

        <div className="w-px h-8 bg-gray-300" />

        {/* 書字方向（目立つトグル） */}
        <div className="flex items-center gap-2 px-3 py-1.5 bg-amber-50 border-2 border-amber-400 rounded-lg">
          <span className="text-sm font-bold text-amber-800">書字方向:</span>
          <div className="flex bg-amber-200 rounded p-0.5">
            <button
              className={`px-3 py-1 text-sm font-bold rounded transition-all ${
                settings.writingDirection === 'vertical'
                  ? 'bg-amber-500 text-white shadow'
                  : 'text-amber-700 hover:bg-amber-300'
              }`}
              onClick={() => {
                updateSettings({ writingDirection: 'vertical', layoutAnchor: 'right-top' });
                setNewPageSize('A3');
                setNewPageOrientation('landscape');
              }}
            >
              縦書き
            </button>
            <button
              className={`px-3 py-1 text-sm font-bold rounded transition-all ${
                settings.writingDirection === 'horizontal'
                  ? 'bg-amber-500 text-white shadow'
                  : 'text-amber-700 hover:bg-amber-300'
              }`}
              onClick={() => {
                updateSettings({ writingDirection: 'horizontal', layoutAnchor: 'left-top' });
                setNewPageSize('A4');
                setNewPageOrientation('portrait');
              }}
            >
              横書き
            </button>
          </div>
        </div>

        {/* テンプレート（トリミングモード時のみ） */}
        {mode === 'crop' && (
          <>
            <div className="w-px h-8 bg-gray-300" />
            <div className="flex items-center gap-2 px-2 py-1 bg-gray-50 rounded border">
              <span className="text-xs text-gray-500">テンプレ:</span>
              <select
                className="border rounded px-1 py-0.5 text-xs"
                value={templateScope}
                onChange={(e) => setTemplateScope(e.target.value as TemplateScope)}
              >
                <option value="global">全体</option>
                <option value="file">ファイル</option>
                <option value="page">ページ</option>
              </select>
              <button
                className="flex items-center gap-1 px-2 py-1 text-xs border rounded hover:bg-gray-100"
                onClick={handleApplyLastTemplate}
                title="前回のテンプレートを適用"
              >
                <RotateCcw className="w-3 h-3" />
                前回
              </button>
              <div className="relative">
                <button
                  className="flex items-center gap-1 px-2 py-1 text-xs border rounded hover:bg-gray-100"
                  onClick={() => setShowTemplateHistory(!showTemplateHistory)}
                  title="テンプレート履歴"
                >
                  <History className="w-3 h-3" />
                  履歴
                </button>
                {showTemplateHistory && templateHistory.length > 0 && (
                  <div className="absolute top-full left-0 mt-1 bg-white border rounded shadow-lg z-20 min-w-[150px]">
                    {templateHistory.map((t, i) => (
                      <button
                        key={i}
                        className="w-full text-left px-3 py-2 text-xs hover:bg-gray-100 border-b last:border-b-0"
                        onClick={() => handleApplyTemplate(t)}
                      >
                        {Math.round(t.width)} × {Math.round(t.height)}
                      </button>
                    ))}
                  </div>
                )}
                {showTemplateHistory && templateHistory.length === 0 && (
                  <div className="absolute top-full left-0 mt-1 bg-white border rounded shadow-lg z-20 p-2 text-xs text-gray-500">
                    履歴なし
                  </div>
                )}
              </div>
            </div>
          </>
        )}

        <div className="flex-1" />

        {/* ズーム */}
        <div className="flex items-center gap-1">
          <button className="toolbar-button" onClick={handleZoomOut} aria-label="縮小">
            <ZoomOut className="w-4 h-4" />
          </button>
          <span className="text-sm min-w-[3rem] text-center">{Math.round(zoom * 100)}%</span>
          <button className="toolbar-button" onClick={handleZoomIn} aria-label="拡大">
            <ZoomIn className="w-4 h-4" />
          </button>
          <button
            className="px-2 py-1 text-xs border rounded hover:bg-gray-50"
            onClick={mode === 'layout' ? calculateLayoutFitZoom : calculateCropFitZoom}
          >
            フィット
          </button>
        </div>

        <div className="w-px h-8 bg-gray-300" />

        {/* グリッド */}
        <button
          className={`toolbar-button ${settings.showGrid ? 'active' : ''}`}
          onClick={() => updateSettings({ showGrid: !settings.showGrid })}
          title="グリッド表示"
        >
          <Grid className="w-5 h-5" />
        </button>

        {/* 縁取り */}
        <button
          className={`px-2 py-1.5 text-sm rounded font-medium ${
            settings.showSnippetBorder ? 'bg-gray-800 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
          }`}
          onClick={() => updateSettings({ showSnippetBorder: !settings.showSnippetBorder })}
          title="スニペットに黒い縁取りを追加"
        >
          縁取り
        </button>

        <div className="w-px h-8 bg-gray-300" />

        {/* 画像補正ボタン */}
        {(() => {
          const e = settings.imageEnhancement;
          const isActive =
            (e?.textDarkness ?? 1.0) !== 1.0 ||
            (e?.contrast ?? 1.0) !== 1.0 ||
            (e?.brightness ?? 1.0) !== 1.0 ||
            e?.autoLevels || e?.unsharpMask || e?.grayscale;
          return (
            <button
              className={`px-3 py-1.5 text-sm rounded font-medium ${
                isActive ? 'bg-orange-500 text-white' : 'bg-gray-200 text-gray-700 hover:bg-gray-300'
              }`}
              onClick={() => setShowEnhancementPreview(true)}
              title="画像補正設定"
            >
              補正{isActive && ' ●'}
            </button>
          );
        })()}

        {/* PDF出力 & 印刷 */}
        <div className="flex items-center gap-1">
          <select
            className="border rounded px-1 py-1 text-xs"
            value={pdfQuality}
            onChange={(e) => setPdfQuality(e.target.value as PdfQuality)}
            title="PDF画質設定"
          >
            <option value="maximum">最高画質</option>
            <option value="high">高画質</option>
            <option value="standard">標準</option>
            <option value="light">軽量</option>
          </select>
          <button
            className="flex items-center gap-1 px-4 py-2 bg-green-500 text-white font-bold rounded hover:bg-green-600 disabled:opacity-50"
            disabled={layoutPages.length === 0 || isExporting}
            onClick={handleExportPDF}
          >
            <Download className="w-4 h-4" />
            {isExporting ? '出力中...' : 'PDF出力'}
          </button>
          <button
            className="flex items-center gap-1 px-4 py-2 bg-purple-500 text-white font-bold rounded hover:bg-purple-600 disabled:opacity-50"
            disabled={layoutPages.length === 0 || isPrinting}
            onClick={handlePrint}
            title="PDFを生成せずに直接印刷"
          >
            <Printer className="w-4 h-4" />
            {isPrinting ? '準備中...' : '印刷'}
          </button>
        </div>
      </div>

      {/* ===== ツールバー下段: 配置モード用ツール ===== */}
      {mode === 'layout' && (
        <div className="bg-white rounded-lg shadow px-2 md:px-4 py-2 flex items-center gap-2 md:gap-3 flex-wrap text-xs md:text-sm">
          {/* ★ 余白・間隔グループ */}
          {activeLayout && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-indigo-50 rounded-lg border-2 border-indigo-300">
              {/* 余白 */}
              <div className="flex items-center gap-1">
                <span className="text-xs text-indigo-600">余白:</span>
                <button className="p-0.5 border border-indigo-300 rounded hover:bg-indigo-100" onClick={() => updateLayoutPageMarginX(activeLayout.id, Math.max(0, (activeLayout.marginX ?? 15) - 5))}>
                  <ChevronLeft className="w-3 h-3 text-indigo-600" />
                </button>
                <span className="text-xs w-4 text-center text-indigo-700">{activeLayout.marginX ?? 15}</span>
                <button className="p-0.5 border border-indigo-300 rounded hover:bg-indigo-100" onClick={() => updateLayoutPageMarginX(activeLayout.id, (activeLayout.marginX ?? 15) + 5)}>
                  <ChevronRight className="w-3 h-3 text-indigo-600" />
                </button>
                <span className="text-indigo-300">/</span>
                <button className="p-0.5 border border-indigo-300 rounded hover:bg-indigo-100" onClick={() => updateLayoutPageMarginY(activeLayout.id, Math.max(0, (activeLayout.marginY ?? 15) - 5))}>
                  <ChevronUp className="w-3 h-3 text-indigo-600" />
                </button>
                <span className="text-xs w-4 text-center text-indigo-700">{activeLayout.marginY ?? 15}</span>
                <button className="p-0.5 border border-indigo-300 rounded hover:bg-indigo-100" onClick={() => updateLayoutPageMarginY(activeLayout.id, (activeLayout.marginY ?? 15) + 5)}>
                  <ChevronDown className="w-3 h-3 text-indigo-600" />
                </button>
              </div>
              {activeLayout.snippets.length > 0 && (
                <>
                  <span className="text-indigo-300">|</span>
                  {/* 間隔 */}
                  <div className="flex items-center gap-1">
                    <span className="text-xs text-indigo-600">間隔:</span>
                    <button className="p-0.5 border border-indigo-300 rounded hover:bg-indigo-100" onClick={() => { const g = pageGapX - 10; setPageGapX(g); adjustPageSnippetsGap(activeLayout.id, g, pageGapY); }}>
                      <ChevronLeft className="w-3 h-3 text-indigo-600" />
                    </button>
                    <span className="text-xs w-6 text-center text-indigo-700">{pageGapX}</span>
                    <button className="p-0.5 border border-indigo-300 rounded hover:bg-indigo-100" onClick={() => { const g = pageGapX + 10; setPageGapX(g); adjustPageSnippetsGap(activeLayout.id, g, pageGapY); }}>
                      <ChevronRight className="w-3 h-3 text-indigo-600" />
                    </button>
                    <span className="text-indigo-300">/</span>
                    <button className="p-0.5 border border-indigo-300 rounded hover:bg-indigo-100" onClick={() => { const g = pageGapY - 10; setPageGapY(g); adjustPageSnippetsGap(activeLayout.id, pageGapX, g); }}>
                      <ChevronUp className="w-3 h-3 text-indigo-600" />
                    </button>
                    <span className="text-xs w-6 text-center text-indigo-700">{pageGapY}</span>
                    <button className="p-0.5 border border-indigo-300 rounded hover:bg-indigo-100" onClick={() => { const g = pageGapY + 10; setPageGapY(g); adjustPageSnippetsGap(activeLayout.id, pageGapX, g); }}>
                      <ChevronDown className="w-3 h-3 text-indigo-600" />
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* 詰めるグループ */}
          {activeLayout && activeLayout.snippets.length > 0 && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-purple-50 rounded-lg border-2 border-purple-300">
              <span className="text-xs text-purple-700 font-bold">詰める</span>
              {/* スコープ選択 */}
              <div className="flex bg-purple-200 rounded p-0.5">
                <button
                  className={`px-2 py-0.5 text-xs font-medium rounded ${arrangeScope === 'page' ? 'bg-purple-500 text-white' : 'text-purple-700 hover:bg-purple-300'}`}
                  onClick={() => setArrangeScope('page')}
                  title="現在のページ内で詰める"
                >
                  ページ
                </button>
                <button
                  className={`px-2 py-0.5 text-xs font-medium rounded ${arrangeScope === 'all' ? 'bg-purple-500 text-white' : 'text-purple-700 hover:bg-purple-300'}`}
                  onClick={() => setArrangeScope('all')}
                  title="全ページを跨いで詰める"
                >
                  全体
                </button>
              </div>
              {/* グリッドパターン選択＋配置順プレビュー（全体モード時のみ表示） */}
              {arrangeScope === 'all' && (
                <>
                  <select
                    className="px-1 py-0.5 text-xs border rounded bg-white text-purple-700"
                    value={repackGrid}
                    onChange={(e) => setRepackGrid(e.target.value as typeof repackGrid)}
                    title="グリッドパターン（列×行）"
                  >
                    {Object.entries(REPACK_GRIDS).map(([key, { label }]) => (
                      <option key={key} value={key}>{label}</option>
                    ))}
                  </select>
                  <GridOrderPreview
                    cols={REPACK_GRIDS[repackGrid].cols}
                    rows={REPACK_GRIDS[repackGrid].rows}
                    isVertical={settings.writingDirection === 'vertical'}
                  />
                </>
              )}
              {/* 詰めるボタン */}
              <button
                className="px-3 py-1 text-xs bg-purple-500 text-white rounded font-bold hover:bg-purple-600"
                onClick={() => {
                  if (arrangeScope === 'all') {
                    const { cols, rows } = REPACK_GRIDS[repackGrid];
                    repackAcrossPages(cols, rows);
                  } else {
                    repackAllSnippets(activeLayout.id);
                  }
                }}
                title={`${settings.writingDirection === 'vertical' ? '右上' : '左上'}基準で詰める（${settings.writingDirection === 'vertical' ? '縦書き' : '横書き'}）`}
              >
                実行
              </button>
              {/* 自動トグル */}
              <button
                className={`px-2 py-1 text-xs rounded ${autoRepack ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-600'}`}
                onClick={() => setAutoRepack(!autoRepack)}
                title={autoRepack ? '自動詰め: オン（トリミング後に自動で詰める）' : '自動詰め: オフ'}
              >
                自動{autoRepack ? '✓' : ''}
              </button>
            </div>
          )}

          {/* 揃えグループ（サイズ・位置をまとめる） */}
          <div className="flex items-center gap-1 px-2 py-1 bg-blue-50 rounded border border-blue-200">
            <span className="text-xs text-blue-600 mr-1">揃え</span>
            <button
              className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
              onClick={() => activeLayout && selectedPlacedSnippet && applySnippetWidthToLayout(activeLayout.id, selectedPlacedSnippet.size.width)}
              disabled={!activeLayout || !selectedPlacedSnippet}
              title="幅を揃える"
            >
              幅
            </button>
            <button
              className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
              onClick={() => activeLayout && selectedPlacedSnippet && applySnippetHeightToLayout(activeLayout.id, selectedPlacedSnippet.size.height)}
              disabled={!activeLayout || !selectedPlacedSnippet}
              title="高さを揃える"
            >
              高さ
            </button>
            <span className="text-blue-300">|</span>
            <button
              className="px-2 py-1 text-xs bg-cyan-500 text-white rounded hover:bg-cyan-600 disabled:opacity-50"
              onClick={() => activeLayout && selectedPlacedSnippet && applySnippetXPositionToLayout(activeLayout.id, selectedPlacedSnippet.position.x)}
              disabled={!activeLayout || !selectedPlacedSnippet}
              title="横位置を揃える"
            >
              X位置
            </button>
            <button
              className="px-2 py-1 text-xs bg-cyan-500 text-white rounded hover:bg-cyan-600 disabled:opacity-50"
              onClick={() => activeLayout && selectedPlacedSnippet && applySnippetYPositionToLayout(activeLayout.id, selectedPlacedSnippet.position.y)}
              disabled={!activeLayout || !selectedPlacedSnippet}
              title="縦位置を揃える"
            >
              Y位置
            </button>
          </div>

          {/* 用紙グループ */}
          <div className="flex items-center gap-1 px-2 py-1 bg-gray-50 rounded border">
            <span className="text-xs text-gray-500 mr-1">用紙</span>
            <select
              className="border rounded px-1 py-0.5 text-sm"
              value={newPageSize}
              onChange={(e) => setNewPageSize(e.target.value as PaperSize)}
            >
              {Object.entries(PAPER_SIZES).map(([key]) => (
                <option key={key} value={key}>{key}</option>
              ))}
            </select>
            <select
              className="border rounded px-1 py-0.5 text-sm"
              value={newPageOrientation}
              onChange={(e) => setNewPageOrientation(e.target.value as PaperOrientation)}
            >
              <option value="portrait">縦</option>
              <option value="landscape">横</option>
            </select>
            <button
              className="flex items-center gap-1 px-2 py-1 bg-blue-500 text-white text-xs rounded hover:bg-blue-600"
              onClick={handleAddPage}
            >
              <Plus className="w-3 h-3" />
            </button>
          </div>

          {/* 追加グループ */}
          <div className="flex items-center gap-1 px-2 py-1 bg-gray-50 rounded border">
            <span className="text-xs text-gray-500 mr-1">追加</span>
            <button
              className="flex items-center gap-1 px-2 py-1 bg-gray-600 text-white text-xs rounded hover:bg-gray-700 disabled:opacity-50"
              onClick={() => activeLayoutPageId && addTextElement(activeLayoutPageId, { x: 50, y: 50 })}
              disabled={!activeLayoutPageId}
              title="テキスト"
            >
              <Type className="w-3 h-3" />
            </button>
            <button
              className="p-1 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50"
              onClick={() => activeLayoutPageId && addShapeElement(activeLayoutPageId, 'rectangle', { x: 50, y: 50 })}
              disabled={!activeLayoutPageId}
              title="四角形"
            >
              <Square className="w-3 h-3" />
            </button>
            <button
              className="p-1 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50"
              onClick={() => activeLayoutPageId && addShapeElement(activeLayoutPageId, 'circle', { x: 50, y: 50 })}
              disabled={!activeLayoutPageId}
              title="円"
            >
              <Circle className="w-3 h-3" />
            </button>
            <button
              className="p-1 bg-gray-600 text-white rounded hover:bg-gray-700 disabled:opacity-50"
              onClick={() => activeLayoutPageId && addShapeElement(activeLayoutPageId, 'line', { x: 50, y: 50 })}
              disabled={!activeLayoutPageId}
              title="線"
            >
              <Minus className="w-3 h-3" />
            </button>
          </div>

          {/* 全ページサイズ統一（スコープ:全体時のみ表示） */}
          {arrangeScope === 'all' && (
            <button
              className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
              onClick={() => unifyAllPagesSnippetSize()}
              title="全ページのスニペットサイズを統一"
            >
              全サイズ統一
            </button>
          )}

          {/* 選択時ツール（2個以上選択時） */}
          {activeLayout && selectedSnippetIds.length >= 2 && (
            <>
              <div className="w-px h-6 bg-gray-300" />
              <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded font-bold">
                {selectedSnippetIds.length}個選択
              </span>
              <div className="flex items-center gap-1">
                <button className="p-1 border rounded hover:bg-gray-50" onClick={() => alignSnippets(activeLayout.id, 'top')} title="上揃え">
                  <AlignStartVertical className="w-3 h-3" />
                </button>
                <button className="p-1 border rounded hover:bg-gray-50" onClick={() => alignSnippets(activeLayout.id, 'bottom')} title="下揃え">
                  <AlignEndVertical className="w-3 h-3" />
                </button>
                <button className="p-1 border rounded hover:bg-gray-50" onClick={() => alignSnippets(activeLayout.id, 'left')} title="左揃え">
                  <AlignStartHorizontal className="w-3 h-3" />
                </button>
                <button className="p-1 border rounded hover:bg-gray-50" onClick={() => alignSnippets(activeLayout.id, 'right')} title="右揃え">
                  <AlignEndHorizontal className="w-3 h-3" />
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button className="px-2 py-1 text-xs border rounded hover:bg-gray-50" onClick={() => unifySnippetSize(activeLayout.id, 'height')} title="高さ統一">
                  高さ
                </button>
                <button className="px-2 py-1 text-xs border rounded hover:bg-gray-50" onClick={() => unifySnippetSize(activeLayout.id, 'width')} title="幅統一">
                  幅
                </button>
              </div>
              <div className="flex items-center gap-1">
                <button className="px-2 py-1 text-xs bg-gray-200 rounded hover:bg-gray-300" onClick={() => packSnippets(activeLayout.id, 'horizontal')} title="横に詰める">
                  横詰め
                </button>
                <button className="px-2 py-1 text-xs bg-gray-200 rounded hover:bg-gray-300" onClick={() => packSnippets(activeLayout.id, 'vertical')} title="縦に詰める">
                  縦詰め
                </button>
              </div>
            </>
          )}

          {/* テキスト選択時 */}
          {activeLayout && selectedTextElement && (
            <>
              <div className="w-px h-6 bg-gray-300" />
              <span className="text-xs bg-green-100 text-green-800 px-2 py-1 rounded">テキスト選択中</span>
              <div className="flex items-center gap-1 bg-green-50 px-2 py-1 rounded border border-green-200">
                <button className="px-2 py-0.5 text-sm bg-green-500 text-white rounded" onClick={() => updateTextElement(activeLayout.id, selectedTextElement.id, { fontSize: Math.max(8, selectedTextElement.fontSize - 2) })}>-</button>
                <span className="text-xs w-10 text-center">{selectedTextElement.fontSize}px</span>
                <button className="px-2 py-0.5 text-sm bg-green-500 text-white rounded" onClick={() => updateTextElement(activeLayout.id, selectedTextElement.id, { fontSize: selectedTextElement.fontSize + 2 })}>+</button>
                <div className="w-px h-4 bg-green-300 mx-1" />
                <button
                  className={`px-2 py-0.5 text-xs rounded ${selectedTextElement.writingMode === 'vertical' ? 'bg-green-600 text-white' : 'bg-white border'}`}
                  onClick={() => updateTextElement(activeLayout.id, selectedTextElement.id, { writingMode: 'vertical' })}
                >縦</button>
                <button
                  className={`px-2 py-0.5 text-xs rounded ${selectedTextElement.writingMode === 'horizontal' ? 'bg-green-600 text-white' : 'bg-white border'}`}
                  onClick={() => updateTextElement(activeLayout.id, selectedTextElement.id, { writingMode: 'horizontal' })}
                >横</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* トリミングモード時は下段なし */}

      {/* メインエリア */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* スニペットリスト */}
        <SnippetList />

        {/* ページサムネイル（トリミングモード時のみ） */}
        {mode === 'crop' && activeFile && (
          <PageThumbnails file={activeFile} multiSelectMode={true} />
        )}

        {/* ワークエリア */}
        <div
          ref={layoutContainerRef}
          className="flex-1 bg-gray-200 rounded-lg overflow-auto p-4 relative"
        >
          {/* 一括処理中のオーバーレイ */}
          {isBatchProcessing && (
            <div className="absolute inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
              <div className="bg-white p-4 rounded-lg shadow-lg text-center">
                <div className="animate-spin w-8 h-8 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-2"></div>
                <p>一括トリミング中...</p>
                <p className="text-sm text-gray-500">{selectedPageNumbers.length}ページ処理中</p>
              </div>
            </div>
          )}

          {mode === 'crop' ? (
            // P3-001: トリミング機能 + BATCH-002: 一括トリミング
            reCropSnippet ? (
              // 再トリミングモード
              <div className="space-y-2">
                <div className="bg-green-100 border border-green-300 rounded-lg p-2 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="w-5 h-5 text-green-600" />
                    <span className="text-green-800 font-medium">
                      再トリミングモード
                    </span>
                    <span className="text-green-600 text-sm">
                      （元のページから再トリミング → 配置済みも更新）
                    </span>
                  </div>
                  <button
                    className="px-2 py-1 text-sm bg-gray-200 rounded hover:bg-gray-300"
                    onClick={() => {
                      setReCropSnippet(null);
                      setMode('layout'); // キャンセル時も配置モードに戻る
                      // 元のレイアウトページとスクロール位置に戻る
                      if (reCropSourceLayoutPageIdRef.current) {
                        setActiveLayoutPage(reCropSourceLayoutPageIdRef.current);
                        reCropSourceLayoutPageIdRef.current = null;
                      }
                      // スクロール位置を復元（少し遅延させてDOM更新後に実行）
                      setTimeout(() => {
                        if (layoutContainerRef.current) {
                          layoutContainerRef.current.scrollTop = reCropSourceScrollTopRef.current;
                        }
                      }, 50);
                    }}
                  >
                    キャンセル
                  </button>
                </div>
                {reCropSourcePage?.imageData ? (
                  <CropTool
                    imageData={reCropSourcePage.imageData}
                    sourceFileId={reCropSnippet.sourceFileId}
                    sourcePageNumber={reCropSnippet.sourcePageNumber}
                    zoom={zoom}
                    templateScope={templateScope}
                    templateToApply={pendingTemplate}
                    onTemplateApplied={() => setPendingTemplate(null)}
                    batchMode={false}
                    onCropComplete={() => {
                      const sourceLayoutPageId = reCropSourceLayoutPageIdRef.current;
                      const sourceScrollTop = reCropSourceScrollTopRef.current;
                      setReCropSnippet(null);
                      setMode('layout'); // 再トリミング完了後、配置モードに戻る
                      // 元のレイアウトページに戻る
                      if (sourceLayoutPageId) {
                        setActiveLayoutPage(sourceLayoutPageId);
                        reCropSourceLayoutPageIdRef.current = null;
                      }
                      // 全詰め → 間隔調整を実行（サイズ統一は行わない）
                      const targetPageId = sourceLayoutPageId || activeLayoutPageId;
                      setTimeout(() => {
                        // targetPageIdを直接使用（handleAutoRepackのクロージャ問題を回避）
                        if (autoRepack && targetPageId) {
                          repackAllSnippets(targetPageId);
                          // 全詰め後にUIで設定した間隔で詰め直す（マイナス値で重ねて余白を相殺）
                          setTimeout(() => {
                            adjustPageSnippetsGap(targetPageId, pageGapX, pageGapY);
                          }, 50);
                        }
                        // スクロール位置を復元
                        setTimeout(() => {
                          if (layoutContainerRef.current) {
                            layoutContainerRef.current.scrollTop = sourceScrollTop;
                          }
                        }, 100);
                      }, 100);
                    }}
                    updateSnippetId={reCropSnippetId}
                    initialCropArea={reCropSnippet.cropArea}
                  />
                ) : (
                  <div className="text-center text-red-500 py-4">
                    元のページ画像が見つかりません。PDFファイルを再度読み込んでください。
                  </div>
                )}
              </div>
            ) : activePage?.imageData ? (
              <div className="space-y-2">
                {/* 選択ページ数の表示と一括適用ボタン */}
                {selectedPageNumbers.length > 1 && (
                  <div className="bg-blue-100 border border-blue-300 rounded-lg p-2 flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <Layers className="w-5 h-5 text-blue-600" />
                      <span className="text-blue-800 font-medium">
                        {selectedPageNumbers.length}ページ選択中
                      </span>
                      <span className="text-blue-600 text-sm">
                        （最初のページで範囲を指定→全ページに適用）
                      </span>
                    </div>
                  </div>
                )}
                <CropTool
                  imageData={activePage.imageData}
                  sourceFileId={activeFileId || ''}
                  sourcePageNumber={activePageNumber}
                  zoom={zoom}
                  templateScope={templateScope}
                  templateToApply={pendingTemplate}
                  onTemplateApplied={() => setPendingTemplate(null)}
                  batchMode={selectedPageNumbers.length > 1}
                  onBatchCrop={handleBatchCrop}
                  onCropComplete={() => {
                    // 自動全詰めのみ実行（サイズ統一は行わない - 各スニペットのアスペクト比を維持）
                    setTimeout(() => {
                      handleAutoRepack();
                    }, 100);
                  }}
                />
              </div>
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500">
                左のサイドバーからPDFを選択してください
              </div>
            )
          ) : (
            // P3-002: 再配置エディタ
            <div className="w-full space-y-4 flex flex-col items-center">
              {/* 表示モード切り替え & ページ情報 */}
              {layoutPages.length > 0 && (
                <div className="flex items-center gap-4 flex-wrap">
                  {/* 表示モード切り替え */}
                  <div className="flex items-center gap-1 bg-gray-100 rounded p-1">
                    <button
                      className={`px-2 py-1 text-xs rounded ${
                        layoutViewMode === 'continuous'
                          ? 'bg-blue-500 text-white'
                          : 'hover:bg-gray-200'
                      }`}
                      onClick={() => setLayoutViewMode('continuous')}
                    >
                      連続表示
                    </button>
                    <button
                      className={`px-2 py-1 text-xs rounded ${
                        layoutViewMode === 'tab'
                          ? 'bg-blue-500 text-white'
                          : 'hover:bg-gray-200'
                      }`}
                      onClick={() => setLayoutViewMode('tab')}
                    >
                      タブ表示
                    </button>
                  </div>

                  {/* タブ表示時のみページタブを表示 */}
                  {layoutViewMode === 'tab' && (
                    <div className="flex gap-2 flex-wrap">
                      {layoutPages.map((page, index) => (
                        <div
                          key={page.id}
                          role="tab"
                          tabIndex={0}
                          aria-selected={activeLayoutPageId === page.id}
                          className={`flex items-center gap-1 px-3 py-1 rounded cursor-pointer ${
                            activeLayoutPageId === page.id
                              ? 'bg-blue-500 text-white'
                              : 'bg-white hover:bg-gray-100'
                          }`}
                          onClick={() => setActiveLayoutPage(page.id)}
                          onKeyDown={(e) => e.key === 'Enter' && setActiveLayoutPage(page.id)}
                        >
                          <span>ページ {index + 1}</span>
                          <span className="text-xs opacity-75">
                            ({page.paperSize} {page.orientation === 'portrait' ? '縦' : '横'})
                          </span>
                          <button
                            className="ml-1 p-0.5 hover:bg-gray-200 rounded disabled:opacity-30"
                            onClick={(e) => {
                              e.stopPropagation();
                              moveLayoutPage(page.id, 'up');
                            }}
                            disabled={index === 0}
                            aria-label="ページを前に移動"
                          >
                            <ChevronLeft className="w-3 h-3" />
                          </button>
                          <button
                            className="p-0.5 hover:bg-gray-200 rounded disabled:opacity-30"
                            onClick={(e) => {
                              e.stopPropagation();
                              moveLayoutPage(page.id, 'down');
                            }}
                            disabled={index === layoutPages.length - 1}
                            aria-label="ページを後ろに移動"
                          >
                            <ChevronRight className="w-3 h-3" />
                          </button>
                          <button
                            className="ml-1 p-0.5 hover:bg-red-200 rounded"
                            onClick={(e) => {
                              e.stopPropagation();
                              removeLayoutPage(page.id);
                            }}
                            aria-label={`ページ${index + 1}を削除`}
                          >
                            <Trash2 className="w-3 h-3" />
                          </button>
                        </div>
                      ))}
                    </div>
                  )}

                  {/* 連続表示時のページ数表示 */}
                  {layoutViewMode === 'continuous' && (
                    <span className="text-sm text-gray-600">
                      {layoutPages.length}ページ
                    </span>
                  )}
                </div>
              )}

              {/* キャンバス */}
              {layoutPages.length > 0 ? (
                layoutViewMode === 'continuous' ? (
                  // 連続表示モード：全ページを縦に並べる
                  <div className="space-y-8">
                    {layoutPages.map((page, index) => {
                      const isActivePage = activeLayoutPageId === page.id;
                      return (
                        <div
                          key={page.id}
                          className={`relative cursor-pointer transition-all ${
                            isActivePage
                              ? 'ring-4 ring-blue-400 ring-offset-2 rounded'
                              : 'hover:ring-2 hover:ring-gray-300 hover:ring-offset-2 rounded'
                          }`}
                          onClick={() => setActiveLayoutPage(page.id)}
                        >
                          {/* ページ番号ラベル */}
                          <div className="absolute -top-6 left-0 flex items-center gap-2">
                            <span className={`text-sm font-medium ${isActivePage ? 'text-blue-600' : 'text-gray-600'}`}>
                              ページ {index + 1}
                              {isActivePage && ' (編集中)'}
                            </span>
                            <span className="text-xs text-gray-400">
                              ({page.paperSize} {page.orientation === 'portrait' ? '縦' : '横'})
                            </span>
                            <button
                              className="p-0.5 hover:bg-red-100 rounded text-red-500"
                              onClick={(e) => {
                                e.stopPropagation();
                                removeLayoutPage(page.id);
                              }}
                              title="ページを削除"
                            >
                              <Trash2 className="w-3 h-3" />
                            </button>
                          </div>
                          <LayoutCanvas
                            layoutPage={page}
                            snippets={snippets}
                            zoom={zoom}
                            showGrid={settings.showGrid}
                            gridSize={settings.gridSize}
                          />
                        </div>
                      );
                    })}
                  </div>
                ) : (
                  // タブ表示モード：選択されたページのみ
                  activeLayout ? (
                    <LayoutCanvas
                      layoutPage={activeLayout}
                      snippets={snippets}
                      zoom={zoom}
                      showGrid={settings.showGrid}
                      gridSize={settings.gridSize}
                    />
                  ) : (
                    <div className="h-full flex items-center justify-center text-gray-500">
                      <div className="text-center">
                        <p>ページを選択してください</p>
                      </div>
                    </div>
                  )
                )
              ) : (
                <div className="h-full flex items-center justify-center text-gray-500">
                  <div className="text-center">
                    <p>レイアウトページがありません</p>
                    <p className="text-sm mt-1">上の「新規ページ」ボタンで追加してください</p>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>

      {/* 補正設定モーダル */}
      {showEnhancementPreview && (
        <div className="fixed inset-0 bg-black bg-opacity-70 flex items-center justify-center z-50">
          <div className="bg-white rounded-lg shadow-2xl max-w-5xl max-h-[90vh] overflow-auto p-4">
            <div className="flex justify-between items-center mb-3">
              <h2 className="text-lg font-bold">画像補正</h2>
              <button
                className="px-3 py-1 bg-gray-200 rounded hover:bg-gray-300"
                onClick={() => { setShowEnhancementPreview(false); setPreviewImage(null); }}
              >
                閉じる
              </button>
            </div>

            {/* 補正設定UI */}
            {(() => {
              const e = settings.imageEnhancement;
              return (
                <div className="mb-4 p-3 bg-gray-50 rounded border space-y-3">
                  {/* スライダー */}
                  <div className="flex items-center gap-4 flex-wrap">
                    <div className="flex items-center gap-2">
                      <span className="text-sm w-16">文字濃さ</span>
                      <input type="range" min="0.3" max="1.5" step="0.1"
                        value={e?.textDarkness ?? 1.0}
                        onChange={(ev) => updateSettings({ imageEnhancement: { ...e, textDarkness: parseFloat(ev.target.value) }})}
                        className="w-24"
                      />
                      <span className={`text-sm w-8 ${(e?.textDarkness ?? 1.0) !== 1.0 ? 'font-bold text-purple-600' : ''}`}>
                        {e?.textDarkness?.toFixed(1) ?? '1.0'}
                      </span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm w-16">明るさ</span>
                      <input type="range" min="0.5" max="1.5" step="0.05"
                        value={e?.brightness ?? 1.0}
                        onChange={(ev) => updateSettings({ imageEnhancement: { ...e, brightness: parseFloat(ev.target.value) }})}
                        className="w-24"
                      />
                      <span className={`text-sm w-8 ${(e?.brightness ?? 1.0) !== 1.0 ? 'font-bold text-blue-600' : ''}`}>
                        {e?.brightness?.toFixed(1) ?? '1.0'}
                      </span>
                    </div>
                  </div>
                  {/* トグルボタン */}
                  <div className="flex items-center gap-2">
                    <button className={`px-3 py-1 text-sm rounded ${e?.autoLevels ? 'bg-yellow-500 text-white' : 'bg-gray-200'}`}
                      onClick={() => updateSettings({ imageEnhancement: { ...e, autoLevels: !e?.autoLevels }})}>自動レベル</button>
                    <button className={`px-3 py-1 text-sm rounded ${e?.unsharpMask ? 'bg-yellow-500 text-white' : 'bg-gray-200'}`}
                      onClick={() => updateSettings({ imageEnhancement: { ...e, unsharpMask: !e?.unsharpMask }})}>鮮明化</button>
                    <button className={`px-3 py-1 text-sm rounded ${e?.grayscale ? 'bg-yellow-500 text-white' : 'bg-gray-200'}`}
                      onClick={() => updateSettings({ imageEnhancement: { ...e, grayscale: !e?.grayscale }})}>グレースケール</button>
                    <button className="px-3 py-1 text-sm bg-gray-300 rounded hover:bg-gray-400"
                      onClick={() => updateSettings({ imageEnhancement: { contrast: 1.0, brightness: 1.0, textDarkness: 1.0, sharpness: false, autoLevels: false, unsharpMask: false, grayscale: false }})}>リセット</button>
                  </div>
                </div>
              );
            })()}

            {/* プレビュー */}
            {snippets.length > 0 ? (
              previewImage ? (
                <div className="flex gap-4">
                  <div className="flex-1">
                    <h3 className="text-sm text-gray-600 mb-1 text-center">補正前</h3>
                    <div className="border rounded p-1 bg-gray-50">
                      <img src={previewImage.original} alt="補正前" className="max-w-full max-h-[50vh] mx-auto" />
                    </div>
                  </div>
                  <div className="flex-1">
                    <h3 className="text-sm text-gray-600 mb-1 text-center">補正後</h3>
                    <div className="border-2 border-orange-400 rounded p-1 bg-orange-50">
                      <img src={previewImage.enhanced} alt="補正後" className="max-w-full max-h-[50vh] mx-auto" />
                    </div>
                  </div>
                </div>
              ) : (
                <div className="flex items-center justify-center h-48">
                  <div className="text-center">
                    <div className="animate-spin w-6 h-6 border-4 border-blue-500 border-t-transparent rounded-full mx-auto mb-2"></div>
                    <p className="text-sm">プレビュー生成中...</p>
                  </div>
                </div>
              )
            ) : (
              <div className="text-center text-gray-500 py-8">
                スニペットがありません。トリミングしてからプレビューを確認できます。
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
