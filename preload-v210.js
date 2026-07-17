const { contextBridge, ipcRenderer } = require('electron')

contextBridge.exposeInMainWorld('kozuDesktop', {
  version: '2.1.0-alpha.8',
  onCloseRequested(callback) {
    const listener = () => callback()
    ipcRenderer.on('app-close-requested', listener)
    return () => ipcRenderer.removeListener('app-close-requested', listener)
  },
  onSaveBeforeClose(callback) {
    const listener = () => callback()
    ipcRenderer.on('app-save-before-close', listener)
    return () => ipcRenderer.removeListener('app-save-before-close', listener)
  },
  respondClose(action) { ipcRenderer.send('app-close-response', action) },
  notifySaveComplete(success) { ipcRenderer.send('app-save-complete', Boolean(success)) },
  saveProjectBeforeClose(payload) { return ipcRenderer.invoke('save-project-before-close', payload) },
  saveProject(payload) { return ipcRenderer.invoke('save-project-v210', payload) },
  exportPng(payload) { return ipcRenderer.invoke('export-png-v210', payload) },
  printDrawing(payload) { return ipcRenderer.invoke('print-drawing-v210', payload) },
  exportPdf(payload) { return ipcRenderer.invoke('export-pdf-v210', payload) },
  showOutputFile(filePath) { return ipcRenderer.invoke('show-output-file-v210', filePath) }
})
