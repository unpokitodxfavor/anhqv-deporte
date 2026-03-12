/**
 * parser.js - Binary data parser for Huami activity logs (v1.8.0)
 */

class ActivityParser {
    static VERSION = "v1.8.0";
    
    static parse(buffer, baseTimestamp) {
        const data = {
            points: [],
            stats: { distance: 0, duration: 0, calories: 0, avgHeartRate: 0 }
        };

        if (buffer.byteLength > 0) {
            try {
                return this.parseZeppOsFormat(buffer, baseTimestamp);
            } catch (e) {
                console.error("Error al parsear datos Zepp OS:", e);
                return {
                    points: this.generateMockRoute().points,
                    stats: {
                        distance: (buffer.byteLength / 1000).toFixed(2),
                        duration: "Error Parseando",
                        calories: "--",
                        avgHeartRate: "--"
                    },
                    isRealData: true,
                    timestamp: baseTimestamp || Date.now()
                };
            }
        }
        return this.generateMockRoute();
    }

    static parseZeppOsFormat(buffer, baseTimestamp, extBaseLat = null, extBaseLng = null) {
        const view = new DataView(buffer);
        let offset = 0;

        let currentTimestamp = baseTimestamp ? new Date(baseTimestamp) : new Date();
        let totalTimeSecs = 0;
        let lastTimeOffset = 0;

        // v1.8.0 Logging enhanced
        let baseLng = (extBaseLng != null && !isNaN(extBaseLng)) ? extBaseLng : 0;
        let baseLat = (extBaseLat != null && !isNaN(extBaseLat)) ? extBaseLat : 0;

        if (baseLat === 0 && baseLng === 0) {
            console.warn("ADVERTENCIA: Iniciando parseo con coordenadas base 0,0. La ruta aparecerá en el océano si no hay recuperación.");
        } else {
            console.log(`Iniciando parseo con Base GPS (Huami): Lat=${baseLat}, Lng=${baseLng}`);
        }

        const points = [];
        let totalDistance = 0;
        let lastLat = null;
        let lastLng = null;
        let firstPointTime = null;
        let hrSum = 0;
        let hrCount = 0;

        const huamiToDegrees = (val) => val / 3000000.0;

        while (offset + 8 <= view.byteLength) {
            const typeCode = view.getUint8(offset);
            const timeOffset = view.getUint8(offset + 1);

            let delta = timeOffset - lastTimeOffset;
            if (delta < 0) delta += 256;
            lastTimeOffset = timeOffset;
            totalTimeSecs += delta;

            const pointTime = new Date(currentTimestamp.getTime() + (totalTimeSecs * 1000));
            if (!firstPointTime) firstPointTime = pointTime;

            switch (typeCode) {
                case 0: // GPS (lngDelta, latDelta, altDelta) - Int16LE
                    const lngDelta = view.getInt16(offset + 2, true);
                    const latDelta = view.getInt16(offset + 4, true);

                    baseLng += lngDelta;
                    baseLat += latDelta;

                    const curLng = huamiToDegrees(baseLng);
                    const curLat = huamiToDegrees(baseLat);

                    if (lastLat !== null && lastLng !== null) {
                        const dist = this._calcDistance(lastLat, lastLng, curLat, curLng);
                        if (dist < 50) {
                            totalDistance += dist;
                        }
                    } else if (Math.abs(curLat) > 0.001) {
                         console.log(`Primer punto GPS convertido: ${curLat.toFixed(6)}, ${curLng.toFixed(6)}`);
                    }
                    
                    lastLat = curLat;
                    lastLng = curLng;

                    points.push({
                        lat: curLat,
                        lng: curLng,
                        time: pointTime,
                        hr: 0
                    });
                    break;

                case 1: // HR
                    const v1 = view.getUint8(offset + 2);
                    const v2 = view.getUint8(offset + 3);
                    const v3 = view.getUint8(offset + 4);
                    const v4 = view.getUint8(offset + 5);
                    const v5 = view.getUint8(offset + 6);
                    const v6 = view.getUint8(offset + 7);

                    if (v2 === 0 && v3 === 0 && v4 === 0 && v5 === 0 && v6 === 0) {
                        if (v1 > 0 && v1 < 255) {
                            hrSum += v1;
                            hrCount++;
                            if (points.length > 0 && Math.abs(pointTime - points[points.length - 1].time) < 10000) {
                                points[points.length - 1].hr = v1;
                            } else {
                                points.push({ lat: lastLat || 0, lng: lastLng || 0, hr: v1, time: pointTime, isHrOnly: true });
                            }
                        }
                    } else {
                        const addHr = (timeOft, hr) => {
                            if (hr > 0 && hr < 255) {
                                hrSum += hr;
                                hrCount++;
                                const hrTime = new Date(currentTimestamp.getTime() + ((totalTimeSecs + timeOft) * 1000));
                                if (points.length > 0 && Math.abs(hrTime - points[points.length - 1].time) < 5000) {
                                    points[points.length - 1].hr = hr;
                                } else {
                                    points.push({ lat: lastLat || 0, lng: lastLng || 0, hr: hr, time: hrTime, isHrOnly: true });
                                }
                            }
                        };
                        addHr(v1, v2);
                        addHr(v3, v4);
                        addHr(v5, v6);
                    }
                    break;
            }
            offset += 8;
        }

        const mapPoints = points.filter(p => !p.isHrOnly);
        const hrs = Math.floor(totalTimeSecs / 3600);
        const mins = Math.floor((totalTimeSecs % 3600) / 60);
        const secs = Math.floor(totalTimeSecs % 60);
        const durationStr = `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`;

        let paceStr = "--:--";
        if (totalDistance > 0.1 && totalTimeSecs > 10) {
            const paceMinTotal = (totalTimeSecs / 60) / totalDistance;
            const pMins = Math.floor(paceMinTotal);
            const pSecs = Math.floor((paceMinTotal - pMins) * 60);
            paceStr = `${pMins}:${pSecs.toString().padStart(2, '0')}`;
        }

        return {
            points: mapPoints.length > 0 ? mapPoints : points,
            stats: {
                distance: totalDistance.toFixed(2),
                duration: totalTimeSecs > 0 ? durationStr : "--:--:--",
                pace: paceStr,
                calories: Math.floor(totalDistance * 60) || "--",
                avgHeartRate: hrCount > 0 ? Math.floor(hrSum / hrCount) : "--"
            },
            isRealData: mapPoints.length > 0 || totalDistance > 0,
            timestamp: firstPointTime ? firstPointTime.getTime() : (baseTimestamp instanceof Date ? baseTimestamp.getTime() : (baseTimestamp || Date.now()))
        };
    }

