const { ipcRenderer } = require('electron');

let isPaused = false;  // Variable para rastrear si la ejecución está pausada
let isRunning = false; // Variable para rastrear si la ejecución está en marcha

// Función para agregar mensajes al log en la interfaz
function addToLog(message) {
    const logDiv = document.getElementById('log-container');
    const newMessage = document.createElement('p');
    newMessage.textContent = message;
    logDiv.appendChild(newMessage);

    // Desplazar el log hacia abajo para ver los últimos mensajes
    logDiv.scrollTop = logDiv.scrollHeight;
}

// Función para actualizar el estado de los botones
function updateButtonStates() {
    const startButton = getElement('start-button');
    const pauseButton = getElement('pause-button');
    const stopButton = getElement('stop-button');

    startButton.textContent = isPaused ? 'Resumir' : 'Iniciar';
    toggleButtonState(startButton, !isRunning || isPaused);
    toggleButtonState(pauseButton, isRunning && !isPaused);
    toggleButtonState(stopButton, isRunning);
}

// Función para alternar el estado de los botones
function toggleButtonState(button, isEnabled) {
    button.disabled = !isEnabled;
    button.classList.toggle('disabled-button', !isEnabled);
}

// Función para obtener elementos del DOM
function getElement(id) {
    return document.getElementById(id);
}

// Manejador para el botón de iniciar/reanudar
function handleStartButton() {
    if (isPaused) {
        ipcRenderer.send('resume');
        isPaused = false;
    } else {
        const useProxies = getElement('use-proxies').checked;
        const useHeadless = getElement('headless-mode').checked;
        const retryOnFail = getElement('retry-on-fail').checked;
        const humanizedMode = getElement('humanized-mode').checked;
        const numWorkers = parseInt(getElement('num-workers').value, 10);
        const credentialsPath = getElement('credentials-path').textContent;
        const proxiesPath = useProxies ? getElement('proxies-path').textContent : null;

        if (!credentialsPath) {
            alert('Por favor, selecciona un archivo de credenciales.');
            return;
        }
        if (useProxies && !proxiesPath) {
            alert('Por favor, selecciona un archivo de proxies.');
            return;
        }

        ipcRenderer.send('start', { useProxies, useHeadless, retryOnFail, numWorkers, humanizedMode, credentialsPath, proxiesPath });
        isRunning = true;
    }
    updateButtonStates();
}

// Manejador para el botón de detener
function handleStopButton() {
    ipcRenderer.send('stop');
    isPaused = false;
    isRunning = false;
    updateButtonStates();
}

// Manejador para el botón de pausar
function handlePauseButton() {
    ipcRenderer.send('pause');
    isPaused = true;
    updateButtonStates();
}

// Manejador para la actualización de estadísticas
function updateStats({ hits, bans, invalids }) {
    getElement('hits').innerText = hits;
    getElement('bans').innerText = bans;
    getElement('invalids').innerText = invalids;
}

// Manejadores para los botones de selección de archivos
function handleSelectCredentials() {
    ipcRenderer.send('select-credentials');
}

function handleSelectProxies() {
    ipcRenderer.send('select-proxies');
}

// Manejadores para actualizar la interfaz con la ruta del archivo seleccionado
function handleSelectedCredentials(event, filePath) {
    getElement('credentials-path').textContent = filePath || 'No se seleccionó ningún archivo de credenciales.';
}

function handleSelectedProxies(event, filePath) {
    getElement('proxies-path').textContent = filePath || 'No se seleccionó ningún archivo de proxies.';
}

// Inicializar la aplicación
function initializeApp() {
    // Vincular eventos de los botones
    getElement('start-button').addEventListener('click', handleStartButton);
    getElement('stop-button').addEventListener('click', handleStopButton);
    getElement('pause-button').addEventListener('click', handlePauseButton);
    getElement('select-credentials').addEventListener('click', handleSelectCredentials);
    getElement('select-proxies').addEventListener('click', handleSelectProxies);

    // Escuchar mensajes del proceso principal
    ipcRenderer.on('log-message', (event, message) => addToLog(message));
    ipcRenderer.on('update-stats', (event, stats) => updateStats(stats));
    ipcRenderer.on('selected-credentials', handleSelectedCredentials);
    ipcRenderer.on('selected-proxies', handleSelectedProxies);

    // Inicializar el estado de los botones
    updateButtonStates();
}

// Ejecutar la inicialización cuando el DOM esté completamente cargado
document.addEventListener('DOMContentLoaded', initializeApp);
