const { ipcRenderer } = require('electron');

let isPaused = false;  // Variable para rastrear si la ejecución está pausada

// Función para agregar mensajes al log en la interfaz
function addToLog(message) {
    const logDiv = document.getElementById('log-container');
    const newMessage = document.createElement('p');
    newMessage.textContent = message;
    logDiv.appendChild(newMessage);

    // Desplazar el log hacia abajo para ver los últimos mensajes
    logDiv.scrollTop = logDiv.scrollHeight;
}

// Escuchar los mensajes de la consola desde el main process
ipcRenderer.on('log-message', (event, message) => {
    addToLog(message);
});

// Manejador para el botón de iniciar/reanudar
document.getElementById('start-button').addEventListener('click', () => {
    if (isPaused) {
        ipcRenderer.send('resume');
        isPaused = false;
        document.getElementById('start-button').textContent = 'Iniciar';
    } else {
        const useProxies = document.getElementById('use-proxies').checked;
        const useHeadless = document.getElementById('headless-mode').checked;
        const retrySameEmailWithNewProxy = document.getElementById('retry-same-email').checked;
        const humanizedMode = document.getElementById('humanized-mode').checked;
        const numWorkers = parseInt(document.getElementById('num-workers').value, 10);  // Capturar el número de hilos (workers)
        const credentialsPath = document.getElementById('credentials-path').textContent;
        const proxiesPath = useProxies ? document.getElementById('proxies-path').textContent : null;

        console.log('Número de workers es:', numWorkers); // Log para verificar que el valor se captura correctamente

        ipcRenderer.send('start', { useProxies, useHeadless, retrySameEmailWithNewProxy, numWorkers , humanizedMode ,credentialsPath, proxiesPath });
    }
});

// Manejador para el botón de detener
document.getElementById('stop-button').addEventListener('click', () => {
    ipcRenderer.send('stop');
    isPaused = false; // Reiniciar el estado de pausa
    document.getElementById('start-button').textContent = 'Iniciar'; // Restaurar el texto original
});

// Manejador para el botón de pausar
document.getElementById('pause-button').addEventListener('click', () => {
    ipcRenderer.send('pause');
    isPaused = true;
    document.getElementById('start-button').textContent = 'Reanudar';
});

// Actualización de las estadísticas de hits, bans e invalids en la interfaz
ipcRenderer.on('update-stats', (event, { hits, bans, invalids }) => {
    document.getElementById('hits').innerText = hits;
    document.getElementById('bans').innerText = bans;
    document.getElementById('invalids').innerText = invalids;
});

// Manejadores para los botones de selección de archivos
document.getElementById('select-credentials').addEventListener('click', () => {
    ipcRenderer.send('select-credentials');
});

// Manejador para el evento de selección de proxies
document.getElementById('select-proxies').addEventListener('click', () => {
    ipcRenderer.send('select-proxies');
});

// Actualización de la interfaz con la ruta del archivo seleccionado
ipcRenderer.on('selected-credentials', (event, filePath) => {
    if (filePath) {
        document.getElementById('credentials-path').textContent = filePath;
    } else {
        alert('No se seleccionó ningún archivo de credenciales.');
    }
});

// Actualización de la interfaz con la ruta del archivo seleccionado
ipcRenderer.on('selected-proxies', (event, filePath) => {
    if (filePath) {
        document.getElementById('proxies-path').textContent = filePath;
    } else {
        alert('No se seleccionó ningún archivo de proxies.');
    }
});