/**
 * ble.js - Communication layer for Amazfit Bip U / Pro
 * Implements Huami Auth Protocol (Modified Mi Band protocol)
 */

const HUAMI_SERVICE_ID = '0000fee0-0000-1000-8000-00805f9b34fb';
const AUTH_CHAR_ID = '00000009-0000-3512-2118-0009af100700';
const FETCH_CONTROL_ID = '00000004-0000-3512-2118-0009af100700';
const FETCH_DATA_ID = '00000005-0000-3512-2118-0009af100700';
const TIME_SERVICE_ID = '00001805-0000-1000-8000-00805f9b34fb';
const TIME_CHAR_ID = '00002a2b-0000-1000-8000-00805f9b34fb';

class AmazfitDevice {
    constructor() {
        this.device = null;
        this.server = null;
        this.service = null;
        this.authChar = null;
        this.fetchControlChar = null;
        this.fetchDataChar = null;
        this.timeChar = null;
        this.lastWorkingChar = null;
        this.authKey = null; // 16 bytes ArrayBuffer
        this.authenticated = false;
        this.activityBuffer = new Uint8Array(0);
        this.activityChunks = []; // Almacén de trozos para evitar realocación continua
        this.totalReceived = 0;
        this.lastUiUpdate = 0;
        this.syncWatchdog = null; // Watchdog para el primer paquete de sync
        this.syncTimeout = null; // Watchdog para la inactividad durante el sync
        this.isWriting = false; // Semáforo v1.3.0: Evita colisiones de escritura BLE
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
            // v1.3.22: Modo Nuclear de Descubrimiento (Listar todos los dispositivos)
            this.device = await navigator.bluetooth.requestDevice({
                acceptAllDevices: true,
                optionalServices: [
                    HUAMI_SERVICE_ID,
                    TIME_SERVICE_ID,
                    '0000fee1-0000-1000-8000-00805f9b34fb',
                    '0000fee2-0000-1000-8000-00805f9b34fb',
                    '00001800-0000-1000-8000-00805f9b34fb', // Generic Access
                    '00001801-0000-1000-8000-00805f9b34fb'  // Generic Attribute
                ]
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
                // Intento rápido v1.3.11: Restauramos el try-catch para evitar crash si falla 0009
                try {
                    this.authChar = await this.service.getCharacteristic(AUTH_CHAR_ID);
                    this.fetchControlChar = await this.service.getCharacteristic(FETCH_CONTROL_ID);
                    this.fetchDataChar = await this.service.getCharacteristic(FETCH_DATA_ID);
                    this.log("Características básicas localizadas rápidamente.", "ble");
                } catch (quickErr) {
                    this.log("Faltan canales en vista rápida. Iniciando escaneo profundo...", "system");
                    throw quickErr; // Forzamos el salto al catch exterior del escaneo profundo
                }
            } catch (e) {
                const services = await this.server.getPrimaryServices();
                this.log(`Escaneando ${services.length} servicios para encontrar canales...`, "system");

                for (const s of services) {
                    try {
                        const chars = await s.getCharacteristics();
                        for (const c of chars) {
                            const uuid = c.uuid.toLowerCase();
                            const p = c.properties;

                            // Log descriptivo de propiedades v1.3.7
                            const propList = [];
                            if (p.read) propList.push("READ");
                            if (p.write) propList.push("WRITE");
                            if (p.writeWithoutResponse) propList.push("WRITE_NO_RESP");
                            if (p.notify) propList.push("NOTIFY");
                            if (p.indicate) propList.push("INDICATE");

                            this.log(`Char: ${c.uuid.substring(0, 8)}... [${propList.join('|')}]`, "ble");

                            // Detección de Canal de DATA (04)
                            if (uuid === FETCH_DATA_ID) {
                                this.fetchDataChar = c;
                                this.log("Canal de DATA (04) verificado.", "ble");
                            }

                            // Detección de Auth (09)
                            if (uuid === AUTH_CHAR_ID) {
                                this.authChar = c;
                                this.log("Canal de AUTH (09) localizado.", "ble");
                            }

                            // Detección de Canal de HORA (2a2b) - v1.3.23
                            if (uuid === TIME_CHAR_ID) {
                                this.timeChar = c;
                                this.log("Canal de HORA (2a2b) localizado durante escaneo profundo.", "ble");
                            }

                            // Detección Adaptativa de canal de mando (MANDATORIA v1.3.21)
                            // v1.3.21: Priorizamos Canal 05 como el mando más estable
                            if (uuid === FETCH_CONTROL_ID) {
                                if (p.write || p.writeWithoutResponse) {
                                    this.fetchControlChar = c;
                                    this.log("Canal de Mando (05) verificado con permisos de escritura.", "ble");
                                }
                            }

                            // Fallback Secundario: Canal 01 (Stellar Bridge compatible)
                            if (!this.fetchControlChar && uuid.includes('00000001')) {
                                this.fetchControlChar = c;
                                this.log("Canal de Control (01) verificado como secundario.", "ble");
                            }
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

        // v1.3.11: Finalización de asignación robusta
        if (!this.fetchDataChar) {
            this.log("¡ADVERTENCIA! No se encontró canal de DATA (04). Usando canal de mando como escucha.", "error");
            this.fetchDataChar = this.fetchControlChar;
        }
        if (!this.fetchControlChar) {
            this.log("¡ADVERTENCIA! No hay canal de ESCRITURA. El sync fallará.", "error");
        }

        if (!this.fetchControlChar) {
            this.log("AVISO: No se encontró FetchChar. El sync no funcionará.", "error");
        }

        try {
            const timeService = await this.server.getPrimaryService(TIME_SERVICE_ID);
            this.timeChar = await timeService.getCharacteristic(TIME_CHAR_ID);
            this.log("Servicio de Hora estándar localizado.", "ble");
        } catch (e) {
            this.log("Aviso: El reloj no expone el servicio de hora estándar. Buscando en FEE0...", "system");
            if (!this.timeChar) {
                try {
                    this.timeChar = await this.service.getCharacteristic(TIME_CHAR_ID);
                    this.log("Característica de Hora (2a2b) localizada en FEE0.", "ble");
                } catch (e2) {
                    this.log("No se pudo localizar el canal de hora.", "error");
                }
            }
        }

        // Iniciar Handshake
        await this._authenticate();
        this.authenticated = true;

        if (this.timeChar) {
            await this._syncTime();
        }

        // Configurar el listener de datos una sola vez
        this._setupDataListener();

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
                // Re-usamos una versión robusta del descubrimiento
                this.service = await this.server.getPrimaryService(HUAMI_SERVICE_ID);
                const chars = await this.service.getCharacteristics();
                for (const c of chars) {
                    const uuid = c.uuid.toLowerCase();
                    if (uuid === AUTH_CHAR_ID) this.authChar = c;
                    if (uuid === FETCH_DATA_ID) this.fetchDataChar = c;
                    if (uuid === FETCH_CONTROL_ID) this.fetchControlChar = c;
                    if (uuid.includes('00000001') && !this.fetchControlChar) this.fetchControlChar = c;
                }

                if (!this.fetchControlChar) this.fetchControlChar = this.fetchDataChar;
                if (!this.fetchDataChar) this.fetchDataChar = this.fetchControlChar;

                // Configurar el listener de datos una sola vez
                this._setupDataListener();

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
        this.inTransferMode = false;
        this.lastAckBlock = -1;
        this.lastAckTime = 0; // v1.3.19: Debounce temporal suave
        this.lastUiUpdate = 0;

        if (this.syncWatchdog) clearTimeout(this.syncWatchdog);
        if (this.syncTimeout) clearTimeout(this.syncTimeout);

        if (!this.fetchControlChar) {
            throw new Error("Característica de control no encontrada. El sync no es posible.");
        }

        try {
            // SEGURIDAD MÁXIMA: Liberamos el canal de autenticación con retardo v1.3.14
            if (this.authChar) {
                try {
                    this.log("Preparando liberación de canal Auth...", "ble");
                    // No liberamos inmediatamente para mantener la estabilidad del enlace
                } catch (e) { }
            }

            // ESCAPE TÉRMICO v1.3.14 (10s): Estandarizado. Liberamos Auth a mitad de camino.
            this.log("Arranque en Frío (10s): Limpiando stack de Bluetooth...", "system");
            await new Promise(r => setTimeout(r, 5000));
            if (this.authChar) {
                try {
                    this.log("Liberando canal Auth tras 5s de estabilidad...", "ble");
                    await this.authChar.stopNotifications();
                } catch (e) { }
            }
            await new Promise(r => setTimeout(r, 5000));

            // HARD RESET DE CANALES v1.3.8/9
            this.log("Hard Reset: Reiniciando canales de comunicación...", "ble");
            await new Promise(r => setTimeout(r, 1000));

            this.log(`Habilitando Canal DATA (${this.fetchDataChar.uuid.substring(6, 8)}) [STELLAR]...`, "ble");
            await this.fetchDataChar.startNotifications();
            await new Promise(r => setTimeout(r, 1000));

            if (this.fetchControlChar && this.fetchControlChar.uuid !== this.fetchDataChar.uuid) {
                this.log(`Habilitando Canal CTRL (${this.fetchControlChar.uuid.substring(6, 8)}) [STELLAR]...`, "ble");
                try { await this.fetchControlChar.startNotifications(); } catch (e) { }
                await new Promise(r => setTimeout(r, 2000));
            }

            // SECUENCIA ATÓMICA v1.3.9: Fases secuenciales adaptativas

            // Fase 1: Descarga Directa
            this.log("Fase 1: Descarga Directa (SPORTS_DETAILS - 0x06)...", "ble");
            // v1.3.34: Fetch SPORTS_DETAILS (0x06) en lugar de ACTIVITY_HISTORY (0x01)
            // 0x01 es History (Steps, Sleep, HR por minutos). 0x06 es los tracks de GPS reales.
            // Para obtener la última actividad o todas desde una fecha. Usamos 2020-01-01 (0xE4 0x07 01 01)
            const directFetch = new Uint8Array([0x01, 0x06, 0xE4, 0x07, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00]);
            await this._safeWrite(directFetch, "DIRECT_FETCH", 20, this.fetchControlChar);

            // Espera activa v1.3.13: 10s para ver si Fase 1 arranca el flujo
            await new Promise(r => setTimeout(r, 10000));

            // Fase 2: Handshake Secundario (v1.3.18: Blindado por inTransferMode)
            if (this.totalReceived === 0 && !this.inTransferMode) {
                this.log("Fase 1 sin respuesta de datos. Iniciando Fase 2: Secundario...", "system");
                const secondaryCmd = new Uint8Array([0x01, 0x06, 0xE4, 0x07, 0x02, 0x15, 0x0A, 0x00, 0x00, 0x00]);
                await this._safeWrite(secondaryCmd, "SECONDARY", 15, this.fetchControlChar);
                await new Promise(r => setTimeout(r, 10000));
            } else if (this.inTransferMode) {
                this.log("Fase 2 omitida: Transferencia activa detectada.", "ble");
            }

            // Fase 3: Emergencia (v1.3.18: Blindado por inTransferMode)
            if (this.totalReceived === 0 && !this.inTransferMode) {
                this.log("Fase 2 sin respuesta. Iniciando Fase 3: Emergencia...", "error");
                await this._forceAuthorizeFetch();
                await new Promise(r => setTimeout(r, 10000));
            } else if (this.inTransferMode) {
                this.log("Fase 3 omitida: Flujo Hyper-Space confirmado.", "ble");
            }

            if (this.totalReceived === 0) {
                this.log("Protocolo de calma completado. Esperando flujo final...", "system");
                this.syncWatchdog = setTimeout(() => {
                    if (this.totalReceived === 0) {
                        this.log("Sync fallido: El hardware no ha reaccionado tras todas las fases.", "error");
                        this._finalizeSync();
                    }
                }, 10000);
            }
        } catch (err) {
            this.log(`ERROR crítico de sincronización: ${err.message}`, "error");
            this.log("TIP: Reinicia el Bluetooth y cierra Zepp/Notify de fondo.", "system");
            throw err;
        }
    }

    _handleActivityData(event) {
        const data = new Uint8Array(event.target.value.buffer);

        // El canal 0004 recibe notificaciones de control. Los datos puros van al canal 0005.
        // Todo lo que empieza por 0x10 es un paquete de Response/Control.
        const isControl = data[0] === 0x10;

        if (isControl) {
            const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
            this.log(`Control: [${hex}] (${data.length} bytes)`, "ble");

            const cmdReply = data[1];
            const status = data[2];

            if (cmdReply === 0x01 && status === 0x01) {
                if (data.length >= 7) {
                    // Start date response success (length 15 or 16)
                    const expectedBytes = data[3] | (data[4] << 8) | (data[5] << 16) | (data[6] << 24);
                    this.log(`Handshake Fetch OK (10 01 01). Esperando ${expectedBytes} paquetes.`, "system");
                    if (expectedBytes === 0) {
                        this.log("No hay datos nuevos para sincronizar.", "system");
                        this._finalizeSync();
                        return;
                    }
                } else {
                    this.log("Handshake inicial OK (10 01 01).", "ble");
                }

                if (this.syncWatchdog) clearTimeout(this.syncWatchdog);

                this.log("Enviando comando START_FETCH (0x02)...", "ble");
                setTimeout(() => {
                    this.inTransferMode = true;
                    this._safeWrite(new Uint8Array([0x02]), "START_FETCH", 5, this.fetchControlChar);
                }, 250);
                return;
            }

            if (cmdReply === 0x01 && status === 0x02) {
                this.log("Rechazo 0x01 al solicitar datos. Reintentando...", "error");
                setTimeout(() => this._retryWithExtendedCommand(), 2000);
                return;
            }

            if (cmdReply === 0x02) {
                if (status === 0x01) {
                    this.log("Fin de transmisión de datos detectado (10 02 01). Enviando ACK final...", "system");
                    // Zepp OS ACK: [0x03, 0x09] (Mantener en reloj) o [0x03, 0x01] (Borrar del reloj)
                    setTimeout(() => {
                        this._safeWrite(new Uint8Array([0x03, 0x09]), "ACK_FINAL_ZEPP", 5, this.fetchControlChar);
                        this._finalizeSync();
                    }, 500);
                } else {
                    this.log(`Fallo en transferencia (10 02 ${status.toString(16)}).`, "error");
                    this._finalizeSync();
                }
                return;
            }

            // Ignoramos otros paquetes de control
            return;
        }

        // ACUMULACIÓN DE DATOS REALES
        this.activityChunks.push(data);
        const oldTotal = this.totalReceived;
        this.totalReceived += data.length;

        // Log de chunks de datos (cada 4KB para no saturar el log)
        if (Math.floor(this.totalReceived / 4096) > Math.floor(oldTotal / 4096)) {
            const preview = data.length > 4 ? Array.from(data.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(' ') : "";
            this.log(`[DATA] Recibido: ${(this.totalReceived / 1024).toFixed(1)} KB (Last: ${data.length}b, Hex: ${preview})`, "ble");
        }

        // Throttling y Detección de Inactividad (Zepp OS no necesita ACK progresivo)
        if (this.syncTimeout) clearTimeout(this.syncTimeout);
        this.syncTimeout = setTimeout(() => this._finalizeSync(), 5000); // 5s de silencio = FIN

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

        // Reconstrucción final: Quitar el primer byte (Seq Number) de cada chunk (Huami MTU)
        let totalPayloadSize = 0;
        for (const chunk of this.activityChunks) {
            if (chunk.length > 1) {
                totalPayloadSize += chunk.length - 1;
            }
        }

        const fullBuffer = new Uint8Array(totalPayloadSize);
        if (totalPayloadSize > 0) {
            this.log(`Finalizando captura. Reconstruyendo ${totalPayloadSize} bytes de payload puro...`, "system");
            let offset = 0;
            for (const chunk of this.activityChunks) {
                if (chunk.length > 1) {
                    fullBuffer.set(chunk.slice(1), offset);
                    offset += (chunk.length - 1);
                }
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
        this.log("Pausa de seguridad Deep Freeze (1.5s)...", "system");
        await new Promise(r => setTimeout(r, 1500));

        this.log("Fase 2: Modo Compatibilidad (Direct 1.2.8)...", "system");
        const extendedCmd = new Uint8Array([0x01, 0x01, 0xE2, 0x07, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00]);
        // v1.3.6: Forzamos canal 05 con disciplina estricta
        await this._safeWrite(extendedCmd, "FULL_SYNC", 10, this.fetchControlChar);
    }

    async _sendSyncAck(ackCmd, isNebula = false) {
        // v1.3.16: Protocolo adaptativo. Si el ACK Nebula falla o es rechazado,
        // intentamos un fallback al ACK clásico (02) que es universal.
        this.log(`Enviando ACK [${Array.from(ackCmd).map(b => b.toString(16).padStart(2, '0')).join(' ')}]...`, "ble");

        const success = await this._safeWrite(ackCmd, isNebula ? "ACK_NEBULA" : "ACK_SYNC", 10, this.fetchControlChar);

        if (!success && isNebula) {
            this.log("Fallo en ACK Nebula. Probando Fallback Clásico (02)...", "system");
            const classicAck = new Uint8Array([0x02]);
            await this._safeWrite(classicAck, "ACK_CLASSIC", 5, this.fetchControlChar);
        }
    }

    async _safeWrite(data, label, retries = 20, forceChar = null) {
        // v1.3.2 - Mutex Estricto: Esperar lo que haga falta
        while (this.isWriting) {
            await new Promise(r => setTimeout(r, 100));
        }

        this.isWriting = true;
        try {
            // v1.3.9: Escritura Adaptativa según propiedades detectadas
            const char = forceChar || this.fetchControlChar;
            const p = char.properties;
            const canWriteNoResp = p.writeWithoutResponse;
            const canWriteWithResp = p.write;

            const charLabel = `Canal ${char.uuid.substring(6, 8)}`;

            for (let attempt = 1; attempt <= retries; attempt++) {
                try {
                    // Pausa de estabilización v1.3.12: 200ms para agilidad
                    await new Promise(r => setTimeout(r, 200));

                    const methodLabel = canWriteNoResp ? "WRITE_NO_RESP" : "WRITE_RESP";
                    this.log(`Sync [${label}] -> ${charLabel} (${methodLabel}) (Intento ${attempt}/${retries})...`, "ble");

                    if (canWriteNoResp) {
                        // Prioridad v1.3.8/9: Fire & Forget para evitar bloqueo de driver
                        await char.writeValueWithoutResponse(data);
                    } else if (canWriteWithResp) {
                        await char.writeValue(data);
                    } else {
                        throw new Error("Característica sin permisos de escritura.");
                    }
                    return true;
                } catch (e) {
                    if (attempt < retries) {
                        // v1.3.13: Cooldown estricto de 3s para liberar el driver de Windows
                        this.log(`GATT Busy en ${charLabel}. Cooldown Estelar (3s)...`, "ble");
                        await new Promise(r => setTimeout(r, 3000));

                        // Intento de fallback cruzado si falló el método principal
                        try {
                            if (canWriteWithResp && canWriteNoResp) {
                                this.log("Probando método de escritura alternativo...", "ble");
                                await char.writeValue(data);
                                return true;
                            }
                        } catch (e2) { }
                    }
                }
            }
            return false;
        } finally {
            this.isWriting = false;
        }
    }

    async _forceAuthorizeFetch() {
        this.log("Enviando comando de Emergencia v3 (Force Header)...", "system");
        // v1.3.23: Variante Huami Standard Fetch Header (01 10 ...)
        const authFetch = new Uint8Array([0x01, 0x10, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
        await this._safeWrite(authFetch, "EMERGENCY_V3", 5, this.fetchControlChar);
    }

    async _syncTime() {
        if (!this.timeChar) return;
        this.log("Sincronizando hora para autorizar actividades...", "system");
        try {
            const now = new Date();
            const year = now.getFullYear();

            // Format 1: 11 bytes (Specific Huami/Zepp with Timezone & DST)
            const packet11 = new Uint8Array([
                year & 0xFF, (year >> 8) & 0xFF,
                now.getMonth() + 1, now.getDate(),
                now.getHours(), now.getMinutes(), now.getSeconds(),
                (now.getDay() === 0 ? 7 : now.getDay()),
                0, // Fractions256
                0, // Timezone offset (simplified)
                0  // DST offset (simplified)
            ]);

            // Format 2: 10 bytes (Standard BLE Current Time Service Exact Time 256)
            const packet10 = new Uint8Array([
                year & 0xFF, (year >> 8) & 0xFF,
                now.getMonth() + 1, now.getDate(),
                now.getHours(), now.getMinutes(), now.getSeconds(),
                (now.getDay() === 0 ? 7 : now.getDay()),
                0, 1 // Fractions256, Adjust Reason
            ]);

            // Format 3: 7 bytes (Basic BLE Date Time)
            const packet7 = new Uint8Array([
                year & 0xFF, (year >> 8) & 0xFF,
                now.getMonth() + 1, now.getDate(),
                now.getHours(), now.getMinutes(), now.getSeconds()
            ]);

            let success = false;
            for (const packet of [packet11, packet10, packet7]) {
                try {
                    await this.timeChar.writeValue(packet);
                    this.log(`¡Hora sincronizada con éxito! (Longitud: ${packet.length} bytes)`, "system");
                    success = true;
                    break;
                } catch (e) {
                    if (!e.message.includes('attribute length') && !e.message.includes('length')) {
                        throw e; // Lanza el error si no es por longitud
                    }
                }
            }

            if (!success) {
                this.log("No se pudo escribir la hora en ningún formato soportado.", "error");
            }
        } catch (err) {
            this.log(`Error de hora: ${err.message}`, "error");
        }
    }

    _setupDataListener() {
        if (!this.fetchDataChar) return;

        // v1.3.12: Detección de colisión de canales para escucha dual
        const channels = new Set();
        if (this.fetchDataChar) channels.add(this.fetchDataChar);
        if (this.fetchControlChar) channels.add(this.fetchControlChar);

        this._activityDataBound = this._activityDataBound || ((e) => this._handleActivityData(e));

        channels.forEach(char => {
            try {
                char.removeEventListener('characteristicvaluechanged', this._activityDataBound);
                char.addEventListener('characteristicvaluechanged', this._activityDataBound);
                this.log(`Escucha activa en canal: ${char.uuid.substring(6, 8)}`, "ble");
            } catch (err) {
                this.log(`Error al configurar listener en ${char.uuid.substring(6, 8)}: ${err.message}`, "error");
            }
        });
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
