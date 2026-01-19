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
  PlacedSnippet,
  PaperSize,
  PaperOrientation,
  Position,
  Size,
  ExportFormat,
  ProgressInfo,
  AppSettings,
  TextElement,
  ShapeElement,
  ShapeType,
} from '../types';
import { getPaperDimensions } from '../types';
import { generateId, mmToPx } from '../utils/helpers';
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
  defaultPaperSize: 'A3',
  defaultPaperOrientation: 'landscape',
  writingDirection: 'vertical', // デフォルトは縦書き（A3横）
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
      selectedTextId: null,
      selectedShapeId: null,
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

      updateSnippet: (snippetId: string, updates: Partial<Omit<Snippet, 'id' | 'createdAt'>>) => {
        set((state) => {
          // スニペットを更新
          const newSnippets = state.snippets.map((s) =>
            s.id === snippetId ? { ...s, ...updates } : s
          );

          // cropAreaとcropZoomが更新された場合、配置済みスニペットのサイズも更新
          let newLayoutPages = state.layoutPages;
          if (updates.cropArea && updates.cropZoom) {
            const newCropWidth = updates.cropArea.width * updates.cropZoom;
            const newCropHeight = updates.cropArea.height * updates.cropZoom;
            const newAspectRatio = newCropWidth / newCropHeight;
            const writingDirection = state.settings.writingDirection;

            newLayoutPages = state.layoutPages.map((page) => ({
              ...page,
              snippets: page.snippets.map((placed) => {
                if (placed.snippetId !== snippetId) return placed;

                let newSize: Size;
                if (writingDirection === 'vertical') {
                  // 縦書き：高さを維持し、幅をアスペクト比で計算
                  const keepHeight = placed.size.height;
                  newSize = {
                    width: keepHeight * newAspectRatio,
                    height: keepHeight,
                  };
                } else {
                  // 横書き：幅を維持し、高さをアスペクト比で計算
                  const keepWidth = placed.size.width;
                  newSize = {
                    width: keepWidth,
                    height: keepWidth / newAspectRatio,
                  };
                }
                return { ...placed, size: newSize };
              }),
            }));
          }

          return { snippets: newSnippets, layoutPages: newLayoutPages };
        });
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
          textElements: [],
          shapeElements: [],
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
        const targetPage = get().layoutPages.find((p) => p.id === pageId);
        const settings = get().settings;

        // トリミングサイズを初期サイズとして使用
        // cropZoomで補正：トリミング時にユーザーが見ていた実際のサイズを使用
        const cropZoom = snippet?.cropZoom || 1;
        let initialSize = snippet
          ? {
              width: snippet.cropArea.width * cropZoom,
              height: snippet.cropArea.height * cropZoom
            }
          : { width: 100, height: 100 };

        // 既存のスニペットがあれば、書字方向に応じてサイズを自動調整
        if (targetPage && targetPage.snippets.length > 0) {
          const firstSnippet = targetPage.snippets[0];
          if (settings.writingDirection === 'vertical') {
            // 縦書き → 高さを揃える（アスペクト比維持）
            const aspectRatio = initialSize.width / initialSize.height;
            initialSize = {
              width: firstSnippet.size.height * aspectRatio,
              height: firstSnippet.size.height,
            };
          } else {
            // 横書き → 幅を揃える（アスペクト比維持）
            const aspectRatio = initialSize.height / initialSize.width;
            initialSize = {
              width: firstSnippet.size.width,
              height: firstSnippet.size.width * aspectRatio,
            };
          }
        }

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

      // 横サイズ一括適用（アスペクト比保持）
      applySnippetWidthToLayout: (pageId: string, targetWidth: number) => {
        // Undo用に履歴を保存
        get().pushLayoutHistory();

        set((state) => ({
          layoutPages: state.layoutPages.map((page) =>
            page.id === pageId
              ? {
                  ...page,
                  snippets: page.snippets.map((s) => {
                    const aspectRatio = s.size.height / s.size.width;
                    return {
                      ...s,
                      size: {
                        width: targetWidth,
                        height: targetWidth * aspectRatio,
                      },
                    };
                  }),
                }
              : page
          ),
        }));
      },

      // 縦サイズ一括適用（アスペクト比保持）
      applySnippetHeightToLayout: (pageId: string, targetHeight: number) => {
        // Undo用に履歴を保存
        get().pushLayoutHistory();

        set((state) => ({
          layoutPages: state.layoutPages.map((page) =>
            page.id === pageId
              ? {
                  ...page,
                  snippets: page.snippets.map((s) => {
                    const aspectRatio = s.size.width / s.size.height;
                    return {
                      ...s,
                      size: {
                        width: targetHeight * aspectRatio,
                        height: targetHeight,
                      },
                    };
                  }),
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

      // ページ余白の更新（後方互換用）
      updateLayoutPageMargin: (pageId: string, margin: number) => {
        set((state) => ({
          layoutPages: state.layoutPages.map((page) =>
            page.id === pageId
              ? { ...page, margin, marginX: margin, marginY: margin }
              : page
          ),
        }));
      },

      // 左右余白の更新
      updateLayoutPageMarginX: (pageId: string, marginX: number) => {
        set((state) => ({
          layoutPages: state.layoutPages.map((page) =>
            page.id === pageId
              ? { ...page, marginX }
              : page
          ),
        }));
      },

      // 上下余白の更新
      updateLayoutPageMarginY: (pageId: string, marginY: number) => {
        set((state) => ({
          layoutPages: state.layoutPages.map((page) =>
            page.id === pageId
              ? { ...page, marginY }
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
        // 書字方向が変更された場合、用紙サイズも連動変更
        if (newSettings.writingDirection !== undefined) {
          const currentDirection = get().settings.writingDirection;
          if (newSettings.writingDirection !== currentDirection) {
            if (newSettings.writingDirection === 'vertical') {
              // 縦書き → A3横
              newSettings.defaultPaperSize = 'A3';
              newSettings.defaultPaperOrientation = 'landscape';
            } else {
              // 横書き → A4縦
              newSettings.defaultPaperSize = 'A4';
              newSettings.defaultPaperOrientation = 'portrait';
            }
          }
        }
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

      setSelectedTextId: (textId) => {
        set({ selectedTextId: textId });
      },

      setSelectedShapeId: (shapeId) => {
        set({ selectedShapeId: shapeId });
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
        const paperSize = getPaperDimensions(page.paperSize, page.orientation);
        const pageWidth = mmToPx(paperSize.width, 96);
        const pageHeight = mmToPx(paperSize.height, 96);
        const marginX = mmToPx(page.marginX ?? page.margin ?? 15, 96); // 左右余白
        const marginY = mmToPx(page.marginY ?? page.margin ?? 15, 96); // 上下余白

        // 配置可能エリア
        const availableWidth = pageWidth - marginX * 2;
        const availableHeight = pageHeight - marginY * 2;

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
          const cropZoom = snippet?.cropZoom || 1;
          const snippetWidth = snippet ? snippet.cropArea.width * cropZoom : placed.size.width;
          const snippetHeight = snippet ? snippet.cropArea.height * cropZoom : placed.size.height;

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
      // autoCreatePages: trueの場合、グリッド容量を超えたら自動でページを追加
      arrangeAllSnippetsInGrid: (pageId: string, cols: number, rows: number, gapX: number = 0, gapY: number = 0, autoCreatePages: boolean = true) => {
        const { layoutPages, snippets } = get();
        const page = layoutPages.find((p) => p.id === pageId);
        if (!page || snippets.length === 0) return;

        // Undo用に履歴を保存
        get().pushLayoutHistory();

        // 用紙サイズを取得
        const paperSize = getPaperDimensions(page.paperSize, page.orientation);
        const pageWidth = mmToPx(paperSize.width, 96);
        const pageHeight = mmToPx(paperSize.height, 96);
        const marginX = mmToPx(page.marginX ?? page.margin ?? 15, 96); // 左右余白
        const marginY = mmToPx(page.marginY ?? page.margin ?? 15, 96); // 上下余白

        // 配置可能エリア（間隔分を引く）
        const totalGapX = gapX * (cols - 1);
        const totalGapY = gapY * (rows - 1);
        const availableWidth = pageWidth - marginX * 2 - totalGapX;
        const availableHeight = pageHeight - marginY * 2 - totalGapY;

        // 最大セルサイズ（グリッドの1マス分）
        const maxCellWidth = availableWidth / cols;
        const maxCellHeight = availableHeight / rows;

        // 最初のスニペットのアスペクト比を取得（トリミング時のズームを考慮）
        const firstSnippet = snippets[0];
        const cropZoom = firstSnippet?.cropZoom || 1;
        const originalWidth = (firstSnippet?.cropArea.width || 100) * cropZoom;
        const originalHeight = (firstSnippet?.cropArea.height || 100) * cropZoom;
        const aspectRatio = originalWidth / originalHeight;

        // アスペクト比を維持しながら最大セルに収まるサイズを計算
        let cellWidth: number;
        let cellHeight: number;
        if (maxCellWidth / maxCellHeight > aspectRatio) {
          // セルが横長 → 高さに合わせる
          cellHeight = maxCellHeight;
          cellWidth = cellHeight * aspectRatio;
        } else {
          // セルが縦長 → 幅に合わせる
          cellWidth = maxCellWidth;
          cellHeight = cellWidth / aspectRatio;
        }

        // 1ページあたりの容量
        const capacity = cols * rows;
        const totalSnippets = snippets.length;
        const numPagesNeeded = Math.ceil(totalSnippets / capacity);

        // 自動ページ作成が有効で、複数ページが必要な場合
        if (autoCreatePages && numPagesNeeded > 1) {
          // 現在のページのインデックスを取得
          const currentPageIndex = layoutPages.findIndex((p) => p.id === pageId);

          // 必要な追加ページを作成
          const newPages: LayoutPage[] = [];
          for (let i = 1; i < numPagesNeeded; i++) {
            newPages.push({
              id: generateId(),
              paperSize: page.paperSize,
              orientation: page.orientation,
              snippets: [],
              textElements: [],
              shapeElements: [],
            });
          }

          // 各ページにスニペットを分配
          const allPageIds = [pageId, ...newPages.map((p) => p.id)];
          const snippetsByPage: Record<string, PlacedSnippet[]> = {};

          allPageIds.forEach((pid) => {
            snippetsByPage[pid] = [];
          });

          snippets.forEach((snippet, index) => {
            const pageIndex = Math.floor(index / capacity);
            const positionInPage = index % capacity;
            const col = cols - 1 - (positionInPage % cols); // 右から左へ
            const row = Math.floor(positionInPage / cols);

            const targetPageId = allPageIds[pageIndex];
            snippetsByPage[targetPageId].push({
              snippetId: snippet.id,
              position: {
                x: col * (cellWidth + gapX),
                y: row * (cellHeight + gapY),
              },
              size: {
                width: cellWidth,
                height: cellHeight,
              },
              rotation: 0,
            });
          });

          // ストアを更新
          set((state) => {
            // 既存ページを更新し、新しいページを挿入
            const updatedPages = state.layoutPages.map((p) =>
              p.id === pageId ? { ...p, snippets: snippetsByPage[pageId] } : p
            );

            // 現在のページの後ろに新しいページを挿入
            const insertIndex = currentPageIndex + 1;
            const finalPages = [
              ...updatedPages.slice(0, insertIndex),
              ...newPages.map((np) => ({ ...np, snippets: snippetsByPage[np.id] })),
              ...updatedPages.slice(insertIndex),
            ];

            return { layoutPages: finalPages };
          });
        } else {
          // 1ページで収まる場合、または自動作成無効の場合
          const newPlacedSnippets = snippets.map((snippet, index) => {
            const col = cols - 1 - (index % cols); // 右から左へ
            const row = Math.floor(index / cols);

            return {
              snippetId: snippet.id,
              position: {
                x: col * (cellWidth + gapX),
                y: row * (cellHeight + gapY),
              },
              size: {
                width: cellWidth,
                height: cellHeight,
              },
              rotation: 0,
            };
          });

          set((state) => ({
            layoutPages: state.layoutPages.map((p) =>
              p.id === pageId ? { ...p, snippets: newPlacedSnippets } : p
            ),
          }));
        }
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

      // 端をぴったりくっつける（選択したスニペットを隙間なく並べる）
      packSnippets: (pageId: string, direction: 'horizontal' | 'vertical') => {
        const { layoutPages, selectedSnippetIds } = get();
        const page = layoutPages.find((p) => p.id === pageId);
        if (!page || selectedSnippetIds.length < 2) return;

        // Undo用に履歴を保存
        get().pushLayoutHistory();

        const selectedPlaced = page.snippets
          .filter((s) => selectedSnippetIds.includes(s.snippetId))
          .sort((a, b) =>
            direction === 'horizontal'
              ? a.position.x - b.position.x
              : a.position.y - b.position.y
          );

        // 最初のスニペットの位置を基準に、隙間なく並べる
        const positionMap = new Map<string, { x: number; y: number }>();

        if (direction === 'horizontal') {
          let currentX = selectedPlaced[0].position.x;
          selectedPlaced.forEach((s) => {
            positionMap.set(s.snippetId, { x: currentX, y: s.position.y });
            currentX += s.size.width; // 隙間なし
          });
        } else {
          let currentY = selectedPlaced[0].position.y;
          selectedPlaced.forEach((s) => {
            positionMap.set(s.snippetId, { x: s.position.x, y: currentY });
            currentY += s.size.height; // 隙間なし
          });
        }

        set((state) => ({
          layoutPages: state.layoutPages.map((p) =>
            p.id === pageId
              ? {
                  ...p,
                  snippets: p.snippets.map((s) => {
                    const newPos = positionMap.get(s.snippetId);
                    return newPos ? { ...s, position: newPos } : s;
                  }),
                }
              : p
          ),
        }));
      },

      // ページ内のスニペットに間隔を適用
      adjustPageSnippetsGap: (pageId: string, gapX: number, gapY: number) => {
        const { layoutPages } = get();
        const page = layoutPages.find((p) => p.id === pageId);
        if (!page || page.snippets.length === 0) return;

        // Undo用に履歴を保存
        get().pushLayoutHistory();

        // 現在の配置からグリッド構造を推定
        const snippets = [...page.snippets].sort((a, b) => {
          // Y座標でグループ化し、同じ行内ではX座標でソート
          const rowDiff = Math.round(a.position.y / 50) - Math.round(b.position.y / 50);
          if (rowDiff !== 0) return rowDiff;
          return a.position.x - b.position.x;
        });

        if (snippets.length === 0) return;

        // 行ごとにグループ化
        const rows: typeof snippets[] = [];
        let currentRow: typeof snippets = [];
        let lastY = snippets[0].position.y;

        snippets.forEach((s) => {
          if (Math.abs(s.position.y - lastY) > 30) {
            if (currentRow.length > 0) rows.push(currentRow);
            currentRow = [s];
            lastY = s.position.y;
          } else {
            currentRow.push(s);
          }
        });
        if (currentRow.length > 0) rows.push(currentRow);

        // 各行内で間隔を適用
        const positionMap = new Map<string, { x: number; y: number }>();
        let currentY = rows[0]?.[0]?.position.y ?? 0;

        rows.forEach((row) => {
          // 行内を右から左に並べ直す（X座標でソート）
          row.sort((a, b) => a.position.x - b.position.x);

          let currentX = row[0]?.position.x ?? 0;
          row.forEach((s) => {
            positionMap.set(s.snippetId, { x: currentX, y: currentY });
            currentX += s.size.width + gapX;
          });

          // 次の行のY位置を計算
          const maxHeight = Math.max(...row.map((s) => s.size.height));
          currentY += maxHeight + gapY;
        });

        set((state) => ({
          layoutPages: state.layoutPages.map((p) =>
            p.id === pageId
              ? {
                  ...p,
                  snippets: p.snippets.map((s) => {
                    const newPos = positionMap.get(s.snippetId);
                    return newPos ? { ...s, position: newPos } : s;
                  }),
                }
              : p
          ),
        }));
      },

      // 全スニペットを詰め直す（トリミング後の再配置用）
      // basis: 'right-top' = 縦書き用（右上基準）, 'left-top' = 横書き用（左上基準）
      // 余白内に収まる範囲でスマートに詰める（シェルフ式ビンパッキング）
      repackAllSnippets: (pageId: string, basis: 'right-top' | 'left-top') => {
        const { layoutPages } = get();
        const page = layoutPages.find((p) => p.id === pageId);
        if (!page || page.snippets.length === 0) return;

        // Undo用に履歴を保存
        get().pushLayoutHistory();

        // 用紙サイズと余白を取得
        const paperDimensions = getPaperDimensions(page.paperSize, page.orientation);
        const marginX = mmToPx(page.marginX ?? page.margin ?? 15, 96); // 左右余白
        const marginY = mmToPx(page.marginY ?? page.margin ?? 15, 96); // 上下余白
        const paperWidthPx = mmToPx(paperDimensions.width, 96);
        const paperHeightPx = mmToPx(paperDimensions.height, 96);
        const availableWidth = paperWidthPx - marginX * 2;
        const availableHeight = paperHeightPx - marginY * 2;

        // スニペットを作成順（ID順）でソート
        // snippetsストアから元のスニペットの順序を取得
        const { snippets: allSnippets } = get();
        const snippetOrder = new Map<string, number>();
        allSnippets.forEach((s, index) => {
          snippetOrder.set(s.id, index);
        });

        const snippetsToPlace = [...page.snippets].sort((a, b) => {
          const orderA = snippetOrder.get(a.snippetId) ?? 0;
          const orderB = snippetOrder.get(b.snippetId) ?? 0;
          return orderA - orderB; // 作成順（ID順）
        });

        // 行ごとに配置（シンプルな順次配置）
        // ※位置は余白からの相対座標で保存（LayoutCanvasで余白分を加算して表示）
        const positionMap = new Map<string, { x: number; y: number }>();

        let currentY = 0;            // 現在の行のY位置（余白からの相対）
        let currentRowHeight = 0;    // 現在の行の高さ
        let currentRowUsedWidth = 0; // 現在の行の使用幅

        // 各スニペットを順番に配置
        snippetsToPlace.forEach((snippet) => {
          const snipWidth = snippet.size.width;
          const snipHeight = snippet.size.height;

          // 現在の行に入るか確認
          if (currentRowUsedWidth + snipWidth > availableWidth && currentRowUsedWidth > 0) {
            // 入らない場合は次の行へ
            currentY += currentRowHeight;
            currentRowHeight = 0;
            currentRowUsedWidth = 0;
          }

          // 用紙の下端を超えないか確認（余白内に収まるか）
          if (currentY + snipHeight > availableHeight) {
            // 用紙に収まらない場合は元の位置を維持
            positionMap.set(snippet.snippetId, { ...snippet.position });
            return;
          }

          // 配置位置を計算（余白からの相対座標）
          let x: number;
          if (basis === 'right-top') {
            // 右から配置: 配置可能幅 - 使用済み幅 - このスニペットの幅
            x = availableWidth - currentRowUsedWidth - snipWidth;
          } else {
            // 左から配置: 使用済み幅
            x = currentRowUsedWidth;
          }

          positionMap.set(snippet.snippetId, { x, y: currentY });
          currentRowUsedWidth += snipWidth;
          currentRowHeight = Math.max(currentRowHeight, snipHeight);
        });

        set((state) => ({
          layoutPages: state.layoutPages.map((p) =>
            p.id === pageId
              ? {
                  ...p,
                  snippets: p.snippets.map((s) => {
                    const newPos = positionMap.get(s.snippetId);
                    return newPos ? { ...s, position: newPos } : s;
                  }),
                }
              : p
          ),
        }));
      },

      // 全ページを跨いで詰め直す
      // 最初のページの設定を引き継いで全スニペットを詰め直し、空ページは削除
      repackAcrossPages: (basis: 'right-top' | 'left-top') => {
        const { layoutPages, snippets: allSnippets } = get();
        if (layoutPages.length === 0) return;

        // Undo用に履歴を保存
        get().pushLayoutHistory();

        // 最初のページから設定を取得
        const firstPage = layoutPages[0];
        const basePaperSize = firstPage.paperSize;
        const baseOrientation = firstPage.orientation;
        const baseMarginX = firstPage.marginX ?? firstPage.margin ?? 15;
        const baseMarginY = firstPage.marginY ?? firstPage.margin ?? 15;

        // 全ページからスニペットを収集
        const allPlacedSnippets: { snippetId: string; size: Size; position: Position; rotation: number }[] = [];
        layoutPages.forEach((page) => {
          page.snippets.forEach((placed) => {
            allPlacedSnippets.push({ ...placed });
          });
        });

        if (allPlacedSnippets.length === 0) return;

        // ID順にソート
        const snippetOrder = new Map<string, number>();
        allSnippets.forEach((s, index) => {
          snippetOrder.set(s.id, index);
        });
        allPlacedSnippets.sort((a, b) => {
          const orderA = snippetOrder.get(a.snippetId) ?? 0;
          const orderB = snippetOrder.get(b.snippetId) ?? 0;
          return orderA - orderB;
        });

        // 用紙設定: 最初のページの設定を使用
        const paperSize = getPaperDimensions(basePaperSize, baseOrientation);
        const marginXPx = mmToPx(baseMarginX, 96);
        const marginYPx = mmToPx(baseMarginY, 96);
        const paperWidthPx = mmToPx(paperSize.width, 96);
        const paperHeightPx = mmToPx(paperSize.height, 96);
        const availableWidth = paperWidthPx - marginXPx * 2;
        const availableHeight = paperHeightPx - marginYPx * 2;

        // ページごとにスニペットを振り分け
        const pagesData: { snippets: { snippetId: string; size: Size; position: Position; rotation: number }[] }[] = [];
        let currentPageSnippets: { snippetId: string; size: Size; position: Position; rotation: number }[] = [];
        let currentY = 0;
        let currentRowHeight = 0;
        let currentRowUsedWidth = 0;

        allPlacedSnippets.forEach((snippet) => {
          const snipWidth = snippet.size.width;
          const snipHeight = snippet.size.height;

          // 現在の行に入るか確認
          if (currentRowUsedWidth + snipWidth > availableWidth && currentRowUsedWidth > 0) {
            currentY += currentRowHeight;
            currentRowHeight = 0;
            currentRowUsedWidth = 0;
          }

          // 現在のページに入るか確認
          if (currentY + snipHeight > availableHeight) {
            // 次のページへ
            if (currentPageSnippets.length > 0) {
              pagesData.push({ snippets: currentPageSnippets });
            }
            currentPageSnippets = [];
            currentY = 0;
            currentRowHeight = 0;
            currentRowUsedWidth = 0;
          }

          // 配置位置を計算
          let x: number;
          if (basis === 'right-top') {
            x = availableWidth - currentRowUsedWidth - snipWidth;
          } else {
            x = currentRowUsedWidth;
          }

          currentPageSnippets.push({
            snippetId: snippet.snippetId,
            size: snippet.size,
            position: { x, y: currentY },
            rotation: 0,
          });

          currentRowUsedWidth += snipWidth;
          currentRowHeight = Math.max(currentRowHeight, snipHeight);
        });

        // 最後のページを追加
        if (currentPageSnippets.length > 0) {
          pagesData.push({ snippets: currentPageSnippets });
        }

        // 新しいページ構成を作成（最初のページの設定を引き継ぐ）
        const newLayoutPages: LayoutPage[] = pagesData.map((pageData, index) => ({
          id: `page-${Date.now()}-${index}`,
          paperSize: basePaperSize,
          orientation: baseOrientation,
          snippets: pageData.snippets,
          textElements: [],
          shapeElements: [],
          marginX: baseMarginX,
          marginY: baseMarginY,
        }));

        set({
          layoutPages: newLayoutPages,
          activeLayoutPageId: newLayoutPages.length > 0 ? newLayoutPages[0].id : null,
        });
      },

      // 全ページのスニペットサイズを統一（1ページ目基準、縦横比維持）
      unifyAllPagesSnippetSize: () => {
        const { layoutPages } = get();
        if (layoutPages.length === 0) return;

        const firstPage = layoutPages[0];
        if (firstPage.snippets.length === 0) return;

        // Undo用に履歴を保存
        get().pushLayoutHistory();

        // 1ページ目の最初のスニペットのサイズを基準にする
        const baseSnippet = firstPage.snippets[0];
        const baseWidth = baseSnippet.size.width;

        set((state) => ({
          layoutPages: state.layoutPages.map((page) => ({
            ...page,
            snippets: page.snippets.map((s) => {
              // 縦横比を維持してリサイズ
              const aspectRatio = s.size.height / s.size.width;
              return {
                ...s,
                size: {
                  width: baseWidth,
                  height: baseWidth * aspectRatio,
                },
              };
            }),
          })),
        }));
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

      // テキスト要素操作
      addTextElement: (pageId: string, position: Position) => {
        get().pushLayoutHistory();

        const newTextElement: TextElement = {
          id: generateId(),
          content: 'テキスト',
          position,
          size: { width: 100, height: 200 },
          fontSize: 16,
          fontFamily: 'serif',
          color: '#000000',
          writingMode: 'vertical',  // デフォルトは縦書き
          textAlign: 'left',
        };

        set((state) => ({
          layoutPages: state.layoutPages.map((page) =>
            page.id === pageId
              ? { ...page, textElements: [...page.textElements, newTextElement] }
              : page
          ),
        }));
      },

      updateTextElement: (pageId: string, textId: string, updates: Partial<TextElement>) => {
        set((state) => ({
          layoutPages: state.layoutPages.map((page) =>
            page.id === pageId
              ? {
                  ...page,
                  textElements: page.textElements.map((t) =>
                    t.id === textId ? { ...t, ...updates } : t
                  ),
                }
              : page
          ),
        }));
      },

      removeTextElement: (pageId: string, textId: string) => {
        get().pushLayoutHistory();
        set((state) => ({
          layoutPages: state.layoutPages.map((page) =>
            page.id === pageId
              ? { ...page, textElements: page.textElements.filter((t) => t.id !== textId) }
              : page
          ),
        }));
      },

      // 図形要素操作
      addShapeElement: (pageId: string, shapeType: ShapeType, position: Position) => {
        get().pushLayoutHistory();

        const newShape: ShapeElement = {
          id: generateId(),
          shapeType,
          position,
          size: shapeType === 'line' ? { width: 100, height: 2 } : { width: 80, height: 80 },
          strokeColor: '#000000',
          strokeWidth: 2,
          fillColor: 'transparent',
        };

        set((state) => ({
          layoutPages: state.layoutPages.map((page) =>
            page.id === pageId
              ? { ...page, shapeElements: [...(page.shapeElements || []), newShape] }
              : page
          ),
        }));
      },

      updateShapeElement: (pageId: string, shapeId: string, updates: Partial<ShapeElement>) => {
        set((state) => ({
          layoutPages: state.layoutPages.map((page) =>
            page.id === pageId
              ? {
                  ...page,
                  shapeElements: (page.shapeElements || []).map((s) =>
                    s.id === shapeId ? { ...s, ...updates } : s
                  ),
                }
              : page
          ),
        }));
      },

      removeShapeElement: (pageId: string, shapeId: string) => {
        get().pushLayoutHistory();
        set((state) => ({
          layoutPages: state.layoutPages.map((page) =>
            page.id === pageId
              ? { ...page, shapeElements: (page.shapeElements || []).filter((s) => s.id !== shapeId) }
              : page
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
