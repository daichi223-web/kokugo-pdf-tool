// =============================================================================
// Zustand Store - アプリケーション状態管理
// NF-002: ローカル処理 - すべてブラウザ内で完結
// NF-005: データ保持 - IndexedDB使用
// =============================================================================

import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type {
  AppState,
  AppActions,
  PDFFile,
  PDFPage,
  Snippet,
  LayoutPage,
  PaperSize,
  PaperOrientation,
  Position,
  Size,
  ExportFormat,
  ProgressInfo,
  AppSettings,
} from '../types';
import { generateId } from '../utils/helpers';
import { loadPDF, renderPageToImage, extractTextFromPage } from '../utils/pdfUtils';
import { runOCR } from '../utils/ocrUtils';
import { exportToText, exportToMarkdown, exportToDocx, exportToPDF } from '../utils/exportUtils';
import {
  startMeasure,
  clearMetrics,
  generateBenchmarkResult,
  formatBenchmarkResult,
  checkPerformanceRequirements,
  type BenchmarkResult,
} from '../utils/performanceUtils';

const DEFAULT_SETTINGS: AppSettings = {
  rubyBracketMode: true,
  showGrid: true,
  gridSize: 10,
  snapToGrid: false,
  defaultPaperSize: 'A4',
  defaultPaperOrientation: 'portrait',
};

interface Store extends AppState, AppActions {
  // パフォーマンス計測
  benchmarkResult: BenchmarkResult | null;
  isBenchmarkMode: boolean;
  startBenchmark: () => void;
  stopBenchmark: () => BenchmarkResult;
  getBenchmarkReport: () => string;

  // Undo機能
  layoutHistory: LayoutPage[][];
  pushLayoutHistory: () => void;
  undoLayout: () => void;

  // スニペット再トリミング
  reCropSnippetId: string | null;
  setReCropSnippet: (snippetId: string | null) => void;
}

