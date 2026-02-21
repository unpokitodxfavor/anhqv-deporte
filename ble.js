/**
 * ble.js - Communication layer for Amazfit Bip U / Pro
 * Implements Huami Auth Protocol (Modified Mi Band protocol)
 */

const HUAMI_SERVICE_ID = '0000fee0-0000-1000-8000-00805f9b34fb';
const AUTH_CHAR_ID = '00000009-0000-3512-2118-0009af100700';
const FETCH_CONTROL_ID = '00000005-0000-3512-2118-0009af100700';
const FETCH_DATA_ID = '00000004-0000-3512-2118-0009af100700';

class AmazfitDevice {
    constructor() {
        this.device = null;
        this.server = null;
        this.service = null;
        this.authChar = null;
        this.fetchControlChar = null;
        this.fetchDataChar = null;
        this.authKey = null; // 16 bytes ArrayBuffer
        this.authenticated = false;
        this.activityBuffer = new Uint8Array(0);
        this.log = (msg, type) => console.log(msg);
    }

    async connect(hexKey, logCallback) {
        if (typeof logCallback === 'function') this.log = logCallback;
        this.log("DEBUG: Entrando en AmazfitDevice.connect", "system");

        this.log("Verificando soporte de Bluetooth...", "system");

        if (!navigator.bluetooth) {
            this.log("Bluetooth no detectado en este navegador.", "error");
            throw new Error("Su navegador no soporta Web Bluetooth. Use Chrome en Android/PC (asegúrese de usar HTTPS).");
        }

        if (hexKey.length !== 32) {
            throw new Error("La Auth Key debe tener 32 caracteres hexadecimales.");
        }

        const maskedKey = hexKey.substring(0, 4) + ".".repeat(24) + hexKey.substring(28);
        this.log(`Preparando Auth Key (Masked: ${maskedKey})...`, "system");
        this.authKey = this._hexToBytes(hexKey);

        this.log("Llamando a requestDevice... (El navegador debería mostrar el diálogo ahora)", "ble");
        try {
            this.device = await navigator.bluetooth.requestDevice({
                filters: [
                    { services: [HUAMI_SERVICE_ID] },
                    { namePrefix: 'Amazfit' },
                    { namePrefix: 'Bip' }
                ],
                optionalServices: [HUAMI_SERVICE_ID, '0000fee1-0000-1000-8000-00805f9b34fb']
            });
        } catch (bleErr) {
            this.log(`Error al buscar dispositivo: ${bleErr.message}`, "error");
            throw bleErr;
        }

        this.log(`Dispositivo encontrado: ${this.device.name}. Conectando...`, "ble");
        this.server = await this.device.gatt.connect();

        this.log("Conectado al servidor GATT. Iniciando descubrimiento exhaustivo...", "ble");

        try {
            // Primero intentamos el servicio estándar
            this.service = await this.server.getPrimaryService(HUAMI_SERVICE_ID);
            this.log("Servicio 0xFEE0 encontrado. Buscando características...", "ble");

            try {
                this.authChar = await this.service.getCharacteristic(AUTH_CHAR_ID);
                this.fetchControlChar = await this.service.getCharacteristic(FETCH_CONTROL_ID);
                this.fetchDataChar = await this.service.getCharacteristic(FETCH_DATA_ID);
                this.log("Características de Auth, Control y Data listas en 0xFEE0.", "ble");
            } catch (e) {
                this.log("Faltan características en 0xFEE0. Iniciando escaneo profundo...", "system");
                const services = await this.server.getPrimaryServices();

                for (const s of services) {
                    try {
                        const chars = await s.getCharacteristics();
                        for (const c of chars) {
                            if (c.uuid === AUTH_CHAR_ID) this.authChar = c;
                            if (c.uuid === FETCH_CONTROL_ID) this.fetchControlChar = c;
                            if (c.uuid === FETCH_DATA_ID) this.fetchDataChar = c;
                        }
                    } catch (err) { }
                }
            }
        } catch (globalErr) {
            this.log(`Error crítico en descubrimiento: ${globalErr.message}`, "error");
            throw globalErr;
        }

        if (!this.authChar) {
            throw new Error("No se ha podido encontrar la característica de Autenticación (0009).");
        }

        // Fallback: si no hay 0004/0005 especializados, usamos el que esté disponible
        if (!this.fetchControlChar) this.fetchControlChar = this.fetchDataChar;
        if (!this.fetchDataChar) this.fetchDataChar = this.fetchControlChar;

        if (!this.fetchControlChar) {
            this.log("AVISO: No se encontró FetchChar. El sync no funcionará.", "error");
        }

        // Iniciar Handshake
        await this._authenticate();
        this.authenticated = true;

        // Guardar ID para auto-reconexión (si el navegador lo soporta)
        if (this.device.id) {
            localStorage.setItem('amazfit_last_device_id', this.device.id);
        }

        return this.device.name;
    }

