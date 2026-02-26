/**
 * parser.js - Binary data parser for Huami activity logs
 */

class ActivityParser {
    /**
     * Parse binary activity stream
     * @param {ArrayBuffer} buffer 
     */
    static parse(buffer) {
        const view = new DataView(buffer);
        const data = {
            points: [],
            stats: {
                distance: 0,
                duration: 0,
                calories: 0,
                avgHeartRate: 0
            }
        };

        // El formato Huami varía por firmware. 
        // Normalmente es una serie de bloques:
        // [HEADER (16-32 bytes)] [GPS DATA] [HEART RATE DATA]

        // Mocking logic para el Bip U Pro basado en Gadgetbridge
        // En una implementación real, iteraríamos sobre el buffer buscando patrones de Sync.

        console.log("Parseando buffer de tamaño:", buffer.byteLength);

        // Si el buffer es real (tiene datos), decodificamos el formato Zepp OS (Type-Length-Value LSB)
        if (buffer.byteLength > 0) {
            try {
                return this.parseZeppOsFormat(buffer);
            } catch (e) {
                console.error("Error al parsear datos Zepp OS:", e);
                // Fallback visual si falla
                return {
                    points: this.generateMockRoute().points,
                    stats: {
                        distance: (buffer.byteLength / 1000).toFixed(2),
                        duration: "Error Parseando",
                        calories: "--",
                        avgHeartRate: "--"
                    },
                    isRealData: true
                };
            }
        }

        return this.generateMockRoute();
    }

    static parseZeppOsFormat(buffer) {
        const view = new DataView(buffer);
        let offset = 0;

        let currentTimestamp = new Date();
        let currentTimeOffset = 0;

        let baseLng = 0;
        let baseLat = 0;
        let baseAlt = 0;

        const points = [];
        let totalDistance = 0;
        let totalTimeSecs = 0;

        let lastLat = null;
        let lastLng = null;
        let firstPointTime = null;
        let lastPointTime = null;

        let hrSum = 0;
        let hrCount = 0;

        // Convertidor de Huami a Grados Decimales estandar
        const huamiToDegrees = (val) => val / 3000000.0;

        // Iterar los chuncks tipo-longitud-valor
        while (offset < view.byteLength) {
            const typeCode = view.getUint8(offset);
            const length = view.getUint8(offset + 1);
            const initialOffset = offset;
            offset += 2; // Avanzar el header de tipo+longitud

            // Asegurarse de que no nos salimos del buffer
            if (initialOffset + length > view.byteLength) {
                console.warn(`Paquete corrupto al final del buffer. Type: ${typeCode}, Length: ${length}`);
                break;
            }

            switch (typeCode) {
                case 1: // TIMESTAMP (length 12)
                    if (length === 12) {
                        // view.getInt32(offset, true); // Ignorado
                        // Javascript no soporta getInt64 nativo en DataView sin BigInt
                        const timeMsLow = view.getUint32(offset + 4, true);
                        const timeMsHigh = view.getUint32(offset + 8, true);
                        // Convertir a numero (seguro hasta el año 285,616)
                        currentTimestamp = new Date((timeMsHigh * Math.pow(2, 32)) + timeMsLow);
                        currentTimeOffset = 0;
                    }
                    break;
                case 2: // GPS_COORDS (length 20)
                    if (length === 20) {
                        baseLng = view.getInt32(offset + 6, true);
                        baseLat = view.getInt32(offset + 10, true);

                        const curLng = huamiToDegrees(baseLng);
                        const curLat = huamiToDegrees(baseLat);

                        if (lastLat !== null && lastLng !== null) {
                            totalDistance += this._calcDistance(lastLat, lastLng, curLat, curLng);
                        }
                        lastLat = curLat;
                        lastLng = curLng;

                        const pointTime = new Date(currentTimestamp.getTime() + currentTimeOffset);
                        if (!firstPointTime) firstPointTime = pointTime;
                        lastPointTime = pointTime;

                        points.push({
                            lat: curLat,
                            lng: curLng,
                            time: pointTime,
                            hr: 0 // Se rellena si hay HR cercano temporalmente
                        });
                    }
                    break;
                case 3: // GPS_DELTA (length 8)
                    if (length === 8) {
                        currentTimeOffset = view.getInt16(offset, true);
                        const lngDelta = view.getInt16(offset + 2, true);
                        const latDelta = view.getInt16(offset + 4, true);

                        baseLng += lngDelta;
                        baseLat += latDelta;

                        const curLng = huamiToDegrees(baseLng);
                        const curLat = huamiToDegrees(baseLat);

                        if (lastLat !== null && lastLng !== null) {
                            totalDistance += this._calcDistance(lastLat, lastLng, curLat, curLng);
                        }
                        lastLat = curLat;
                        lastLng = curLng;

                        const pointTime = new Date(currentTimestamp.getTime() + currentTimeOffset);
                        if (!firstPointTime) firstPointTime = pointTime;
                        lastPointTime = pointTime;

                        points.push({
                            lat: curLat,
                            lng: curLng,
                            time: pointTime,
                            hr: 0
                        });
                    }
                    break;
                case 4: // STATUS (length 4)
                    break;
                case 5: // SPEED (length 8)
                    break;
                case 7: // ALTITUDE (length 6)
                    break;
                case 8: // HEARTRATE (length 3)
                    if (length === 3) {
                        currentTimeOffset = view.getInt16(offset, true);
                        const hr = view.getUint8(offset + 2);

                        if (hr > 0 && hr < 255) {
                            hrSum += hr;
                            hrCount++;
                            // Modificar el ultimo punto si esta cerca en el tiempo
                            if (points.length > 0) {
                                points[points.length - 1].hr = hr;
                            }
                        }
                    }
                    break;
            }

            // Consumir el tamaño del chunk
            offset = initialOffset + length;
        }

        // Calcular duración
        if (firstPointTime && lastPointTime) {
            totalTimeSecs = Math.abs(lastPointTime.getTime() - firstPointTime.getTime()) / 1000;
        }

        const hrs = Math.floor(totalTimeSecs / 3600);
        const mins = Math.floor((totalTimeSecs % 3600) / 60);
        const secs = Math.floor(totalTimeSecs % 60);
        const durationStr = `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

        return {
            points: points,
            stats: {
                distance: totalDistance.toFixed(2), // en km
                duration: totalTimeSecs > 0 ? durationStr : "--:--:--",
                calories: Math.floor(totalDistance * 60) || "--", // Estimación inventada
                avgHeartRate: hrCount > 0 ? Math.floor(hrSum / hrCount) : "--"
            },
            isRealData: true
        };
    }

    // Calcula distancia Haversine en km
    static _calcDistance(lat1, lon1, lat2, lon2) {
        const R = 6371; // Radio de la tierra en km
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a =
            Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
        const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
        return R * c;
    }

    static generateMockRoute() {
        // Genera un recorrido de 2km por una zona de Madrid (Puerta del Sol)
        const startLat = 40.4168;
        const startLng = -3.7038;
        const points = [];

        for (let i = 0; i < 100; i++) {
            points.push({
                lat: startLat + (Math.sin(i / 10) * 0.005),
                lng: startLng + (i * 0.0001),
                hr: 120 + Math.floor(Math.random() * 40),
                time: i
            });
        }

        return {
            points: points,
            stats: {
                distance: 2.15,
                duration: "00:25:30",
                calories: 185,
                avgHeartRate: 142
            }
        };
    }
}

window.ActivityParser = ActivityParser;
