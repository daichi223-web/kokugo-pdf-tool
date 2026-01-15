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
  Equal,
  Type,
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
import { exportLayoutToPDF } from '../utils/exportUtils';

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
    setActiveLayoutPage,
    updateSettings,
    selectedPageNumbers,
    addSnippet,
    applySnippetSizeToLayout,
    reCropSnippetId,
    setReCropSnippet,
    selectedSnippetIds,
    alignSnippets,
    unifySnippetSize,
    addTextElement,
  } = useAppStore();

  const [layoutZoom, setLayoutZoom] = useState(1);
  const [cropZoom, setCropZoom] = useState(1);
  const [mode, setMode] = useState<'crop' | 'layout'>('crop');

  // 現在のモードに応じたズーム値
  const zoom = mode === 'layout' ? layoutZoom : cropZoom;
  const setZoom = mode === 'layout' ? setLayoutZoom : setCropZoom;
  const [newPageSize, setNewPageSize] = useState<PaperSize>(
    settings.defaultPaperSize ?? 'A4'
  );
  const [newPageOrientation, setNewPageOrientation] = useState<PaperOrientation>(
    settings.defaultPaperOrientation ?? 'portrait'
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
  const selectedPlacedSnippet = activeLayout?.snippets.find(
    (snippet) => snippet.snippetId === selectedSnippetId
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
    const imageData = reCropSnippet?.imageData || activePage?.imageData;
    if (!imageData) {
      setCropImageSize(null);
      return;
    }

    const img = new Image();
    img.onload = () => {
      setCropImageSize({ width: img.width, height: img.height });
    };
    img.src = imageData;
  }, [activePage?.imageData, reCropSnippet?.imageData]);

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
        });
      }
    } finally {
      setIsBatchProcessing(false);
    }
  }, [activeFile, selectedPageNumbers, addSnippet]);

  // PDF出力
  const handleExportPDF = useCallback(async () => {
    if (layoutPages.length === 0) return;

    setIsExporting(true);
    try {
      const blob = await exportLayoutToPDF(layoutPages, snippets);
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
  }, [layoutPages, snippets]);

  return (
    <div className="h-full flex flex-col gap-4">
      {/* ツールバー */}
      <div className="toolbar rounded-lg shadow">
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

        <div className="w-px h-6 bg-gray-200" />

        {/* CROP-006: テンプレート管理（トリミングモード時のみ） */}
        {mode === 'crop' && (
          <>
            <div className="flex items-center gap-1">
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
            </div>

            <button
              className="flex items-center gap-1 px-2 py-1 text-xs border rounded hover:bg-gray-50"
              onClick={handleApplyLastTemplate}
              title="前回のテンプレートを適用"
            >
              <RotateCcw className="w-3 h-3" />
              前回適用
            </button>

            <div className="relative">
              <button
                className="flex items-center gap-1 px-2 py-1 text-xs border rounded hover:bg-gray-50"
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

            <div className="w-px h-6 bg-gray-200" />
          </>
        )}

        {/* P3-004: 用紙サイズ選択 */}
        {mode === 'layout' && (
          <>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={newPageSize}
              onChange={(e) => setNewPageSize(e.target.value as PaperSize)}
            >
              {Object.entries(PAPER_SIZES).map(([key, value]) => (
                <option key={key} value={key}>
                  {value.label}
                </option>
              ))}
            </select>
            <select
              className="border rounded px-2 py-1 text-sm"
              value={newPageOrientation}
              onChange={(e) => setNewPageOrientation(e.target.value as PaperOrientation)}
            >
              <option value="portrait">縦</option>
              <option value="landscape">横</option>
            </select>
            <button
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600"
              onClick={handleAddPage}
            >
              <Plus className="w-4 h-4" />
              新規ページ
            </button>

            <button
              className="flex items-center gap-1 px-3 py-1.5 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
              onClick={() => {
                if (activeLayoutPageId) {
                  addTextElement(activeLayoutPageId, { x: 50, y: 50 });
                }
              }}
              disabled={!activeLayoutPageId}
              title="縦書きテキストを追加"
            >
              <Type className="w-4 h-4" />
              テキスト
            </button>

            <div className="w-px h-6 bg-gray-200" />
          </>
        )}

        {/* P3-005: グリッド/ガイド表示 */}
        <button
          className={`toolbar-button ${settings.showGrid ? 'active' : ''}`}
          onClick={() => updateSettings({ showGrid: !settings.showGrid })}
          title="グリッド表示"
        >
          <Grid className="w-5 h-5" />
        </button>

        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.snapToGrid}
            onChange={(e) => updateSettings({ snapToGrid: e.target.checked })}
            className="rounded"
          />
          スナップ
        </label>

        {mode === 'layout' && (
          <>
            <div className="w-px h-6 bg-gray-200" />
            <button
              className="flex items-center gap-1 px-4 py-2 bg-orange-500 text-white font-bold rounded-md hover:bg-orange-600 disabled:opacity-50 disabled:bg-gray-300 shadow-sm"
              onClick={() => {
                if (activeLayout && selectedPlacedSnippet) {
                  applySnippetSizeToLayout(activeLayout.id, selectedPlacedSnippet.size);
                }
              }}
              disabled={!activeLayout || !selectedPlacedSnippet}
              title="選択中のスニペットサイズを全スニペットに適用"
            >
              サイズ一括適用
            </button>
          </>
        )}

        {/* 選択時のみ表示：整列・サイズ統一ツール */}
        {mode === 'layout' && activeLayout && selectedSnippetIds.length >= 2 && (
          <>
            <div className="w-px h-6 bg-gray-200" />

            {/* 選択数表示 */}
            <span className="text-xs bg-amber-100 text-amber-800 px-2 py-1 rounded">
              {selectedSnippetIds.length}個選択中
            </span>

            {/* 整列ボタン */}
            <div className="flex items-center gap-1">
              <button
                className="flex items-center gap-1 px-2 py-1 text-xs border rounded hover:bg-gray-50"
                onClick={() => alignSnippets(activeLayout.id, 'top')}
                title="上揃え"
              >
                <AlignStartVertical className="w-3 h-3" />
                上揃え
              </button>
              <button
                className="flex items-center gap-1 px-2 py-1 text-xs border rounded hover:bg-gray-50"
                onClick={() => alignSnippets(activeLayout.id, 'left')}
                title="左揃え"
              >
                <AlignStartHorizontal className="w-3 h-3" />
                左揃え
              </button>
            </div>

            <div className="w-px h-6 bg-gray-200" />

            {/* サイズ統一ボタン */}
            <div className="flex items-center gap-1">
              <button
                className="flex items-center gap-1 px-2 py-1 text-xs border rounded hover:bg-gray-50"
                onClick={() => unifySnippetSize(activeLayout.id, 'height')}
                title="高さを統一（最初の選択に合わせる）"
              >
                <Equal className="w-3 h-3 rotate-90" />
                高さ統一
              </button>
              <button
                className="flex items-center gap-1 px-2 py-1 text-xs border rounded hover:bg-gray-50"
                onClick={() => unifySnippetSize(activeLayout.id, 'width')}
                title="幅を統一（最初の選択に合わせる）"
              >
                <Equal className="w-3 h-3" />
                幅統一
              </button>
            </div>
          </>
        )}

        <div className="w-px h-6 bg-gray-200" />

        {/* ズーム */}
        <button className="toolbar-button" onClick={handleZoomOut} aria-label="縮小">
          <ZoomOut className="w-5 h-5" />
        </button>
        <span className="text-sm min-w-[4rem] text-center" aria-live="polite">
          {Math.round(zoom * 100)}%
        </span>
        <button className="toolbar-button" onClick={handleZoomIn} aria-label="拡大">
          <ZoomIn className="w-5 h-5" />
        </button>
        <button
          className="px-2 py-1 text-xs border rounded hover:bg-gray-50"
          onClick={mode === 'layout' ? calculateLayoutFitZoom : calculateCropFitZoom}
          title="画面に収める"
        >
          フィット
        </button>

        <div className="flex-1" />

        {/* P3-006: 印刷用PDF出力 */}
        <button
          className="flex items-center gap-1 px-3 py-1.5 bg-green-500 text-white rounded hover:bg-green-600 disabled:opacity-50"
          disabled={layoutPages.length === 0 || isExporting}
          onClick={handleExportPDF}
        >
          <Download className="w-4 h-4" />
          {isExporting ? '出力中...' : 'PDF出力'}
        </button>
      </div>

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
                      （スニペットをさらにトリミング）
                    </span>
                  </div>
                  <button
                    className="px-2 py-1 text-sm bg-gray-200 rounded hover:bg-gray-300"
                    onClick={() => setReCropSnippet(null)}
                  >
                    キャンセル
                  </button>
                </div>
                <CropTool
                  imageData={reCropSnippet.imageData}
                  sourceFileId={reCropSnippet.sourceFileId}
                  sourcePageNumber={reCropSnippet.sourcePageNumber}
                  zoom={zoom}
                  templateScope={templateScope}
                  templateToApply={pendingTemplate}
                  onTemplateApplied={() => setPendingTemplate(null)}
                  batchMode={false}
                  onCropComplete={() => setReCropSnippet(null)}
                />
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
              {/* レイアウトページタブ */}
              {layoutPages.length > 0 && (
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

              {/* キャンバス */}
              {activeLayout ? (
                <LayoutCanvas
                  layoutPage={activeLayout}
                  snippets={snippets}
                  zoom={zoom}
                  showGrid={settings.showGrid}
                  gridSize={settings.gridSize}
                  snapToGrid={settings.snapToGrid}
                />
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
