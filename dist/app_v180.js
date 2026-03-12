/**
 * app.js - Main Application Logic (v1.8.0)
 */
console.log("==> Cargando app.js (v1.8.0) <==");

document.addEventListener('DOMContentLoaded', () => {
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

    const APP_VERSION = "v1.8.0";
    let allActivities = JSON.parse(localStorage.getItem('amazfit_db') || '[]');
    let currentView = 'activities';

    function log(message, type = 'system') {
        if (!logConsole) return;
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        const time = new Date().toLocaleTimeString();
        entry.innerText = `[${time}] ${message}`;
        logConsole.appendChild(entry);
        logConsole.scrollTop = logConsole.scrollHeight;
    }

    function showView(viewId) {
        if (viewId !== 'detail') currentView = viewId;
        [activityView, statsDashboard, settingsSection, breakdownSection, statsSection, logSection].forEach(v => v?.classList.add('hidden'));
        [navActivities, navStats, navSettings, navLog].forEach(n => n?.classList.remove('active'));

        if (viewId === 'activities') { activityView.classList.remove('hidden'); navActivities?.classList.add('active'); }
        else if (viewId === 'stats') { statsDashboard?.classList.remove('hidden'); navStats?.classList.add('active'); updateGlobalStats(); }
        else if (viewId === 'settings') { settingsSection?.classList.remove('hidden'); navSettings?.classList.add('active'); }
        else if (viewId === 'breakdown') { breakdownSection?.classList.remove('hidden'); navStats?.classList.add('active'); }
        else if (viewId === 'log') { logSection?.classList.remove('hidden'); navLog?.classList.add('active'); }
        else if (viewId === 'detail') { statsSection?.classList.remove('hidden'); }
    }

    navActivities?.addEventListener('click', () => showView('activities'));
    navStats?.addEventListener('click', () => showView('stats'));
    navLog?.addEventListener('click', () => showView('log'));
    navSettings?.addEventListener('click', () => showView('settings'));

    async function syncWithBackend() {
        const apiUrl = window.APP_CONFIG?.API_URL;
        if (!apiUrl) return;
        try {
            log("Sincronizando con la nube...", "system");
            const response = await fetch(apiUrl);
            if (!response.ok) throw new Error("Fallo al conectar con la nube");
            const cloudActivities = await response.json();
            if (Array.isArray(cloudActivities)) {
                let downloaded = 0;
                cloudActivities.forEach(cloudAct => {
                    if (!cloudAct || !cloudAct.stats) return;
                    if (!allActivities.some(a => a.timestamp === cloudAct.timestamp)) {
                        allActivities.push(cloudAct);
                        downloaded++;
                    }
                });
                if (downloaded > 0) {
                    allActivities.sort((a, b) => b.timestamp - a.timestamp);
                    localStorage.setItem('amazfit_db', JSON.stringify(allActivities));
                    log(`${downloaded} actividades descargadas de la nube.`, "success");
                    refreshUI();
                }
            }
        } catch (e) { console.error("Sync Error:", e); }
    }

    function refreshUI() {
        activityList.innerHTML = '';
        const recent = allActivities.slice(0, 4);
        if (recent.length === 0) {
            activityList.innerHTML = '<p class="empty-msg">No hay actividades. Sincroniza para descargar datos.</p>';
        } else {
            recent.forEach(act => renderRealActivity(act, 0, true));
        }
    }

    window.addEventListener('amazfit-data', (event) => {
        const { fullBuffer, complete, startTime, baseLat, baseLng } = event.detail;
        if (complete) {
            hideLoading();
            log(`Procesando datos recibidos. Base Lat: ${baseLat}, Base Lng: ${baseLng}`, "system");
            const activities = ActivityParser.parseMultiple(fullBuffer.buffer, startTime, baseLat, baseLng);
            activities.forEach(act => {
                if (act?.isRealData && parseFloat(act.stats.distance) > 0) {
                    saveToDb(act);
                }
            });
            refreshUI();
            updateGlobalStats();
            syncWithBackend(); // Subir lo nuevo
        }
    });

    function saveToDb(activity) {
        if (!allActivities.find(a => a.timestamp === activity.timestamp)) {
            let seconds = 0;
            if (activity.stats.duration) {
                const parts = activity.stats.duration.split(':');
                if (parts.length === 3) seconds = (parseInt(parts[0]) * 3600) + (parseInt(parts[1]) * 60) + parseInt(parts[2]);
            }
            const summary = {
                timestamp: activity.timestamp,
                stats: activity.stats,
                durationSec: seconds,
                points: activity.points || []
            };
            allActivities.push(summary);
            allActivities.sort((a, b) => b.timestamp - a.timestamp);
            localStorage.setItem('amazfit_db', JSON.stringify(allActivities));
            
            const apiUrl = window.APP_CONFIG?.API_URL;
            if (apiUrl) {
                fetch(apiUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify(summary)
                }).catch(e => console.error("Cloud Save failed", e));
            }
        }
    }

    function renderRealActivity(data, index, isFromHistory = false) {
        const item = document.createElement('div');
        item.className = 'activity-item animate-fade';
        const d = new Date(data.timestamp);
        const dateStr = d.toLocaleDateString([], { day: '2-digit', month: '2-digit' }) + ' ' + d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        
        item.innerHTML = `
            <div class="activity-info">
                <h4>Actividad ${dateStr}</h4>
                <span>${data.stats.distance} km • ${data.stats.duration}</span>
            </div>
            <div style="display: flex; align-items: center; gap: 8px;">
                <button class="btn-delete">🗑️</button>
                <span class="arrow">→</span>
            </div>
        `;
        item.querySelector('.btn-delete').onclick = (e) => {
            e.stopPropagation();
            if (confirm("¿Borrar actividad?")) {
                allActivities = allActivities.filter(a => a.timestamp !== data.timestamp);
                localStorage.setItem('amazfit_db', JSON.stringify(allActivities));
                refreshUI();
                updateGlobalStats();
            }
        };
        item.onclick = () => viewActivityDetail(data);
        activityList.appendChild(item);
    }

    function viewActivityDetail(data) {
        document.getElementById('stat-dist').innerText = data.stats.distance + ' km';
        document.getElementById('stat-time').innerText = data.stats.duration;
        document.getElementById('stat-cal').innerText = data.stats.calories + ' kcal';
        document.getElementById('stat-hr').innerText = data.stats.avgHeartRate + ' bpm';
        document.getElementById('stat-pace').innerText = (data.stats.pace || "--:--") + ' min/km';
        document.getElementById('activity-title').innerText = `Detalle: ${new Date(data.timestamp).toLocaleString()}`;
        showView('detail');
        window.sportMap.init();
        window.sportMap.renderRoute(data.points);
    }

    function updateGlobalStats() {
        let totalDist = 0;
        allActivities.forEach(a => totalDist += parseFloat(a.stats.distance) || 0);
        const el = document.getElementById('global-total-dist');
        if (el) el.innerText = totalDist.toFixed(2);
        const elCount = document.getElementById('global-total-count');
        if (elCount) elCount.innerText = allActivities.length;
    }

    function showLoading(text) {
        const txtEl = document.getElementById('loading-text');
        if (txtEl) txtEl.innerText = text;
        if (loadingOverlay) loadingOverlay.style.display = 'flex';
    }
    function hideLoading() { if (loadingOverlay) loadingOverlay.style.display = 'none'; }

    connectBtn.onclick = async () => {
        const key = authKeyInput.value.trim();
        if (key.length !== 32) { alert('Clave de 32 caracteres requerida.'); return; }
        showLoading('Conectando...');
        try {
            const dev = await window.amazfit.connect(key, (m, t) => log(m, t));
            statusText.innerText = `Conectado: ${dev}`;
            statusDot.classList.add('online');
            authSection.classList.add('hidden');
            activitySection.classList.remove('hidden');
            localStorage.setItem('amazfit_auth_key', key);
            syncWithBackend();
        } catch (e) { log(e.message, 'error'); }
        finally { hideLoading(); }
    };

    refreshBtn.onclick = async () => {
        showLoading('Descargando actividades...');
        try { await window.amazfit.fetchActivities(); }
        catch (e) { log(e.message, 'error'); }
        finally { hideLoading(); }
    };

    document.getElementById('force-full-sync')?.addEventListener('click', async () => {
        if (!confirm("Esto pedirá todos los datos de nuevo. ¿Continuar?")) return;
        localStorage.removeItem('last_sync_timestamp');
        showLoading("Sincronización Total...");
        try { await window.amazfit.fetchActivities(new Date(2020, 0, 1)); }
        catch (e) { log(e.message, 'error'); }
        finally { hideLoading(); }
    });

    closeStatsBtn.onclick = () => showView(currentView);

    // Initial Load
    refreshUI();
    const savedKey = localStorage.getItem('amazfit_auth_key') || window.APP_CONFIG?.AMAZFIT_AUTH_KEY;
    if (savedKey) {
        authKeyInput.value = savedKey;
        setTimeout(async () => {
            try {
                const dev = await window.amazfit.attemptAutoConnect(savedKey, (m, t) => log(m, t));
                if (dev) {
                    statusText.innerText = `Conectado: ${dev}`;
                    statusDot.classList.add('online');
                    authSection.classList.add('hidden');
                    activitySection.classList.remove('hidden');
                    syncWithBackend();
                }
            } catch (e) { }
        }, 1000);
    }
    
    document.querySelectorAll('#version-display, #header-version').forEach(el => el.innerText = APP_VERSION);
    log(`App ${APP_VERSION} lista.`, "system");
});
