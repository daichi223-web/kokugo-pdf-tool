// =============================================================================
// 作業状態の自動永続化（K-01）
// files / snippets / layout をスライス別に IndexedDB へ保存し、
// 起動時に復元する。リロード・タブ閉じで作業が消えないようにするための層。
//
// - localStorage は不可（imageData が Base64 で巨大なため容量超過する）
// - File / Date / ネストオブジェクトは structured clone でそのまま保存できる
// - 旧 storageUtils.ts（未配線の NF-005 実装）とは独立した DB を使う
// =============================================================================

import { openDB, IDBPDatabase } from 'idb';
import type { PDFFile, Snippet, LayoutPage } from '../types';

const DB_NAME = 'kokugo-pdf-workstate';
const DB_VERSION = 1;
const STORE = 'state';

// スライスのスキーマ版。復元時に不一致なら破棄する（構造変更時にここを上げる）
export const WORKSTATE_SCHEMA_VERSION = 1;

export interface FilesSlice {
  v: number;
  files: PDFFile[];
  activeFileId: string | null;
  activePageNumber: number;
}

export interface SnippetsSlice {
  v: number;
  snippets: Snippet[];
}

export interface LayoutSlice {
  v: number;
  layoutPages: LayoutPage[];
  activeLayoutPageId: string | null;
}

let dbPromise: Promise<IDBPDatabase> | null = null;

function getDB(): Promise<IDBPDatabase> {
  if (!dbPromise) {
    dbPromise = openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE)) {
          db.createObjectStore(STORE);
        }
      },
    });
  }
  return dbPromise;
}

async function putSlice(key: string, value: unknown): Promise<void> {
  const db = await getDB();
  await db.put(STORE, value, key);
}

async function getSlice<T>(key: string): Promise<T | undefined> {
  const db = await getDB();
  return db.get(STORE, key) as Promise<T | undefined>;
}

export async function saveFilesSlice(slice: Omit<FilesSlice, 'v'>): Promise<void> {
  await putSlice('files', { v: WORKSTATE_SCHEMA_VERSION, ...slice });
}

export async function saveSnippetsSlice(slice: Omit<SnippetsSlice, 'v'>): Promise<void> {
  await putSlice('snippets', { v: WORKSTATE_SCHEMA_VERSION, ...slice });
}

export async function saveLayoutSlice(slice: Omit<LayoutSlice, 'v'>): Promise<void> {
  await putSlice('layout', { v: WORKSTATE_SCHEMA_VERSION, ...slice });
}

function validSlice<T extends { v: number }>(slice: T | undefined): T | undefined {
  return slice && slice.v === WORKSTATE_SCHEMA_VERSION ? slice : undefined;
}

export async function loadWorkState(): Promise<{
  files?: FilesSlice;
  snippets?: SnippetsSlice;
  layout?: LayoutSlice;
}> {
  try {
    const [files, snippets, layout] = await Promise.all([
      getSlice<FilesSlice>('files'),
      getSlice<SnippetsSlice>('snippets'),
      getSlice<LayoutSlice>('layout'),
    ]);
    return {
      files: validSlice(files),
      snippets: validSlice(snippets),
      layout: validSlice(layout),
    };
  } catch (err) {
    console.error('作業状態の読み込みに失敗しました:', err);
    return {};
  }
}

export async function clearWorkState(): Promise<void> {
  const db = await getDB();
  await db.clear(STORE);
}
