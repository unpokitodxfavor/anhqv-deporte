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
        this.lastWorkingChar = null; // Guardará el canal que acepte escrituras
        this.authKey = null; // 16 bytes ArrayBuffer
        this.authenticated = false;
        this.activityBuffer = new Uint8Array(0);
        this.activityChunks = []; // Almacén de trozos para evitar realocación continua
        this.totalReceived = 0;
        this.lastUiUpdate = 0;
        this.syncWatchdog = null; // Watchdog para el primer paquete de sync
        this.syncTimeout = null; // Watchdog para la inactividad durante el sync
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

                            // Log descriptivo de propiedades
                            const props = Object.keys(c.properties).filter(key => c.properties[key]);
                            this.log(`Característica hallada: ${c.uuid.substring(0, 8)}... Props: [${props.join(', ')}]`, "ble");
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

        // Fallback dinámico basado en UUIDs
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

                // Configurar el listener de datos una sola vez
                this.fetchDataChar.removeEventListener('characteristicvaluechanged', this._activityDataBound);
                this._activityDataBound = (e) => this._handleActivityData(e);
                this.fetchDataChar.addEventListener('characteristicvaluechanged', this._activityDataBound);

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

        // Limpiar acumuladores y contadores
        this.activityBuffer = new Uint8Array(0);
        this.activityChunks = [];
        this.totalReceived = 0;
        this.lastUiUpdate = 0;

        // Iniciar Watchdog de seguridad (10 segundos para recibir el primer paquete)
        if (this.syncWatchdog) clearTimeout(this.syncWatchdog);
        this.syncWatchdog = setTimeout(() => {
            if (this.totalReceived === 0) {
                this.log("Sincronización fallida por tiempo de espera. El reloj no respondió al comando.", "error");
                this._finalizeSync();
            }
        }, 10000);

        if (!this.fetchControlChar) {
            throw new Error("Característica de control no encontrada. El sync no es posible.");
        }

        try {
            // SEGURIDAD MÁXIMA: Liberamos el canal de autenticación.
            if (this.authChar) {
                try {
                    this.log("Limpiando canal Auth...", "ble");
                    await this.authChar.stopNotifications();
                } catch (e) { }
            }

            // Espera mayor (2s) para estabilización de hardware
            this.log("Esperando estabilización de hardware (2s)...", "system");
            await new Promise(r => setTimeout(r, 2000));

            this.log("Habilitando notificaciones en canal Data...", "ble");
            await this.fetchDataChar.startNotifications();
            // El listener ahora se configura en connect/autoConnect para evitar duplicidad

            // Si hay un canal de control específico, también pedimos notificaciones por si acaso
            if (this.fetchControlChar && this.fetchControlChar.uuid !== this.fetchDataChar.uuid) {
                try {
                    this.log("Habilitando notificaciones en canal Control...", "ble");
                    await this.fetchControlChar.startNotifications();
                } catch (e) { }
            }

            this.log("Enviando comando de RESET antes de iniciar sync...", "ble");
            try {
                await this.fetchControlChar.writeValue(new Uint8Array([0x01, 0x00]));
                await new Promise(r => setTimeout(r, 500));
            } catch (e) { }

            const fetchCmd = new Uint8Array([0x01, 0x01]);

            // ESTRATEGIA DE ESCRITURA EXPERIMENTAL
            const attemptWrite = async (char, label) => {
                this.log(`Intentando enviar comando a ${label}...`, "ble");
                try {
                    await char.writeValue(fetchCmd);
                    this.lastWorkingChar = char; // Guardamos el éxito
                    return true;
                } catch (e) {
                    this.log(`Fallo writeValue en ${label}: ${e.message}`, "error");
                    try {
                        this.log(`Probando fallback WithoutResponse en ${label}...`, "ble");
                        await char.writeValueWithoutResponse(fetchCmd);
                        this.lastWorkingChar = char; // Guardamos el éxito
                        return true;
                    } catch (e2) {
                        this.log(`Fallo total en ${label}: ${e2.message}`, "error");
                        return false;
                    }
                }
            };

            let success = await attemptWrite(this.fetchControlChar, "FETCH_CONTROL (0005)");

            // Si falla el canal primario, probamos el de DATA (algunos modelos lo prefieren)
            if (!success && this.fetchDataChar && this.fetchDataChar.uuid !== this.fetchControlChar.uuid) {
                this.log("Reintentando con canal alternativo (PATCH)...", "system");
                success = await attemptWrite(this.fetchDataChar, "FETCH_DATA (0004)");
            }

            if (!success) {
                throw new Error("No se pudo enviar el comando a ninguna característica. El reloj ha rechazado la operación.");
            }

            this.log("¡Comando aceptado! Esperando bytes del reloj...", "system");
        } catch (err) {
            this.log(`ERROR crítico de sincronización: ${err.message}`, "error");
            this.log("TIP: Reinicia el Bluetooth y cierra Zepp/Notify de fondo.", "system");
            throw err;
        }
    }

    _handleActivityData(event) {
        const data = new Uint8Array(event.target.value.buffer);

        // Detección de tipos de paquetes sin loguear datos brutos (Velocidad Crítica)
        const isControl = data.length <= 3 && data[0] === 0x10;
        const isHeader = data.length === 15 && data[0] === 0x10;

        if (isControl || isHeader) {
            const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
            this.log(`Control: [${hex}] (${data.length} bytes)`, "ble");
        }

        if (isControl) {
            const cmdReply = data[1];
            const status = data[2];

            if (cmdReply === 0x01 && status === 0x01) {
                if (this.totalReceived === 0) {
                    this.log("Handshake inicial OK (10 01 01).", "ble");
                    if (this.syncWatchdog) clearTimeout(this.syncWatchdog);
                } else if (this.totalReceived > 1000) {
                    this.log("¡Señal de finalización detectada!", "system");
                    this._finalizeSync();
                }
                return;
            }

            if (cmdReply === 0x01 && status === 0x02) {
                this.log("Rechazo 0x01. Iniciando modo de compatibilidad (Full Sync)...", "error");
                this._retryWithExtendedCommand();
                return;
            }

            if (cmdReply === 0x03 && status === 0x01) {
                this.log("Puerta 0x03 abierta. Disparando 0x05...", "ble");
                setTimeout(() => this._sendSyncAck(new Uint8Array([0x05])), 50);
                return;
            }

            if (cmdReply === 0x05 && status === 0x02) {
                this.log("Rechazo 0x05. Probando 0x04...", "error");
                setTimeout(() => this._sendSyncAck(new Uint8Array([0x04])), 50);
                return;
            }

            if (cmdReply === 0x04 && status === 0x02) {
                this.log("Rechazo 0x04. Probando 0x01...", "error");
                setTimeout(() => this._sendSyncAck(new Uint8Array([0x01])), 50);
                return;
            }

            // Cualquier otro paquete de control no se acumula
            return;
        }

        // Cabecera v2 detectada
        if (isHeader && data[1] === 0x01) {
            const lastByte = data[14];
            this.log(`Cabecera v2 detectada (Index: ${lastByte}). Iniciando transferencia...`, "ble");
            this._sendSyncAck(new Uint8Array([0x02, lastByte]));
            return; // No acumulamos la cabecera en el buffer de datos
        }

        // ACUMULACIÓN ULTRA-RÁPIDA (Solo datos reales)
        this.activityChunks.push(data);
        const oldTotal = this.totalReceived;
        this.totalReceived += data.length;

        // ACK PROGRESIVO: Si no enviamos nada, el reloj se pausa cada 2-4KB.
        // Enviamos un confirmador ligero cada 2KB para mantener el flujo abierto.
        if (Math.floor(this.totalReceived / 2048) > Math.floor(oldTotal / 2048)) {
            this._sendSyncAck(new Uint8Array([0x02]));
        }

        // Throttling y Detección de Inactividad
        if (this.syncTimeout) clearTimeout(this.syncTimeout);
        this.syncTimeout = setTimeout(() => this._finalizeSync(), 3000); // 3s de silencio = FIN

        const now = Date.now();
        if (now - this.lastUiUpdate > 300) {
            this.lastUiUpdate = now;
            window.dispatchEvent(new CustomEvent('amazfit-progress', {
                detail: { received: this.totalReceived }
            }));

            // Log cada 10KB para no saturar el DOM
            if (Math.floor(this.totalReceived / 10240) > Math.floor((this.totalReceived - data.length) / 10240)) {
                this.log(`Descargado: ${Math.floor(this.totalReceived / 1024)} KB...`, "system");
            }
        }
    }

    _finalizeSync() {
        if (this.syncTimeout) clearTimeout(this.syncTimeout);
        if (this.syncWatchdog) clearTimeout(this.syncWatchdog);
        this.syncTimeout = null;
        this.syncWatchdog = null;

        // Reconstrucción única y final (O(n))
        const fullBuffer = new Uint8Array(this.totalReceived);
        if (this.totalReceived > 0) {
            this.log(`Finalizando captura. Reconstruyendo ${this.totalReceived} bytes...`, "system");
            let offset = 0;
            for (const chunk of this.activityChunks) {
                fullBuffer.set(chunk, offset);
                offset += chunk.length;
            }
        }

        this.activityBuffer = fullBuffer;
        this.activityChunks = []; // Liberar memoria

        window.dispatchEvent(new CustomEvent('amazfit-data', {
            detail: {
                fullBuffer: this.activityBuffer,
                complete: true
            }
        }));
    }

    async _retryWithExtendedCommand() {
        this.log("Esperando pausa de seguridad antes del reintento (1.5s)...", "system");
        await new Promise(r => setTimeout(r, 1500));

        this.log("Iniciando modo de compatibilidad (Full Sync)...", "system");
        try {
            // Comando extendido con timestamp NULL (10 bytes en total)
            const extendedCmd = new Uint8Array([0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);

            // Usamos el canal que funcionó antes (lastWorkingChar)
            const char = this.lastWorkingChar || this.fetchControlChar;

            try {
                await char.writeValue(extendedCmd);
            } catch (e) {
                await char.writeValueWithoutResponse(extendedCmd);
            }
            this.log("Comando extendido enviado con éxito.", "ble");
        } catch (err) {
            this.log(`Fallo crítico en reintento: ${err.message}`, "error");
        }
    }

    async _sendSyncAck(ackCmd) {
        if (!(ackCmd instanceof Uint8Array)) {
            ackCmd = new Uint8Array([ackCmd]);
        }

        try {
            const char = this.lastWorkingChar || this.fetchControlChar;
            if (!char) return;

            // PRIORIDAD A WithoutResponse PARA MÁXIMA VELOCIDAD
            try {
                await char.writeValueWithoutResponse(ackCmd);
            } catch (e) {
                await char.writeValue(ackCmd);
            }
        } catch (err) {
            // Silencioso durante el sync para no frenar el proceso
            if (this.totalReceived === 0) console.error("Error ACK:", err.message);
        }
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
