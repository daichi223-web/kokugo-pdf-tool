// =============================================================================
// メインアプリケーションコンポーネント
// NF-001: Webアプリケーション
// =============================================================================

import { useEffect } from 'react';
import { useAppStore } from './stores/appStore';
import { Header } from './components/Header';
import { Sidebar } from './components/Sidebar';
import { ExtractView } from './components/ExtractView';
import { LayoutView } from './components/LayoutView';
import { ProgressOverlay } from './components/ProgressOverlay';
import { cleanupOldData } from './utils/storageUtils';

function App() {
  const { activeTab, isProcessing, progress } = useAppStore();

  // 起動時に古いデータをクリーンアップ
  useEffect(() => {
    cleanupOldData().catch(console.error);
  }, []);

  return (
    <div className="h-screen flex flex-col">
      {/* ヘッダー */}
      <Header />

      {/* メインコンテンツ */}
      <div className="flex-1 flex overflow-hidden">
        {/* サイドバー */}
        <Sidebar />

        {/* メインエリア */}
        <main className="flex-1 overflow-hidden p-4">
          {activeTab === 'extract' ? <ExtractView /> : <LayoutView />}
        </main>
      </div>

      {/* プログレスオーバーレイ */}
      {isProcessing && progress && <ProgressOverlay progress={progress} />}
    </div>
  );
}

export default App;
