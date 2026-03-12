/**
 * ble.js - Bluetooth Communication for Amazfit (v1.8.0)
 */

const AUTH_SERVICE_ID = "0000fee1-0000-1000-8000-00805f9b34fb";
const AUTH_CHAR_ID = "00000009-0000-3512-2118-0009af100700";
const FETCH_SERVICE_ID = "0000fee0-0000-1000-8000-00805f9b34fb";
const FETCH_CONTROL_ID = "00000004-0000-3512-2118-0009af100700";
const FETCH_DATA_ID = "00000005-0000-3512-2118-0009af100700";

class AmazfitDevice {
    constructor() {
        this.device = null;
        this.server = null;
        this.chars = {};
        this.authKey = null;
        this.isDownloading = false;
        this.totalReceived = 0;
        this.activityChunks = [];
        this.summaries = [];
        this._summaryBuffer = new Uint8Array(0);
        this.syncWatchdog = null;
        this.syncMode = 'none'; // 'summaries' | 'activities'
        this.lastUiUpdate = 0;
        this.isWriting = false;
        this.VERSION = "v1.8.0";
    }

    log(msg, type) { if (this.logger) this.logger(msg, type); }

    async connect(authKey, logger) {
        this.authKey = authKey;
        this.logger = logger;
        this.log("Iniciando búsqueda de dispositivo...", "ble");

        this.device = await navigator.bluetooth.requestDevice({
            filters: [{ services: [AUTH_SERVICE_ID] }],
            optionalServices: [FETCH_SERVICE_ID]
        });

        this.device.addEventListener('gattserverdisconnected', () => {
            this.log("Dispositivo desconectado.", "error");
            window.dispatchEvent(new CustomEvent('amazfit-disconnected'));
        });

        this.server = await this.device.gatt.connect();
        const authService = await this.server.getPrimaryService(AUTH_SERVICE_ID);
        this.chars.auth = await authService.getCharacteristic(AUTH_CHAR_ID);

        const fetchService = await this.server.getPrimaryService(FETCH_SERVICE_ID);
        this.chars.control = await fetchService.getCharacteristic(FETCH_CONTROL_ID);
        this.chars.data = await fetchService.getCharacteristic(FETCH_DATA_ID);

        await this.chars.auth.startNotifications();
        this.chars.auth.addEventListener('characteristicvaluechanged', (e) => this._handleAuth(e));

        await this.chars.control.startNotifications();
        this.chars.control.addEventListener('characteristicvaluechanged', (e) => this._handleActivityData(e));

        await this.chars.data.startNotifications();
        this.chars.data.addEventListener('characteristicvaluechanged', (e) => this._handleActivityData(e));

        await this._authenticate();
        return this.device.name;
    }

    async attemptAutoConnect(authKey, logger) {
        this.authKey = authKey;
        this.logger = logger;
        const devices = await navigator.bluetooth.getDevices();
        if (devices.length > 0) {
            this.device = devices[0];
            return await this.connect(authKey, logger);
        }
        return null;
    }

    async _authenticate() {
        this.log("Autenticando...", "ble");
        await this._safeWrite(new Uint8Array([0x01, 0x00]), "AUTH_STEP_1", 10, this.chars.auth);
    }

    async _handleAuth(event) {
        const value = new Uint8Array(event.target.value.buffer);
        if (value[0] === 0x10 && value[1] === 0x01 && value[2] === 0x01) {
            this.log("Paso 1 OK. Solicitando reto...", "ble");
            await this._safeWrite(new Uint8Array([0x02, 0x00]), "AUTH_STEP_2", 10, this.chars.auth);
        } else if (value[0] === 0x10 && value[1] === 0x02 && value[2] === 0x01) {
            this.log("Reto recibido. Cifrando...", "ble");
            const challenge = value.slice(3);
            const response = await this._encryptChallenge(challenge);
            await this._safeWrite(new Uint8Array([0x03, 0x00, ...response]), "AUTH_STEP_3", 10, this.chars.auth);
        } else if (value[0] === 0x10 && value[1] === 0x03 && value[2] === 0x01) {
            this.log("¡Autenticación exitosa!", "success");
            window.dispatchEvent(new CustomEvent('amazfit-connected'));
        } else if (value[0] === 0x10 && value[2] !== 0x01) {
            this.log("Error de autenticación. Verifica la Auth Key.", "error");
        }
    }

