const { app, BrowserWindow, ipcMain, dialog } = require('electron');
const { Worker } = require('worker_threads');
const path = require('path');
const fs = require('fs');



let hits = 0;
let bans = 0;
let invalids = 0;
let workers = [];
let isRunning = false;

// Función para leer credenciales
function readCredentials(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    const lines = content.split('\n').filter(Boolean);
    return lines.map(line => {
        const [email, password] = line.split(':');
        return { email: email.trim(), password: password.trim() };
    });
}

// Función para leer proxies
function readProxies(filePath) {
    const content = fs.readFileSync(filePath, 'utf-8');
    return content.split('\n').filter(Boolean);
}

// Redirigir los mensajes de consola a la interfaz
function sendLogToRenderer(message) {
    if (BrowserWindow.getAllWindows().length > 0) {
        BrowserWindow.getAllWindows()[0].webContents.send('log', message);
    }
}

// Sobrescribir console.log para enviar mensajes al frontend
console.log = (...args) => {
    sendLogToRenderer(args.join(' '));
    process.stdout.write(args.join(' ') + '\n');
};

console.error = (...args) => {
    sendLogToRenderer(args.join(' '));
    process.stderr.write(args.join(' ') + '\n');
};

// Crear la ventana de la aplicación
function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        webPreferences: {
            preload: path.join(__dirname, 'preload.js'),
            nodeIntegration: true,
            contextIsolation: false,
        },
    });

    win.loadFile('index.html');
}


// Función para iniciar los workers
function startWorkers({ useProxies, retrySameEmailWithNewProxy, useHeadless, numWorkers , humanizedMode }) {
    const credentials = readCredentials('credentials.txt');
    const proxies = useProxies ? readProxies('proxies.txt') : [];

    for (let i = 0; i < numWorkers; i++) {
        const worker = new Worker('./worker.js', {
            workerData: {
                credentials: credentials.slice(i * credentials.length / numWorkers, (i + 1) * credentials.length / numWorkers),
                proxies,
                useProxies,
                retrySameEmailWithNewProxy,
                useHeadless,
                humanizedMode
            }
        });

        worker.on('message', (message) => {
            console.log(`Worker ${i}: ${message}`);
            BrowserWindow.getAllWindows().forEach(window => {
                window.webContents.send('log-message', `Worker ${i}: ${message}`);
            });
            if (message.includes('Inicio de sesión exitoso')) {
                hits++;
                updateStats();
            } else if (message.includes('TimeoutError detectado') || message.includes('IP bloqueada')) {
                bans++;
                updateStats();
            } else if (message.includes('El correo no está registrado.') || message.includes('Contraseña incorrecta. Cerrando navegador.')) {
                invalids++;
                updateStats();
            }
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
    BrowserWindow.getAllWindows().forEach(window => {
        window.webContents.send('update-stats', { hits, bans , invalids});
    });
}


// Eventos de IPC para manejar la interfaz
ipcMain.on('start', (event, { useProxies, retrySameEmailWithNewProxy, useHeadless, numWorkers , humanizedMode , credentialsPath, proxiesPath}) => {
    if (!isRunning) {
        console.log('Número de workers es:', numWorkers); // Log para verificar que se recibe correctamente
        startWorkers({ useProxies, retrySameEmailWithNewProxy, useHeadless, numWorkers , humanizedMode ,credentialsPath, proxiesPath });
    }
});


ipcMain.on('stop', () => {
    if (isRunning) {
        stopWorkers();
    }
});

ipcMain.on('pause', () => {
    if (isRunning) {
        pauseWorkers();
    }
});

ipcMain.on('resume', () => {
    if (isRunning) {
        resumeWorkers();
    }
});

// Seleccionar credenciales
ipcMain.on('select-credentials', (event) => {
    dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Text Files', extensions: ['txt'] }]
    }).then(result => {
        if (!result.canceled && result.filePaths.length > 0) {
            event.reply('selected-credentials', result.filePaths[0]);
        } else {
            event.reply('selected-credentials', null);
        }
    }).catch(err => {
        console.error('Error al seleccionar archivo de credenciales:', err);
        event.reply('selected-credentials', null);
    });
});

// Seleccionar proxies
ipcMain.on('select-proxies', (event) => {
    dialog.showOpenDialog({
        properties: ['openFile'],
        filters: [{ name: 'Text Files', extensions: ['txt'] }]
    }).then(result => {
        if (!result.canceled && result.filePaths.length > 0) {
            event.reply('selected-proxies', result.filePaths[0]);
        } else {
            event.reply('selected-proxies', null);
        }
    }).catch(err => {
        console.error('Error al seleccionar archivo de proxies:', err);
        event.reply('selected-proxies', null);
    });
});


// Iniciar la aplicación de Electron
app.whenReady().then(() => {
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
