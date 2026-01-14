// =============================================================================
// 外部連携ユーティリティ
// P4-001: Google Docs連携
// P4-002: Notion連携
// P4-003: OCR精度向上検討（Cloud Vision API）
// =============================================================================

// 設定をローカルストレージで管理
const STORAGE_KEY = 'kokugo-pdf-external-config';

interface StoredConfig {
  googleDocs?: Partial<GoogleDocsConfig>;
  notion?: Partial<NotionConfig>;
  cloudVision?: Partial<CloudVisionConfig>;
}

function getStoredConfig(): StoredConfig {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    return stored ? JSON.parse(stored) : {};
  } catch {
    return {};
  }
}

function saveStoredConfig(config: StoredConfig): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(config));
}

// =============================================================================
// P4-001: Google Docs連携
// =============================================================================

export interface GoogleDocsConfig {
  clientId: string;
  apiKey: string;
  scopes: string[];
}

const DEFAULT_GOOGLE_SCOPES = [
  'https://www.googleapis.com/auth/documents',
  'https://www.googleapis.com/auth/drive.file',
];

/**
 * Google Docs設定を保存
 */
export function saveGoogleDocsConfig(config: Partial<GoogleDocsConfig>): void {
  const stored = getStoredConfig();
  stored.googleDocs = { ...stored.googleDocs, ...config };
  saveStoredConfig(stored);
}

/**
 * Google Docs設定を取得
 */
export function getGoogleDocsConfig(): Partial<GoogleDocsConfig> | null {
  const stored = getStoredConfig();
  return stored.googleDocs || null;
}

/**
 * Google Docs APIの初期化
 * 注意: gapi.jsをHTMLで読み込む必要あり
 */
export async function initGoogleDocs(config: GoogleDocsConfig): Promise<boolean> {
  try {
    // gapiが存在するか確認
    if (typeof window !== 'undefined' && 'gapi' in window) {
      const gapi = (window as unknown as { gapi: { client: { init: (config: unknown) => Promise<void> } } }).gapi;
      await gapi.client.init({
        apiKey: config.apiKey,
        clientId: config.clientId,
        scope: config.scopes.join(' ') || DEFAULT_GOOGLE_SCOPES.join(' '),
        discoveryDocs: ['https://docs.googleapis.com/$discovery/rest?version=v1'],
      });
      saveGoogleDocsConfig(config);
      return true;
    }
    console.warn('Google API (gapi) not loaded. Add <script src="https://apis.google.com/js/api.js"></script> to index.html');
    return false;
  } catch (error) {
    console.error('Google Docs initialization failed:', error);
    return false;
  }
}

/**
 * Google Docsにエクスポート
 */
export async function exportToGoogleDocs(
  text: string,
  title: string
): Promise<{ documentId: string; url: string } | null> {
  try {
    if (typeof window === 'undefined' || !('gapi' in window)) {
      console.error('Google API not available');
      return null;
    }

    const gapi = (window as unknown as {
      gapi: {
        client: {
          docs: {
            documents: {
              create: (params: { title: string }) => Promise<{ result: { documentId: string } }>;
              batchUpdate: (params: { documentId: string; requests: unknown[] }) => Promise<void>;
            };
          };
        };
      };
    }).gapi;

    // ドキュメント作成
    const createResponse = await gapi.client.docs.documents.create({
      title: title,
    });
    const documentId = createResponse.result.documentId;

    // テキストを挿入
    await gapi.client.docs.documents.batchUpdate({
      documentId: documentId,
      requests: [{
        insertText: {
          location: { index: 1 },
          text: text,
        },
      }],
    });

    return {
      documentId,
      url: `https://docs.google.com/document/d/${documentId}/edit`,
    };
  } catch (error) {
    console.error('Export to Google Docs failed:', error);
    return null;
  }
}

// =============================================================================
// P4-002: Notion連携
// =============================================================================

export interface NotionConfig {
  apiKey: string;
  databaseId?: string;
  proxyUrl?: string; // CORS対策用プロキシサーバーURL
}

/**
 * Notion設定を保存
 */