    async _encryptChallenge(challenge) {
        const keyBuffer = this._hexToBytes(this.authKey);
        const cryptoKey = await crypto.subtle.importKey('raw', keyBuffer, { name: 'AES-CBC' }, false, ['encrypt']);
        const iv = new Uint8Array(16);
        const encrypted = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, cryptoKey, challenge);
        return new Uint8Array(encrypted);
    }

    _hexToBytes(hex) {
        const bytes = new Uint8Array(hex.length / 2);
        for (let i = 0; i < hex.length; i += 2) bytes[i / 2] = parseInt(hex.substr(i, 2), 16);
        return bytes;
    }

    async fetchActivities(sinceDate = null) {
        if (!sinceDate) {
            const lastSync = localStorage.getItem('last_sync_timestamp');
            sinceDate = lastSync ? new Date(parseInt(lastSync) + 1000) : new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
        }

        try {
            this.totalReceived = 0;
            this.activityChunks = [];
            
            this.log("Sincronizando hora...", "system");
            await this._syncTime();

            this.log("Enviando Discovery...", "ble");
            await this._safeWrite(new Uint8Array([0x01, 0x01]), "DISCOVERY", 5, this.chars.control);
            await new Promise(r => setTimeout(r, 1000));

            this.log("Pidiendo resúmenes de actividades...", "system");
            this.summaries = [];
            this.syncMode = 'summaries';
            this._summaryBuffer = new Uint8Array(0);
            await this._safeWrite(new Uint8Array([0x01, 0x02]), "GET_SUMMARIES", 5, this.chars.control);
            await new Promise(r => setTimeout(r, 500));
            await this._safeWrite(new Uint8Array([0x02]), "FETCH_SUMMARIES", 5, this.chars.control);

            await new Promise((resolve) => {
                let finishTimeout = setTimeout(() => { resolve(); }, 8000);
                const finishListener = () => {
                    clearTimeout(finishTimeout);
                    window.removeEventListener('amazfit-summaries-finished', finishListener);
                    resolve();
                };
                window.addEventListener('amazfit-summaries-finished', finishListener);
            });

            this.log(`Fase resúmenes completada (${this.summaries.length}). Buscando actividades nuevas...`, "system");
            this.syncMode = 'activities';
            await this._requestSearch(sinceDate);

            this.syncWatchdog = setTimeout(() => {
                if (!this.isDownloading && this.totalReceived === 0) {
                    this.log("El reloj no ha respondido.", "warn");
                    window.dispatchEvent(new CustomEvent('amazfit-data-finished'));
                }
            }, 10000);
        } catch (e) { this.log("Error en fetch: " + e.message, "error"); }
    }

    async _syncTime() {
        const now = new Date();
        const cmd = new Uint8Array([
            0x01, 0x00, 
            now.getFullYear() & 0xff, now.getFullYear() >> 8,
            now.getMonth() + 1, now.getDate(), now.getHours(), now.getMinutes(), now.getSeconds(), 0x00
        ]);
        await this._safeWrite(cmd, "TIME_SYNC", 5, this.chars.control);
    }

    async _requestSearch(date) {
        const cmd = new Uint8Array([
            0x01, 0x01,
            date.getFullYear() & 0xff, date.getFullYear() >> 8,
            date.getMonth() + 1, date.getDate(), date.getHours(), date.getMinutes(), date.getSeconds(), 0x00
        ]);
        await this._safeWrite(cmd, "SEARCH_CMD", 10, this.chars.control);
    }

    _handleActivityData(event) {
        const value = new Uint8Array(event.target.value.buffer, event.target.value.byteOffset, event.target.value.byteLength);
        if (value.length === 0) return;

        const uuid = event.target.uuid.toLowerCase();
        const isControl = (uuid === FETCH_CONTROL_ID) && value[0] === 0x10;

        if (isControl) {
            // Header Inicio
            if (value[1] === 0x01 && value[2] === 0x01) {
                const dataSize = (value[3] | (value[4] << 8) | (value[5] << 16) | (value[6] << 24));
                if (dataSize === 0) {
                    this.log("¡Todo al día!", "success");
                    window.dispatchEvent(new CustomEvent('amazfit-data-finished'));
                    return;
                }
                
                let y = value[7] | (value[8] << 8), mo = value[9], d = value[10], h = value[11], mi = value[12], s = value[13];
                let bLat = null, bLng = null;
                if (value.length >= 23) {
                    const dv = new DataView(value.buffer, value.byteOffset, value.byteLength);
                    bLat = dv.getInt32(15, true);
                    bLng = dv.getInt32(19, true);
                }

                this.log(`Actividad detectada: ${d}/${mo}/${y} (${dataSize} bytes). Base GPS: ${bLat}, ${bLng}`, "success");
                this.streamStartTime = new Date(y, mo - 1, d, h, mi, s);
                this.streamBaseLat = bLat;
                this.streamBaseLng = bLng;
                this.activityChunks = [];
                this.isDownloading = true;
                this.totalReceived = 0;

                setTimeout(() => {
                    this._safeWrite(new Uint8Array([0x02]), "FETCH_DATA", 5, this.chars.control);
                }, 500);
            }
            // Header Fin
            else if (value[1] === 0x02 && value[2] === 0x01) {
                if (this.syncMode === 'summaries') {
                    window.dispatchEvent(new CustomEvent('amazfit-summaries-finished'));
                } else {
                    this._finalizeSync();
                    this.isDownloading = false;
                    setTimeout(async () => {
                        await this._safeWrite(new Uint8Array([0x03]), "ACK_FINAL", 5, this.chars.control);
                        if (this.streamStartTime) {
                            await new Promise(r => setTimeout(r, 1000));
                            await this._requestSearch(new Date(this.streamStartTime.getTime() + 1000));
                        }
                    }, 500);
                }
            }
        } else if (this.syncMode === 'summaries') {
            const chunk = value.length > 1 ? value.slice(1) : new Uint8Array(0);
            this._summaryBuffer = new Uint8Array([...this._summaryBuffer, ...chunk]);
            this._parseSummaryPackage();
        } else if (this.isDownloading) {
            this.activityChunks.push(value);
            this.totalReceived += value.length;
            const now = Date.now();
            if (now - this.lastUiUpdate > 300) {
                this.lastUiUpdate = now;
                window.dispatchEvent(new CustomEvent('amazfit-progress', { detail: { received: this.totalReceived } }));
            }
        }
    }

    _parseSummaryPackage() {
        while (this._summaryBuffer.length >= 30) {
            const dv = new DataView(this._summaryBuffer.buffer, this._summaryBuffer.byteOffset, this._summaryBuffer.byteLength);
            const ts = dv.getUint32(0, true);
            const lat = dv.getInt32(18, true);
            const lng = dv.getInt32(22, true);
            if (ts > 0 && lat !== 0 && lng !== 0) {
                this.summaries.push({ ts, lat, lng });
            }
            this._summaryBuffer = this._summaryBuffer.slice(30);
        }
    }

    _finalizeSync() {
        let bLat = this.streamBaseLat || 0;
        let bLng = this.streamBaseLng || 0;

        if (this.summaries.length > 0 && this.streamStartTime) {
            const unixTs = Math.floor(this.streamStartTime.getTime() / 1000);
            const match = this.summaries.find(s => Math.abs(s.ts - unixTs) < 60);
            if (match && match.lat !== 0) {
                bLat = match.lat; bLng = match.lng;
                this.log(`GPS Base recuperado de resumen: ${bLat}, ${bLng}`, "system");
            }
        }

        let totalSize = 0;
        for (const c of this.activityChunks) if (c.length > 1) totalSize += c.length - 1;
        
        const full = new Uint8Array(totalSize);
        let off = 0;
        for (const c of this.activityChunks) {
            if (c.length > 1) { full.set(c.slice(1), off); off += (c.length - 1); }
        }

        window.dispatchEvent(new CustomEvent('amazfit-data', {
            detail: { fullBuffer: full, complete: true, startTime: this.streamStartTime, baseLat: bLat, baseLng: bLng }
        }));
    }

    async _safeWrite(data, label, retries = 5, char) {
        if (!char) return false;
        while (this.isWriting) await new Promise(r => setTimeout(r, 100));
        this.isWriting = true;
        try {
            for (let i = 0; i < retries; i++) {
                try {
                    await new Promise(r => setTimeout(r, 100));
                    if (char.properties.writeWithoutResponse) await char.writeValueWithoutResponse(data);
                    else await char.writeValue(data);
                    return true;
                } catch (e) { await new Promise(r => setTimeout(r, 1000)); }
            }
            return false;
        } finally { this.isWriting = false; }
    }
}

window.amazfit = new AmazfitDevice();
