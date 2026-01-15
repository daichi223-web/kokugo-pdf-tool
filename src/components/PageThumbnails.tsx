// =============================================================================
// ページサムネイルコンポーネント
// BATCH-001: 複数選択対応
// =============================================================================

import { useState, useCallback } from 'react';
import { CheckCircle, AlertCircle, Loader, CheckSquare, Square } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import type { PDFFile } from '../types';

interface PageThumbnailsProps {
  file: PDFFile;
  multiSelectMode?: boolean;
}

export function PageThumbnails({ file, multiSelectMode = false }: PageThumbnailsProps) {
  const {
    activePageNumber,
    setActivePage,
    selectedPageNumbers,
    togglePageSelection,
    selectPageRange,
    selectAllPages,
    clearPageSelection,
  } = useAppStore();

  const [lastClickedPage, setLastClickedPage] = useState<number | null>(null);

  const handlePageClick = useCallback(
    (e: React.MouseEvent, pageNumber: number) => {
      if (multiSelectMode) {
        if (e.shiftKey && lastClickedPage !== null) {
          // Shift+クリック: 範囲選択
          selectPageRange(lastClickedPage, pageNumber);
        } else if (e.ctrlKey || e.metaKey) {
          // Ctrl/Cmd+クリック: 追加/解除
          togglePageSelection(pageNumber);
        } else {
          // 通常クリック: 単一選択（アクティブページも変更）
          setActivePage(pageNumber);
          clearPageSelection();
          togglePageSelection(pageNumber);
        }
        setLastClickedPage(pageNumber);
      } else {
        setActivePage(pageNumber);
      }
    },
    [multiSelectMode, lastClickedPage, selectPageRange, togglePageSelection, setActivePage, clearPageSelection]
  );

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <span className="thumbnail-badge bg-green-500 text-white">
            <CheckCircle className="w-3 h-3" />
          </span>
        );
      case 'processing':
        return (
          <span className="thumbnail-badge bg-blue-500 text-white">
            <Loader className="w-3 h-3 animate-spin" />
          </span>
        );
      case 'failed':
        return (
          <span className="thumbnail-badge bg-red-500 text-white">
            <AlertCircle className="w-3 h-3" />
          </span>
        );
      default:
        return null;
    }
  };

  const isPageSelected = (pageNumber: number) => selectedPageNumbers.includes(pageNumber);

  return (
    <div className="w-28 bg-gray-50 rounded-lg overflow-auto p-2 flex flex-col">
      {/* 複数選択モード時のヘッダー */}
      {multiSelectMode && (
        <div className="mb-2 space-y-1">
          <button
            className="w-full text-xs px-2 py-1 bg-blue-500 text-white rounded hover:bg-blue-600"
            onClick={selectAllPages}
          >
            全選択
          </button>
          <button
            className="w-full text-xs px-2 py-1 border rounded hover:bg-gray-100"
            onClick={clearPageSelection}
          >
            選択解除
          </button>
          {selectedPageNumbers.length > 0 && (
            <div className="text-xs text-center text-blue-600 font-medium">
              {selectedPageNumbers.length}ページ選択中
            </div>
          )}
        </div>
      )}

      <div className="space-y-2 flex-1 overflow-auto">
        {file.pages.map((page) => {
          const isSelected = isPageSelected(page.pageNumber);
          const isActive = activePageNumber === page.pageNumber;

          return (
            <div
              key={page.pageNumber}
              className={`thumbnail relative cursor-pointer ${isActive ? 'active' : ''} ${
                multiSelectMode && isSelected ? 'ring-2 ring-blue-500' : ''
              }`}
              onClick={(e) => handlePageClick(e, page.pageNumber)}
            >
              {/* チェックボックス（複数選択モード時） */}
              {multiSelectMode && (
                <div className="absolute top-1 left-1 z-10">
                  {isSelected ? (
                    <CheckSquare className="w-5 h-5 text-blue-500 bg-white rounded" />
                  ) : (
                    <Square className="w-5 h-5 text-gray-400 bg-white rounded" />
                  )}
                </div>
              )}

              {page.imageData ? (
                <img
                  src={page.imageData}
                  alt={`Page ${page.pageNumber}`}
                  className="w-full h-auto"
                />
              ) : (
                <div className="w-full aspect-[3/4] bg-gray-200 flex items-center justify-center">
                  <span className="text-xs text-gray-400">{page.pageNumber}</span>
                </div>
              )}
              {getStatusBadge(page.ocrStatus)}
              <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs text-center py-0.5">
                {page.pageNumber}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
