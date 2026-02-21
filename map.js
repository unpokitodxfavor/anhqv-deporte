/**
 * map.js - Leaflet Map Integration
 */

class SportMap {
    constructor(elementId) {
        this.map = null;
        this.polyline = null;
        this.marker = null;
        this.elementId = elementId;
    }

    init() {
        if (this.map) return;

        this.map = L.map(this.elementId).setView([40.4168, -3.7038], 13);

        L.tileLayer('https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', {
            attribution: '&copy; OpenStreetMap &copy; CARTO'
        }).addTo(this.map);
    }

    renderRoute(points) {
        if (!this.map) this.init();

        const latLngs = points.map(p => [p.lat, p.lng]);

        if (this.polyline) {
            this.map.removeLayer(this.polyline);
        }

        this.polyline = L.polyline(latLngs, {
            color: '#ff3e3e',
            weight: 5,
            opacity: 0.8,
            smoothFactor: 1
        }).addTo(this.map);

        // Ajustar vista
        this.map.fitBounds(this.polyline.getBounds(), { padding: [20, 20] });

        // Añadir marcador de inicio
        if (this.marker) this.map.removeLayer(this.marker);
        this.marker = L.circleMarker(latLngs[0], {
            radius: 8,
            fillColor: '#00ff88',
            color: '#fff',
            weight: 2,
            opacity: 1,
            fillOpacity: 0.8
        }).addTo(this.map).bindPopup('Inicio del ejercicio');
    }
}

window.sportMap = new SportMap('map');
