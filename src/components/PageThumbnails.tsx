// =============================================================================
// ページサムネイルコンポーネント
// =============================================================================

import { CheckCircle, AlertCircle, Loader } from 'lucide-react';
import { useAppStore } from '../stores/appStore';
import type { PDFFile } from '../types';

interface PageThumbnailsProps {
  file: PDFFile;
}

export function PageThumbnails({ file }: PageThumbnailsProps) {
  const { activePageNumber, setActivePage } = useAppStore();

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'completed':
        return (
          <span className="thumbnail-badge bg-green-500 text-white">
            <CheckCircle className="w-3 h-3" />
          </span>
        );
      case 'processing':
        return (
          <span className="thumbnail-badge bg-blue-500 text-white">
            <Loader className="w-3 h-3 animate-spin" />
          </span>
        );
      case 'failed':
        return (
          <span className="thumbnail-badge bg-red-500 text-white">
            <AlertCircle className="w-3 h-3" />
          </span>
        );
      default:
        return null;
    }
  };

  return (
    <div className="w-24 bg-gray-50 rounded-lg overflow-auto p-2">
      <div className="space-y-2">
        {file.pages.map((page) => (
          <div
            key={page.pageNumber}
            className={`thumbnail ${
              activePageNumber === page.pageNumber ? 'active' : ''
            }`}
            onClick={() => setActivePage(page.pageNumber)}
          >
            {page.imageData ? (
              <img
                src={page.imageData}
                alt={`Page ${page.pageNumber}`}
                className="w-full h-auto"
              />
            ) : (
              <div className="w-full aspect-[3/4] bg-gray-200 flex items-center justify-center">
                <span className="text-xs text-gray-400">{page.pageNumber}</span>
              </div>
            )}
            {getStatusBadge(page.ocrStatus)}
            <div className="absolute bottom-0 left-0 right-0 bg-black bg-opacity-50 text-white text-xs text-center py-0.5">
              {page.pageNumber}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
