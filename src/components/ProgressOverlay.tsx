// =============================================================================
// プログレスオーバーレイコンポーネント
// P1-009: プログレス表示
// =============================================================================

import { X, Loader } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { formatTime } from '../utils/helpers';
import type { ProgressInfo } from '../types';

interface ProgressOverlayProps {
  progress: ProgressInfo;
}

export function ProgressOverlay({ progress }: ProgressOverlayProps) {
  const { cancelOCR } = useAppStore();

  const percentage = Math.round((progress.current / progress.total) * 100);

  return (
    <div className="modal-overlay">
      <div className="modal-content p-6">
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Loader className="w-5 h-5 text-blue-500 animate-spin" />
            <h3 className="font-medium">処理中...</h3>
          </div>
          <button
            className="p-1 hover:bg-gray-100 rounded"
            onClick={cancelOCR}
            title="キャンセル"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <p className="text-sm text-gray-600 mb-4">{progress.message}</p>

        {/* プログレスバー */}
        <div className="progress-bar mb-2">
          <div
            className="progress-bar-fill"
            style={{ width: `${percentage}%` }}
          />
        </div>

        <div className="flex justify-between text-sm text-gray-500">
          <span>
            {progress.current} / {progress.total} ({percentage}%)
          </span>
          {progress.estimatedTimeRemaining !== undefined && (
            <span>
              残り約 {formatTime(progress.estimatedTimeRemaining)}
            </span>
          )}
        </div>
      </div>
    </div>
  );
}
