    async _safeWrite(data, label, retries = 5) {
    // v1.2.9: Solo escribimos en el canal de CONTROL (05) para evitar colisiones con el canal de DATOS (04)
    const chars = [this.fetchControlChar].filter(c => c);

    for (let attempt = 1; attempt <= retries; attempt++) {
        for (const char of chars) {
            try {
                // Deep Freeze 1.2.8: Eliminamos readValue() para no saturar al Bip U Pro
                this.log(`Sync [${label}] -> ${char.uuid.slice(-2)} (${attempt}/${retries})...`, "ble");
                await char.writeValue(data);
                return true;
            } catch (e) {
                if (attempt < retries) {
                    try {
                        // Intento desesperado sin respuesta
                        await char.writeValueWithoutResponse(data);
                        return true;
                    } catch (e2) {
                        this.log(`GATT Ocupado. Reintento en ${800 * attempt}ms...`, "ble");
                        await new Promise(r => setTimeout(r, 800 * attempt));
                    }
                }
            }
        }
    }
    return false;
}
