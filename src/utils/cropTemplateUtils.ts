// =============================================================================
// 切り出しテンプレート管理
// CROP-006: サイズテンプレート（全体/ファイル/ページ）
// =============================================================================

export interface CropTemplate {
  width: number;
  height: number;
  createdAt: number;
}

export type TemplateScope = 'global' | 'file' | 'page';

const STORAGE_PREFIX = 'cropTemplates';
const MAX_TEMPLATES = 10;

/**
 * ストレージキーを生成
 */
function getStorageKey(scope: TemplateScope, fileId?: string, pageNumber?: number): string {
  switch (scope) {
    case 'global':
      return `${STORAGE_PREFIX}:global`;
    case 'file':
      return `${STORAGE_PREFIX}:file:${fileId}`;
    case 'page':
      return `${STORAGE_PREFIX}:page:${fileId}:${pageNumber}`;
  }
}

/**
 * テンプレート一覧を取得
 */
export function getTemplates(
  scope: TemplateScope,
  fileId?: string,
  pageNumber?: number
): CropTemplate[] {
  const key = getStorageKey(scope, fileId, pageNumber);
  try {
    const stored = localStorage.getItem(key);
    return stored ? JSON.parse(stored) : [];
  } catch {
    return [];
  }
}

/**
 * テンプレートを保存
 * 同じサイズは最新で上書き、最大10件
 */
export function saveTemplate(
  scope: TemplateScope,
  template: CropTemplate,
  fileId?: string,
  pageNumber?: number
): void {
  const key = getStorageKey(scope, fileId, pageNumber);
  let templates = getTemplates(scope, fileId, pageNumber);

  // 同じサイズを除去（誤差5px以内は同一とみなす）
  templates = templates.filter(
    (t) => Math.abs(t.width - template.width) > 5 || Math.abs(t.height - template.height) > 5
  );

  // 先頭に追加
  templates.unshift({
    ...template,
    createdAt: Date.now(),
  });

  // 最大件数に制限
  templates = templates.slice(0, MAX_TEMPLATES);

  localStorage.setItem(key, JSON.stringify(templates));
}

/**
 * 最新のテンプレートを取得
 */
export function getLatestTemplate(
  scope: TemplateScope,
  fileId?: string,
  pageNumber?: number
): CropTemplate | null {
  const templates = getTemplates(scope, fileId, pageNumber);
  return templates[0] || null;
}

/**
 * テンプレートをクリア
 */
export function clearTemplates(
  scope: TemplateScope,
  fileId?: string,
  pageNumber?: number
): void {
  const key = getStorageKey(scope, fileId, pageNumber);
  localStorage.removeItem(key);
}

/**
 * すべてのスコープから最新テンプレートを取得（優先順位: ページ > ファイル > 全体）
 */
export function getLatestTemplateAny(
  fileId: string,
  pageNumber: number
): { template: CropTemplate; scope: TemplateScope } | null {
  // ページ優先
  const pageTemplate = getLatestTemplate('page', fileId, pageNumber);
  if (pageTemplate) return { template: pageTemplate, scope: 'page' };

  // ファイル
  const fileTemplate = getLatestTemplate('file', fileId);
  if (fileTemplate) return { template: fileTemplate, scope: 'file' };

  // 全体
  const globalTemplate = getLatestTemplate('global');
  if (globalTemplate) return { template: globalTemplate, scope: 'global' };

  return null;
}

/**
 * サイズを画像境界内にクランプ
 */
export function clampSelectionToImage(
  selection: { x: number; y: number; width: number; height: number },
  imageWidth: number,
  imageHeight: number
): { x: number; y: number; width: number; height: number } {
  let { x, y, width, height } = selection;

  // サイズが画像を超える場合は縮小
  width = Math.min(width, imageWidth);
  height = Math.min(height, imageHeight);

  // 位置をクランプ
  x = Math.max(0, Math.min(x, imageWidth - width));
  y = Math.max(0, Math.min(y, imageHeight - height));

  return { x, y, width, height };
}

/**
 * テンプレートサイズを中心基準で適用
 */
export function applyTemplateAtCenter(
  template: CropTemplate,
  centerX: number,
  centerY: number,
  imageWidth: number,
  imageHeight: number
): { x: number; y: number; width: number; height: number } {
  const x = centerX - template.width / 2;
  const y = centerY - template.height / 2;

  return clampSelectionToImage(
    { x, y, width: template.width, height: template.height },
    imageWidth,
    imageHeight
  );
}