export function saveNotionConfig(config: Partial<NotionConfig>): void {
  const stored = getStoredConfig();
  stored.notion = { ...stored.notion, ...config };
  saveStoredConfig(stored);
}

/**
 * Notion設定を取得
 */
export function getNotionConfig(): Partial<NotionConfig> | null {
  const stored = getStoredConfig();
  return stored.notion || null;
}

/**
 * Notion APIの初期化
 * 注意: ブラウザから直接Notion APIにアクセスするとCORSエラーになる
 * proxyUrlを設定するか、サーバーサイドでの実装を推奨
 */
export function initNotion(config: NotionConfig): boolean {
  if (!config.apiKey) {
    console.error('Notion API key is required');
    return false;
  }
  saveNotionConfig(config);
  return true;
}

/**
 * Notionにページを作成
 * proxyUrlが設定されている場合はプロキシ経由でアクセス
 */
export async function createNotionPage(
  text: string,
  title: string,
  config: NotionConfig
): Promise<{ pageId: string; url: string } | null> {
  if (!config.apiKey) {
    console.error('Notion API key not configured');
    return null;
  }

  const apiUrl = config.proxyUrl
    ? `${config.proxyUrl}/notion/pages`
    : 'https://api.notion.com/v1/pages';

  try {
    // テキストを2000文字以下のブロックに分割（Notion API制限）
    const textBlocks = [];
    for (let i = 0; i < text.length; i += 2000) {
      textBlocks.push({
        object: 'block',
        type: 'paragraph',
        paragraph: {
          rich_text: [{ text: { content: text.slice(i, i + 2000) } }],
        },
      });
    }

    const body: Record<string, unknown> = {
      properties: {
        title: { title: [{ text: { content: title } }] },
      },
      children: textBlocks,
    };

    if (config.databaseId) {
      body.parent = { database_id: config.databaseId };
    } else {
      // データベースIDがない場合はワークスペースに作成
      body.parent = { type: 'workspace', workspace: true };
    }

    const response = await fetch(apiUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${config.apiKey}`,
        'Content-Type': 'application/json',
        'Notion-Version': '2022-06-28',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      const error = await response.json();
      console.error('Notion API error:', error);
      return null;
    }

    const data = await response.json();
    return {
      pageId: data.id,
      url: data.url,
    };
  } catch (error) {
    console.error('Create Notion page failed:', error);
    return null;
  }
}

// =============================================================================
// P4-003: OCR精度向上検討 - Google Cloud Vision API
// =============================================================================

export interface CloudVisionConfig {
  apiKey: string;
}

/**
 * Cloud Vision設定を保存
 */
export function saveCloudVisionConfig(config: Partial<CloudVisionConfig>): void {
  const stored = getStoredConfig();
  stored.cloudVision = { ...stored.cloudVision, ...config };
  saveStoredConfig(stored);
}

/**
 * Cloud Vision設定を取得
 */
export function getCloudVisionConfig(): Partial<CloudVisionConfig> | null {
  const stored = getStoredConfig();
  return stored.cloudVision || null;
}

/**
 * Google Cloud Vision APIでOCR（高精度版）
 * 注意: APIコストが発生（約$1.50/1000リクエスト）
 */
export async function runCloudVisionOCR(
  imageData: string,
  config: CloudVisionConfig
): Promise<{ text: string; confidence: number } | null> {
  if (!config.apiKey) {
    console.error('Cloud Vision API key not configured');
    return null;
  }

  try {
    // Base64プレフィックスを削除
    const base64Image = imageData.replace(/^data:image\/\w+;base64,/, '');

    const response = await fetch(
      `https://vision.googleapis.com/v1/images:annotate?key=${config.apiKey}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          requests: [
            {
              image: { content: base64Image },
              features: [
                { type: 'TEXT_DETECTION' },
                { type: 'DOCUMENT_TEXT_DETECTION' }, // より詳細なテキスト検出
              ],
              imageContext: {
                languageHints: ['ja', 'ja-vert'], // 日本語（縦書き含む）
              },
            },
          ],
        }),
      }
    );

    if (!response.ok) {
      const error = await response.json();
      console.error('Cloud Vision API error:', error);
      return null;
    }

    const data = await response.json();
    const fullTextAnnotation = data.responses?.[0]?.fullTextAnnotation;

    if (!fullTextAnnotation) {
      return { text: '', confidence: 0 };
    }

    // 信頼度を計算（各シンボルの信頼度の平均）
    let totalConfidence = 0;
    let symbolCount = 0;

    for (const page of fullTextAnnotation.pages || []) {
      for (const block of page.blocks || []) {
        for (const paragraph of block.paragraphs || []) {
          for (const word of paragraph.words || []) {
            for (const symbol of word.symbols || []) {
              if (symbol.confidence !== undefined) {
                totalConfidence += symbol.confidence;
                symbolCount++;
              }
            }
          }
        }
      }
    }

    const avgConfidence = symbolCount > 0 ? (totalConfidence / symbolCount) * 100 : 95;

    return {
      text: fullTextAnnotation.text || '',
      confidence: avgConfidence,
    };
  } catch (error) {
    console.error('Cloud Vision OCR failed:', error);
    return null;
  }
}