    /**
     * Intenta reconectar a un dispositivo ya emparejado previamente
     */
    async attemptAutoConnect(hexKey, logCallback) {
        if (typeof logCallback === 'function') this.log = logCallback;

        if (!navigator.bluetooth || !navigator.bluetooth.getDevices) {
            this.log("Auto-connect no soportado en este navegador (Requiere Chrome 102+ o activar flags).", "system");
            return null;
        }

        try {
            const devices = await navigator.bluetooth.getDevices();
            if (devices.length > 0) {
                this.log(`Encontrado(s) ${devices.length} dispositivo(s) recordado(s).`, "system");
                this.device = devices[0];

                // Configurar Auth Key
                this.authKey = this._hexToBytes(hexKey);

                this.log(`Intentando auto-conectar a: ${this.device.name}...`, "ble");
                this.server = await this.device.gatt.connect();

                // El resto es igual que connect() pero sin requestDevice
                // Re-usamos una versión simplificada del descubrimiento
                this.service = await this.server.getPrimaryService(HUAMI_SERVICE_ID);
                this.authChar = await this.service.getCharacteristic(AUTH_CHAR_ID);
                this.fetchControlChar = await this.service.getCharacteristic(FETCH_CONTROL_ID);
                this.fetchDataChar = await this.service.getCharacteristic(FETCH_DATA_ID);

                if (!this.fetchControlChar) this.fetchControlChar = this.fetchDataChar;
                if (!this.fetchDataChar) this.fetchDataChar = this.fetchControlChar;

                await this._authenticate();
                this.authenticated = true;
                return this.device.name;
            }
        } catch (err) {
            this.log(`No se pudo auto-conectar: ${err.message}`, "system");
        }
        return null;
    }

    async _authenticate() {
        this.log("Iniciando handshake de autenticación...", "system");

        return new Promise(async (resolve, reject) => {
            const timeout = setTimeout(() => {
                this.authChar?.removeEventListener('characteristicvaluechanged', authHandler);
                this.log("TIMEOUT: El reloj no respondió al handshake.", "error");
                // Asegurarse de cerrar el overlay si hay timeout
                if (window.dispatchEvent) {
                    window.dispatchEvent(new CustomEvent('ble-timeout'));
                }
                reject(new Error("Tiempo de espera agotado en la autenticación."));
            }, 10000);

            const authHandler = async (event) => {
                try {
                    const value = new Uint8Array(event.target.value.buffer);
                    this.log(`Mensaje BLE recibido: ${Array.from(value).map(b => b.toString(16).padStart(2, '0')).join(' ')}`, "ble");

                    // 0x10 = Response, [1] = Opcode (02=Random, 03=Final), [2] = Status (01=Success)
                    if (value[0] === 0x10 && value[1] === 0x02 && value[2] === 0x01) {
                        this.log("Número aleatorio recibido. Encriptando y respondiendo...", "ble");
                        const random = value.slice(3);
                        const encrypted = await this._encryptAES(this.authKey, random);
                        const response = new Uint8Array(2 + encrypted.length);
                        response[0] = 0x03;
                        response[1] = 0x00;
                        response.set(encrypted, 2);
                        await this.authChar.writeValue(response);
                        this.log("Respuesta encriptada enviada.", "ble");
                    } else if (value[0] === 0x10 && value[1] === 0x03 && value[2] === 0x01) {
                        clearTimeout(timeout);
                        this.authChar.removeEventListener('characteristicvaluechanged', authHandler);
                        this.log("¡Handshake completado con éxito! Llave correcta.", "system");
                        resolve();
                    } else if (value[0] === 0x10 && value[2] !== 0x01) {
                        clearTimeout(timeout);
                        this.authChar.removeEventListener('characteristicvaluechanged', authHandler);

                        let errorMsg = `ERROR Handshake: Código ${value[2]}`;
                        if (value[1] === 0x03 && value[2] === 0x04) {
                            errorMsg = "ERROR: Auth Key INCORRECTA. El reloj ha rechazado la llave.";
                        } else if (value[1] === 0x01 && value[2] === 0x04) {
                            errorMsg = "ERROR: El reloj requiere emparejamiento previo. Pulsa 'Aceptar' en el reloj.";
                        }

                        this.log(errorMsg, "error");
                        reject(new Error(errorMsg));
                    }
                } catch (e) {
                    clearTimeout(timeout);
                    this.log(`Excepción en BLE: ${e.message}`, "error");
                    reject(e);
                }
            };

            await this.authChar.startNotifications();
            this.authChar.addEventListener('characteristicvaluechanged', authHandler);

            const reqRandom = new Uint8Array([0x02, 0x00]);
            await this.authChar.writeValue(reqRandom);
        });
    }

