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
    applySnippetSizeToLayout,
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
    arrangeAllSnippetsInGrid,
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
  const [gridPattern, setGridPattern] = useState<'4x2' | '4x3' | '3x2' | '2x2' | 'auto'>('4x2');
  const [gridGapX, setGridGapX] = useState(0); // グリッド配置の間隔（横）
  const [gridGapY, setGridGapY] = useState(0); // グリッド配置の間隔（縦）
  const [pdfQuality, setPdfQuality] = useState<PdfQuality>('standard'); // PDF出力画質
  const [isPrinting, setIsPrinting] = useState(false);

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

  // トリミング完了時の自動サイズ揃え処理
  const handleAutoUnifySize = useCallback(() => {
    if (!activeLayoutPageId) return;

    const activeLayout = layoutPages.find(p => p.id === activeLayoutPageId);
    if (!activeLayout || activeLayout.snippets.length < 2) return;

    // 最初のスニペットを基準にする
    const firstSnippet = activeLayout.snippets[0];

    if (settings.writingDirection === 'vertical') {
      // 縦書き → 高さを揃える
      applySnippetHeightToLayout(activeLayoutPageId, firstSnippet.size.height);
    } else {
      // 横書き → 幅を揃える
      applySnippetWidthToLayout(activeLayoutPageId, firstSnippet.size.width);
    }
  }, [activeLayoutPageId, layoutPages, settings.writingDirection, applySnippetHeightToLayout, applySnippetWidthToLayout]);

  // 自動全詰め処理（トリミング後に実行）
  const handleAutoRepack = useCallback(() => {
    if (!autoRepack || !activeLayoutPageId) return;
    const basis = settings.writingDirection === 'vertical' ? 'right-top' : 'left-top';
    repackAllSnippets(activeLayoutPageId, basis);
  }, [autoRepack, activeLayoutPageId, settings.writingDirection, repackAllSnippets]);

  // グリッドパターンの設定
  const GRID_PATTERNS: Record<string, { cols: number; rows: number; label: string }> = {
    '4x2': { cols: 4, rows: 2, label: '4×2' },
    '4x3': { cols: 4, rows: 3, label: '4×3' },
    '3x2': { cols: 3, rows: 2, label: '3×2' },
    '2x2': { cols: 2, rows: 2, label: '2×2' },
    'auto': { cols: 0, rows: 0, label: '自動' },
  };

  // スニペット数から最適なグリッドを自動判定
  const getAutoGrid = (count: number): { cols: number; rows: number } => {
    if (count <= 2) return { cols: 2, rows: 1 };
    if (count <= 4) return { cols: 2, rows: 2 };
    if (count <= 6) return { cols: 3, rows: 2 };
    if (count <= 8) return { cols: 4, rows: 2 };
    if (count <= 12) return { cols: 4, rows: 3 };
    return { cols: 4, rows: Math.ceil(count / 4) };
  };

  // 全て配置
  const handleArrangeAll = useCallback(() => {
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

    arrangeAllSnippetsInGrid(activeLayoutPageId, cols, rows, gridGapX, gridGapY);
  }, [activeLayoutPageId, snippets.length, gridPattern, gridGapX, gridGapY, arrangeAllSnippetsInGrid]);

  // PDF出力
  const handleExportPDF = useCallback(async () => {
    if (layoutPages.length === 0) return;

    setIsExporting(true);
    try {
      const blob = await exportLayoutToPDF(layoutPages, snippets, pdfQuality, settings.imageEnhancement);
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
      await printLayoutDirectly(layoutPages, snippets, settings.imageEnhancement);
    } catch (error) {
      console.error('印刷エラー:', error);
      alert('印刷の準備に失敗しました');
    } finally {
      setIsPrinting(false);
    }
  }, [layoutPages, snippets, settings.imageEnhancement]);

  return (
    <div className="h-full flex flex-col gap-2">
      {/* ===== ツールバー上段: 基本設定 ===== */}
      <div className="bg-white rounded-lg shadow px-4 py-2 flex items-center gap-4">
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
                updateSettings({ writingDirection: 'vertical' });
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
                updateSettings({ writingDirection: 'horizontal' });
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

        <div className="w-px h-8 bg-gray-300" />

        {/* 画像補正 */}
        <div className="flex items-center gap-1 px-2 py-1 bg-yellow-50 rounded border border-yellow-300">
          <span className="text-xs text-yellow-700 font-medium">補正</span>
          <div className="flex items-center gap-0.5">
            <span className="text-xs text-gray-500">濃</span>
            <input
              type="range"
              min="0.5"
              max="2.0"
              step="0.1"
              value={settings.imageEnhancement?.contrast ?? 1.0}
              onChange={(e) => updateSettings({
                imageEnhancement: {
                  ...settings.imageEnhancement,
                  contrast: parseFloat(e.target.value),
                },
              })}
              className="w-12 h-4"
              title={`コントラスト: ${settings.imageEnhancement?.contrast ?? 1.0}`}
            />
            <span className="text-xs w-6 text-center">{settings.imageEnhancement?.contrast?.toFixed(1) ?? '1.0'}</span>
          </div>
          <div className="flex items-center gap-0.5">
            <span className="text-xs text-gray-500">明</span>
            <input
              type="range"
              min="0.5"
              max="1.5"
              step="0.05"
              value={settings.imageEnhancement?.brightness ?? 1.0}
              onChange={(e) => updateSettings({
                imageEnhancement: {
                  ...settings.imageEnhancement,
                  brightness: parseFloat(e.target.value),
                },
              })}
              className="w-12 h-4"
              title={`明るさ: ${settings.imageEnhancement?.brightness ?? 1.0}`}
            />
            <span className="text-xs w-6 text-center">{settings.imageEnhancement?.brightness?.toFixed(2) ?? '1.00'}</span>
          </div>
          <button
            className={`px-1.5 py-0.5 text-xs rounded ${settings.imageEnhancement?.sharpness ? 'bg-yellow-500 text-white' : 'bg-gray-200'}`}
            onClick={() => updateSettings({
              imageEnhancement: {
                ...settings.imageEnhancement,
                sharpness: !settings.imageEnhancement?.sharpness,
              },
            })}
            title="シャープ化"
          >
            鮮明
          </button>
          <button
            className="px-1.5 py-0.5 text-xs bg-gray-300 rounded hover:bg-gray-400"
            onClick={() => updateSettings({
              imageEnhancement: {
                contrast: 1.0,
                brightness: 1.0,
                sharpness: false,
              },
            })}
            title="リセット"
          >
            ↺
          </button>
        </div>

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
        <div className="bg-white rounded-lg shadow px-4 py-2 flex items-center gap-3 flex-wrap">
          {/* すべて配置グループ */}
          {snippets.length > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 bg-orange-50 rounded border border-orange-200">
              <span className="text-xs text-orange-600 mr-1">配置</span>
              <select
                className="border rounded px-1 py-0.5 text-xs"
                value={gridPattern}
                onChange={(e) => setGridPattern(e.target.value as typeof gridPattern)}
              >
                {Object.entries(GRID_PATTERNS).map(([key, value]) => (
                  <option key={key} value={key}>{value.label}</option>
                ))}
              </select>
              <button className="p-0.5 border rounded hover:bg-gray-100" onClick={() => setGridGapX(gridGapX - 10)} title="横間隔を狭める">
                <ChevronLeft className="w-3 h-3" />
              </button>
              <span className="text-xs w-6 text-center">{gridGapX}</span>
              <button className="p-0.5 border rounded hover:bg-gray-100" onClick={() => setGridGapX(gridGapX + 10)} title="横間隔を広げる">
                <ChevronRight className="w-3 h-3" />
              </button>
              <span className="text-gray-300">/</span>
              <button className="p-0.5 border rounded hover:bg-gray-100" onClick={() => setGridGapY(gridGapY - 10)} title="縦間隔を狭める">
                <ChevronUp className="w-3 h-3" />
              </button>
              <span className="text-xs w-6 text-center">{gridGapY}</span>
              <button className="p-0.5 border rounded hover:bg-gray-100" onClick={() => setGridGapY(gridGapY + 10)} title="縦間隔を広げる">
                <ChevronDown className="w-3 h-3" />
              </button>
              <button
                className="px-2 py-1 text-xs bg-orange-500 text-white rounded hover:bg-orange-600 disabled:opacity-50"
                onClick={handleArrangeAll}
                disabled={!activeLayoutPageId}
                title="全スニペットをグリッド配置"
              >
                全て配置
              </button>
            </div>
          )}

          {/* 自動全詰めオン/オフ */}
          <div className="flex items-center gap-1 px-2 py-1 bg-gray-50 rounded border">
            <span className="text-xs text-gray-500 mr-1">自動詰め</span>
            <button
              className={`px-2 py-1 text-xs rounded ${autoRepack ? 'bg-green-500 text-white' : 'bg-gray-300 text-gray-600'}`}
              onClick={() => setAutoRepack(!autoRepack)}
              title={autoRepack ? '自動全詰め: オン' : '自動全詰め: オフ'}
            >
              {autoRepack ? 'ON' : 'OFF'}
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
              追加
            </button>
          </div>

          {/* 追加グループ */}
          <div className="flex items-center gap-1 px-2 py-1 bg-gray-50 rounded border">
            <span className="text-xs text-gray-500 mr-1">追加</span>
            <button
              className="flex items-center gap-1 px-2 py-1 bg-gray-600 text-white text-xs rounded hover:bg-gray-700 disabled:opacity-50"
              onClick={() => activeLayoutPageId && addTextElement(activeLayoutPageId, { x: 50, y: 50 })}
              disabled={!activeLayoutPageId}
              title="テキストを追加"
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

          {/* 余白グループ */}
          {activeLayout && (
            <div className="flex items-center gap-1 px-2 py-1 bg-gray-50 rounded border">
              <span className="text-xs text-gray-500 mr-1">余白</span>
              <button
                className="p-0.5 border rounded hover:bg-gray-100"
                onClick={() => updateLayoutPageMarginX(activeLayout.id, Math.max(0, (activeLayout.marginX ?? 15) - 5))}
              >
                <ChevronLeft className="w-3 h-3" />
              </button>
              <span className="text-xs w-4 text-center">{activeLayout.marginX ?? 15}</span>
              <button
                className="p-0.5 border rounded hover:bg-gray-100"
                onClick={() => updateLayoutPageMarginX(activeLayout.id, (activeLayout.marginX ?? 15) + 5)}
              >
                <ChevronRight className="w-3 h-3" />
              </button>
              <span className="text-gray-300 mx-0.5">/</span>
              <button
                className="p-0.5 border rounded hover:bg-gray-100"
                onClick={() => updateLayoutPageMarginY(activeLayout.id, Math.max(0, (activeLayout.marginY ?? 15) - 5))}
              >
                <ChevronUp className="w-3 h-3" />
              </button>
              <span className="text-xs w-4 text-center">{activeLayout.marginY ?? 15}</span>
              <button
                className="p-0.5 border rounded hover:bg-gray-100"
                onClick={() => updateLayoutPageMarginY(activeLayout.id, (activeLayout.marginY ?? 15) + 5)}
              >
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* サイズ揃えグループ */}
          <div className="flex items-center gap-1 px-2 py-1 bg-blue-50 rounded border border-blue-200">
            <span className="text-xs text-blue-600 mr-1">揃える</span>
            <button
              className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
              onClick={() => activeLayout && selectedPlacedSnippet && applySnippetWidthToLayout(activeLayout.id, selectedPlacedSnippet.size.width)}
              disabled={!activeLayout || !selectedPlacedSnippet}
              title="幅を揃える（選択基準）"
            >
              幅
            </button>
            <button
              className="px-2 py-1 text-xs bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
              onClick={() => activeLayout && selectedPlacedSnippet && applySnippetHeightToLayout(activeLayout.id, selectedPlacedSnippet.size.height)}
              disabled={!activeLayout || !selectedPlacedSnippet}
              title="高さを揃える（選択基準）"
            >
              高さ
            </button>
            <button
              className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50"
              onClick={() => activeLayout && selectedPlacedSnippet && applySnippetSizeToLayout(activeLayout.id, selectedPlacedSnippet.size)}
              disabled={!activeLayout || !selectedPlacedSnippet}
              title="サイズを揃える（選択基準）"
            >
              両方
            </button>
          </div>

          {/* 位置揃えグループ */}
          <div className="flex items-center gap-1 px-2 py-1 bg-cyan-50 rounded border border-cyan-200">
            <span className="text-xs text-cyan-600 mr-1">位置</span>
            <button
              className="px-2 py-1 text-xs bg-cyan-500 text-white rounded hover:bg-cyan-600 disabled:opacity-50"
              onClick={() => activeLayout && selectedPlacedSnippet && applySnippetXPositionToLayout(activeLayout.id, selectedPlacedSnippet.position.x)}
              disabled={!activeLayout || !selectedPlacedSnippet}
              title="横位置を揃える（選択基準）"
            >
              横
            </button>
            <button
              className="px-2 py-1 text-xs bg-cyan-500 text-white rounded hover:bg-cyan-600 disabled:opacity-50"
              onClick={() => activeLayout && selectedPlacedSnippet && applySnippetYPositionToLayout(activeLayout.id, selectedPlacedSnippet.position.y)}
              disabled={!activeLayout || !selectedPlacedSnippet}
              title="縦位置を揃える（選択基準）"
            >
              縦
            </button>
          </div>

          {/* 自動配置グループ */}
          {activeLayout && activeLayout.snippets.length > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 bg-purple-50 rounded border border-purple-200">
              <span className="text-xs text-purple-600 mr-1">配置</span>
              <button
                className="px-2 py-1 text-xs bg-purple-500 text-white rounded hover:bg-purple-600"
                onClick={() => repackAllSnippets(activeLayout.id, settings.writingDirection === 'vertical' ? 'right-top' : 'left-top')}
                title={settings.writingDirection === 'vertical' ? '右上から配置（縦書き）' : '左上から配置（横書き）'}
              >
                {settings.writingDirection === 'vertical' ? '右上' : '左上'}
              </button>
            </div>
          )}

          {/* 間隔グループ（マイナス対応で重ねも可能） */}
          {activeLayout && activeLayout.snippets.length > 0 && (
            <div className="flex items-center gap-1 px-2 py-1 bg-gray-50 rounded border">
              <span className="text-xs text-gray-500 mr-1">間隔</span>
              <button className="p-0.5 border rounded hover:bg-gray-100" onClick={() => { const g = pageGapX - 10; setPageGapX(g); adjustPageSnippetsGap(activeLayout.id, g, pageGapY); }}>
                <ChevronLeft className="w-3 h-3" />
              </button>
              <span className="text-xs w-6 text-center">{pageGapX}</span>
              <button className="p-0.5 border rounded hover:bg-gray-100" onClick={() => { const g = pageGapX + 10; setPageGapX(g); adjustPageSnippetsGap(activeLayout.id, g, pageGapY); }}>
                <ChevronRight className="w-3 h-3" />
              </button>
              <span className="text-gray-300 mx-0.5">/</span>
              <button className="p-0.5 border rounded hover:bg-gray-100" onClick={() => { const g = pageGapY - 10; setPageGapY(g); adjustPageSnippetsGap(activeLayout.id, pageGapX, g); }}>
                <ChevronUp className="w-3 h-3" />
              </button>
              <span className="text-xs w-6 text-center">{pageGapY}</span>
              <button className="p-0.5 border rounded hover:bg-gray-100" onClick={() => { const g = pageGapY + 10; setPageGapY(g); adjustPageSnippetsGap(activeLayout.id, pageGapX, g); }}>
                <ChevronDown className="w-3 h-3" />
              </button>
            </div>
          )}

          {/* 全ページ一括グループ */}
          <div className="flex items-center gap-1 px-2 py-1 bg-green-50 rounded border border-green-200">
            <span className="text-xs text-green-600 mr-1">全ページ</span>
            <button
              className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
              onClick={() => repackAcrossPages(settings.writingDirection === 'vertical' ? 'right-top' : 'left-top')}
              title="全ページを跨いで自動配置"
            >
              配置
            </button>
            <button
              className="px-2 py-1 text-xs bg-green-500 text-white rounded hover:bg-green-600"
              onClick={() => unifyAllPagesSnippetSize()}
              title="全ページのサイズを統一"
            >
              サイズ
            </button>
          </div>

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
                      // 自動サイズ揃え → 全詰め → 間隔調整を順番に実行
                      const targetPageId = sourceLayoutPageId || activeLayoutPageId;
                      setTimeout(() => {
                        handleAutoUnifySize();
                        // サイズ更新後に全詰め
                        setTimeout(() => {
                          handleAutoRepack();
                          // 全詰め後にUIで設定した間隔で詰め直す（マイナス値で重ねて余白を相殺）
                          if (autoRepack && targetPageId) {
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
                        }, 50);
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
                    // 自動サイズ揃え＆自動全詰め（少し遅延させてスニペット追加後に実行）
                    setTimeout(() => {
                      handleAutoUnifySize();
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
    </div>
  );
}
