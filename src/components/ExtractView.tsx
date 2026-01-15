// =============================================================================
// テキスト抽出ビュー
// P1-005: OCR編集画面（左右並列）
// OCR-LAYOUT: 縦書きレイアウト表示対応
// =============================================================================

import { useState, useMemo } from 'react';
import {
  Play,
  Download,
  Copy,
  FileText,
  Check,
  ChevronLeft,
  ChevronRight,
  Layers,
  AlignLeft,
  AlignJustify,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { PageThumbnails } from './PageThumbnails';
import { createVerticalLayout, layoutToHTML } from '../utils/ocrUtils';
import type { ExportFormat } from '../types';

export function ExtractView() {
  const {
    files,
    activeFileId,
    activePageNumber,
    setActivePage,
    updatePageText,
    startOCR,
    startOCRForPages,
    exportText,
    copyToClipboard,
    settings,
    updateSettings,
    selectedPageNumbers,
    clearPageSelection,
  } = useAppStore();

  const [copySuccess, setCopySuccess] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('txt');
  const [ocrSelectMode, setOcrSelectMode] = useState(false);
  const [layoutViewMode, setLayoutViewMode] = useState(false);  // 縦書きレイアウト表示モード

  const activeFile = files.find((f) => f.id === activeFileId);
  const activePage = activeFile?.pages.find((p) => p.pageNumber === activePageNumber);

  // OCRブロックからレイアウトHTMLを生成
  const layoutHTML = useMemo(() => {
    if (!activePage?.ocrBlocks || activePage.ocrBlocks.length === 0) {
      return null;
    }
    const layout = createVerticalLayout(
      { text: activePage.textContent || '', confidence: 0, blocks: activePage.ocrBlocks },
      activePage.width,
      activePage.height
    );
    return layoutToHTML(layout);
  }, [activePage?.ocrBlocks, activePage?.textContent, activePage?.width, activePage?.height]);

  if (!activeFile) {
    return (
      <div className="h-full flex items-center justify-center text-gray-500">
        <div className="text-center">
          <FileText className="w-12 h-12 mx-auto mb-2 text-gray-300" />
          <p>左のサイドバーからPDFファイルを追加してください</p>
        </div>
      </div>
    );
  }

  const handleCopy = async () => {
    if (activePage?.textContent) {
      await copyToClipboard(activePage.textContent);
      setCopySuccess(true);
      setTimeout(() => setCopySuccess(false), 2000);
    }
  };

  const handleExport = () => {
    if (activeFile) {
      exportText(activeFile.id, exportFormat);
    }
  };

  const handleTextChange = (text: string) => {
    if (activeFile && activePage) {
      updatePageText(activeFile.id, activePage.pageNumber, text);
    }
  };

  const goToPrevPage = () => {
    if (activePageNumber > 1) {
      setActivePage(activePageNumber - 1);
    }
  };

  const goToNextPage = () => {
    if (activeFile && activePageNumber < activeFile.pageCount) {
      setActivePage(activePageNumber + 1);
    }
  };

  return (
    <div className="h-full flex flex-col gap-4">
      {/* ツールバー */}
      <div className="toolbar rounded-lg shadow">
        {/* OCRページ選択モード切替 */}
        <button
          className={`flex items-center gap-1 px-3 py-1.5 rounded ${
            ocrSelectMode
              ? 'bg-purple-500 text-white hover:bg-purple-600'
              : 'border hover:bg-gray-50'
          }`}
          onClick={() => {
            if (ocrSelectMode) {
              clearPageSelection();
            }
            setOcrSelectMode(!ocrSelectMode);
          }}
          title="OCRするページを選択"
        >
          <Layers className="w-4 h-4" />
          ページ選択
        </button>

        {/* 選択中の表示 */}
        {ocrSelectMode && selectedPageNumbers.length > 0 && (
          <span className="text-sm text-purple-600 font-medium">
            {selectedPageNumbers.length}ページ選択中
          </span>
        )}

        {/* OCR実行 */}
        <button
          className="flex items-center gap-1 px-3 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600 disabled:opacity-50"
          onClick={() => {
            if (ocrSelectMode && selectedPageNumbers.length > 0) {
              startOCRForPages(activeFile.id, selectedPageNumbers);
              setOcrSelectMode(false);
              clearPageSelection();
            } else {
              startOCR(activeFile.id);
            }
          }}
          disabled={ocrSelectMode && selectedPageNumbers.length === 0}
        >
          <Play className="w-4 h-4" />
          {ocrSelectMode && selectedPageNumbers.length > 0
            ? `選択ページをOCR (${selectedPageNumbers.length})`
            : 'OCR実行（全ページ）'}
        </button>

        <div className="w-px h-6 bg-gray-200" />

        {/* P2-001: ルビ括弧表記オプション */}
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={settings.rubyBracketMode}
            onChange={(e) => updateSettings({ rubyBracketMode: e.target.checked })}
            className="rounded"
          />
          ルビ括弧表記
        </label>

        <div className="w-px h-6 bg-gray-200" />

        {/* P1-008: クリップボードコピー */}
        <button
          className="flex items-center gap-1 px-3 py-1.5 border rounded hover:bg-gray-50"
          onClick={handleCopy}
          disabled={!activePage?.textContent}
        >
          {copySuccess ? (
            <Check className="w-4 h-4 text-green-500" />
          ) : (
            <Copy className="w-4 h-4" />
          )}
          コピー
        </button>

        <div className="w-px h-6 bg-gray-200" />

        {/* OCR-LAYOUT: レイアウト表示切替 */}
        <button
          className={`flex items-center gap-1 px-3 py-1.5 rounded ${
            layoutViewMode
              ? 'bg-amber-500 text-white hover:bg-amber-600'
              : 'border hover:bg-gray-50'
          }`}
          onClick={() => setLayoutViewMode(!layoutViewMode)}
          disabled={!layoutHTML}
          title="縦書き/横書きレイアウト表示"
        >
          {layoutViewMode ? (
            <AlignJustify className="w-4 h-4" />
          ) : (
            <AlignLeft className="w-4 h-4" />
          )}
          {layoutViewMode ? 'レイアウト' : 'テキスト'}
        </button>

        <div className="w-px h-6 bg-gray-200" />

        {/* エクスポート */}
        <select
          className="border rounded px-2 py-1 text-sm"
          value={exportFormat}
          onChange={(e) => setExportFormat(e.target.value as ExportFormat)}
        >
          <option value="txt">テキスト (.txt)</option>
          <option value="md">Markdown (.md)</option>
          <option value="docx">Word (.docx)</option>
          <option value="pdf">PDF (.pdf)</option>
        </select>
        <button
          className="flex items-center gap-1 px-3 py-1.5 bg-green-500 text-white rounded hover:bg-green-600"
          onClick={handleExport}
        >
          <Download className="w-4 h-4" />
          出力
        </button>
      </div>

      {/* メインエディタエリア */}
      <div className="flex-1 flex gap-4 overflow-hidden">
        {/* サムネイル */}
        <PageThumbnails file={activeFile} multiSelectMode={ocrSelectMode} />

        {/* P1-005: 左右並列表示 */}
        <div className="flex-1 editor-container">
          {/* 左：元PDF画像 */}
          <div className="editor-panel">
            <div className="editor-panel-header flex items-center justify-between">
              <span>元PDF (ページ {activePageNumber}/{activeFile.pageCount})</span>
              <div className="flex items-center gap-1">
                <button
                  className="p-1 hover:bg-gray-200 rounded disabled:opacity-50"
                  onClick={goToPrevPage}
                  disabled={activePageNumber <= 1}
                  aria-label="前のページ"
                >
                  <ChevronLeft className="w-4 h-4" />
                </button>
                <button
                  className="p-1 hover:bg-gray-200 rounded disabled:opacity-50"
                  onClick={goToNextPage}
                  disabled={activePageNumber >= activeFile.pageCount}
                  aria-label="次のページ"
                >
                  <ChevronRight className="w-4 h-4" />
                </button>
              </div>
            </div>
            <div className="editor-panel-content bg-gray-100 flex items-center justify-center">
              {activePage?.imageData ? (
                <img
                  src={activePage.imageData}
                  alt={`Page ${activePageNumber}`}
                  className="max-w-full max-h-full object-contain"
                />
              ) : (
                <p className="text-gray-400">画像を読み込み中...</p>
              )}
            </div>
          </div>

          {/* 右：抽出テキスト（編集可能）/ レイアウト表示 */}
          <div className="editor-panel">
            <div className="editor-panel-header flex items-center justify-between">
              <span>{layoutViewMode && layoutHTML ? 'レイアウト表示' : '抽出テキスト'}</span>
              {activePage && (
                <span className="text-xs text-gray-500">
                  OCR: {activePage.ocrStatus === 'completed' ? '完了' :
                        activePage.ocrStatus === 'processing' ? `処理中 ${activePage.ocrProgress}%` :
                        activePage.ocrStatus === 'failed' ? '失敗' : '未実行'}
                </span>
              )}
            </div>
            <div className="editor-panel-content">
              {layoutViewMode && layoutHTML ? (
                // レイアウト表示モード
                <div
                  className="layout-preview h-full"
                  dangerouslySetInnerHTML={{ __html: layoutHTML }}
                />
              ) : (
                // テキスト編集モード
                <textarea
                  className="text-editor"
                  value={activePage?.textContent || ''}
                  onChange={(e) => handleTextChange(e.target.value)}
                  placeholder="OCRを実行するか、テキストを直接入力してください..."
                />
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
