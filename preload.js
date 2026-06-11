const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('electronAPI', {
    /**
     * Obtains the local IPv4 address of the machine.
     */
    getLocalIp: () => ipcRenderer.invoke('get-local-ip'),
	
	/**
     * Opens a file dialog to select the Vertex AI JSON key file.
     */
    selectJsonFile: () => ipcRenderer.invoke('select-json-file'),

    /**
     * Triggers the folder selection dialog and starts the monitoring 
     * process immediately using the provided Auth details.
     */
	selectAndStart: (authMethod, authCredential, modelName, commanderSide, instructionsRed, instructionsBlue, intervalTime) => 
        ipcRenderer.invoke('select-and-start', authMethod, authCredential, modelName, commanderSide, instructionsRed, instructionsBlue, intervalTime),
	
    /**
     * Stops the active monitoring interval in the main process.
     */
    stopMonitor: () => ipcRenderer.invoke('stop-monitor'),

    /**
     * Listens for log updates sent from the main process to be 
     * displayed in the UI log console.
     */
    onLogMessage: (callback) => ipcRenderer.on('log-message', (event, message, type) => callback(message, type)),
	
	/**
     * Listens for battlefield state updates to draw on the Leaflet map
     */
    onUpdateMap: (callback) => ipcRenderer.on('update-map', (event, state) => callback(state))
});