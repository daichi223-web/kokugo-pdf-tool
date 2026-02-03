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
  defaultPaperSize: 'A3',
  defaultPaperOrientation: 'landscape',
  writingDirection: 'vertical', // デフォルトは縦書き（A3横）
  pdfRenderScale: 2, // PDF読み込み時の解像度スケール（デフォルト2倍）
  imageEnhancement: {
    contrast: 1.0,    // コントラスト（1.0がデフォルト）
    brightness: 1.0,  // 明るさ（1.0がデフォルト）
    textDarkness: 1.0, // 文字の濃さ（1.0がデフォルト、小さいほど濃い）
    sharpness: false, // シャープ化（デフォルトOFF）
    autoLevels: false, // オートレベル（デフォルトOFF）
    unsharpMask: false, // アンシャープマスク（デフォルトOFF）
    grayscale: false,  // グレースケール（デフォルトOFF）
  },
  layoutAnchor: 'right-top', // デフォルトは右上（縦書き用）
  showSnippetBorder: false, // スニペット縁取り（デフォルトOFF）
  snippetBorderWidth: 0.5, // 縁取り幅（mm）
  gridPattern: '4x2', // グリッドパターン（配置・詰め共通）
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
              const { settings } = get();
              // 取り込み時のデフォルト補正
              const importEnhancement = {
                contrast: 1.0,
                brightness: 1.1,      // 少し明るく
                textDarkness: 0.8,    // 文字を濃く
                sharpness: false,
                autoLevels: true,     // 白を白に、黒を黒に
                unsharpMask: false,
                grayscale: false,
              };
              const imageData = await renderPageToImage(
                pdfData.pdf,
                pageNum,
                settings.pdfRenderScale,
                importEnhancement
              );
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

      // スニペットの順序を入れ替え
      reorderSnippets: (fromIndex: number, toIndex: number) => {
        set((state) => {
          const newSnippets = [...state.snippets];
          const [removed] = newSnippets.splice(fromIndex, 1);
          newSnippets.splice(toIndex, 0, removed);
          return { snippets: newSnippets };
        });
      },

      // スニペットの改ページフラグをトグル
      toggleSnippetPageBreak: (snippetId: string) => {
        set((state) => ({
          snippets: state.snippets.map((s) =>
            s.id === snippetId ? { ...s, pageBreakBefore: !s.pageBreakBefore } : s
          ),
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
        // 新しいページを先頭に追加
        set((state) => ({
          layoutPages: [newPage, ...state.layoutPages],
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

      // 全ページの配置をクリア（スニペット自体は残す）
      clearAllPlacements: () => {
        get().pushLayoutHistory();
        set((state) => ({
          layoutPages: state.layoutPages.map((page) => ({
            ...page,
            snippets: [],
          })),
        }));
      },

      // ページ順序を移動
      moveLayoutPage: (pageId: string, direction: 'up' | 'down') => {
        set((state) => {
          const index = state.layoutPages.findIndex((p) => p.id === pageId);
          if (index === -1) return state;

          const newIndex = direction === 'up' ? index - 1 : index + 1;
          if (newIndex < 0 || newIndex >= state.layoutPages.length) return state;

          const newPages = [...state.layoutPages];
          [newPages[index], newPages[newIndex]] = [newPages[newIndex], newPages[index]];

          return { layoutPages: newPages };
        });
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

      // 左右余白の更新（配置基準点に応じてスニペット位置を補正）
      updateLayoutPageMarginX: (pageId: string, marginX: number) => {
        const { settings } = get();
        set((state) => ({
          layoutPages: state.layoutPages.map((page) => {
            if (page.id !== pageId) return page;

            const oldMarginX = page.marginX ?? page.margin ?? 15;
            const deltaMm = marginX - oldMarginX;
            // mm → px変換（96 DPI基準）
            const deltaPx = mmToPx(deltaMm, 96);

            // 配置基準点に応じた位置補正
            // right-top: 右固定（余白が増えたら左にシフト）
            // left-top: 左固定（位置そのまま）
            // center: 中央固定（余白変化の半分だけシフト）
            let adjustedSnippets = page.snippets;
            if (settings.layoutAnchor === 'right-top') {
              adjustedSnippets = page.snippets.map((s) => ({
                ...s,
                position: { ...s.position, x: s.position.x - deltaPx },
              }));
            } else if (settings.layoutAnchor === 'center') {
              adjustedSnippets = page.snippets.map((s) => ({
                ...s,
                position: { ...s.position, x: s.position.x - deltaPx / 2 },
              }));
            }
            // left-top: 位置そのまま

            return { ...page, marginX, snippets: adjustedSnippets };
          }),
        }));
      },

      // 上下余白の更新（配置基準点に応じてスニペット位置を補正）
      updateLayoutPageMarginY: (pageId: string, marginY: number) => {
        const { settings } = get();
        set((state) => ({
          layoutPages: state.layoutPages.map((page) => {
            if (page.id !== pageId) return page;

            const oldMarginY = page.marginY ?? page.margin ?? 15;
            const deltaMm = marginY - oldMarginY;
            const deltaPx = mmToPx(deltaMm, 96);

            // 上下は全て上固定（下に広がる）
            // center: 中央固定（余白変化の半分だけシフト）
            let adjustedSnippets = page.snippets;
            if (settings.layoutAnchor === 'center') {
              adjustedSnippets = page.snippets.map((s) => ({
                ...s,
                position: { ...s.position, y: s.position.y - deltaPx / 2 },
              }));
            }

            return { ...page, marginY, snippets: adjustedSnippets };
          }),
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
      // 全スニペットをグリッド配置（スニペットリストから一括配置）
      // autoCreatePages: trueの場合、グリッド容量を超えたら自動でページを追加
      // pageBreakBeforeフラグがあるスニペットは強制的に次のページに配置
      // layoutAnchor設定に応じて配置方向を変更
      arrangeAllSnippetsInGrid: (pageId: string, cols: number, rows: number, _gapX: number = 0, _gapY: number = 0, autoCreatePages: boolean = true) => {
        const { layoutPages, snippets, settings } = get();
        const page = layoutPages.find((p) => p.id === pageId);
        if (!page || snippets.length === 0) return;

        // デバッグ: スニペット数を表示
        console.log('[arrangeAllSnippetsInGrid] 開始', {
          snippetsCount: snippets.length,
          snippetIds: snippets.map(s => s.id),
          pageId,
          cols,
          rows,
        });

        // Undo用に履歴を保存
        get().pushLayoutHistory();

        // 用紙サイズを取得
        const paperSize = getPaperDimensions(page.paperSize, page.orientation);
        const pageWidth = mmToPx(paperSize.width, 96);
        const pageHeight = mmToPx(paperSize.height, 96);
        const baseMarginX = page.marginX ?? page.margin ?? 15;
        const baseMarginY = page.marginY ?? page.margin ?? 15;
        const marginX = mmToPx(baseMarginX, 96);
        const marginY = mmToPx(baseMarginY, 96);

        // 配置可能エリア
        const availableWidth = pageWidth - marginX * 2;
        const availableHeight = pageHeight - marginY * 2;

        // 最大セルサイズ（グリッドの1マス分）
        const maxCellWidth = availableWidth / cols;
        const maxCellHeight = availableHeight / rows;

        // 各スニペットのサイズを計算する関数（個別のアスペクト比を維持）
        const calculateSnippetSize = (snippet: typeof snippets[0]): { width: number; height: number } => {
          const cropZoom = snippet.cropZoom || 1;
          const originalWidth = snippet.cropArea.width * cropZoom;
          const originalHeight = snippet.cropArea.height * cropZoom;
          const aspectRatio = originalWidth / originalHeight;

          let cellWidth: number;
          let cellHeight: number;
          if (settings.writingDirection === 'vertical') {
            // 縦書き: 高さを基準に、セルに収まるようにスケール
            cellHeight = maxCellHeight;
            cellWidth = cellHeight * aspectRatio;
            // 幅がセルを超える場合は幅を基準に再計算
            if (cellWidth > maxCellWidth) {
              cellWidth = maxCellWidth;
              cellHeight = cellWidth / aspectRatio;
            }
          } else {
            // 横書き: 幅を基準に、セルに収まるようにスケール
            cellWidth = maxCellWidth;
            cellHeight = cellWidth / aspectRatio;
            // 高さがセルを超える場合は高さを基準に再計算
            if (cellHeight > maxCellHeight) {
              cellHeight = maxCellHeight;
              cellWidth = cellHeight * aspectRatio;
            }
          }
          return { width: cellWidth, height: cellHeight };
        };

        // 1ページあたりの容量
        const capacity = cols * rows;

        // 元PDFのページ番号順でソート
        const sortedSnippets = [...snippets].sort((a, b) => a.sourcePageNumber - b.sourcePageNumber);

        // ページごとにスニペットを分配（pageBreakBeforeを考慮）
        const pagesData: PlacedSnippet[][] = [[]];
        let currentPageIndex = 0;
        let positionInPage = 0;

        sortedSnippets.forEach((snippet) => {
          // 改ページフラグがある場合、または容量超過の場合は次のページへ
          if (snippet.pageBreakBefore && pagesData[currentPageIndex].length > 0) {
            currentPageIndex++;
            pagesData[currentPageIndex] = [];
            positionInPage = 0;
          } else if (positionInPage >= capacity) {
            currentPageIndex++;
            pagesData[currentPageIndex] = [];
            positionInPage = 0;
          }

          // 縦書き/横書きに応じて列位置を計算
          let col: number;
          if (settings.writingDirection === 'horizontal') {
            // 横書き: 左から右へ
            col = positionInPage % cols;
          } else {
            // 縦書き: 右から左へ
            col = cols - 1 - (positionInPage % cols);
          }
          const row = Math.floor(positionInPage / cols);

          // X座標を計算
          const x = col * maxCellWidth;

          // 各スニペット個別のサイズを計算
          const snippetSize = calculateSnippetSize(snippet);

          pagesData[currentPageIndex].push({
            snippetId: snippet.id,
            position: {
              x,
              y: row * maxCellHeight,
            },
            size: snippetSize,  // 個別のアスペクト比を維持したサイズ
            rotation: 0,
          });

          positionInPage++;
        });

        // 自動ページ作成が無効で1ページに収まらない場合は最初のページのみ
        if (!autoCreatePages) {
          set((state) => ({
            layoutPages: state.layoutPages.map((p) =>
              p.id === pageId ? { ...p, snippets: pagesData[0] } : p
            ),
          }));
          return;
        }

        // 現在のページのインデックスを取得
        const currentLayoutPageIndex = layoutPages.findIndex((p) => p.id === pageId);

        // 必要な追加ページを作成
        const newPages: LayoutPage[] = [];
        for (let i = 1; i < pagesData.length; i++) {
          newPages.push({
            id: generateId(),
            paperSize: page.paperSize,
            orientation: page.orientation,
            snippets: [],
            textElements: [],
            shapeElements: [],
            marginX: baseMarginX,
            marginY: baseMarginY,
          });
        }

        // 各ページにスニペットを設定
        const allPageIds = [pageId, ...newPages.map((p) => p.id)];
        const snippetsByPage: Record<string, PlacedSnippet[]> = {};
        allPageIds.forEach((pid, idx) => {
          snippetsByPage[pid] = pagesData[idx] || [];
        });

        // ストアを更新
        // デバッグ: 配置結果を表示
        console.log('[arrangeAllSnippetsInGrid] 配置結果', {
          pagesDataLength: pagesData.length,
          snippetsPerPage: pagesData.map((p, i) => ({ page: i, count: p.length, ids: p.map(s => s.snippetId) })),
        });

        set((state) => {
          // 既存ページを更新し、新しいページを挿入
          const updatedPages = state.layoutPages.map((p) =>
            p.id === pageId ? { ...p, snippets: snippetsByPage[pageId] } : p
          );

          // 現在のページの後ろに新しいページを挿入
          const insertIndex = currentLayoutPageIndex + 1;
          const finalPages = [
            ...updatedPages.slice(0, insertIndex),
            ...newPages.map((np) => ({ ...np, snippets: snippetsByPage[np.id] })),
            ...updatedPages.slice(insertIndex),
          ];

          return { layoutPages: finalPages };
        });
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
        const { layoutPages, settings } = get();
        const page = layoutPages.find((p) => p.id === pageId);
        if (!page || page.snippets.length === 0) return;

        // Undo用に履歴を保存
        get().pushLayoutHistory();

        // 用紙サイズと余白を取得
        const paperDimensions = getPaperDimensions(page.paperSize, page.orientation);
        const marginX = mmToPx(page.marginX ?? page.margin ?? 15, 96);
        const paperWidthPx = mmToPx(paperDimensions.width, 96);
        const contentWidth = paperWidthPx - marginX * 2;

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

        // 各行内で間隔を適用（配置基準点に応じた処理）
        const positionMap = new Map<string, { x: number; y: number }>();
        let currentY = rows[0]?.[0]?.position.y ?? 0;

        rows.forEach((row) => {
          // 行の合計幅を計算
          const totalWidth = row.reduce((sum, s) => sum + s.size.width, 0) + gapX * (row.length - 1);

          if (settings.layoutAnchor === 'right-top') {
            // 右上固定: 右端から左に配置
            row.sort((a, b) => b.position.x - a.position.x); // 右から順にソート
            let currentX = contentWidth - row[0]?.size.width;
            row.forEach((s) => {
              positionMap.set(s.snippetId, { x: currentX, y: currentY });
              currentX -= s.size.width + gapX;
            });
          } else if (settings.layoutAnchor === 'center') {
            // 中央固定: 中央から配置
            row.sort((a, b) => a.position.x - b.position.x);
            let currentX = (contentWidth - totalWidth) / 2;
            row.forEach((s) => {
              positionMap.set(s.snippetId, { x: currentX, y: currentY });
              currentX += s.size.width + gapX;
            });
          } else {
            // 左上固定: 左端から右に配置
            row.sort((a, b) => a.position.x - b.position.x);
            let currentX = row[0]?.position.x ?? 0;
            row.forEach((s) => {
              positionMap.set(s.snippetId, { x: currentX, y: currentY });
              currentX += s.size.width + gapX;
            });
          }

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

      // 全スニペットを詰め直す（Bin-Packing アルゴリズム）
      // Pythonスクリプトと同じロジック:
      // - グリッドセル単位で管理
      // - セル内に収まるなら縦に積む (Condition A: Fits)
      // - 収まらないなら次のセルへ (Condition B: Overflow)
      // - サイズは変更しない、位置のみ変更
      repackAllSnippets: (pageId: string) => {
        const { layoutPages, snippets: allSnippets, settings } = get();
        const page = layoutPages.find((p) => p.id === pageId);
        if (!page || page.snippets.length === 0) return;

        // Undo用に履歴を保存
        get().pushLayoutHistory();

        // 用紙サイズと余白を取得
        const paperDimensions = getPaperDimensions(page.paperSize, page.orientation);
        const marginX = mmToPx(page.marginX ?? page.margin ?? 15, 96);
        const marginY = mmToPx(page.marginY ?? page.margin ?? 15, 96);
        const paperWidthPx = mmToPx(paperDimensions.width, 96);
        const paperHeightPx = mmToPx(paperDimensions.height, 96);
        const availableWidth = paperWidthPx - marginX * 2;
        const availableHeight = paperHeightPx - marginY * 2;

        // 元PDFのページ番号順でソート
        const snippetPageOrder = new Map<string, number>();
        allSnippets.forEach((s) => {
          snippetPageOrder.set(s.id, s.sourcePageNumber);
        });

        const snippetsToPlace = [...page.snippets].sort((a, b) => {
          const pageA = snippetPageOrder.get(a.snippetId) ?? 0;
          const pageB = snippetPageOrder.get(b.snippetId) ?? 0;
          return pageA - pageB; // 元PDFのページ番号順
        });

        // 縦書き/横書きで方向を決定
        const isVertical = settings.writingDirection === 'vertical';

        // 配置位置を計算（サイズは変更しない）
        const positionMap = new Map<string, { x: number; y: number }>();

        if (isVertical) {
          // 縦書き: セルベースで横に配置（右→左）、列が行をまたいで揃う
          const maxSnippetWidth = Math.max(...snippetsToPlace.map((s) => s.size.width));
          const maxSnippetHeight = Math.max(...snippetsToPlace.map((s) => s.size.height));
          const cols = Math.max(1, Math.floor(availableWidth / maxSnippetWidth));
          const rows = Math.max(1, Math.floor(availableHeight / maxSnippetHeight));
          const cellWidth = availableWidth / cols;
          const cellHeight = availableHeight / rows;

          // 各セルの使用高さを追跡（セル内に縦に積む）
          const cellUsedHeight: number[][] = Array.from({ length: rows }, () => new Array(cols).fill(0));
          // 行優先・右始点で進行
          let currentCol = cols - 1;
          let currentRow = 0;

          snippetsToPlace.forEach((snippet) => {
            const height = snippet.size.height;

            // 現在のセルに収まるかチェック
            const remainingHeight = cellHeight - cellUsedHeight[currentRow][currentCol];
            if (height > remainingHeight && cellUsedHeight[currentRow][currentCol] > 0) {
              // 次のセルへ（行優先・右始点: 右→左、上→下）
              currentCol--;
              if (currentCol < 0) {
                currentCol = cols - 1;
                currentRow++;
              }
              if (currentRow >= rows) return; // 全セル使用済み
            }

            // セルの左上座標を基準に、セル内で右寄せ配置
            const cellX = currentCol * cellWidth;
            const cellY = currentRow * cellHeight;
            const x = cellX + cellWidth - snippet.size.width; // セル内右寄せ
            const y = cellY + cellUsedHeight[currentRow][currentCol];

            positionMap.set(snippet.snippetId, { x, y });

            // セル内使用高さを更新
            cellUsedHeight[currentRow][currentCol] += height;

            // セルが満杯なら次へ
            if (cellUsedHeight[currentRow][currentCol] >= cellHeight) {
              currentCol--;
              if (currentCol < 0) {
                currentCol = cols - 1;
                currentRow++;
              }
            }
          });
        } else {
          // 横書き: 縦に積む（上→下）、列内に高さが許す限り積む
          const maxSnippetWidth = Math.max(...snippetsToPlace.map((s) => s.size.width));
          const cols = Math.max(1, Math.floor(availableWidth / maxSnippetWidth));
          const cellWidth = availableWidth / cols;

          // 各列の現在のY位置を追跡
          const columnHeights: number[] = new Array(cols).fill(0);
          let currentCol = 0;

          snippetsToPlace.forEach((snippet) => {
            const height = snippet.size.height;

            // 現在の列に収まるかチェック
            const remainingHeight = availableHeight - columnHeights[currentCol];

            if (height > remainingHeight && columnHeights[currentCol] > 0) {
              // 収まらない場合、次の列へ移動
              currentCol++;
              if (currentCol >= cols) {
                // 全列が埋まった - 配置できない
                return;
              }
            }

            // 左端から右へ詰める
            const x = currentCol * cellWidth;
            const y = columnHeights[currentCol];

            positionMap.set(snippet.snippetId, { x, y });

            // 列の使用高さを更新
            columnHeights[currentCol] += height;
          });
        }

        // 位置のみ更新（サイズは絶対に変更しない）
        set((state) => ({
          layoutPages: state.layoutPages.map((p) =>
            p.id === pageId
              ? {
                  ...p,
                  snippets: p.snippets.map((s) => {
                    const newPos = positionMap.get(s.snippetId);
                    // 位置のみ更新、sizeやrotationはそのまま
                    return newPos ? { ...s, position: newPos } : s;
                  }),
                }
              : p
          ),
        }));
      },

      // 全ページを跨いで詰め直す（Bin-Packingアルゴリズム）
      // 最初のページの設定を引き継いで全スニペットを詰め直し、空ページは削除
      repackAcrossPages: (gridCols?: number, gridRows?: number) => {
        const { layoutPages, snippets: allSnippets, settings } = get();
        if (layoutPages.length === 0) return;

        // Undo用に履歴を保存
        get().pushLayoutHistory();

        // 最初のページから設定を取得
        const firstPage = layoutPages[0];
        const basePaperSize = firstPage.paperSize;
        const baseOrientation = firstPage.orientation;
        const baseMarginX = firstPage.marginX ?? firstPage.margin ?? 15;
        const baseMarginY = firstPage.marginY ?? firstPage.margin ?? 15;

        // 縦書き/横書きで方向を決定
        const isVertical = settings.writingDirection === 'vertical';

        // 全スニペットのマップを作成
        const snippetMap = new Map<string, typeof allSnippets[0]>();
        allSnippets.forEach((s) => {
          snippetMap.set(s.id, s);
        });

        // 全ページから配置済みスニペットを収集（サイズ情報を保持）
        const placedSizeMap = new Map<string, { size: Size; rotation: number }>();
        layoutPages.forEach((page) => {
          page.snippets.forEach((placed) => {
            placedSizeMap.set(placed.snippetId, { size: placed.size, rotation: placed.rotation });
          });
        });

        // 全スニペットを対象にする（配置済み＋未配置）
        // 未配置のスニペットはcropArea × cropZoomからサイズを算出
        const allTargetSnippets: { snippetId: string; size: Size; rotation: number }[] = [];

        // 既存の配置済みスニペットのサイズを基準にして未配置のサイズを決定
        const firstPlaced = placedSizeMap.size > 0 ? [...placedSizeMap.values()][0] : null;

        allSnippets.forEach((snippet) => {
          const placed = placedSizeMap.get(snippet.id);
          if (placed) {
            // 配置済み: 既存のサイズを使用
            allTargetSnippets.push({ snippetId: snippet.id, size: placed.size, rotation: placed.rotation });
          } else {
            // 未配置: cropAreaからサイズ算出、既存スニペットに揃える
            const cropZoom = snippet.cropZoom || 1;
            let size = {
              width: snippet.cropArea.width * cropZoom,
              height: snippet.cropArea.height * cropZoom,
            };
            // 既存の配置済みスニペットがあればサイズを揃える
            if (firstPlaced) {
              if (isVertical) {
                const aspectRatio = size.width / size.height;
                size = { width: firstPlaced.size.height * aspectRatio, height: firstPlaced.size.height };
              } else {
                const aspectRatio = size.height / size.width;
                size = { width: firstPlaced.size.width, height: firstPlaced.size.width * aspectRatio };
              }
            }
            allTargetSnippets.push({ snippetId: snippet.id, size, rotation: 0 });
          }
        });

        if (allTargetSnippets.length === 0) return;

        // 元PDFのページ番号順でソート
        allTargetSnippets.sort((a, b) => {
          const snippetA = snippetMap.get(a.snippetId);
          const snippetB = snippetMap.get(b.snippetId);
          const pageA = snippetA?.sourcePageNumber ?? 0;
          const pageB = snippetB?.sourcePageNumber ?? 0;
          return pageA - pageB;
        });

        const allPlacedSnippets = allTargetSnippets;

        // 用紙設定: 最初のページの設定を使用
        const paperSize = getPaperDimensions(basePaperSize, baseOrientation);
        const marginXPx = mmToPx(baseMarginX, 96);
        const marginYPx = mmToPx(baseMarginY, 96);
        const paperWidthPx = mmToPx(paperSize.width, 96);
        const paperHeightPx = mmToPx(paperSize.height, 96);
        const availableWidth = paperWidthPx - marginXPx * 2;
        const availableHeight = paperHeightPx - marginYPx * 2;

        // ページごとのスニペット配置を格納
        const pagesData: { snippets: PlacedSnippet[] }[] = [];
        let currentPageSnippets: PlacedSnippet[] = [];

        if (isVertical) {
          // 縦書き: セルベースのグリッド配置（行優先・右始点）
          // 各セルは固定位置。セル内でスニペットを縦に積み、右端揃え。
          // → 列が行をまたいで揃う
          const cols = gridCols ?? 4;
          const rows = gridRows ?? 2;

          const cellWidth = availableWidth / cols;
          const cellHeight = availableHeight / rows;

          // 各セルの使用高さを追跡
          let currentCol = cols - 1;
          let currentRow = 0;
          let currentY = 0; // セル内のY使用量

          const resetState = () => {
            currentCol = cols - 1;
            currentRow = 0;
            currentY = 0;
          };

          // 次のセルへ移動（行優先・右始点: 右→左、上→下）
          const advanceCell = () => {
            currentCol--;
            if (currentCol < 0) {
              currentCol = cols - 1;
              currentRow++;
            }
            currentY = 0;
          };

          allPlacedSnippets.forEach((snippet) => {
            const snippetData = snippetMap.get(snippet.snippetId);
            const snipHeight = snippet.size.height;

            // 改ページフラグ
            if (snippetData?.pageBreakBefore && currentPageSnippets.length > 0) {
              pagesData.push({ snippets: currentPageSnippets });
              currentPageSnippets = [];
              resetState();
            }

            // Condition B: セルに入らない場合、次のセルへ
            const remainingHeight = cellHeight - currentY;
            if (snipHeight > remainingHeight && currentY > 0) {
              advanceCell();
            }

            // Condition C: ページが満杯の場合、新しいページへ
            if (currentRow >= rows) {
              pagesData.push({ snippets: currentPageSnippets });
              currentPageSnippets = [];
              resetState();
            }

            // セルのグリッド座標から配置位置を計算（セル内右寄せ）
            const cellX = currentCol * cellWidth;
            const cellY = currentRow * cellHeight;
            const x = cellX + cellWidth - snippet.size.width; // セル内右端揃え
            const y = cellY + currentY;

            currentPageSnippets.push({
              snippetId: snippet.snippetId,
              size: snippet.size,
              position: { x, y },
              rotation: snippet.rotation,
            });

            // セル内Y位置を更新
            currentY += snipHeight;

            // セルが満杯になったら次のセルへ
            if (currentY >= cellHeight) {
              advanceCell();
            }
          });
        } else {
          // 横書き: 縦に積む（上→下）、行優先（左→右、上→下）
          // gridCols/gridRows指定があればそれを使用（4×2なら cols=4, rows=2）
          const cols = gridCols ?? 4;
          const rows = gridRows ?? 2;

          const cellWidth = availableWidth / cols;
          const cellHeight = availableHeight / rows;

          // Bin-Packing状態
          let currentCol = 0;
          let currentRow = 0;
          let currentY = 0; // セル内のY位置

          const resetState = () => {
            currentCol = 0;
            currentRow = 0;
            currentY = 0;
          };

          // 次のセルへ移動（行優先: 左→右、上→下）
          const advanceCell = () => {
            currentCol++;
            if (currentCol >= cols) {
              currentCol = 0;
              currentRow++;
            }
            currentY = 0;
          };

          allPlacedSnippets.forEach((snippet) => {
            const snippetData = snippetMap.get(snippet.snippetId);
            const snipHeight = snippet.size.height;

            // 改ページフラグ
            if (snippetData?.pageBreakBefore && currentPageSnippets.length > 0) {
              pagesData.push({ snippets: currentPageSnippets });
              currentPageSnippets = [];
              resetState();
            }

            // Condition B: セルに入らない場合、次のセルへ
            const remainingHeight = cellHeight - currentY;
            if (snipHeight > remainingHeight && currentY > 0) {
              advanceCell();
            }

            // Condition C: ページが満杯の場合、新しいページへ
            if (currentRow >= rows) {
              pagesData.push({ snippets: currentPageSnippets });
              currentPageSnippets = [];
              resetState();
            }

            // 配置位置を計算
            const x = currentCol * cellWidth;
            const y = currentRow * cellHeight + currentY;

            currentPageSnippets.push({
              snippetId: snippet.snippetId,
              size: snippet.size,
              position: { x, y },
              rotation: snippet.rotation,
            });

            // セル内Y位置を更新
            currentY += snipHeight;

            // セルが満杯になったら次のセルへ
            if (currentY >= cellHeight) {
              advanceCell();
            }
          });
        }

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
