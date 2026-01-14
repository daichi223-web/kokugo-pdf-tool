// =============================================================================
// レイアウトビュー（トリミング・再配置）
// P3-001: トリミング機能
// P3-002: 再配置エディタ
// P3-004: 用紙サイズ選択
// P3-005: グリッド/ガイド表示
// P3-006: 印刷用PDF出力
// =============================================================================

import { useState } from 'react';
import {
  Plus,
  Download,
  Grid,
  Trash2,
  ZoomIn,
  ZoomOut,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { SnippetList } from './SnippetList';
import { LayoutCanvas } from './LayoutCanvas';
import { CropTool } from './CropTool';
import { PAPER_SIZES, type PaperSize } from '../types';

export function LayoutView() {
  const {
    files,
    activeFileId,
    activePageNumber,
    snippets,
    layoutPages,
    activeLayoutPageId,
    settings,
    addLayoutPage,
    removeLayoutPage,
    setActiveLayoutPage,
    updateSettings,
  } = useAppStore();

  const [zoom, setZoom] = useState(1);
  const [mode, setMode] = useState<'crop' | 'layout'>('crop');
  const [newPageSize, setNewPageSize] = useState<PaperSize>('A4');

  const activeFile = files.find((f) => f.id === activeFileId);
  const activePage = activeFile?.pages.find((p) => p.pageNumber === activePageNumber);
  const activeLayout = layoutPages.find((p) => p.id === activeLayoutPageId);

  const handleAddPage = () => {
    addLayoutPage(newPageSize);
  };

  const handleZoomIn = () => setZoom((z) => Math.min(z + 0.25, 3));
  const handleZoomOut = () => setZoom((z) => Math.max(z - 0.25, 0.25));

  return (
    <div className="h-full flex flex-col gap-4">
      {/* ツールバー */}
      <div className="toolbar rounded-lg shadow">
        {/* モード切り替え */}
        <div className="flex bg-gray-100 rounded p-0.5">
          <button
            className={`px-3 py-1 rounded text-sm ${
              mode === 'crop' ? 'bg-white shadow' : ''
            }`}
            onClick={() => setMode('crop')}
          >
            トリミング
          </button>
          <button
            className={`px-3 py-1 rounded text-sm ${
              mode === 'layout' ? 'bg-white shadow' : ''
            }`}
            onClick={() => setMode('layout')}
          >
            配置
          </button>
        </div>

        <div className="w-px h-6 bg-gray-200" />

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
            <button
              className="flex items-center gap-1 px-3 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600"
              onClick={handleAddPage}
            >
              <Plus className="w-4 h-4" />
              新規ページ
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

        <div className="flex-1" />

        {/* P3-006: 印刷用PDF出力 */}
        <button
          className="flex items-center gap-1 px-3 py-1.5 bg-green-500 text-white rounded hover:bg-green-600"
          disabled={layoutPages.length === 0}
        >
          <Download className="w-4 h-4" />
          PDF出力
        </button>
      </div>

      {/* メインエリア */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* スニペットリスト */}
        <SnippetList />

        {/* ワークエリア */}
        <div className="flex-1 bg-gray-200 rounded-lg overflow-auto p-4">
          {mode === 'crop' ? (
            // P3-001: トリミング機能
            activePage?.imageData ? (
              <CropTool
                imageData={activePage.imageData}
                sourceFileId={activeFileId || ''}
                sourcePageNumber={activePageNumber}
                zoom={zoom}
              />
            ) : (
              <div className="h-full flex items-center justify-center text-gray-500">
                左のサイドバーからPDFを選択してください
              </div>
            )
          ) : (
            // P3-002: 再配置エディタ
            <div className="space-y-4">
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
                      <span className="text-xs opacity-75">({page.paperSize})</span>
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