export const useAppStore = create<Store>()(
  persist(
    (set, get) => ({
      // 初期状態
      files: [],
      activeFileId: null,
      activePageNumber: 1,
      snippets: [],
      layoutPages: [],
      activeLayoutPageId: null,
      settings: DEFAULT_SETTINGS,
      isProcessing: false,
      progress: null,
      activeTab: 'layout',
      selectedSnippetId: null,
      selectedSnippetIds: [],
      selectedPageNumbers: [],
      benchmarkResult: null,
      isBenchmarkMode: false,
      layoutHistory: [],
      reCropSnippetId: null,

      // ファイル操作
      // P1-001: PDF読み込み（単体）
      // P1-002: PDF読み込み（複数一括）
      addFiles: async (files: File[]) => {
        set({ isProcessing: true });
        const { isBenchmarkMode } = get();

        for (let i = 0; i < files.length; i++) {
          const file = files[i];
          set({
            progress: {
              current: i + 1,
              total: files.length,
              message: `${file.name} を読み込み中...`,
            },
          });

          try {
            const endPdfLoad = isBenchmarkMode ? startMeasure(`pdf-load-${file.name}`) : null;
            const pdfData = await loadPDF(file);
            endPdfLoad?.({ fileName: file.name, pages: pdfData.numPages });

            const pages: PDFPage[] = [];

            for (let j = 0; j < pdfData.numPages; j++) {
              const pageNum = j + 1;
              set({
                progress: {
                  current: i + 1,
                  total: files.length,
                  message: `${file.name} - ページ ${pageNum}/${pdfData.numPages} を処理中...`,
                },
              });

              const endRender = isBenchmarkMode ? startMeasure(`render-page-${pageNum}`) : null;
              const imageData = await renderPageToImage(pdfData.pdf, pageNum);
              endRender?.({ page: pageNum });

              const endExtract = isBenchmarkMode ? startMeasure(`extract-text-${pageNum}`) : null;
              const textContent = await extractTextFromPage(pdfData.pdf, pageNum);
              endExtract?.({ page: pageNum, hasText: !!textContent });

              pages.push({
                pageNumber: pageNum,
                width: pdfData.width,
                height: pdfData.height,
                imageData,
                textContent: textContent || '',
                ocrStatus: textContent ? 'completed' : 'pending',
                ocrProgress: textContent ? 100 : 0,
              });
            }

            const pdfFile: PDFFile = {
              id: generateId(),
              name: file.name,
              file,
              pageCount: pdfData.numPages,
              pages,
              status: 'completed',
              createdAt: new Date(),
            };

            set((state) => ({
              files: [...state.files, pdfFile],
              activeFileId: state.activeFileId || pdfFile.id,
            }));
          } catch (error) {
            console.error(`Error loading ${file.name}:`, error);
            const errorFile: PDFFile = {
              id: generateId(),
              name: file.name,
              file,
              pageCount: 0,
              pages: [],
              status: 'error',
              error: error instanceof Error ? error.message : '読み込みエラー',
              createdAt: new Date(),
            };
            set((state) => ({ files: [...state.files, errorFile] }));
          }
        }

        set({ isProcessing: false, progress: null });
      },

      removeFile: (fileId: string) => {
        set((state) => ({
          files: state.files.filter((f) => f.id !== fileId),
          activeFileId: state.activeFileId === fileId ? null : state.activeFileId,
          snippets: state.snippets.filter((s) => s.sourceFileId !== fileId),
        }));
      },

      setActiveFile: (fileId: string | null) => {
        set({ activeFileId: fileId, activePageNumber: 1 });
      },

      setActivePage: (pageNumber: number) => {
        set({ activePageNumber: pageNumber });
      },

      updatePageText: (fileId: string, pageNumber: number, text: string) => {
        set((state) => ({
          files: state.files.map((f) =>
            f.id === fileId
              ? {
                  ...f,
                  pages: f.pages.map((p) =>
                    p.pageNumber === pageNumber ? { ...p, textContent: text } : p
                  ),
                }
              : f
          ),
        }));
      },

      // OCR操作
      // P1-003: 縦書きOCR対応
      // P1-004: デジタルPDFテキスト抽出
      startOCR: async (fileId: string) => {
        const file = get().files.find((f) => f.id === fileId);
        if (!file) return;

        set({ isProcessing: true });
        const { isBenchmarkMode } = get();

        for (let i = 0; i < file.pages.length; i++) {
          const page = file.pages[i];
          if (page.ocrStatus === 'completed' && page.textContent) continue;

          set({
            progress: {
              current: i + 1,
              total: file.pages.length,
              message: `OCR処理中: ページ ${page.pageNumber}/${file.pages.length}`,
              estimatedTimeRemaining: (file.pages.length - i - 1) * 10,
            },
          });

          // ページのOCRステータスを更新
          set((state) => ({
            files: state.files.map((f) =>
              f.id === fileId
                ? {
                    ...f,
                    pages: f.pages.map((p) =>
                      p.pageNumber === page.pageNumber
                        ? { ...p, ocrStatus: 'processing' as const }
                        : p
                    ),
                  }
                : f
            ),
          }));

          try {
            if (page.imageData) {
              const endOcr = isBenchmarkMode ? startMeasure(`ocr-page-${page.pageNumber}`) : null;
              const result = await runOCR(page.imageData, (progress) => {
                set((state) => ({
                  files: state.files.map((f) =>
                    f.id === fileId
                      ? {
                          ...f,
                          pages: f.pages.map((p) =>
                            p.pageNumber === page.pageNumber
                              ? { ...p, ocrProgress: progress }
                              : p
                          ),
                        }
                      : f
                  ),
                }));
              });
              endOcr?.({ page: page.pageNumber, textLength: result.text.length });

              set((state) => ({
                files: state.files.map((f) =>
                  f.id === fileId
                    ? {
                        ...f,
                        pages: f.pages.map((p) =>
                          p.pageNumber === page.pageNumber
                            ? {
                                ...p,
                                textContent: result.text,
                                ocrStatus: 'completed' as const,
                                ocrProgress: 100,
                                ocrBlocks: result.blocks,  // OCRブロック情報も保存
                              }
                            : p
                        ),
                      }
                    : f
                ),
              }));
            }
          } catch (error) {
            console.error(`OCR error on page ${page.pageNumber}:`, error);
            set((state) => ({
              files: state.files.map((f) =>
                f.id === fileId
                  ? {
                      ...f,
                      pages: f.pages.map((p) =>
                        p.pageNumber === page.pageNumber
                          ? { ...p, ocrStatus: 'failed' as const }
                          : p
                      ),
                    }
                  : f
              ),
            }));
          }
        }

        set({ isProcessing: false, progress: null });
      },

      // 選択したページのみOCR実行
      startOCRForPages: async (fileId: string, pageNumbers: number[]) => {
        const file = get().files.find((f) => f.id === fileId);
        if (!file || pageNumbers.length === 0) return;

        set({ isProcessing: true });
        const { isBenchmarkMode } = get();

        for (let i = 0; i < pageNumbers.length; i++) {
          const pageNumber = pageNumbers[i];
          const page = file.pages.find((p) => p.pageNumber === pageNumber);
          if (!page) continue;
          if (page.ocrStatus === 'completed' && page.textContent) continue;

          set({
            progress: {
              current: i + 1,
              total: pageNumbers.length,
              message: `OCR処理中: ページ ${pageNumber} (${i + 1}/${pageNumbers.length})`,
              estimatedTimeRemaining: (pageNumbers.length - i - 1) * 10,
            },
          });

          set((state) => ({
            files: state.files.map((f) =>
              f.id === fileId
                ? {
                    ...f,
                    pages: f.pages.map((p) =>
                      p.pageNumber === pageNumber
                        ? { ...p, ocrStatus: 'processing' as const }
                        : p
                    ),
                  }
                : f
            ),
          }));

          try {
            if (page.imageData) {
              const endOcr = isBenchmarkMode ? startMeasure(`ocr-page-${pageNumber}`) : null;
              const result = await runOCR(page.imageData, (progress) => {
                set((state) => ({
                  files: state.files.map((f) =>
                    f.id === fileId
                      ? {
                          ...f,
                          pages: f.pages.map((p) =>
                            p.pageNumber === pageNumber
                              ? { ...p, ocrProgress: progress }
                              : p
                          ),
                        }
                      : f
                  ),
                }));
              });
              endOcr?.({ page: pageNumber, textLength: result.text.length });

              set((state) => ({
                files: state.files.map((f) =>
                  f.id === fileId
                    ? {
                        ...f,
                        pages: f.pages.map((p) =>
                          p.pageNumber === pageNumber
                            ? {
                                ...p,
                                textContent: result.text,
                                ocrStatus: 'completed' as const,
                                ocrProgress: 100,
                                ocrBlocks: result.blocks,
                              }
                            : p
                        ),
                      }
                    : f
                ),
              }));
            }
          } catch (error) {
            console.error(`OCR error on page ${pageNumber}:`, error);
            set((state) => ({
              files: state.files.map((f) =>
                f.id === fileId
                  ? {
                      ...f,
                      pages: f.pages.map((p) =>
                        p.pageNumber === pageNumber
                          ? { ...p, ocrStatus: 'failed' as const }
                          : p
                      ),
                    }
                  : f
              ),
            }));
          }
        }

        set({ isProcessing: false, progress: null });
      },

      cancelOCR: () => {
        set({ isProcessing: false, progress: null });
      },

      // スニペット操作
      // P3-001: トリミング機能
      addSnippet: (snippet) => {
        const newSnippet: Snippet = {
          ...snippet,
          id: generateId(),
          createdAt: new Date(),
        };
        set((state) => ({ snippets: [...state.snippets, newSnippet] }));
      },

      removeSnippet: (snippetId: string) => {
        set((state) => ({
          snippets: state.snippets.filter((s) => s.id !== snippetId),
          layoutPages: state.layoutPages.map((page) => ({
            ...page,
            snippets: page.snippets.filter((s) => s.snippetId !== snippetId),
          })),
        }));
      },

      // レイアウト操作
      // P3-002: 再配置エディタ
      // P3-004: 用紙サイズ選択
      addLayoutPage: (paperSize: PaperSize, orientation: PaperOrientation) => {
        const newPage: LayoutPage = {
          id: generateId(),
          paperSize,
          orientation,
          snippets: [],
        };
        set((state) => ({
          layoutPages: [...state.layoutPages, newPage],
          activeLayoutPageId: newPage.id,
        }));
      },

      removeLayoutPage: (pageId: string) => {
        set((state) => ({
          layoutPages: state.layoutPages.filter((p) => p.id !== pageId),
          activeLayoutPageId:
            state.activeLayoutPageId === pageId ? null : state.activeLayoutPageId,
        }));
      },

      setActiveLayoutPage: (pageId: string | null) => {
        set({ activeLayoutPageId: pageId });
      },

      addSnippetToLayout: (pageId: string, snippetId: string, position: Position) => {
        // Undo用に履歴を保存
        get().pushLayoutHistory();

        const snippet = get().snippets.find((s) => s.id === snippetId);
        // トリミングサイズを初期サイズとして使用
        const initialSize = snippet
          ? { width: snippet.cropArea.width, height: snippet.cropArea.height }
          : { width: 100, height: 100 };

        set((state) => ({
          layoutPages: state.layoutPages.map((page) =>
            page.id === pageId
              ? {
                  ...page,
                  snippets: [
                    ...page.snippets,
                    {
                      snippetId,
                      position,
                      size: initialSize,
                      rotation: 0,
                    },
                  ],
                }
              : page
          ),
        }));
      },

      updateSnippetPosition: (pageId: string, snippetId: string, position: Position) => {
        set((state) => ({
          layoutPages: state.layoutPages.map((page) =>
            page.id === pageId
              ? {
                  ...page,
                  snippets: page.snippets.map((s) =>
                    s.snippetId === snippetId ? { ...s, position } : s
                  ),
                }
              : page
          ),
        }));
      },

      updateSnippetSize: (pageId: string, snippetId: string, size: Size) => {
        set((state) => ({
          layoutPages: state.layoutPages.map((page) =>
            page.id === pageId
              ? {
                  ...page,
                  snippets: page.snippets.map((s) =>
                    s.snippetId === snippetId ? { ...s, size } : s
                  ),
                }
              : page
          ),
        }));
      },

      applySnippetSizeToLayout: (pageId: string, size: Size) => {
        // Undo用に履歴を保存
        get().pushLayoutHistory();

        set((state) => ({
          layoutPages: state.layoutPages.map((page) =>
            page.id === pageId
              ? {
                  ...page,
                  snippets: page.snippets.map((s) => ({ ...s, size })),
                }
              : page
          ),
        }));
      },

      removeSnippetFromLayout: (pageId: string, snippetId: string) => {
        // Undo用に履歴を保存
        get().pushLayoutHistory();

        set((state) => ({
          layoutPages: state.layoutPages.map((page) =>
            page.id === pageId
              ? {
                  ...page,
                  snippets: page.snippets.filter((s) => s.snippetId !== snippetId),
                }
              : page
          ),
        }));
      },

      // エクスポート操作
      // P1-006: テキスト出力
      // P1-007: Markdown出力
      // P2-002: Word出力
      // P2-003: PDF出力
      exportText: async (fileId: string, format: ExportFormat) => {
        const file = get().files.find((f) => f.id === fileId);
        if (!file) return;

        const text = file.pages.map((p) => p.textContent || '').join('\n\n---\n\n');
        const { rubyBracketMode } = get().settings;

        let blob: Blob;
        let filename: string;

        switch (format) {
          case 'txt':
            blob = exportToText(text, rubyBracketMode);
            filename = `${file.name.replace('.pdf', '')}.txt`;
            break;
          case 'md':
            blob = exportToMarkdown(text, file.name, rubyBracketMode);
            filename = `${file.name.replace('.pdf', '')}.md`;
            break;
          case 'docx':
            blob = await exportToDocx(text, file.name, rubyBracketMode);
            filename = `${file.name.replace('.pdf', '')}.docx`;
            break;
          case 'pdf':
            blob = await exportToPDF(text, rubyBracketMode);
            filename = `${file.name.replace('.pdf', '')}_text.pdf`;
            break;
          default:
            return;
        }

        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = filename;
        a.click();
        URL.revokeObjectURL(url);
      },

      // P3-006: 印刷用PDF出力
      exportLayoutPDF: async () => {
        const { layoutPages, snippets, settings } = get();
        // This would use pdf-lib to create the layout PDF
        // Implementation in exportUtils
        console.log('Exporting layout PDF...', { layoutPages, snippets, settings });
      },

      // P1-008: クリップボードコピー
      copyToClipboard: async (text: string) => {
        try {
          await navigator.clipboard.writeText(text);
        } catch (error) {
          console.error('Failed to copy:', error);
        }
      },

      // 設定操作
      // P2-001: ルビ括弧表記オプション
      // P3-005: グリッド/ガイド表示
      updateSettings: (newSettings: Partial<AppSettings>) => {
        set((state) => ({
          settings: { ...state.settings, ...newSettings },
        }));
      },

      // UI操作
      setActiveTab: (tab) => {
        set({ activeTab: tab });
      },

      setSelectedSnippet: (snippetId) => {
        set({ selectedSnippetId: snippetId });
      },

      // P1-009: プログレス表示
      setProgress: (progress: ProgressInfo | null) => {
        set({ progress });
      },

      // ページ複数選択操作
      togglePageSelection: (pageNumber: number) => {
        set((state) => {
          const selected = state.selectedPageNumbers;
          if (selected.includes(pageNumber)) {
            return { selectedPageNumbers: selected.filter((n) => n !== pageNumber) };
          } else {
            return { selectedPageNumbers: [...selected, pageNumber].sort((a, b) => a - b) };
          }
        });
      },

      selectPageRange: (start: number, end: number) => {
        const min = Math.min(start, end);
        const max = Math.max(start, end);
        const range: number[] = [];
        for (let i = min; i <= max; i++) {
          range.push(i);
        }
        set({ selectedPageNumbers: range });
      },

      clearPageSelection: () => {
        set({ selectedPageNumbers: [] });
      },

      selectAllPages: () => {
        const activeFile = get().files.find((f) => f.id === get().activeFileId);
        if (!activeFile) return;
        const allPages: number[] = [];
        for (let i = 1; i <= activeFile.pageCount; i++) {
          allPages.push(i);
        }
        set({ selectedPageNumbers: allPages });
      },

      // Undo機能（配置操作）
      pushLayoutHistory: () => {
        const { layoutPages, layoutHistory } = get();
        // 現在の状態をディープコピーして履歴に追加（最大20件）
        const newHistory = [
          ...layoutHistory.slice(-19),
          JSON.parse(JSON.stringify(layoutPages)),
        ];
        set({ layoutHistory: newHistory });
      },

      undoLayout: () => {
        const { layoutHistory } = get();
        if (layoutHistory.length === 0) return;

        const newHistory = [...layoutHistory];
        const previousState = newHistory.pop();
        if (previousState) {
          set({
            layoutPages: previousState,
            layoutHistory: newHistory,
          });
        }
      },

      // スニペット再トリミング
      setReCropSnippet: (snippetId: string | null) => {
        set({ reCropSnippetId: snippetId });
      },

      // 配置済みスニペット複数選択
      togglePlacedSnippetSelection: (snippetId: string) => {
        set((state) => {
          const selected = state.selectedSnippetIds;
          if (selected.includes(snippetId)) {
            return { selectedSnippetIds: selected.filter((id) => id !== snippetId) };
          } else {
            return { selectedSnippetIds: [...selected, snippetId] };
          }
        });
      },

      clearPlacedSnippetSelection: () => {
        set({ selectedSnippetIds: [] });
      },

      selectAllPlacedSnippets: (pageId: string) => {
        const page = get().layoutPages.find((p) => p.id === pageId);
        if (!page) return;
        set({ selectedSnippetIds: page.snippets.map((s) => s.snippetId) });
      },

      // グリッド配置
      arrangeSnippetsInGrid: (pageId: string, cols: number, rows: number, orderHorizontal: boolean) => {
        const { layoutPages, selectedSnippetIds, snippets } = get();
        const page = layoutPages.find((p) => p.id === pageId);
        if (!page) return;

        // Undo用に履歴を保存
        get().pushLayoutHistory();

        // 選択されたスニペットを取得（選択順を維持）
        const selectedPlaced = selectedSnippetIds
          .map((id) => page.snippets.find((s) => s.snippetId === id))
          .filter((s): s is NonNullable<typeof s> => s !== undefined);

        if (selectedPlaced.length === 0) return;

        // 用紙サイズを取得
        const { getPaperDimensions } = require('../types');
        const { mmToPx } = require('../utils/helpers');
        const paperSize = getPaperDimensions(page.paperSize, page.orientation);
        const pageWidth = mmToPx(paperSize.width, 96);
        const pageHeight = mmToPx(paperSize.height, 96);
        const margin = mmToPx(15, 96);

        // 配置可能エリア
        const availableWidth = pageWidth - margin * 2;
        const availableHeight = pageHeight - margin * 2;

        // セルサイズ
        const cellWidth = availableWidth / cols;
        const cellHeight = availableHeight / rows;

        // グリッド配置
        const newSnippets = page.snippets.map((placed) => {
          const selectedIndex = selectedSnippetIds.indexOf(placed.snippetId);
          if (selectedIndex === -1) return placed;

          let gridIndex: number;
          if (orderHorizontal) {
            // 横優先（→）: 0,1,2,3 / 4,5,6,7
            gridIndex = selectedIndex;
          } else {
            // 縦優先（↓）: 0,2,4,6 / 1,3,5,7
            const col = Math.floor(selectedIndex / rows);
            const row = selectedIndex % rows;
            gridIndex = row * cols + col;
          }

          const col = gridIndex % cols;
          const row = Math.floor(gridIndex / cols);

          // セル内で中央配置
          const snippet = snippets.find((s) => s.id === placed.snippetId);
          const snippetWidth = snippet ? snippet.cropArea.width : placed.size.width;
          const snippetHeight = snippet ? snippet.cropArea.height : placed.size.height;

          // サイズをセルに収まるように調整
          const scale = Math.min(cellWidth / snippetWidth, cellHeight / snippetHeight, 1);
          const newWidth = snippetWidth * scale;
          const newHeight = snippetHeight * scale;

          return {
            ...placed,
            position: {
              x: col * cellWidth + (cellWidth - newWidth) / 2,
              y: row * cellHeight + (cellHeight - newHeight) / 2,
            },
            size: {
              width: newWidth,
              height: newHeight,
            },
          };
        });

        set((state) => ({
          layoutPages: state.layoutPages.map((p) =>
            p.id === pageId ? { ...p, snippets: newSnippets } : p
          ),
        }));
      },

      // 全スニペットをグリッド配置（スニペットリストから一括配置）
      arrangeAllSnippetsInGrid: (pageId: string, cols: number, rows: number) => {
        const { layoutPages, snippets } = get();
        const page = layoutPages.find((p) => p.id === pageId);
        if (!page || snippets.length === 0) return;

        // Undo用に履歴を保存
        get().pushLayoutHistory();

        // 用紙サイズを取得
        const { getPaperDimensions } = require('../types');
        const { mmToPx } = require('../utils/helpers');
        const paperSize = getPaperDimensions(page.paperSize, page.orientation);
        const pageWidth = mmToPx(paperSize.width, 96);
        const pageHeight = mmToPx(paperSize.height, 96);
        const margin = mmToPx(15, 96);

        // 配置可能エリア
        const availableWidth = pageWidth - margin * 2;
        const availableHeight = pageHeight - margin * 2;

        // セルサイズ
        const cellWidth = availableWidth / cols;
        const cellHeight = availableHeight / rows;

        // 全スニペットをリスト順（作成順）で配置
        const newPlacedSnippets = snippets.map((snippet, index) => {
          const col = index % cols;
          const row = Math.floor(index / cols);

          // セルに収まるようにサイズを調整
          const snippetWidth = snippet.cropArea.width;
          const snippetHeight = snippet.cropArea.height;
          const scale = Math.min(cellWidth / snippetWidth, cellHeight / snippetHeight, 1);
          const newWidth = snippetWidth * scale;
          const newHeight = snippetHeight * scale;

          return {
            snippetId: snippet.id,
            position: {
              x: col * cellWidth + (cellWidth - newWidth) / 2,
              y: row * cellHeight + (cellHeight - newHeight) / 2,
            },
            size: {
              width: newWidth,
              height: newHeight,
            },
            rotation: 0,
          };
        });

        set((state) => ({
          layoutPages: state.layoutPages.map((p) =>
            p.id === pageId ? { ...p, snippets: newPlacedSnippets } : p
          ),
        }));
      },

      // 整列機能
      alignSnippets: (pageId: string, alignment: 'top' | 'left' | 'bottom' | 'right') => {
        const { layoutPages, selectedSnippetIds } = get();
        const page = layoutPages.find((p) => p.id === pageId);
        if (!page || selectedSnippetIds.length < 2) return;

        // Undo用に履歴を保存
        get().pushLayoutHistory();

        const selectedPlaced = page.snippets.filter((s) =>
          selectedSnippetIds.includes(s.snippetId)
        );

        let targetValue: number;
        switch (alignment) {
          case 'top':
            targetValue = Math.min(...selectedPlaced.map((s) => s.position.y));
            break;
          case 'left':
            targetValue = Math.min(...selectedPlaced.map((s) => s.position.x));
            break;
          case 'bottom':
            targetValue = Math.max(...selectedPlaced.map((s) => s.position.y + s.size.height));
            break;
          case 'right':
            targetValue = Math.max(...selectedPlaced.map((s) => s.position.x + s.size.width));
            break;
        }

        set((state) => ({
          layoutPages: state.layoutPages.map((p) =>
            p.id === pageId
              ? {
                  ...p,
                  snippets: p.snippets.map((s) => {
                    if (!selectedSnippetIds.includes(s.snippetId)) return s;
                    switch (alignment) {
                      case 'top':
                        return { ...s, position: { ...s.position, y: targetValue } };
                      case 'left':
                        return { ...s, position: { ...s.position, x: targetValue } };
                      case 'bottom':
                        return { ...s, position: { ...s.position, y: targetValue - s.size.height } };
                      case 'right':
                        return { ...s, position: { ...s.position, x: targetValue - s.size.width } };
                      default:
                        return s;
                    }
                  }),
                }
              : p
          ),
        }));
      },

      // 等間隔配置
      distributeSnippets: (pageId: string, direction: 'horizontal' | 'vertical') => {
        const { layoutPages, selectedSnippetIds } = get();
        const page = layoutPages.find((p) => p.id === pageId);
        if (!page || selectedSnippetIds.length < 3) return;

        // Undo用に履歴を保存
        get().pushLayoutHistory();

        const selectedPlaced = page.snippets
          .filter((s) => selectedSnippetIds.includes(s.snippetId))
          .sort((a, b) =>
            direction === 'horizontal'
              ? a.position.x - b.position.x
              : a.position.y - b.position.y
          );

        if (direction === 'horizontal') {
          const first = selectedPlaced[0];
          const last = selectedPlaced[selectedPlaced.length - 1];
          const totalWidth = selectedPlaced.reduce((sum, s) => sum + s.size.width, 0);
          const totalSpace = last.position.x + last.size.width - first.position.x - totalWidth;
          const gap = totalSpace / (selectedPlaced.length - 1);

          let currentX = first.position.x;
          const positionMap = new Map<string, number>();
          selectedPlaced.forEach((s) => {
            positionMap.set(s.snippetId, currentX);
            currentX += s.size.width + gap;
          });

          set((state) => ({
            layoutPages: state.layoutPages.map((p) =>
              p.id === pageId
                ? {
                    ...p,
                    snippets: p.snippets.map((s) => {
                      const newX = positionMap.get(s.snippetId);
                      return newX !== undefined
                        ? { ...s, position: { ...s.position, x: newX } }
                        : s;
                    }),
                  }
                : p
            ),
          }));
        } else {
          const first = selectedPlaced[0];
          const last = selectedPlaced[selectedPlaced.length - 1];
          const totalHeight = selectedPlaced.reduce((sum, s) => sum + s.size.height, 0);
          const totalSpace = last.position.y + last.size.height - first.position.y - totalHeight;
          const gap = totalSpace / (selectedPlaced.length - 1);

          let currentY = first.position.y;
          const positionMap = new Map<string, number>();
          selectedPlaced.forEach((s) => {
            positionMap.set(s.snippetId, currentY);
            currentY += s.size.height + gap;
          });

          set((state) => ({
            layoutPages: state.layoutPages.map((p) =>
              p.id === pageId
                ? {
                    ...p,
                    snippets: p.snippets.map((s) => {
                      const newY = positionMap.get(s.snippetId);
                      return newY !== undefined
                        ? { ...s, position: { ...s.position, y: newY } }
                        : s;
                    }),
                  }
                : p
            ),
          }));
        }
      },

      // サイズ統一
      unifySnippetSize: (pageId: string, dimension: 'width' | 'height' | 'both') => {
        const { layoutPages, selectedSnippetIds } = get();
        const page = layoutPages.find((p) => p.id === pageId);
        if (!page || selectedSnippetIds.length < 2) return;

        // Undo用に履歴を保存
        get().pushLayoutHistory();

        const selectedPlaced = page.snippets.filter((s) =>
          selectedSnippetIds.includes(s.snippetId)
        );

        // 最初に選択したスニペットのサイズを基準にする
        const reference = selectedPlaced[0];
        if (!reference) return;

        set((state) => ({
          layoutPages: state.layoutPages.map((p) =>
            p.id === pageId
              ? {
                  ...p,
                  snippets: p.snippets.map((s) => {
                    if (!selectedSnippetIds.includes(s.snippetId)) return s;
                    switch (dimension) {
                      case 'width':
                        return { ...s, size: { ...s.size, width: reference.size.width } };
                      case 'height':
                        return { ...s, size: { ...s.size, height: reference.size.height } };
                      case 'both':
                        return { ...s, size: { ...reference.size } };
                      default:
                        return s;
                    }
                  }),
                }
              : p
          ),
        }));
      },

      // NF-003: パフォーマンス計測
      startBenchmark: () => {
        clearMetrics();
        set({ isBenchmarkMode: true, benchmarkResult: null });
      },

      stopBenchmark: () => {
        const result = generateBenchmarkResult();
        set({ isBenchmarkMode: false, benchmarkResult: result });

        // 要件チェック
        const files = get().files;
        const totalPages = files.reduce((sum, f) => sum + f.pageCount, 0);
        const check = checkPerformanceRequirements(totalPages, result.totalDuration);
        console.log(check.message);

        return result;
      },

      getBenchmarkReport: () => {
        const result = get().benchmarkResult;
        if (!result) return 'ベンチマーク結果がありません。startBenchmark() → 処理 → stopBenchmark() の順で実行してください。';
        return formatBenchmarkResult(result);
      },
    }),
    {
      name: 'kokugo-pdf-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        settings: state.settings,
      }),
    }
  )
);
