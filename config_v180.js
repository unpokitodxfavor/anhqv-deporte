/**
 * config.js - Global Configuration (v1.8.0)
 */
window.APP_CONFIG = {
    // URL del backend PHP para guardar actividades en la nube
    API_URL: 'https://aquinohayquienviva.es/anhqv-deporte/api.php',
    
    // Configuración opcional de Google Drive
    GOOGLE_CLIENT_ID: localStorage.getItem('gdrive_client_id') || '',
    
    // Auth Key por defecto (si se desea pre-cargar)
    AMAZFIT_AUTH_KEY: localStorage.getItem('amazfit_auth_key') || '',
    
    // Versión de la configuración
    CONFIG_VERSION: '1.8.0'
};
