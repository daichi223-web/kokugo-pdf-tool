import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  optimizeDeps: {
    exclude: ['pdfjs-dist']
  },
  worker: {
    format: 'es'
  },
  build: {
    rollupOptions: {
      output: {
        manualChunks: {
          // PDF関連ライブラリ
          'pdf-libs': ['pdfjs-dist', 'pdf-lib'],
          // OCR関連
          'ocr': ['tesseract.js'],
          // Word出力
          'docx': ['docx'],
          // React関連
          'vendor': ['react', 'react-dom', 'zustand'],
        }
      }
    }
  }
})
