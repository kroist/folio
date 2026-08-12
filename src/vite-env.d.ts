/// <reference types="vite/client" />

import type { FolioApi } from './types'

declare global {
  interface Window {
    folio: FolioApi
  }
}