/**
 * OCR精度比較レポート生成
 */
export function generateOCRComparisonReport(
  tesseractResult: { text: string; confidence: number },
  cloudVisionResult: { text: string; confidence: number } | null
): string {
  const report = `
# OCR精度比較レポート

## Tesseract.js (ローカル)
- 精度: ${tesseractResult.confidence.toFixed(1)}%
- 文字数: ${tesseractResult.text.length}文字
- コスト: 無料

## Google Cloud Vision API (オプション)
${
  cloudVisionResult
    ? `- 精度: ${cloudVisionResult.confidence.toFixed(1)}%
- 文字数: ${cloudVisionResult.text.length}文字
- コスト: 従量課金（約$1.50/1000リクエスト）`
    : '- 未使用'
}

## 推奨
${
  cloudVisionResult && cloudVisionResult.confidence > tesseractResult.confidence + 10
    ? '高精度が必要な場合はCloud Vision APIの使用を検討してください。'
    : 'Tesseract.jsで十分な精度が得られています。'
}
`;

  return report;
}

// =============================================================================
// 外部連携の状態管理
// =============================================================================

export interface ExternalIntegrationState {
  googleDocs: {
    enabled: boolean;
    configured: boolean;
  };
  notion: {
    enabled: boolean;
    configured: boolean;
  };
  cloudVision: {
    enabled: boolean;
    configured: boolean;
  };
}

/**
 * 外部連携の状態を取得
 */
export function getExternalIntegrationState(): ExternalIntegrationState {
  const stored = getStoredConfig();

  return {
    googleDocs: {
      enabled: !!(stored.googleDocs?.clientId && stored.googleDocs?.apiKey),
      configured: !!(stored.googleDocs?.clientId || stored.googleDocs?.apiKey),
    },
    notion: {
      enabled: !!stored.notion?.apiKey,
      configured: !!stored.notion?.apiKey,
    },
    cloudVision: {
      enabled: !!stored.cloudVision?.apiKey,
      configured: !!stored.cloudVision?.apiKey,
    },
  };
}

/**
 * 全ての外部連携設定をクリア
 */
export function clearExternalConfig(): void {
  localStorage.removeItem(STORAGE_KEY);
}

/**
 * 外部連携の設定状況をまとめて取得
 */
export function getExternalConfigSummary(): string {
  const state = getExternalIntegrationState();
  const lines: string[] = [
    '=== 外部連携設定状況 ===',
    '',
    `Google Docs: ${state.googleDocs.enabled ? '✅ 有効' : state.googleDocs.configured ? '⚠️ 設定途中' : '❌ 未設定'}`,
    `Notion: ${state.notion.enabled ? '✅ 有効' : '❌ 未設定'}`,
    `Cloud Vision API: ${state.cloudVision.enabled ? '✅ 有効' : '❌ 未設定'}`,
    '',
    '--- 設定方法 ---',
    'Google Docs: saveGoogleDocsConfig({ clientId, apiKey })',
    'Notion: saveNotionConfig({ apiKey, proxyUrl? })',
    'Cloud Vision: saveCloudVisionConfig({ apiKey })',
  ];
  return lines.join('\n');
}
