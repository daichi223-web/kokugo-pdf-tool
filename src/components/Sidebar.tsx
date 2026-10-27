// =============================================================================
// サイドバーコンポーネント
// P3-003: 複数PDF管理画面
// =============================================================================

import { useCallback } from 'react';
import { useDropzone, type FileRejection } from 'react-dropzone';
import {
  Upload,
  File,
  Trash2,
  AlertCircle,
  CheckCircle,
  Loader,
} from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import { formatFileSize } from '../utils/helpers';
import { MAX_PDF_SIZE_MB } from '../utils/pdfUtils';

export function Sidebar() {
  const { files, activeFileId, addFiles, removeFile, setActiveFile } = useAppStore();

  // P1-001, P1-002: PDF読み込み（単体・複数一括）
  const onDrop = useCallback(
    (acceptedFiles: File[]) => {
      const pdfFiles = acceptedFiles.filter(
        (file) => file.type === 'application/pdf'
      );
      if (pdfFiles.length > 0) {
        addFiles(pdfFiles);
      }
    },
    [addFiles]
  );

  // 上限超えなどで弾かれたファイルは黙って消えるので、理由を知らせる
  const onDropRejected = useCallback((rejections: FileRejection[]) => {
    const lines = rejections.map(({ file, errors }) => {
      const reason = errors.some((e) => e.code === 'file-too-large')
        ? `${MAX_PDF_SIZE_MB}MBを超えています（${formatFileSize(file.size)}）`
        : errors.some((e) => e.code === 'too-many-files')
          ? '一度に選べるのは10ファイルまでです'
          : errors.map((e) => e.message).join(' / ');
      return `・${file.name}: ${reason}`;
    });
    alert(`読み込めなかったファイルがあります\n${lines.join('\n')}`);
  }, []);

  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    onDropRejected,
    accept: {
      'application/pdf': ['.pdf'],
    },
    maxSize: MAX_PDF_SIZE_MB * 1024 * 1024,
    maxFiles: 10,
  });

  const getStatusIcon = (status: string) => {
    switch (status) {
      case 'completed':
        return <CheckCircle className="w-4 h-4 text-green-500" />;
      case 'processing':
        return <Loader className="w-4 h-4 text-blue-500 animate-spin" />;
      case 'error':
        return <AlertCircle className="w-4 h-4 text-red-500" />;
      default:
        return <File className="w-4 h-4 text-gray-400" />;
    }
  };

  return (
    <aside className="w-64 bg-white border-r flex flex-col">
      {/* ドロップゾーン */}
      <div className="p-3">
        <div
          {...getRootProps()}
          className={`dropzone ${isDragActive ? 'active' : ''}`}
        >
          <input {...getInputProps()} />
          <Upload className="w-8 h-8 mx-auto mb-2 text-gray-400" />
          <p className="text-sm text-gray-600">
            {isDragActive
              ? 'ここにドロップ'
              : 'PDFをドラッグ&ドロップ\nまたはクリックして選択'}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            最大10ファイル、{MAX_PDF_SIZE_MB}MB/ファイル
          </p>
        </div>
      </div>

      {/* ファイルリスト */}
      <div className="flex-1 overflow-auto p-3">
        <h3 className="text-sm font-medium text-gray-700 mb-2">
          ファイル ({files.length})
        </h3>
        {files.length === 0 ? (
          <p className="text-sm text-gray-400 text-center py-4">
            PDFファイルがありません
          </p>
        ) : (
          <ul className="space-y-2">
            {files.map((file) => (
              <li
                key={file.id}
                role="button"
                tabIndex={0}
                className={`p-2 rounded cursor-pointer transition-colors ${
                  activeFileId === file.id
                    ? 'bg-blue-50 border border-blue-200'
                    : 'hover:bg-gray-50 border border-transparent'
                }`}
                onClick={() => setActiveFile(file.id)}
                onKeyDown={(e) => e.key === 'Enter' && setActiveFile(file.id)}
                aria-selected={activeFileId === file.id}
              >
                <div className="flex items-start gap-2">
                  {getStatusIcon(file.status)}
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium truncate" title={file.name}>
                      {file.name}
                    </p>
                    <p className="text-xs text-gray-500">
                      {file.pageCount}ページ • {formatFileSize(file.file.size)}
                    </p>
                    {file.error && (
                      <p className="text-xs text-red-500 mt-1">{file.error}</p>
                    )}
                  </div>
                  <button
                    className="p-1 hover:bg-red-100 rounded"
                    onClick={(e) => {
                      e.stopPropagation();
                      removeFile(file.id);
                    }}
                    title="削除"
                    aria-label={`${file.name}を削除`}
                  >
                    <Trash2 className="w-4 h-4 text-red-500" />
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </aside>
  );
}
