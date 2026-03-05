/**
 * app.js - Main Application Logic
 */
console.log("==> Cargando app.js (v1.6.9) <==");

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
    const copyLogBtn = document.getElementById('copy-log');
    const logSection = document.getElementById('log-section');

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
    const navLog = document.getElementById('nav-log');
    const navSettings = document.getElementById('nav-settings');

    const APP_VERSION = "v1.6.9";

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
        if (viewId !== 'detail') currentView = viewId;

        [activityView, statsDashboard, settingsSection, breakdownSection, statsSection, logSection].forEach(v => {
            if (v) v.classList.add('hidden');
        });
        [navActivities, navStats, navSettings, navLog].forEach(n => {
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
        } else if (viewId === 'log') {
            logSection?.classList.remove('hidden');
            navLog?.classList.add('active');
        } else if (viewId === 'detail') {
            statsSection?.classList.remove('hidden');
        }
    }

    navActivities?.addEventListener('click', () => showView('activities'));
    navStats?.addEventListener('click', () => showView('stats'));
    navLog?.addEventListener('click', () => showView('log'));
    navSettings?.addEventListener('click', () => showView('settings'));

    // Persistent storage Logic
    let allActivities = [];
    let currentView = 'activities'; // Track current view for "Back" button

    async function syncWithBackend() {
        const apiUrl = window.APP_CONFIG?.API_URL;
        if (!apiUrl) return;

        const cloudStatus = document.getElementById('cloud-status');
        try {
            if (cloudStatus) { cloudStatus.innerText = "⏳"; cloudStatus.title = "Sincronizando..."; }
            log("Sincronizando con la nube...", "system");

            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error("Fallo al conectar con la nube");
            const cloudActivities = await response.json();

            if (Array.isArray(cloudActivities)) {
                let downloaded = 0;
                let uploaded = 0;

                // 1. Descargar de nube a local si faltan
                cloudActivities.forEach(cloudAct => {
                    const localExists = allActivities.some(a => a.timestamp === cloudAct.timestamp);
                    if (!localExists) {
                        allActivities.push(cloudAct);
                        downloaded++;
                    }
                });

                // 2. Subir de local a nube si faltan (Bidireccional)
                for (const localAct of allActivities) {
                    const cloudExists = cloudActivities.some(a => a.timestamp === localAct.timestamp);
                    if (!cloudExists) {
                        try {
                            await fetch(apiUrl, {
                                method: 'POST',
                                headers: { 'Content-Type': 'application/json' },
                                body: JSON.stringify(localAct)
                            });
                            uploaded++;
                        } catch (e) { console.error("Error al subir actividad antigua", e); }
                    }
                }

                if (downloaded > 0 || uploaded > 0) {
                    allActivities.sort((a, b) => b.timestamp - a.timestamp);
                    localStorage.setItem('amazfit_db', JSON.stringify(allActivities));
                    if (downloaded > 0) log(`${downloaded} actividades bajadas de la nube.`, "system");
                    if (uploaded > 0) log(`${uploaded} actividades locales subidas a la nube.`, "system");

                    // Refrescar lista principal
                    activityList.innerHTML = '';
                    const recent = [...allActivities].slice(0, 5);
                    recent.forEach(act => renderRealActivity(act, 0, true));
                }

                if (cloudStatus) { cloudStatus.innerText = "☁️"; cloudStatus.style.opacity = "1"; cloudStatus.title = "Nube sincronizada"; }
                log("Nube al día.", "system");
            }
        } catch (e) {
            log(`Error Cloud Sync: ${e.message}`, "error");
            if (cloudStatus) { cloudStatus.innerText = "❌"; cloudStatus.title = "Error de sincronización"; }
        }
    }

    // Carga inicial
    (async () => {
        try {
            const stored = localStorage.getItem('amazfit_db');
            if (stored) {
                allActivities = JSON.parse(stored);
                allActivities.sort((a, b) => b.timestamp - a.timestamp);
                const recent = [...allActivities].slice(0, 5);
                recent.forEach(act => renderRealActivity(act, 0, true));
            }
            // Intentar sincronizar con la nube tras cargar local
            if (window.APP_CONFIG?.API_URL) {
                await syncWithBackend();
            }
        } catch (e) { console.error("Error loading DB", e); }
    })();

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
        log("Actividad borrada del historial local.", "system");

        // Borrar de la nube
        const apiUrl = window.APP_CONFIG?.API_URL;
        if (apiUrl) {
            fetch(`${apiUrl}?timestamp=${timestamp}`, { method: 'DELETE' })
                .then(r => r.json())
                .then(data => {
                    if (data.success) log("Actividad borrada de la nube.", "system");
                })
                .catch(e => console.error("Cloud Delete failed", e));
        }
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
                pointsCount: activity.points?.length || 0,
                points: activity.points || [] // Guardamos los puntos para ver el mapa después
            };
            allActivities.push(summary);
            allActivities.sort((a, b) => b.timestamp - a.timestamp);
            localStorage.setItem('amazfit_db', JSON.stringify(allActivities));

            // Guardar en la nube
            const apiUrl = window.APP_CONFIG?.API_URL;
            if (apiUrl) {
                fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(summary)
                })
                    .then(r => r.json())
                    .then(data => {
                        if (data.success) log("Copia de seguridad en la nube completada.", "system");
                    })
                    .catch(e => console.error("Cloud Save failed", e));
            }
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
                    item.style.cursor = 'pointer';
                    const dateStr = new Date(act.timestamp).toLocaleString([], { day: '2-digit', month: '2-digit', year: '2-digit', hour: '2-digit', minute: '2-digit' });
                    item.innerHTML = `
                        <div class="activity-info">
                            <h4>Actividad ${dateStr}</h4>
                            <span>${act.stats.distance} km • ${act.stats.duration || '--:--'}</span>
                        </div>
                        <div style="display: flex; align-items: center; gap: 5px;">
                            <button class="btn-delete" title="Borrar">🗑️</button>
                            <span class="arrow">→</span>
                        </div>
                    `;
                    item.onclick = (e) => {
                        viewActivityDetail(act);
                    };
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

    async function getOrCreateFolder(name) {
        if (!accessToken) if (!(await initGoogleDrive())) return null;
        try {
            // Search if folder exists (within app scope)
            const searchUrl = `https://www.googleapis.com/drive/v3/files?q=name='${name}' and mimeType='application/vnd.google-apps.folder' and trashed=false`;
            const searchRes = await fetch(searchUrl, {
                headers: { Authorization: 'Bearer ' + accessToken }
            });
            const searchData = await searchRes.json();
            if (searchData.files && searchData.files.length > 0) {
                return searchData.files[0].id;
            }

            // Create if not found
            const createRes = await fetch('https://www.googleapis.com/drive/v3/files', {
                method: 'POST',
                headers: {
                    Authorization: 'Bearer ' + accessToken,
                    'Content-Type': 'application/json'
                },
                body: JSON.stringify({
                    name: name,
                    mimeType: 'application/vnd.google-apps.folder'
                })
            });
            const folder = await createRes.json();
            return folder.id;
        } catch (e) {
            log("Error al buscar/crear carpeta: " + e.message, "error");
            return null;
        }
    }

    async function uploadToDrive(fileName, content, mimeType = 'application/json') {
        if (!accessToken) if (!(await initGoogleDrive())) return;
        showLoading("Subiendo a Google Drive...");
        try {
            const folderId = await getOrCreateFolder('amazfit');
            const metadata = { name: fileName, mimeType: mimeType };
            if (folderId) metadata.parents = [folderId];

            const form = new FormData();
            form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
            form.append('file', new Blob([content], { type: mimeType }));

            const response = await fetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart', {
                method: 'POST',
                headers: { Authorization: 'Bearer ' + accessToken },
                body: form
            });
            if (response.ok) {
                log(`¡Fichero '${fileName}' guardado en Drive (carpeta amazfit)!`, "system");
                alert(`Guardado en Google Drive: ${fileName}`);
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
        const fileName = `amazfit_backup_${new Date().toISOString().split('T')[0]}.json`;
        uploadToDrive(fileName, JSON.stringify(allActivities, null, 2));
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
    copyLogBtn?.addEventListener('click', () => {
        const text = logConsole.innerText;
        navigator.clipboard.writeText(text).then(() => {
            alert("¡Contenido copiado al portapapeles!");
        }).catch(err => {
            log(`Error al copiar: ${err}`, "error");
        });
    });

    document.getElementById('delete-local-history')?.addEventListener('click', () => {
        if (confirm("¿Borrar todo el historial historial y reiniciar sincronización?")) {
            localStorage.removeItem('amazfit_db');
            localStorage.removeItem('last_sync_timestamp');
            allActivities = [];
            activityList.innerHTML = '<p class="empty-msg">No hay actividades. Pulsa sincronizar para descargar datos reales.</p>';
            updateGlobalStats();
            log("Historial y marca de sincronización borrados.", "system");
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

    document.getElementById('force-full-sync')?.addEventListener('click', async () => {
        if (!confirm("Esto ignorará la marca de última sincronización y pedirá todos los datos al reloj (desde 2020). ¿Continuar?")) return;
        localStorage.removeItem('last_sync_timestamp');
        showLoading("Forzando Sincronización Completa...");
        try { await window.amazfit.fetchActivities(new Date(2020, 0, 1)); } // Forzar siempre descarga total del buffer circular
        catch (err) { log(`Error: ${err.message}`, "error"); hideLoading(); }
    });

    document.getElementById('force-full-sync-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.getElementById('force-full-sync')?.click();
    });

    refreshBtn.addEventListener('click', async () => {
        showLoading("Sincronizando reloj...");
        try { await window.amazfit.fetchActivities(); }
        catch (err) { log(`Error: ${err.message}`, "error"); hideLoading(); }
    });

    window.addEventListener('amazfit-data', (event) => {
        const { fullBuffer, complete, startTime } = event.detail;
        if (complete) {
            hideLoading();
            const activities = ActivityParser.parseMultiple(fullBuffer.buffer, startTime);
            let lastTS = 0;
            activities.forEach((act, i) => {
                if (act?.isRealData) {
                    renderRealActivity(act, i + 1);
                    saveToDb(act);
                    if (act.timestamp > lastTS) lastTS = act.timestamp;
                }
            });
            if (lastTS) localStorage.setItem('last_sync_timestamp', lastTS.toString());
            if (activities.length === 0) {
                log("Sincronización finalizada: No se encontraron actividades nuevas.", "system");
            } else {
                const GAP_THRESHOLD_MS = 12 * 60 * 60 * 1000; // 12 horas de hueco = nueva actividad (más robusto para actividades largas)
                // Si había mensaje de "No hay actividades", lo quitamos
                const empty = activityList.querySelector('.empty-msg');
                if (empty) empty.remove();
            }
        }
    });

    function viewActivityDetail(data) {
        if (!data || !data.stats) return;

        const dateStr = new Date(data.timestamp).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

        document.getElementById('stat-dist').innerText = data.stats.distance + ' km';
        document.getElementById('stat-time').innerText = data.stats.duration;
        document.getElementById('stat-cal').innerText = data.stats.calories + ' kcal';
        document.getElementById('stat-hr').innerText = data.stats.avgHeartRate + ' bpm';
        document.getElementById('stat-pace').innerText = (data.stats.pace || "--:--") + ' min/km';
        document.getElementById('activity-title').innerText = `Actividad: ${dateStr}`;

        showView('detail');

        window.sportMap.init();
        window.sportMap.renderRoute(data.points);

        const filename = `amazfit_${data.timestamp}.gpx`;
        const gpxBtn = document.getElementById('download-gpx');
        if (gpxBtn) {
            gpxBtn.onclick = () => {
                const gpxStr = ActivityParser.exportToGPX(data);
                const blob = new Blob([gpxStr], { type: "application/gpx+xml" });
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url; a.download = filename; a.click();
                URL.revokeObjectURL(url);
            };
        }

        const gdriveBtn = document.getElementById('upload-gdrive-gpx');
        if (gdriveBtn) {
            gdriveBtn.onclick = () => {
                const gpxStr = ActivityParser.exportToGPX(data);
                uploadToDrive(filename, gpxStr, "application/gpx+xml");
            };
        }
    }

    function renderRealActivity(data, index, isFromHistory = false) {
        if (!data || !data.stats) return;

        // Evitar duplicados en el DOM si ya está (por timestamp)
        if (!isFromHistory && document.querySelector(`[data-ts="${data.timestamp}"]`)) return;

        const item = document.createElement('div');
        item.className = 'activity-item real-sync';
        if (isFromHistory) item.classList.add('history-item');
        item.setAttribute('data-ts', data.timestamp);

        const dateStr = new Date(data.timestamp).toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
        item.innerHTML = `
            <div class="activity-info">
                <h4>Actividad ${dateStr} ${isFromHistory ? '<small>(Guardada)</small>' : ''}</h4>
                <span>${data.stats.distance} km • ${data.stats.duration || '--:--'}</span>
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
        item.onclick = () => viewActivityDetail(data);
        activityList.insertBefore(item, activityList.firstChild);
    }

    closeStatsBtn.onclick = () => {
        showView(currentView);
    };

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
    // Init UI version display
    document.querySelectorAll('#version-display, #header-version').forEach(el => {
        el.innerText = APP_VERSION;
    });

    log(`Iniciando App v${APP_VERSION}...`, 'system');
});
