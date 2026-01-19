// =============================================================================
// メインアプリケーションコンポーネント
// NF-001: Webアプリケーション
// =============================================================================

import { useEffect, useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useAppStore } from './stores/appStore';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ExtractView } from './components/ExtractView';
import { LayoutView } from './components/LayoutView';
import { ProgressOverlay } from './components/ProgressOverlay';
import { cleanupOldData } from './utils/storageUtils';

function App() {
  const { activeTab, isProcessing, progress, files } = useAppStore();
  const [sidebarOpen, setSidebarOpen] = useState(false);

  // 起動時に古いデータをクリーンアップ
  useEffect(() => {
    cleanupOldData().catch(console.error);
  }, []);

  // ファイルが追加されたらサイドバーを閉じる（モバイル）
  useEffect(() => {
    if (files.length > 0 && window.innerWidth < 768) {
      setSidebarOpen(false);
    }
  }, [files.length]);

  return (
    <div className="h-screen flex flex-col">
      {/* ヘッダー */}
      <Header />

      {/* メインコンテンツ */}
      <div className="flex-1 flex overflow-hidden relative">
        {/* モバイルメニューボタン */}
        <button
          className="md:hidden fixed bottom-4 left-4 z-50 bg-blue-500 text-white p-3 rounded-full shadow-lg hover:bg-blue-600"
          onClick={() => setSidebarOpen(!sidebarOpen)}
          aria-label={sidebarOpen ? 'メニューを閉じる' : 'メニューを開く'}
        >
          {sidebarOpen ? <X className="w-6 h-6" /> : <Menu className="w-6 h-6" />}
        </button>

        {/* モバイルオーバーレイ */}
        {sidebarOpen && (
          <div
            className="md:hidden fixed inset-0 bg-black bg-opacity-50 z-30"
            onClick={() => setSidebarOpen(false)}
          />
        )}

        {/* サイドバー - モバイルではスライドイン */}
        <div
          className={`
            fixed md:static inset-y-0 left-0 z-40
            transform transition-transform duration-300 ease-in-out
            ${sidebarOpen ? 'translate-x-0' : '-translate-x-full md:translate-x-0'}
          `}
        >
          <Sidebar />
        </div>

        {/* メインエリア */}
        <main className="flex-1 overflow-hidden p-2 md:p-4">
          {activeTab === 'extract' ? <ExtractView /> : <LayoutView />}
        </main>
      </div>

      {/* プログレスオーバーレイ */}
      {isProcessing && progress && <ProgressOverlay progress={progress} />}
    </div>
  );
}

export default App;
