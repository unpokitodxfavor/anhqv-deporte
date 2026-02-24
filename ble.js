/**
 * ble.js - Communication layer for Amazfit Bip U / Pro
 * Implements Huami Auth Protocol (Modified Mi Band protocol)
 */

const HUAMI_SERVICE_ID = '0000fee0-0000-1000-8000-00805f9b34fb';
const AUTH_CHAR_ID = '00000009-0000-3512-2118-0009af100700';
const FETCH_CONTROL_ID = '00000005-0000-3512-2118-0009af100700';
const FETCH_DATA_ID = '00000004-0000-3512-2118-0009af100700';
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
            this.device = await navigator.bluetooth.requestDevice({
                filters: [
                    { services: [HUAMI_SERVICE_ID] },
                    { namePrefix: 'Amazfit' },
                    { namePrefix: 'Bip' }
                ],
                optionalServices: [HUAMI_SERVICE_ID, TIME_SERVICE_ID, '0000fee1-0000-1000-8000-00805f9b34fb']
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

                                // v1.3.15: Si el mando actual no es el oficial (05), el 04 SIEMPRE gana como fallback
                                const isOfficialControl = this.fetchControlChar && this.fetchControlChar.uuid.includes('0005');
                                if ((!this.fetchControlChar || !isOfficialControl) && (p.write || p.writeWithoutResponse)) {
                                    this.fetchControlChar = c;
                                    this.log("¡Prioridad Crítica: Canal de DATOS (04) forzado como Mando!", "system");
                                }
                            }

                            // Detección de Auth (09)
                            if (uuid === AUTH_CHAR_ID) {
                                this.authChar = c;
                                this.log("Canal de AUTH (09) localizado.", "ble");
                            }

                            // Detección Adaptativa de canal de mando (MANDATORIA v1.3.10/11)
                            if (uuid === FETCH_CONTROL_ID) {
                                if (p.write || p.writeWithoutResponse) {
                                    this.fetchControlChar = c;
                                    this.log("Canal de Mando (05) verificado con permisos de escritura.", "ble");
                                } else {
                                    this.log("AVISO: Canal 05 detectado pero es SOLO NOTIFICACIÓN. Ignorando como oficial...", "system");
                                }
                            }

                            // Fallback Secundario: 01 o 03 (Solo si no hemos asignado nada aún, ni siquiera 04)
                            if (!this.fetchControlChar && (p.write || p.writeWithoutResponse) && s.uuid === HUAMI_SERVICE_ID) {
                                if (uuid.includes('00000001') || uuid.includes('00000003')) {
                                    this.fetchControlChar = c;
                                    this.log(`¡Canal de mando adaptativo secundario asignado a: ${c.uuid.substring(0, 8)}!`, "system");
                                }
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
            this.log("Servicio de Hora localizado.", "ble");
        } catch (e) {
            this.log("Aviso: El reloj no expone el servicio de hora estándar.", "system");
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
                // Re-usamos una versión simplificada del descubrimiento
                this.service = await this.server.getPrimaryService(HUAMI_SERVICE_ID);
                this.authChar = await this.service.getCharacteristic(AUTH_CHAR_ID);
                this.fetchControlChar = await this.service.getCharacteristic(FETCH_CONTROL_ID);
                this.fetchDataChar = await this.service.getCharacteristic(FETCH_DATA_ID);

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
            this.log("Fase 1: Descarga Directa (Detección Adaptativa)...", "ble");
            const directFetch = new Uint8Array([0x01, 0x01, 0xE2, 0x07, 0x01, 0x01, 0x00, 0x00, 0x00, 0x00]);
            await this._safeWrite(directFetch, "DIRECT_FETCH", 20, this.fetchControlChar);

            // Espera activa v1.3.13: 10s para ver si Fase 1 arranca el flujo
            await new Promise(r => setTimeout(r, 10000));

            // Fase 2: Handshake Secundario (Si no hay datos)
            if (this.totalReceived === 0) {
                this.log("Fase 1 sin respuesta de datos. Iniciando Fase 2: Secundario...", "system");
                const secondaryCmd = new Uint8Array([0x01, 0x01, 0xE8, 0x07, 0x02, 0x15, 0x0A, 0x00, 0x00, 0x00]);
                await this._safeWrite(secondaryCmd, "SECONDARY", 15, this.fetchControlChar);
                await new Promise(r => setTimeout(r, 10000));
            }

            // Fase 3: Emergencia (Si sigue sin haber datos)
            if (this.totalReceived === 0) {
                this.log("Fase 2 sin respuesta. Iniciando Fase 3: Emergencia...", "error");
                await this._forceAuthorizeFetch();
                await new Promise(r => setTimeout(r, 10000));
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

        // Detección de tipos de paquetes sin loguear datos brutos (Velocidad Crítica)
        const isControl = data.length <= 3 && data[0] === 0x10;
        const isHeader = data.length === 15 && data[0] === 0x10;

        if (isControl || isHeader) {
            const hex = Array.from(data).map(b => b.toString(16).padStart(2, '0')).join(' ');
            this.log(`Control: [${hex}] (${data.length} bytes)`, "ble");
        }

        if (isControl) {
            const APP_VERSION = "1.3.16";
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
                // v1.3.16: Solo reintentamos si NO estamos ya recibiendo datos (evita bucle infinito)
                if (this.totalReceived === 0) {
                    this.log("Rechazo 0x01. Iniciando modo de compatibilidad (Full Sync) tras 2s...", "error");
                    setTimeout(() => this._retryWithExtendedCommand(), 2000);
                } else {
                    this.log("Aviso: Rechazo 01 detectado pero el flujo ya está activo. Ignorando reintento...", "system");
                }
                return;
            }

            if (cmdReply === 0x03 && status === 0x01) {
                this.log("Puerta 0x03 abierta. Disparando 0x05...", "ble");
                setTimeout(() => this._sendSyncAck(new Uint8Array([0x05])), 250);
                return;
            }

            if (cmdReply === 0x05 && status === 0x02) {
                this.log("Rechazo 0x05. Probando 0x04...", "error");
                setTimeout(() => this._sendSyncAck(new Uint8Array([0x04])), 250);
                return;
            }

            if (cmdReply === 0x04 && status === 0x02) {
                this.log("Rechazo 0x04. Probando 0x01...", "error");
                setTimeout(() => this._sendSyncAck(new Uint8Array([0x01])), 250);
                return;
            }

            // Detección de peticiones de ACK del reloj (10 02 XX)
            if (cmdReply === 0x02) {
                this.log(`Reloj solicita ACK para bloque ${status}. Respondiendo (Deep Space 500ms)...`, "ble");
                // v1.3.16: Aumento a 500ms para evitar colisión en Canal 04 compartido
                setTimeout(() => {
                    this._sendSyncAck(new Uint8Array([0x01, 0x02, status]), true);
                }, 500);
                return;
            }

            // Cualquier otro paquete de control no se acumula
            return;
        }

        // Cabecera v2 detectada
        if (isHeader && data[1] === 0x01) {
            const lastByte = data[14];
            this.log(`Cabecera v2 detectada (Index: ${lastByte}). Iniciando transferencia (Deep Space 500ms)...`, "ble");
            // v1.3.16: Delay de 500ms también para la cabecera
            setTimeout(() => this._sendSyncAck(new Uint8Array([0x01, 0x02, lastByte]), true), 500);
            return; // No acumulamos la cabecera en el buffer de datos
        }
        // ACUMULACIÓN ULTRA-RÁPIDA (Solo datos reales)
        this.activityChunks.push(data);
        const oldTotal = this.totalReceived;
        this.totalReceived += data.length;

        // v1.3.4: Log de chunks de datos (solo cada 1KB para no saturar el log)
        if (Math.floor(this.totalReceived / 1024) > Math.floor(oldTotal / 1024)) {
            const preview = data.length > 4 ? Array.from(data.slice(0, 4)).map(b => b.toString(16).padStart(2, '0')).join(' ') : "";
            this.log(`[DATA] Recibido: ${(this.totalReceived / 1024).toFixed(1)} KB (Last: ${data.length}b, Hex: ${preview})`, "ble");
        }

        // ACK PROGRESIVO: Si no enviamos nada, el reloj se pausa cada 2-4KB.
        // Enviamos un confirmador ligero cada 2KB para mantener el flujo abierto.
        if (Math.floor(this.totalReceived / 2048) > Math.floor(oldTotal / 2048)) {
            // v1.3.1: Usamos sin respuesta para no congestionar el flujo de datos
            this._sendSyncAck(new Uint8Array([0x02]), true);
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
        this.log("Enviando comando de Emergencia v2 (Control Estricto)...", "system");
        // Variante 0x01 0x01 + 8 bytes de 0x00 (Soft Fetch Force)
        const authFetch = new Uint8Array([0x01, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00, 0x00]);
        // v1.3.5: Forzamos el canal de control para la emergencia
        await this._safeWrite(authFetch, "EMERGENCY_V2", 5, this.fetchControlChar);
    }

    async _syncTime() {
        if (!this.timeChar) return;
        this.log("Sincronizando hora para autorizar actividades...", "system");
        try {
            const now = new Date();
            const year = now.getFullYear();
            const timePacket = new Uint8Array([
                year & 0xFF, (year >> 8) & 0xFF,
                now.getMonth() + 1,
                now.getDate(),
                now.getHours(),
                now.getMinutes(),
                now.getSeconds(),
                (now.getDay() === 0 ? 7 : now.getDay()),
                0, 1
            ]);
            await this.timeChar.writeValue(timePacket);
            this.log("¡Hora sincronizada con éxito!", "system");
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
