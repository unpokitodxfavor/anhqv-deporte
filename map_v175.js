/**
 * map.js - Leaflet Map Integration
 */

class SportMap {
    constructor(elementId) {
        this.map = null;
        this.polyline = null;
        this.startMarker = null;
        this.endMarker = null;
        this.elementId = elementId;
    }

    init() {
        if (this.map) return;

        // Limpiar controles por defecto para una UI inmersiva
        this.map = L.map(this.elementId, { zoomControl: false }).setView([40.4168, -3.7038], 13);

        // Capa satélite tipo Esri (ideal para ver terrenos y rutas)
        L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', {
            attribution: '&copy; Esri',
            maxZoom: 18
        }).addTo(this.map);
    }

    renderRoute(points) {
        if (!this.map) this.init();

        if (!points || points.length === 0) {
            console.warn("No hay puntos GPS para renderizar en el mapa.");
            if (this.polyline) this.map.removeLayer(this.polyline);
            if (this.startMarker) this.map.removeLayer(this.startMarker);
            if (this.endMarker) this.map.removeLayer(this.endMarker);
            return;
        }

        const latLngs = points.map(p => [p.lat, p.lng]);

        if (this.polyline) {
            this.map.removeLayer(this.polyline);
        }

        // Ruta azul brillante como en la referencia
        this.polyline = L.polyline(latLngs, {
            color: '#0b66ff',
            weight: 6,
            opacity: 1,
            lineJoin: 'round',
            lineCap: 'round'
        }).addTo(this.map);

        this.map.fitBounds(this.polyline.getBounds(), { padding: [50, 50] });

        // Marcador Inicio (Verde)
        if (this.startMarker) this.map.removeLayer(this.startMarker);
        this.startMarker = L.circleMarker(latLngs[0], {
            radius: 8,
            fillColor: '#00cc66',
            color: '#ffffff',
            weight: 3,
            opacity: 1,
            fillOpacity: 1
        }).addTo(this.map);

        // Marcador Fin (Rojo)
        const lastPoint = latLngs[latLngs.length - 1];
        if (this.endMarker) this.map.removeLayer(this.endMarker);
        this.endMarker = L.circleMarker(lastPoint, {
            radius: 8,
            fillColor: '#fc3d39',
            color: '#ffffff',
            weight: 3,
            opacity: 1,
            fillOpacity: 1
        }).addTo(this.map);
    }
}

window.sportMap = new SportMap('map');
