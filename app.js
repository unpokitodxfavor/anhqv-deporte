/**
 * app.js - Main Application Logic
 */
console.log("==> Cargando app.js (v1.0.6) <==");

document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Cargado. Iniciando app logic...");
    const authSection = document.getElementById('auth-section');
    const activitySection = document.getElementById('activity-list-section');
    const statsSection = document.getElementById('stats-section');
    const connectBtn = document.getElementById('connect-btn');
    const saveKeyBtn = document.getElementById('save-key');
    const authKeyInput = document.getElementById('auth-key');
    const statusDot = document.querySelector('.dot');
    const statusText = document.getElementById('connection-status');
    const activityList = document.getElementById('activity-list');
    const closeStatsBtn = document.getElementById('close-stats');
    const refreshBtn = document.getElementById('refresh-activities');
    const logConsole = document.getElementById('log-console');
    const clearLogsBtn = document.getElementById('clear-logs');
    const loadingOverlay = document.getElementById('loading-overlay');
    const cancelLoadingBtn = document.getElementById('cancel-loading');

    const APP_VERSION = "1.0.7";

    // --- Logger ---
    function log(message, type = 'system') {
        try {
            if (!logConsole) {
                console.error("Critical: logConsole not found", message);
                return;
            }
            const entry = document.createElement('div');
            entry.className = `log-entry ${type}`;
            const time = new Date().toLocaleTimeString();
            entry.innerText = `[${time}] ${message}`;
            logConsole.appendChild(entry);
            logConsole.scrollTop = logConsole.scrollHeight;
            console.log(`%c[UI Log ${type}] ${message}`, "color: #00ff88; font-weight: bold;");
        } catch (e) {
            console.error("Error in log function:", e);
        }
    }

    // Capture global errors
    window.onerror = function (msg, url, lineNo, columnNo, error) {
        log(`CRITICAL JS ERROR: ${msg} (line ${lineNo})`, 'error');
        return false;
    };

    log(`Iniciando App v${APP_VERSION}...`, 'system');
    log(`Navegador: ${navigator.userAgent.includes('Brave') ? 'Brave' : 'Compatible?'}`, 'ble');
    log(`Protocolo: ${window.location.protocol}`, 'system');
    log(`Bluetooth: ${navigator.bluetooth ? 'Soportado' : 'NO SOPORTADO'}`, navigator.bluetooth ? 'ble' : 'error');

    if (window.location.protocol === 'file:') {
        log("ERROR: Debes usar una URL https:// (Netlify/GitHub)", "error");
    }
    console.log(`App v${APP_VERSION} inicializada correctamente.`);

    clearLogsBtn.addEventListener('click', () => {
        logConsole.innerHTML = `<div class="log-entry system">Consola limpia (v${APP_VERSION}).</div>`;
    });

    // Cargar clave guardada o usar la proporcionada
    const DEFAULT_KEY = "218236eafd6e9b5e05d02e4d112c6b57";
    const savedKey = localStorage.getItem('amazfit_auth_key');
    if (savedKey) {
        authKeyInput.value = savedKey;
        // Intentar auto-conexión al cargar
        setTimeout(async () => {
            log("Buscando dispositivos previamente emparejados...", "system");
            try {
                const autoDevice = await window.amazfit.attemptAutoConnect(savedKey, (msg, type) => log(msg, type));
                if (autoDevice) {
                    log(`¡Auto-conectado a: ${autoDevice}!`, 'system');
                    updateStatus(true, `Auto-conectado: ${autoDevice}`);
                    if (authSection) authSection.classList.add('hidden');
                    if (activitySection) activitySection.classList.remove('hidden');
                }
            } catch (e) {
                log("Auto-conexión no disponible. Ver guía rápida para habilitarla en el navegador.", "system");
            }
        }, 1000);
    } else {
        authKeyInput.value = DEFAULT_KEY;
        log("DEBUG: Usando Auth Key predeterminada proporcionada por el usuario.", "system");
    }

    // --- Eventos UI ---

    saveKeyBtn.addEventListener('click', () => {
        localStorage.setItem('amazfit_auth_key', authKeyInput.value);
        alert('Clave guardada localmente.');
    });

    if (connectBtn) {
        connectBtn.onclick = async () => {
            log('>>> CLICK DETECTADO (v1.0.5) <<<', 'system');
            const key = authKeyInput.value.trim();
            log(`Clave detectada length: ${key.length}`, 'system');

            if (key.length !== 32) {
                log('ADVERTENCIA: Clave no válida (debe ser 32 hex chars)', 'error');
                alert('Introduce la Auth Key de 32 caracteres.');
                return;
            }

            try {
                showLoading('Solicitando Bluetooth...');
                log('Iniciando búsqueda de reloj Amazfit...', 'ble');
                log('NOTA: Si no aparece nada, revisa los permisos de Bluetooth en Brave.', 'system');

                const deviceName = await window.amazfit.connect(key, (msg, type) => log(msg, type));

                log(`¡CONECTADO A: ${deviceName}!`, 'system');
                updateStatus(true, `Conectado: ${deviceName}`);
                if (authSection) authSection.classList.add('hidden');
                if (activitySection) activitySection.classList.remove('hidden');

                // Ya no cargamos mocks automáticamente, el usuario debe pulsar Actualizar
                log("Pulsa 'Actualizar' para descargar datos reales.", "system");
            } catch (err) {
                log(`ERROR CRÍTICO: ${err.name} - ${err.message}`, 'error');
                alert('Error al conectar: ' + err.message);
            } finally {
                hideLoading();
            }
        };
    } else {
        console.error("No se encontró el botón connect-btn!");
    }

    refreshBtn.addEventListener('click', async () => {
        showLoading('Descargando lista de actividades...');
        try {
            await window.amazfit.fetchActivities();
        } catch (err) {
            log(`Error al iniciar descarga: ${err.message}`, "error");
            hideLoading();
        }
    });

    // Escuchar datos reales del reloj
    window.addEventListener('amazfit-data', (event) => {
        const { chunk, fullBuffer } = event.detail;

        // Actualizar UI del loader con el progreso (bytes recibidos)
        const loadingText = document.getElementById('loading-text');
        if (loadingText) {
            loadingText.innerText = `Descargando: ${fullBuffer.length} bytes recibidos...`;
        }

        // Si tenemos un buffer considerable o ha pasado un tiempo, parseamos
        if (fullBuffer.length > 50) {
            const parsedData = ActivityParser.parse(fullBuffer.buffer);
            if (parsedData.isRealData) {
                // Actualizar la lista de actividades con el "progreso"
                renderRealActivityProgress(parsedData);
            }
        }
    });

    function renderRealActivityProgress(data) {
        // Esta función actualizaría la UI mientras se descargan los datos
        const activitiesList = document.querySelector('.activities-list');
        if (activitiesList && !document.getElementById('real-sync-item')) {
            activitiesList.innerHTML = `
                <div class="activity-card" id="real-sync-item">
                    <div class="activity-info">
                        <h3>Sincronización Real</h3>
                        <p>Descargando datos del reloj...</p>
                        <span>${data.stats.distance} MB / Unidades procesadas</span>
                    </div>
                </div>
            ` + activitiesList.innerHTML;
        }
    }

    closeStatsBtn.addEventListener('click', () => {
        statsSection.classList.add('hidden');
        activitySection.classList.remove('hidden');
    });

    // --- Lógica de Negocio ---

    function updateStatus(online, text) {
        statusDot.classList.toggle('online', online);
        statusText.innerHTML = `<span class="dot ${online ? 'online' : ''}"></span> ${online ? text : 'Desconectado'}`;
    }

    function showLoading(text) {
        const txtEl = document.getElementById('loading-text');
        if (txtEl) {
            txtEl.innerText = text;
            log(`UI Status: ${text}`, 'system');
        }
        if (loadingOverlay) loadingOverlay.style.display = 'flex';
    }

    function hideLoading() {
        if (loadingOverlay) loadingOverlay.style.display = 'none';
    }

    if (cancelLoadingBtn) {
        cancelLoadingBtn.addEventListener('click', () => {
            log("Sincronización cancelada por el usuario.", 'system');
            hideLoading();
        });
    }

    window.addEventListener('ble-timeout', () => {
        log("Evento de timeout detectado, ocultando overlay.", 'error');
        hideLoading();
    });

    function loadMockActivities() {
        activityList.innerHTML = '';
        const mocks = [
            { id: 1, type: 'Carrera', date: 'Hoy, 18:30', dist: '5.2 km' },
            { id: 2, type: 'Ciclismo', date: 'Ayer, 10:15', dist: '12.8 km' },
            { id: 3, type: 'Caminata', date: '20 Feb, 08:00', dist: '2.1 km' }
        ];

        mocks.forEach(act => {
            const item = document.createElement('div');
            item.className = 'activity-item';
            item.innerHTML = `
                <div class="activity-info">
                    <h4>${act.type}</h4>
                    <span>${act.date} • ${act.dist}</span>
                </div>
                <span class="arrow">→</span>
            `;
            item.onclick = () => showActivityDetail(act);
            activityList.appendChild(item);
        });
    }

    function showActivityDetail(activity) {
        showLoading('Descargando datos del GPS...');

        // Simular descarga y parseo
        setTimeout(() => {
            const parsedData = window.ActivityParser.parse(new ArrayBuffer(0));

            // Actualizar UI de estadísticas
            document.getElementById('stat-dist').innerText = parsedData.stats.distance + ' km';
            document.getElementById('stat-time').innerText = parsedData.stats.duration;
            document.getElementById('stat-cal').innerText = parsedData.stats.calories + ' kcal';
            document.getElementById('stat-hr').innerText = parsedData.stats.avgHeartRate + ' bpm';

            activitySection.classList.add('hidden');
            statsSection.classList.remove('hidden');

            // Inicializar y renderizar mapa
            window.sportMap.init();
            window.sportMap.renderRoute(parsedData.points);

            hideLoading();
        }, 1200);
    }
});
