import { contextBridge, ipcRenderer, type IpcRendererEvent } from 'electron'
import type { ReviewProgress, UpdateState, YolkApi } from '../shared/api'

const api: YolkApi = {
  getUpdateState: () => ipcRenderer.invoke('update:state'),
  update: (action) => ipcRenderer.invoke('update:action', action),
  onUpdateState: (listener) => {
    const handler = (_event: IpcRendererEvent, state: UpdateState) => listener(state)
    ipcRenderer.on('update:state', handler)
    return () => ipcRenderer.off('update:state', handler)
  },
  getSettings: () => ipcRenderer.invoke('settings:get'),
  saveSettings: (update) => ipcRenderer.invoke('settings:save', update),
  saveConvention: (repo, text) => ipcRenderer.invoke('settings:convention', repo, text),
  saveJudging: (judging) => ipcRenderer.invoke('settings:judging', judging),
  listRepositories: () => ipcRenderer.invoke('repos:list'),
  listPullRequests: (repo, state) => ipcRenderer.invoke('prs:list', repo, state),
  startReview: (url, reviewId) => ipcRenderer.invoke('review:start', url, reviewId),
  cancelReview: (reviewId) => ipcRenderer.send('review:cancel', reviewId),
  explainUnit: (reviewId, fileIndex, unitId) => ipcRenderer.invoke('review:explain', reviewId, fileIndex, unitId),
  explainSelection: (reviewId, fileIndex, lines) => ipcRenderer.invoke('review:explain-selection', reviewId, fileIndex, lines),
  onReviewProgress: (listener) => {
    const handler = (_event: IpcRendererEvent, progress: ReviewProgress) => listener(progress)
    ipcRenderer.on('review:progress', handler)
    return () => ipcRenderer.off('review:progress', handler)
  },
}

contextBridge.exposeInMainWorld('yolk', api)
