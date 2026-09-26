/// <reference types="vite/client" />
import type { YolkApi } from '../../shared/api'

declare global {
  interface Window {
    yolk: YolkApi
  }
}