    static parseMultiple(buffer, baseTimestamp, baseLat = null, baseLng = null) {
        const fullData = this.parseZeppOsFormat(buffer, baseTimestamp, baseLat, baseLng);
        if (!fullData.isRealData) return [];
        if (!fullData.points || fullData.points.length === 0) return [fullData];

        const activities = [];
        let currentPoints = [];
        const GAP_THRESHOLD_MS = 12 * 60 * 60 * 1000;
        let hasGaps = false;

        for (let i = 0; i < fullData.points.length; i++) {
            const p = fullData.points[i];
            if (currentPoints.length > 0) {
                const prev = currentPoints[currentPoints.length - 1];
                if (p.time - prev.time > GAP_THRESHOLD_MS) {
                    hasGaps = true;
                    activities.push(this._packageActivity(currentPoints));
                    currentPoints = [];
                }
            }
            currentPoints.push(p);
        }

        if (!hasGaps) return [fullData];
        if (currentPoints.length > 0) activities.push(this._packageActivity(currentPoints));
        return activities;
    }

    static _packageActivity(points) {
        if (points.length === 0) return null;
        let dist = 0;
        let hrSum = 0;
        let hrCount = 0;
        for (let i = 1; i < points.length; i++) {
            dist += this._calcDistance(points[i - 1].lat, points[i - 1].lng, points[i].lat, points[i].lng);
            if (points[i].hr > 0) { hrSum += points[i].hr; hrCount++; }
        }

        const durationSecs = Math.floor((points[points.length - 1].time - points[0].time) / 1000);
        const hrs = Math.floor(durationSecs / 3600);
        const mins = Math.floor((durationSecs % 3600) / 60);
        const secs = durationSecs % 60;

        return {
            points: points,
            stats: {
                distance: dist.toFixed(2),
                duration: `${hrs.toString().padStart(2, '0')}:${mins.toString().padStart(2, '0')}:${secs.toString().padStart(2, '0')}`,
                calories: Math.floor(dist * 60),
                avgHeartRate: hrCount > 0 ? Math.floor(hrSum / hrCount) : "--"
            },
            isRealData: true,
            timestamp: points[0].time.getTime()
        };
    }

    static exportToGPX(parsedData) {
        let gpx = '<?xml version="1.0" encoding="UTF-8"?>\n';
        gpx += '<gpx version="1.1" creator="Amazfit Dashboard" xmlns="http://www.topografix.com/GPX/1/1" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xsi:schemaLocation="http://www.topografix.com/GPX/1/1 http://www.topografix.com/GPX/1/1/gpx.xsd http://www.garmin.com/xmlschemas/GpxExtensions/v3 http://www.garmin.com/xmlschemas/GpxExtensionsv3.xsd http://www.garmin.com/xmlschemas/TrackPointExtension/v1 http://www.garmin.com/xmlschemas/TrackPointExtensionv1.xsd">\n';
        gpx += '  <trk><name>Actividad Amazfit</name><trkseg>\n';
        parsedData.points.forEach(point => {
            if (point.lat && point.lng) {
                gpx += `      <trkpt lat="${point.lat.toFixed(6)}" lon="${point.lng.toFixed(6)}">`;
                if (point.time instanceof Date) gpx += `<time>${point.time.toISOString()}</time>`;
                if (point.hr > 0) gpx += `<extensions><gpxtpx:TrackPointExtension xmlns:gpxtpx="http://www.garmin.com/xmlschemas/TrackPointExtension/v1"><gpxtpx:hr>${point.hr}</gpxtpx:hr></gpxtpx:TrackPointExtension></extensions>`;
                gpx += `</trkpt>\n`;
            }
        });
        gpx += '    </trkseg></trk></gpx>';
        return gpx;
    }

    static _calcDistance(lat1, lon1, lat2, lon2) {
        const R = 6371;
        const dLat = (lat2 - lat1) * Math.PI / 180;
        const dLon = (lon2 - lon1) * Math.PI / 180;
        const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLon / 2) * Math.sin(dLon / 2);
        return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
    }

    static generateMockRoute() {
        const startLat = 37.6062; // Cartagena start! (v1.8.0 Mock updated)
        const startLng = -0.9857;
        const points = [];
        for (let i = 0; i < 50; i++) {
            points.push({
                lat: startLat + (i * 0.0001),
                lng: startLng + (Math.sin(i/5) * 0.0002),
                hr: 110 + (i % 20),
                time: new Date(Date.now() - (50-i)*60000)
            });
        }
        return {
            points: points,
            stats: { distance: "0.50", duration: "00:05:00", calories: 30, avgHeartRate: 120 }
        };
    }
}
window.ActivityParser = ActivityParser;
