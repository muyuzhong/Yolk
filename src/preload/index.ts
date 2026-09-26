import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ReviewProgress, YolkApi } from '../shared/api'

const api: YolkApi = {
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (update) => ipcRenderer.invoke('settings:save', update),
  saveConvention: (repo, text) => ipcRenderer.invoke('settings:convention', repo, text),
  listRepositories: () => ipcRenderer.invoke('repos:list'),
  listPullRequests: (repo, state) => ipcRenderer.invoke('prs:list', repo, state),
  startReview: (url, reviewId) => ipcRenderer.invoke('review:start', url, reviewId),
  cancelReview: (reviewId) => ipcRenderer.send('review:cancel', reviewId),
  explainBlock: (reviewId, fileIndex, blockId) => ipcRenderer.invoke('review:explain', reviewId, fileIndex, blockId),
  onReviewProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, progress: ReviewProgress) => listener(progress)
    ipcRenderer.on('review:progress', handler)
    return () => ipcRenderer.off('review:progress', handler)
  },
}

contextBridge.exposeInMainWorld('yolk', api)
