// =============================================================================
// ストレージユーティリティ
// NF-005: データ保持 - IndexedDB使用、30日間保持
// =============================================================================

import { openDB, DBSchema, IDBPDatabase } from 'idb';

interface KokugoPDFDB extends DBSchema {
  snippets: {
    key: string;
    value: {
      id: string;
      sourceFileId: string;
      sourcePageNumber: number;
      cropArea: {
        x: number;
        y: number;
        width: number;
        height: number;
      };
      imageData: string;
      createdAt: number;
    };
    indexes: { 'by-date': number };
  };
  layouts: {
    key: string;
    value: {
      id: string;
      paperSize: string;
      snippets: Array<{
        snippetId: string;
        position: { x: number; y: number };
        size: { width: number; height: number };
        rotation: number;
      }>;
      createdAt: number;
    };
    indexes: { 'by-date': number };
  };
  settings: {
    key: string;
    value: unknown;
  };
}

const DB_NAME = 'kokugo-pdf-db';
const DB_VERSION = 1;
const RETENTION_DAYS = 30;

let dbInstance: IDBPDatabase<KokugoPDFDB> | null = null;

/**
 * データベースを取得（初期化）
 */
async function getDB(): Promise<IDBPDatabase<KokugoPDFDB>> {
  if (dbInstance) return dbInstance;

  dbInstance = await openDB<KokugoPDFDB>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      // スニペットストア
      if (!db.objectStoreNames.contains('snippets')) {
        const snippetStore = db.createObjectStore('snippets', { keyPath: 'id' });
        snippetStore.createIndex('by-date', 'createdAt');
      }

      // レイアウトストア
      if (!db.objectStoreNames.contains('layouts')) {
        const layoutStore = db.createObjectStore('layouts', { keyPath: 'id' });
        layoutStore.createIndex('by-date', 'createdAt');
      }

      // 設定ストア
      if (!db.objectStoreNames.contains('settings')) {
        db.createObjectStore('settings');
      }
    },
  });

  return dbInstance;
}

/**
 * スニペットを保存
 */
export async function saveSnippet(snippet: {
  id: string;
  sourceFileId: string;
  sourcePageNumber: number;
  cropArea: { x: number; y: number; width: number; height: number };
  imageData: string;
  createdAt: Date;
}): Promise<void> {
  const db = await getDB();
  await db.put('snippets', {
    ...snippet,
    createdAt: snippet.createdAt.getTime(),
  });
}

/**
 * スニペットを取得
 */
export async function getSnippet(id: string): Promise<KokugoPDFDB['snippets']['value'] | undefined> {
  const db = await getDB();
  return db.get('snippets', id);
}

/**
 * 全スニペットを取得
 */
export async function getAllSnippets(): Promise<KokugoPDFDB['snippets']['value'][]> {
  const db = await getDB();
  return db.getAll('snippets');
}

/**
 * スニペットを削除
 */
export async function deleteSnippet(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('snippets', id);
}

/**
 * レイアウトを保存
 */
export async function saveLayout(layout: KokugoPDFDB['layouts']['value']): Promise<void> {
  const db = await getDB();
  await db.put('layouts', layout);
}

/**
 * 全レイアウトを取得
 */
export async function getAllLayouts(): Promise<KokugoPDFDB['layouts']['value'][]> {
  const db = await getDB();
  return db.getAll('layouts');
}

/**
 * レイアウトを削除
 */
export async function deleteLayout(id: string): Promise<void> {
  const db = await getDB();
  await db.delete('layouts', id);
}

/**
 * 設定を保存
 */
export async function saveSetting(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put('settings', value, key);
}

/**
 * 設定を取得
 */
export async function getSetting<T>(key: string): Promise<T | undefined> {
  const db = await getDB();
  return db.get('settings', key) as Promise<T | undefined>;
}

/**
 * 古いデータを削除（30日以上前）
 * NF-005: 30日間保持
 */
export async function cleanupOldData(): Promise<void> {
  const db = await getDB();
  const cutoffDate = Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000;

  // 古いスニペットを削除
  const snippets = await db.getAllFromIndex('snippets', 'by-date');
  for (const snippet of snippets) {
    if (snippet.createdAt < cutoffDate) {
      await db.delete('snippets', snippet.id);
    }
  }

  // 古いレイアウトを削除
  const layouts = await db.getAllFromIndex('layouts', 'by-date');
  for (const layout of layouts) {
    if (layout.createdAt < cutoffDate) {
      await db.delete('layouts', layout.id);
    }
  }
}

/**
 * データベースをクリア
 */
export async function clearDatabase(): Promise<void> {
  const db = await getDB();
  await db.clear('snippets');
  await db.clear('layouts');
}

/**
 * ストレージ使用量を取得
 */
export async function getStorageUsage(): Promise<{ used: number; available: number }> {
  if ('storage' in navigator && 'estimate' in navigator.storage) {
    const estimate = await navigator.storage.estimate();
    return {
      used: estimate.usage || 0,
      available: estimate.quota || 0,
    };
  }
  return { used: 0, available: 0 };
}
