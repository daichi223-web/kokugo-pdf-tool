// =============================================================================
// ヘッダーコンポーネント
// =============================================================================

import { FileText, Layout, Settings } from 'lucide-react';
import { useAppStore } from '../stores/appStore';

export function Header() {
  const { activeTab, setActiveTab } = useAppStore();

  return (
    <header className="bg-white border-b shadow-sm">
      <div className="flex items-center justify-between px-4 py-2">
        {/* ロゴ */}
        <div className="flex items-center gap-2">
          <FileText className="w-6 h-6 text-blue-600" />
          <h1 className="text-lg font-bold text-gray-800">国語PDF編集ツール</h1>
        </div>

        {/* タブ */}
        <nav className="flex items-center gap-1">
          <button
            className={`tab ${activeTab === 'extract' ? 'active' : ''}`}
            onClick={() => setActiveTab('extract')}
          >
            <span className="flex items-center gap-1">
              <FileText className="w-4 h-4" />
              テキスト抽出
            </span>
          </button>
          <button
            className={`tab ${activeTab === 'layout' ? 'active' : ''}`}
            onClick={() => setActiveTab('layout')}
          >
            <span className="flex items-center gap-1">
              <Layout className="w-4 h-4" />
              トリミング・配置
            </span>
          </button>
        </nav>

        {/* 設定ボタン */}
        <button className="toolbar-button" title="設定">
          <Settings className="w-5 h-5" />
        </button>
      </div>
    </header>
  );
}
