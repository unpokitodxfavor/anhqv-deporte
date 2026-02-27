/**
 * app.js - Main Application Logic
 */
console.log("==> Cargando app.js (v1.5.0) <==");

document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM Cargado. Iniciando app logic...");
    const authSection = document.getElementById('auth-section');
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

    // Navigation and View elements
    const activitySection = document.getElementById('activity-list-section');
    const activityView = document.getElementById('activity-view');
    const statsDashboard = document.getElementById('stats-dashboard-section');
    const settingsSection = document.getElementById('settings-section');
    const statsSection = document.getElementById('stats-section');

    const navActivities = document.getElementById('nav-activities');
    const navStats = document.getElementById('nav-stats');
    const navSettings = document.getElementById('nav-settings');

    function showView(viewId) {
        // Ocultar todas las secciones principales
        [activityView, statsDashboard, settingsSection].forEach(v => {
            if (v) v.classList.add('hidden');
        });

        // Desactivar botones nav
        [navActivities, navStats, navSettings].forEach(n => {
            if (n) n.classList.remove('active');
        });

        if (viewId === 'activities') {
            activityView.classList.remove('hidden');
            navActivities?.classList.add('active');
        } else if (viewId === 'stats') {
            statsDashboard?.classList.remove('hidden');
            navStats?.classList.add('active');
            updateGlobalStats();
        } else if (viewId === 'settings') {
            settingsSection?.classList.remove('hidden');
            navSettings?.classList.add('active');
        }
    }

    navActivities?.addEventListener('click', () => showView('activities'));
    navStats?.addEventListener('click', () => showView('stats'));
    navSettings?.addEventListener('click', () => showView('settings'));

    // Persistent storage Logic
    let allActivities = [];
    try {
        const stored = localStorage.getItem('amazfit_db');
        if (stored) allActivities = JSON.parse(stored);
    } catch (e) { console.error("Error loading DB", e); }

    function saveToDb(activity) {
        if (!allActivities.find(a => a.timestamp === activity.timestamp)) {
            const summary = {
                timestamp: activity.timestamp,
                stats: activity.stats,
                pointsCount: activity.points.length
            };
            allActivities.push(summary);
            localStorage.setItem('amazfit_db', JSON.stringify(allActivities));
        }
    }

    function updateGlobalStats() {
        const statsListEl = document.getElementById('stats-summary-list');
        const totalDistEl = document.getElementById('global-total-dist');
        const totalCountEl = document.getElementById('global-total-count');
        const monthDistEl = document.getElementById('month-total-dist');
        const weekDistEl = document.getElementById('week-total-dist');

        if (allActivities.length === 0) {
            if (statsListEl) statsListEl.innerHTML = '<p class="empty-msg">No hay datos. Sincroniza tu reloj para empezar.</p>';
            return;
        }

        let totalDist = 0;
        let monthDist = 0;
        let weekDist = 0;
        let weekCount = 0;

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());

        allActivities.forEach(act => {
            const d = parseFloat(act.stats.distance) || 0;
            totalDist += d;

            const actDate = new Date(act.timestamp);
            if (actDate >= startOfMonth) monthDist += d;
            if (actDate >= startOfWeek) {
                weekDist += d;
                weekCount++;
            }
        });

        if (totalDistEl) totalDistEl.innerText = `${totalDist.toFixed(2)} km`;
        if (totalCountEl) totalCountEl.innerText = `${allActivities.length} actividades`;
        if (monthDistEl) monthDistEl.innerText = `${monthDist.toFixed(2)} km`;
        if (weekDistEl) weekDistEl.innerText = `${weekDist.toFixed(2)} km`;
        const weekCountEl = document.getElementById('week-total-count');
        if (weekCountEl) weekCountEl.innerText = `${weekCount} activ.`;

        // Monthly grouping
        const groups = {};
        allActivities.forEach(act => {
            const date = new Date(act.timestamp);
            const key = date.toLocaleString('es-ES', { month: 'long', year: 'numeric' });
            if (!groups[key]) groups[key] = { dist: 0, count: 0 };
            groups[key].dist += parseFloat(act.stats.distance) || 0;
            groups[key].count++;
        });

        if (statsListEl) {
            statsListEl.innerHTML = '';
            Object.keys(groups).forEach(key => {
                const item = document.createElement('div');
                item.className = 'activity-item';
                item.style.cursor = 'default';
                item.innerHTML = `
                    <div class="activity-info">
                        <h4 style="text-transform: capitalize;">${key}</h4>
                        <span>${groups[key].dist.toFixed(2)} km • ${groups[key].count} sesiones</span>
                    </div>
                `;
                statsListEl.appendChild(item);
            });
        }
    }

    document.getElementById('delete-local-history')?.addEventListener('click', () => {
        if (confirm("¿Estás seguro de borrar todo el historial acumulado?")) {
            localStorage.removeItem('amazfit_db');
            allActivities = [];
            updateGlobalStats();
            log("Historial local borrado.", "system");
        }
    });

    const VITE_SUSTAINABILITY = false;
    const OFFLINE = false;
    const APP_VERSION = "v1.5.0";

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

    // Permitir a otros ficheros mandar logs a la consola UI
    window.addEventListener('app-log', (e) => {
        log(e.detail.message, e.detail.type);
    });

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

    const copyLogBtn = document.getElementById('copy-log');
    if (copyLogBtn) {
        copyLogBtn.addEventListener('click', () => {
            const text = Array.from(logConsole.querySelectorAll('.log-entry'))
                .map(el => el.innerText)
                .join('\n');
            navigator.clipboard.writeText(text).then(() => {
                const oldText = copyLogBtn.innerText;
                copyLogBtn.innerText = '¡Copiado!';
                setTimeout(() => copyLogBtn.innerText = oldText, 2000);
            }).catch(err => {
                console.error("Error al copiar:", err);
            });
        });
    }

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
            log('>>> CLICK DETECTADO (Patch v1.2.4) <<<', 'system');
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
        showLoading(`Flujo de Rayo Cósmico v${APP_VERSION} (Resiliencia Total)...`);

        // Chronos Timeout v1.3.13: 120 seconds (resilience margin)
        const safetyHatch = setTimeout(() => {
            if (loadingOverlay.style.display !== 'none') {
                log("TIMEOUT CHRONOS: Tiempo máximo de sincronización (2 min) agotado.", "error");
                hideLoading();
            }
        }, 120000);

        try {
            await window.amazfit.fetchActivities();
        } catch (err) {
            log(`Error al iniciar descarga: ${err.message}`, "error");
            clearTimeout(safetyHatch);
            hideLoading();
        }
    });

    // Escuchar progreso de descarga (ligero)
    window.addEventListener('amazfit-progress', (event) => {
        const { received } = event.detail;
        const loadingText = document.getElementById('loading-text');
        if (loadingText) {
            loadingText.innerText = `Descargando: ${(received / 1024).toFixed(1)} KB recibidos...`;
        }
    });

    // Escuchar finalización de descarga o datos de control
    window.addEventListener('amazfit-data', (event) => {
        const { fullBuffer, complete } = event.detail;

        if (complete) {
            hideLoading();
            log(`Descarga finalizada: ${fullBuffer.byteLength} bytes.`, "system");

            // v1.4.1: Intentar parsear múltiples actividades
            const activities = ActivityParser.parseMultiple(fullBuffer.buffer);
            log(`Se han detectado ${activities.length} actividades en el buffer.`, "system");

            let lastTimestamp = 0;
            activities.forEach((act, index) => {
                if (act && act.isRealData && act.points.length > 0) {
                    renderRealActivity(act, index + 1);
                    saveToDb(act); // PERSISTIR
                    if (act.timestamp > lastTimestamp) lastTimestamp = act.timestamp;
                }
            });

            if (lastTimestamp > 0) {
                // Guardar para la próxima sincronización incremental
                localStorage.setItem('last_sync_timestamp', lastTimestamp.toString());
                log(`Marca de sincronización actualizada: ${new Date(lastTimestamp).toLocaleString()}`, "system");
            }
        }
    });

    function renderRealActivity(data, index) {
        log(`Renderizando actividad #${index}...`, "system");

        // Limpiar el mensaje de "No hay actividades"
        const emptyMsg = activityList.querySelector('.empty-msg');
        if (emptyMsg) emptyMsg.remove();

        const item = document.createElement('div');
        item.className = 'activity-item real-sync';

        const dateStr = new Date(data.timestamp).toLocaleString([], {
            day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit'
        });

        item.innerHTML = `
            <div class="activity-info">
                <h4>Actividad ${dateStr}</h4>
                <span>${data.stats.distance} km • ${data.stats.duration}</span>
            </div>
            <span class="arrow">→</span>
        `;
        item.onclick = () => {
            // Mostrar los datos reales en la vista de estadísticas
            document.getElementById('stat-dist').innerText = data.stats.distance + ' km';
            document.getElementById('stat-time').innerText = data.stats.duration;
            document.getElementById('stat-cal').innerText = data.stats.calories + ' kcal';
            document.getElementById('stat-hr').innerText = data.stats.avgHeartRate + ' bpm';
            const paceEl = document.getElementById('stat-pace');
            if (paceEl) paceEl.innerText = (data.stats.pace || "--:--") + ' min/km';

            const titleEl = document.getElementById('activity-title');
            if (titleEl) titleEl.innerText = `Actividad: ${dateStr}`;

            activitySection.classList.add('hidden');
            statsSection.classList.remove('hidden');

            // Renderizar mapa
            window.sportMap.init();
            window.sportMap.renderRoute(data.points);

            // Refrescar tamaño tras render porque estaba oculto
            setTimeout(() => {
                if (window.sportMap.map) {
                    window.sportMap.map.invalidateSize();
                    if (window.sportMap.polyline && data.points.length > 0) {
                        window.sportMap.map.fitBounds(window.sportMap.polyline.getBounds(), { padding: [20, 20] });
                    }
                }
            }, 300);

            // Botón GPX
            const gpxBtn = document.getElementById('download-gpx');
            if (gpxBtn) {
                gpxBtn.onclick = () => {
                    const gpxStr = ActivityParser.exportToGPX(data);
                    const blob = new Blob([gpxStr], { type: "application/gpx+xml" });
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement('a');
                    a.href = url;
                    a.download = `amazfit_${data.timestamp}.gpx`;
                    a.click();
                    URL.revokeObjectURL(url);
                    log("GPX exportado.", "system");
                };
            }
        };

        // Insertar al principio de la lista
        activityList.insertBefore(item, activityList.firstChild);
    }

    closeStatsBtn.addEventListener('click', () => {
        statsSection.classList.add('hidden');
        activityView.classList.remove('hidden'); // Editado para usar activityView
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
