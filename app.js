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
    const breakdownSection = document.getElementById('breakdown-section');
    const breakdownList = document.getElementById('breakdown-list');
    const closeBreakdownBtn = document.getElementById('close-breakdown');

    const navActivities = document.getElementById('nav-activities');
    const navStats = document.getElementById('nav-stats');
    const navSettings = document.getElementById('nav-settings');

    const APP_VERSION = "v1.5.4";

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

    // Navigation Logic
    function showView(viewId) {
        [activityView, statsDashboard, settingsSection, breakdownSection].forEach(v => {
            if (v) v.classList.add('hidden');
        });
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
        } else if (viewId === 'breakdown') {
            breakdownSection?.classList.remove('hidden');
            navStats?.classList.add('active');
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

    function deleteFromDb(timestamp) {
        if (!confirm("¿Borrar esta actividad del historial?")) return;
        allActivities = allActivities.filter(a => a.timestamp !== timestamp);
        localStorage.setItem('amazfit_db', JSON.stringify(allActivities));
        updateGlobalStats();
        // Intentar refrescar la vista actual si es breakdown
        const titleEl = document.getElementById('breakdown-title');
        if (!breakdownSection.classList.contains('hidden') && titleEl) {
            const currentTitle = titleEl.innerText;
            // Si estamos viendo un desglose, lo refrescamos con los datos filtrados
            // Esto es un poco rudimentario pero funcionará para la mayoría de casos
            const statsListEl = document.getElementById('stats-summary-list');
            updateGlobalStats(); // Ya lo llamamos arriba
            // Si era un mes, lo buscamos de nuevo
            const filtered = allActivities.filter(act => {
                // ... lógica para re-filtrar según el título ...
                // Para simplificar, si borras algo, cerramos el breakdown para que veas el total actualizado
                showView('stats');
            });
        }
        log("Actividad borrada del historial.", "system");
    }

    function saveToDb(activity) {
        if (!allActivities.find(a => a.timestamp === activity.timestamp)) {
            let seconds = 0;
            if (activity.stats.duration) {
                const parts = activity.stats.duration.split(':');
                if (parts.length === 3) {
                    seconds = (parseInt(parts[0]) * 3600) + (parseInt(parts[1]) * 60) + parseInt(parts[2]);
                }
            }
            const summary = {
                timestamp: activity.timestamp,
                stats: activity.stats,
                durationSec: seconds,
                pointsCount: activity.points?.length || 0
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
        const recordDistEl = document.getElementById('record-dist');
        const recordDateEl = document.getElementById('record-date');
        const avgSpeedEl = document.getElementById('global-avg-speed');
        const totalTimeEl = document.getElementById('total-time-hours');

        if (allActivities.length === 0) {
            if (statsListEl) statsListEl.innerHTML = '<p class="empty-msg">No hay datos. Sincroniza tu reloj para empezar.</p>';
            return;
        }

        let totalDist = 0;
        let totalSec = 0;
        let monthDist = 0;
        let weekDist = 0;
        let weekCount = 0;
        let maxDist = 0;
        let maxDistDate = null;

        const now = new Date();
        const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);
        const startOfWeek = new Date(now);
        startOfWeek.setDate(now.getDate() - now.getDay());

        const groups = {};
        allActivities.forEach(act => {
            const d = parseFloat(act.stats.distance) || 0;
            const s = act.durationSec || 0;
            totalDist += d;
            totalSec += s;

            if (d > maxDist) {
                maxDist = d;
                maxDistDate = new Date(act.timestamp);
            }

            const actDate = new Date(act.timestamp);
            if (actDate >= startOfMonth) monthDist += d;
            if (actDate >= startOfWeek) {
                weekDist += d;
                weekCount++;
            }

            // Grouping for monthly list
            const key = actDate.toLocaleString('es-ES', { month: 'long', year: 'numeric' });
            if (!groups[key]) groups[key] = { dist: 0, count: 0 };
            groups[key].dist += d;
            groups[key].count++;
        });

        if (totalDistEl) totalDistEl.innerText = `${totalDist.toFixed(2)} km`;
        if (totalCountEl) totalCountEl.innerText = `${allActivities.length} actividades`;
        if (monthDistEl) monthDistEl.innerText = `${monthDist.toFixed(2)} km`;
        if (weekDistEl) weekDistEl.innerText = `${weekDist.toFixed(2)} km`;
        const weekCountEl = document.getElementById('week-total-count');
        if (weekCountEl) weekCountEl.innerText = `${weekCount} activ.`;

        if (recordDistEl) recordDistEl.innerText = `${maxDist.toFixed(2)} km`;
        if (recordDateEl && maxDistDate) recordDateEl.innerText = maxDistDate.toLocaleDateString();
        const avgSpeed = totalSec > 0 ? (totalDist / (totalSec / 3600)) : 0;
        if (avgSpeedEl) avgSpeedEl.innerText = `${avgSpeed.toFixed(1)} km/h`;
        if (totalTimeEl) totalTimeEl.innerText = `${Math.floor(totalSec / 3600)}h ${Math.floor((totalSec % 3600) / 60)}m total`;

        if (statsListEl) {
            statsListEl.innerHTML = '';
            Object.keys(groups).forEach(key => {
                const item = document.createElement('div');
                item.className = 'activity-item';
                item.style.cursor = 'pointer';
                item.innerHTML = `
                    <div class="activity-info">
                        <h4 style="text-transform: capitalize;">${key}</h4>
                        <span>${groups[key].dist.toFixed(2)} km • ${groups[key].count} sesiones</span>
                    </div>
                    <span class="arrow">→</span>
                `;
                item.onclick = () => {
                    const monthActivities = allActivities.filter(act => {
                        const actDate = new Date(act.timestamp);
                        return actDate.toLocaleString('es-ES', { month: 'long', year: 'numeric' }) === key;
                    });
                    showActivitiesBreakdown(monthActivities, key);
                };
                statsListEl.appendChild(item);
            });
        }

        // Setup clicks for general cards
        const cards = [
            { id: 'global-total-dist', title: 'Historial Completo', filter: () => true },
            { id: 'month-total-dist', title: 'Este Mes', filter: (act) => new Date(act.timestamp) >= startOfMonth },
            { id: 'week-total-dist', title: 'Esta Semana', filter: (act) => new Date(act.timestamp) >= startOfWeek },
            { id: 'record-dist', title: 'Récord de Distancia', filter: (act) => parseFloat(act.stats.distance) === maxDist }
        ];

        cards.forEach(card => {
            const el = document.getElementById(card.id);
            if (el) {
                const parent = el.closest('.stat-card');
                if (parent) {
                    parent.style.cursor = 'pointer';
                    parent.onclick = () => {
                        const filtered = allActivities.filter(card.filter);
                        showActivitiesBreakdown(filtered, card.title);
                    };
                }
            }
        });
    }

    function showActivitiesBreakdown(activities, title) {
        const titleEl = document.getElementById('breakdown-title');
        if (titleEl) titleEl.innerText = title;

        if (breakdownList) {
            breakdownList.innerHTML = '';
            if (activities.length === 0) {
                breakdownList.innerHTML = '<p class="empty-msg">No hay actividades en este periodo.</p>';
            } else {
                // Ordenar por fecha descendente
                [...activities].sort((a, b) => b.timestamp - a.timestamp).forEach(act => {
                    const item = document.createElement('div');
                    item.className = 'activity-item';
                    item.style.cursor = 'default';
                    const dateStr = new Date(act.timestamp).toLocaleString([], { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
                    item.innerHTML = `
                        <div class="activity-info">
                            <h4>Actividad ${dateStr}</h4>
                            <span>${act.stats.distance} km • ${act.stats.duration || '--:--'}</span>
                        </div>
                        <button class="btn-delete" title="Borrar">🗑️</button>
                    `;
                    const delBtn = item.querySelector('.btn-delete');
                    delBtn.onclick = (e) => {
                        e.stopPropagation();
                        deleteFromDb(act.timestamp);
                    };
                    breakdownList.appendChild(item);
                });
            }
        }
        showView('breakdown');
    }

    if (closeBreakdownBtn) closeBreakdownBtn.onclick = () => showView('stats');

    // --- Google Drive Integration ---
    let tokenClient;
    let accessToken = null;
    const CLIENT_ID_INPUT = document.getElementById('gdrive-client-id');

    async function initGoogleDrive() {
        const CLIENT_ID = CLIENT_ID_INPUT?.value || localStorage.getItem('gdrive_client_id') || window.APP_CONFIG?.GOOGLE_CLIENT_ID;
        if (!CLIENT_ID) {
            alert("Introduce tu Client ID en Ajustes.");
            showView('settings');
            return false;
        }
        return new Promise((resolve) => {
            tokenClient = google.accounts.oauth2.initTokenClient({
                client_id: CLIENT_ID,
                scope: 'https://www.googleapis.com/auth/drive.file',
                callback: (r) => {
                    if (r.error) { log("Error Auth Google: " + r.error, "error"); resolve(false); }
                    accessToken = r.access_token;
                    resolve(true);
                },
            });
            tokenClient.requestAccessToken({ prompt: 'consent' });
        });
    }

    async function uploadToDrive(jsonContent) {
        if (!accessToken) if (!(await initGoogleDrive())) return;
        showLoading("Subiendo a Google Drive...");
        try {
            const fileName = `amazfit_backup_${new Date().toISOString().split('T')[0]}.json`;
            const metadata = { name: fileName, mimeType: 'application/json' };
            const form = new FormData();
            form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            form.append('file', new Blob([jsonContent], { type: 'application/json' }));
            const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + accessToken },
                body: form
            });
            if (response.ok) {
                log("¡Copia de seguridad en Drive!", "system");
                alert("Guardado en Google Drive.");
            } else {
                const err = await response.json();
                log("Error al subir: " + (err.error?.message || "Desconocido"), "error");
                accessToken = null;
            }
        } catch (e) { log("Error Drive: " + e.message, "error"); }
        finally { hideLoading(); }
    }

    document.getElementById('export-gdrive')?.addEventListener('click', () => {
        if (allActivities.length === 0) { alert("No hay datos."); return; }
        uploadToDrive(JSON.stringify(allActivities, null, 2));
    });

    if (CLIENT_ID_INPUT) {
        const configId = window.APP_CONFIG?.GOOGLE_CLIENT_ID || "";
        CLIENT_ID_INPUT.value = localStorage.getItem('gdrive_client_id') || configId;

        document.getElementById('save-gdrive-id')?.addEventListener('click', () => {
            localStorage.setItem('gdrive_client_id', CLIENT_ID_INPUT.value);
            log("Client ID de Google guardado.", "system");
            alert("Google Client ID guardado correctamente.");
        });

        CLIENT_ID_INPUT.onchange = () => localStorage.setItem('gdrive_client_id', CLIENT_ID_INPUT.value);
    }

    // --- Core UI & Bluetooth ---
    function updateStatus(online, text) {
        statusDot?.classList.toggle('online', online);
        if (statusText) statusText.innerHTML = `<span class="dot ${online ? 'online' : ''}"></span> ${online ? text : 'Desconectado'}`;
    }

    function showLoading(text) {
        const txtEl = document.getElementById('loading-text');
        if (txtEl) txtEl.innerText = text;
        if (loadingOverlay) loadingOverlay.style.display = 'flex';
        log(`Status: ${text}`, 'system');
    }

    function hideLoading() { if (loadingOverlay) loadingOverlay.style.display = 'none'; }

    cancelLoadingBtn?.addEventListener('click', () => hideLoading());
    clearLogsBtn?.addEventListener('click', () => logConsole.innerHTML = `<div class="log-entry system">Consola limpia v${APP_VERSION}</div>`);

    document.getElementById('delete-local-history')?.addEventListener('click', () => {
        if (confirm("¿Borrar todo el historial?")) {
            localStorage.removeItem('amazfit_db');
            allActivities = [];
            updateGlobalStats();
            log("Historial local borrado.", "system");
        }
    });

    // Bluetooth Connect
    connectBtn.onclick = async () => {
        const key = authKeyInput.value.trim();
        if (key.length !== 32) { alert('Clave no válida.'); return; }
        try {
            showLoading('Conectando...');
            const deviceName = await window.amazfit.connect(key, (msg, type) => log(msg, type));
            updateStatus(true, `Conectado: ${deviceName}`);
            authSection.classList.add('hidden');
            activitySection.classList.remove('hidden');
            localStorage.setItem('amazfit_auth_key', key);
        } catch (err) { log(`Error: ${err.message}`, 'error'); alert('Error: ' + err.message); }
        finally { hideLoading(); }
    };

    saveKeyBtn.addEventListener('click', () => {
        localStorage.setItem('amazfit_auth_key', authKeyInput.value);
        log("Auth Key guardada.", "system");
    });

    refreshBtn.addEventListener('click', async () => {
        showLoading("Sincronizando reloj...");
        try { await window.amazfit.fetchActivities(); }
        catch (err) { log(`Error: ${err.message}`, "error"); hideLoading(); }
    });

    window.addEventListener('amazfit-data', (event) => {
        const { fullBuffer, complete } = event.detail;
        if (complete) {
            hideLoading();
            const activities = ActivityParser.parseMultiple(fullBuffer.buffer);
            let lastTS = 0;
            activities.forEach((act, i) => {
                if (act?.isRealData) {
                    renderRealActivity(act, i + 1);
                    saveToDb(act);
                    if (act.timestamp > lastTS) lastTS = act.timestamp;
                }
            });
            if (lastTS) localStorage.setItem('last_sync_timestamp', lastTS.toString());
        }
    });

    function renderRealActivity(data, index) {
        const item = document.createElement('div');
        item.className = 'activity-item real-sync';
        const dateStr = new Date(data.timestamp).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        item.innerHTML = `
            <div class="activity-info">
                <h4>Actividad ${dateStr}</h4>
                <span>${data.stats.distance} km • ${data.stats.duration}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 5px;">
                <button class="btn-delete" title="Borrar">🗑️</button>
                <span class="arrow">→</span>
            </div>
        `;

        const delBtn = item.querySelector('.btn-delete');
        delBtn.onclick = (e) => {
            e.stopPropagation();
            if (confirm("¿Borrar esta actividad de la lista?")) {
                item.remove();
                // También borrar de la DB si existe
                allActivities = allActivities.filter(a => a.timestamp !== data.timestamp);
                localStorage.setItem('amazfit_db', JSON.stringify(allActivities));
                updateGlobalStats();
            }
        };
        item.onclick = () => {
            document.getElementById('stat-dist').innerText = data.stats.distance + ' km';
            document.getElementById('stat-time').innerText = data.stats.duration;
            document.getElementById('stat-cal').innerText = data.stats.calories + ' kcal';
            document.getElementById('stat-hr').innerText = data.stats.avgHeartRate + ' bpm';
            document.getElementById('stat-pace').innerText = (data.stats.pace || "--:--") + ' min/km';
            document.getElementById('activity-title').innerText = `Actividad: ${dateStr}`;
            activitySection.classList.add('hidden');
            statsSection.classList.remove('hidden');
            window.sportMap.init();
            window.sportMap.renderRoute(data.points);
            const gpxBtn = document.getElementById('download-gpx');
            if (gpxBtn) gpxBtn.onclick = () => {
                const gpxStr = ActivityParser.exportToGPX(data);
                const blob = new Blob([gpxStr], { type: "application/gpx+xml" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = `amazfit_${data.timestamp}.gpx`; a.click();
                URL.revokeObjectURL(url);
            };
        };
        activityList.insertBefore(item, activityList.firstChild);
    }

    closeStatsBtn.onclick = () => { statsSection.classList.add('hidden'); activityView.classList.remove('hidden'); };

    // Init
    const savedKey = localStorage.getItem('amazfit_auth_key') || window.APP_CONFIG?.AMAZFIT_AUTH_KEY;
    if (savedKey) {
        authKeyInput.value = savedKey;
        setTimeout(async () => {
            try {
                const dev = await window.amazfit.attemptAutoConnect(savedKey, (m, t) => log(m, t));
                if (dev) {
                    updateStatus(true, `Auto: ${dev}`);
                    authSection.classList.add('hidden');
                    activitySection.classList.remove('hidden');
                }
            } catch (e) { }
        }, 800);
    }

    window.onerror = (m, u, l) => log(`Error JS: ${m} (línea ${l})`, 'error');
    log(`Iniciando App v${APP_VERSION}...`, 'system');
});
