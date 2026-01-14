// =============================================================================
// 型定義 - 大学入試国語PDF編集ツール
// =============================================================================

// PDF関連の型
export interface PDFFile {
  id: string;
  name: string;
  file: File;
  pageCount: number;
  pages: PDFPage[];
  status: FileStatus;
  error?: string;
  createdAt: Date;
}

export interface PDFPage {
  pageNumber: number;
  width: number;
  height: number;
  imageData?: string; // Base64 encoded image
  textContent?: string;
  ocrStatus: OCRStatus;
  ocrProgress: number;
}

export type FileStatus = 'pending' | 'processing' | 'completed' | 'error';
export type OCRStatus = 'pending' | 'processing' | 'completed' | 'failed';

// OCR関連の型
export interface OCRResult {
  text: string;
  confidence: number;
  blocks: OCRBlock[];
}

export interface OCRBlock {
  text: string;
  bbox: BoundingBox;
  confidence: number;
}

export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

// スニペット（トリミング）関連の型
export interface Snippet {
  id: string;
  sourceFileId: string;
  sourcePageNumber: number;
  cropArea: CropArea;
  imageData: string; // Base64 encoded image
  createdAt: Date;
}

export interface CropArea {
  x: number;
  y: number;
  width: number;
  height: number;
}

// レイアウト関連の型
export interface LayoutPage {
  id: string;
  paperSize: PaperSize;
  snippets: PlacedSnippet[];
}

export interface PlacedSnippet {
  snippetId: string;
  position: Position;
  size: Size;
  rotation: number;
}

export interface Position {
  x: number;
  y: number;
}

export interface Size {
  width: number;
  height: number;
}

export type PaperSize = 'A4' | 'B4';

export const PAPER_SIZES: Record<PaperSize, { width: number; height: number; label: string }> = {
  A4: { width: 210, height: 297, label: 'A4 (210×297mm)' },
  B4: { width: 257, height: 364, label: 'B4 (257×364mm)' },
};

// エクスポート設定の型
export interface ExportOptions {
  format: ExportFormat;
  includeRuby: boolean;
  paperSize: PaperSize;
  dpi: number;
  margin: number;
}

export type ExportFormat = 'txt' | 'md' | 'docx' | 'pdf';

// プログレス関連の型
export interface ProgressInfo {
  current: number;
  total: number;
  message: string;
  estimatedTimeRemaining?: number;
}

// 設定関連の型
export interface AppSettings {
  rubyBracketMode: boolean; // true: 漢字（かんじ）, false: 漢字のみ
  showGrid: boolean;
  gridSize: number;
  snapToGrid: boolean;
  defaultPaperSize: PaperSize;
}

// ストア関連の型
export interface AppState {
  // ファイル管理
  files: PDFFile[];
  activeFileId: string | null;
  activePageNumber: number;

  // スニペット管理
  snippets: Snippet[];

  // レイアウト管理
  layoutPages: LayoutPage[];
  activeLayoutPageId: string | null;

  // 設定
  settings: AppSettings;

  // 処理状態
  isProcessing: boolean;
  progress: ProgressInfo | null;

  // UI状態
  activeTab: 'extract' | 'layout';
  selectedSnippetId: string | null;
}

// アクション型
export interface AppActions {
  // ファイル操作
  addFiles: (files: File[]) => Promise<void>;
  removeFile: (fileId: string) => void;
  setActiveFile: (fileId: string | null) => void;
  setActivePage: (pageNumber: number) => void;
  updatePageText: (fileId: string, pageNumber: number, text: string) => void;

  // OCR操作
  startOCR: (fileId: string) => Promise<void>;
  cancelOCR: () => void;

  // スニペット操作
  addSnippet: (snippet: Omit<Snippet, 'id' | 'createdAt'>) => void;
  removeSnippet: (snippetId: string) => void;

  // レイアウト操作
  addLayoutPage: (paperSize: PaperSize) => void;
  removeLayoutPage: (pageId: string) => void;
  setActiveLayoutPage: (pageId: string | null) => void;
  addSnippetToLayout: (pageId: string, snippetId: string, position: Position) => void;
  updateSnippetPosition: (pageId: string, snippetId: string, position: Position) => void;
  updateSnippetSize: (pageId: string, snippetId: string, size: Size) => void;
  removeSnippetFromLayout: (pageId: string, snippetId: string) => void;

  // エクスポート操作
  exportText: (fileId: string, format: ExportFormat) => Promise<void>;
  exportLayoutPDF: () => Promise<void>;
  copyToClipboard: (text: string) => Promise<void>;

  // 設定操作
  updateSettings: (settings: Partial<AppSettings>) => void;

  // UI操作
  setActiveTab: (tab: 'extract' | 'layout') => void;
  setSelectedSnippet: (snippetId: string | null) => void;
  setProgress: (progress: ProgressInfo | null) => void;
}
