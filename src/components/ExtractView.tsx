// =============================================================================
// テキスト抽出ビュー
// P1-005: OCR編集画面（左右並列）
// =============================================================================

import { useState } from 'react';
import {
  Play,
  Download,
  Copy,
  FileText,
  Check,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { PageThumbnails } from './PageThumbnails';
import type { ExportFormat } from '../types';

export function ExtractView() {
  const {
    files,
    activeFileId,
    activePageNumber,
    setActivePage,
    updatePageText,
    startOCR,
    exportText,
    copyToClipboard,
    settings,
    updateSettings,
  } = useAppStore();

  const [copySuccess, setCopySuccess] = useState(false);
  const [exportFormat, setExportFormat] = useState<ExportFormat>('txt');

  const activeFile = files.find((f) => f.id === activeFileId);
  const activePage = activeFile?.pages.find((p) => p.pageNumber === activePageNumber);

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
        {/* OCR実行 */}
        <button
          className="flex items-center gap-1 px-3 py-1.5 bg-blue-500 text-white rounded hover:bg-blue-600"
          onClick={() => startOCR(activeFile.id)}
        >
          <Play className="w-4 h-4" />
          OCR実行
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
        <PageThumbnails file={activeFile} />

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

          {/* 右：抽出テキスト（編集可能） */}
          <div className="editor-panel">
            <div className="editor-panel-header flex items-center justify-between">
              <span>抽出テキスト</span>
              {activePage && (
                <span className="text-xs text-gray-500">
                  OCR: {activePage.ocrStatus === 'completed' ? '完了' :
                        activePage.ocrStatus === 'processing' ? `処理中 ${activePage.ocrProgress}%` :
                        activePage.ocrStatus === 'failed' ? '失敗' : '未実行'}
                </span>
              )}
            </div>
            <div className="editor-panel-content">
              <textarea
                className="text-editor"
                value={activePage?.textContent || ''}
                onChange={(e) => handleTextChange(e.target.value)}
                placeholder="OCRを実行するか、テキストを直接入力してください..."
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