    async fetchActivities() {
        if (!this.authenticated) throw new Error("No autenticado");
        this.log("Solicitando lista de actividades reales...", "system");

        // Limpiar acumulador
        this.activityBuffer = new Uint8Array(0);

        if (!this.fetchControlChar) {
            throw new Error("Característica de control no encontrada. El sync no es posible.");
        }

        try {
            // SEGURIDAD: Algunos relojes fallan si hay varias notificaciones activas.
            if (this.authChar) {
                try {
                    this.log("Liberando canal de autenticación...", "ble");
                    await this.authChar.stopNotifications();
                } catch (e) { }
            }

            await new Promise(r => setTimeout(r, 1000));

            this.log("Abriendo canal de datos (Data)...", "ble");
            await this.fetchDataChar.startNotifications();
            this.fetchDataChar.addEventListener('characteristicvaluechanged', (e) => this._handleActivityData(e));

            // Si el canal de control es distinto al de datos, abrimos notificaciones también
            if (this.fetchControlChar.uuid !== this.fetchDataChar.uuid) {
                this.log("Abriendo canal de control (Fetch)...", "ble");
                await this.fetchControlChar.startNotifications();
            }

            await new Promise(r => setTimeout(r, 800));

            const fetchCmd = new Uint8Array([0x01, 0x01]);
            this.log("Enviando comando de sincronización final...", "ble");

            // Intento con writeValue (Auto)
            try {
                await this.fetchControlChar.writeValue(fetchCmd);
            } catch (writeErr) {
                this.log("Fallo writeValue estándar, intentando WithoutResponse...", "error");
                await this.fetchControlChar.writeValueWithoutResponse(fetchCmd);
            }

            this.log("Comando enviado con éxito. Esperando respuesta del reloj...", "system");
        } catch (err) {
            this.log(`ERROR sync: ${err.message}`, "error");
            throw err;
        }
    }

    _handleActivityData(event) {
        const data = new Uint8Array(event.target.value.buffer);
        this.log(`Paquete de datos recibido: ${data.length} bytes`, "ble");

        // Acumular datos
        const newBuffer = new Uint8Array(this.activityBuffer.length + data.length);
        newBuffer.set(this.activityBuffer);
        newBuffer.set(data, this.activityBuffer.length);
        this.activityBuffer = newBuffer;

        // Emitir evento para la UI con el buffer acumulado actual
        window.dispatchEvent(new CustomEvent('amazfit-data', {
            detail: {
                chunk: data,
                fullBuffer: this.activityBuffer
            }
        }));
    }

    // Helpers
    _hexToBytes(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) {
            bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
        }
        return bytes;
    }

    async _encryptAES(key, data) {
        // En un entorno real usaríamos SubtleCrypto
        // Amazfit usa AES-128 en modo ECB (sin padding)
        const cryptoKey = await window.crypto.subtle.importKey(
            'raw',
            key,
            { name: 'AES-CBC' }, // Web Crypto no soporta ECB nativo fácilmente, usamos truco o librería
            false,
            ['encrypt']
        );

        // NOTA: El handshake de Amazfit es AES-128 sin vector de inicialización (IV = 0)
        // Pero Web Crypto requiere IV para CBC. En Gadgetbridge se usa ECB.
        // Dado el entorno de navegador, si esto falla, usaremos una implementación JS ligera de AES.
        try {
            const iv = new Uint8Array(16); // Zero IV
            const enc = await window.crypto.subtle.encrypt(
                { name: 'AES-CBC', iv: iv },
                cryptoKey,
                data
            );
            return new Uint8Array(enc).slice(0, 16); // Cogemos solo el primer bloque
        } catch (e) {
            console.error("Encryption error", e);
            // Fallback: Si no funciona, el usuario tendrá que usar un navegador compatible o inyectaremos AES.js
            return data; // Provisional
        }
    }
}

window.amazfit = new AmazfitDevice();
