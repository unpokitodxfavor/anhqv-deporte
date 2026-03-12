/**
 * map.js - Leaflet Map Integration (v1.8.0)
 */

class SportMap {
    constructor(elementId) {
        this.map = null;
        this.polyline = null;
        this.startMarker = null;
        this.endMarker = null;
        this.elementId = elementId;
        this.labelsLayer = null;
    }

    init() {
        if (this.map) return;

        // Limpiar controles por defecto para una UI inmersiva
        this.map = L.map(this.elementId, { 
            zoomControl: false,
            attributionControl: false 
        }).setView([40.4168, -3.7038], 13);

        // Capa satélite tipo Esri (ideal para ver terrenos y rutas)
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 18
        }).addTo(this.map);

        // Capa de etiquetas (v1.8.0): Para que el usuario vea nombres de ciudades como Cartagena
        this.labelsLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}', {
            maxZoom: 18,
            opacity: 0.8
        }).addTo(this.map);
    }

    renderRoute(points) {
        if (!this.map) this.init();

        const validPoints = points ? points.filter(p => !p.isHrOnly && (Math.abs(p.lat) > 0.001 || Math.abs(p.lng) > 0.001)) : [];

        if (validPoints.length === 0) {
            console.warn("No hay puntos GPS válidos para renderizar en el mapa.");
            if (this.polyline) this.map.removeLayer(this.polyline);
            if (this.startMarker) this.map.removeLayer(this.startMarker);
            if (this.endMarker) this.map.removeLayer(this.endMarker);
            
            const mapEl = document.getElementById(this.elementId);
            mapEl.innerHTML = `
                <div style="height: 100%; display: flex; flex-direction: column; align-items: center; justify-content: center; background: #1a1b1e; color: #94a3b8; font-family: 'Outfit', sans-serif;">
                    <span style="font-size: 40px; margin-bottom: 15px; opacity: 0.5;">🛰️</span>
                    <p style="margin: 0; font-weight: 600;">Sin datos de mapa</p>
                    <p style="margin: 5px 0 0 0; font-size: 13px; opacity: 0.7;">Esta actividad no contiene ruta GPS válida.</p>
                </div>
            `;
            return;
        }

        const mapEl = document.getElementById(this.elementId);
        if (mapEl.querySelector('div')) {
            if (this.map) {
                this.map.remove();
                this.map = null;
            }
            mapEl.innerHTML = "";
            this.init();
        }
        mapEl.style.display = 'block';

        const latLngs = validPoints.map(p => [p.lat, p.lng]);

        if (this.polyline) {
            this.map.removeLayer(this.polyline);
        }

        // Ruta azul brillante
        this.polyline = L.polyline(latLngs, {
            color: '#00f2fe',
            weight: 6,
            opacity: 1,
            lineJoin: 'round',
            lineCap: 'round'
        }).addTo(this.map);

        this.map.fitBounds(this.polyline.getBounds(), { padding: [50, 50] });

        // Marcador Inicio (Verde neón)
        if (this.startMarker) this.map.removeLayer(this.startMarker);
        this.startMarker = L.circleMarker(latLngs[0], {
            radius: 8,
            fillColor: '#10b981',
            color: '#ffffff',
            weight: 3,
            opacity: 1,
            fillOpacity: 1
        }).addTo(this.map);

        // Marcador Fin (Rojo neón)
        const lastPoint = latLngs[latLngs.length - 1];
        if (this.endMarker) this.map.removeLayer(this.endMarker);
        this.endMarker = L.circleMarker(lastPoint, {
            radius: 8,
            fillColor: '#f43f5e',
            color: '#ffffff',
            weight: 3,
            opacity: 1,
            fillOpacity: 1
        }).addTo(this.map);
    }
}

window.sportMap = new SportMap('map');
