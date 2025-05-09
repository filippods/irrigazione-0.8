// manual.js - Completamente riscritto da zero
// Controllo manuale delle zone di irrigazione

// ====================== VARIABILI GLOBALI ======================
let userSettings = {}; // Impostazioni utente
let maxZoneDuration = 180; // Durata massima in minuti (default)
let maxActiveZones = 3; // Numero massimo di zone attive (default)
let zoneStatusInterval = null; // Intervallo di polling stato zone
let activeZones = {}; // Stato corrente delle zone attive con timer
let disabledManualMode = false; // Flag per disabilitare la modalità manuale
const POLL_INTERVAL = 3000; // Intervallo di polling in millisecondi

// ====================== INIZIALIZZAZIONE ======================
function initializeManualPage(userData) {
    console.log("Inizializzazione pagina controllo manuale");

    // Carica impostazioni utente
    if (userData && Object.keys(userData).length > 0) {
        userSettings = userData;
        maxActiveZones = userData.max_active_zones || 3;
        maxZoneDuration = userData.max_zone_duration || 180;
        renderZones(userData.zones || []);
    } else {
        // Carica impostazioni dal server
        fetch('/data/user_settings.json')
            .then(response => {
                if (!response.ok) throw new Error('Errore nel caricamento delle impostazioni utente');
                return response.json();
            })
            .then(data => {
                userSettings = data;
                maxActiveZones = data.max_active_zones || 3;
                maxZoneDuration = data.max_zone_duration || 180;
                renderZones(data.zones || []);
            })
            .catch(error => {
                console.error('Errore nel caricamento delle impostazioni:', error);
                showToast('Errore nel caricamento delle impostazioni', 'error');
            });
    }
    
    // Aggiungi stili CSS
    addManualStyles();
    
    // Avvia il polling dello stato
    startStatusPolling();
    
    // Pulizia quando si cambia pagina
    window.addEventListener('pagehide', cleanupManualPage);
}

// Aggiunge stili necessari
function addManualStyles() {
    if (!document.getElementById('manual-styles')) {
        const style = document.createElement('style');
        style.id = 'manual-styles';
        
        style.innerHTML = `
            .zone-card.disabled-mode {
                opacity: 0.6;
                pointer-events: none;
                position: relative;
            }
            
            .manual-page-overlay {
                position: fixed;
                top: 60px;
                left: 0;
                right: 0;
                bottom: 0;
                background-color: rgba(0, 0, 0, 0.5);
                display: flex;
                justify-content: center;
                align-items: center;
                z-index: 1000;
            }
            
            .overlay-message {
                background-color: #fff;
                border-radius: 8px;
                padding: 20px;
                max-width: 80%;
                text-align: center;
                box-shadow: 0 4px 10px rgba(0, 0, 0, 0.3);
            }
            
            .overlay-message h3 {
                color: #ff3333;
                margin-top: 0;
            }
            
            .overlay-message p {
                margin-bottom: 0;
            }
            
            .zone-card input::placeholder {
                color: #999;
                opacity: 1;
            }
            
            .zone-card.active {
                border: 2px solid #00cc66;
                box-shadow: 0 0 15px rgba(0, 204, 102, 0.5);
            }
            
            .loading-indicator {
                position: relative;
                color: transparent !important;
                pointer-events: none;
            }
            
            .loading-indicator::after {
                content: "";
                position: absolute;
                width: 20px;
                height: 20px;
                top: 50%;
                left: 50%;
                margin-top: -10px;
                margin-left: -10px;
                border-radius: 50%;
                border: 3px solid rgba(0, 0, 0, 0.1);
                border-top-color: #00cc66;
                animation: spin 1s linear infinite;
            }
            
            @keyframes spin {
                0% { transform: rotate(0deg); }
                100% { transform: rotate(360deg); }
            }
        `;
        
        document.head.appendChild(style);
    }
}

// Avvia il polling dello stato
function startStatusPolling() {
    // Esegui subito la prima volta
    fetchZonesStatus();
    
    // Imposta l'intervallo di polling
    zoneStatusInterval = setInterval(fetchZonesStatus, POLL_INTERVAL);
    console.log("Polling stato zone avviato");
}

// Ferma il polling dello stato
function stopStatusPolling() {
    if (zoneStatusInterval) {
        clearInterval(zoneStatusInterval);
        zoneStatusInterval = null;
        console.log("Polling stato zone fermato");
    }
}

// Pulisce le risorse
function cleanupManualPage() {
    stopStatusPolling();
    
    // Rimuovi tutti i timer
    Object.keys(activeZones).forEach(zoneId => {
        if (activeZones[zoneId].timer) {
            clearInterval(activeZones[zoneId].timer);
        }
    });
    
    activeZones = {};
}

// ====================== RENDERING INTERFACCIA ======================
// Renderizza le zone
function renderZones(zones) {
    console.log("Renderizzazione zone:", zones);
    
    const container = document.getElementById('zone-container');
    if (!container) return;
    
    // Filtra solo le zone visibili
    const visibleZones = Array.isArray(zones) ? zones.filter(zone => zone && zone.status === "show") : [];
    
    if (visibleZones.length === 0) {
        container.innerHTML = `
            <div class="empty-state">
                <h3>Nessuna zona configurata</h3>
                <p>Configura le zone nelle impostazioni per poterle controllare manualmente.</p>
                <button class="button primary" onclick="loadPage('settings.html')">
                    Vai alle impostazioni
                </button>
            </div>
        `;
        return;
    }
    
    container.innerHTML = '';
    
    visibleZones.forEach(zone => {
        if (!zone || zone.id === undefined) return;
        
        const zoneCard = document.createElement('div');
        zoneCard.className = 'zone-card';
        zoneCard.id = `zone-${zone.id}`;
        
        const defaultDuration = 10; // Valore di default per l'input durata
        
        zoneCard.innerHTML = `
            <h3>${zone.name || `Zona ${zone.id + 1}`}</h3>
            <div class="input-container">
                <input type="number" id="duration-${zone.id}" placeholder="Durata (minuti)" 
                    min="1" max="${maxZoneDuration}" value="${defaultDuration}">
                <div class="toggle-switch">
                    <label class="switch">
                        <input type="checkbox" id="toggle-${zone.id}" class="zone-toggle" data-zone-id="${zone.id}">
                        <span class="slider"></span>
                    </label>
                </div>
            </div>
            <div class="progress-container">
                <progress id="progress-${zone.id}" value="0" max="100" style="width: 100%;"></progress>
                <div class="timer-display" id="timer-${zone.id}">00:00</div>
            </div>
        `;
        
        container.appendChild(zoneCard);
    });
    
    // Aggiungi gestori eventi
    addZoneEventListeners();
    
    // Aggiorna immediatamente lo stato
    fetchZonesStatus();
}

// Aggiungi gestori eventi
function addZoneEventListeners() {
    document.querySelectorAll('.zone-toggle').forEach(toggle => {
        toggle.addEventListener('change', function(event) {
            // Se la pagina è disabilitata, non fare nulla
            if (disabledManualMode) {
                event.preventDefault();
                return false;
            }
            
            const zoneId = parseInt(event.target.getAttribute('data-zone-id'));
            const isActive = event.target.checked;
            
            if (isActive) {
                // Attiva la zona
                const durationInput = document.getElementById(`duration-${zoneId}`);
                const duration = durationInput ? parseInt(durationInput.value) : 0;
                
                if (!duration || isNaN(duration) || duration <= 0 || duration > maxZoneDuration) {
                    showToast(`Inserisci una durata valida tra 1 e ${maxZoneDuration} minuti`, 'warning');
                    event.target.checked = false;
                    return;
                }
                
                activateZone(zoneId, duration);
            } else {
                // Disattiva la zona
                deactivateZone(zoneId);
            }
        });
    });
}

// Attiva una zona
function activateZone(zoneId, duration) {
    console.log(`Attivazione zona ${zoneId} per ${duration} minuti`);
    
    // Imposta loading state
    const toggle = document.getElementById(`toggle-${zoneId}`);
    const zoneCard = document.getElementById(`zone-${zoneId}`);
    const durationInput = document.getElementById(`duration-${zoneId}`);
    
    if (toggle) toggle.disabled = true;
    if (zoneCard) zoneCard.classList.add('loading-indicator');
    if (durationInput) durationInput.disabled = true;
    
    fetch('/start_zone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone_id: zoneId, duration: duration })
    })
    .then(response => {
        if (!response.ok) throw new Error(`Errore HTTP: ${response.status}`);
        return response.json();
    })
    .then(data => {
        // Rimuovi loading state
        if (zoneCard) zoneCard.classList.remove('loading-indicator');
        
        if (data.success) {
            showToast(`Zona ${zoneId + 1} attivata per ${duration} minuti`, 'success');
            
            // Aggiorna lo stato locale
            const durationSeconds = duration * 60;
            
            // Inizializza monitoraggio locale della zona attivata
            startZoneTimer(zoneId, durationSeconds);
            
            // Aggiorna l'UI
            if (zoneCard) zoneCard.classList.add('active');
            if (durationInput) durationInput.disabled = true;
            
            fetchZonesStatus(); // Aggiorna lo stato dal server
        } else {
            showToast(`Errore: ${data.error || 'Attivazione zona fallita'}`, 'error');
            
            // Reset UI in caso di errore
            if (toggle) {
                toggle.checked = false;
                toggle.disabled = false;
            }
            if (durationInput) durationInput.disabled = false;
        }
    })
    .catch(error => {
        console.error('Errore durante l\'attivazione della zona:', error);
        showToast('Errore di rete durante l\'attivazione della zona', 'error');
        
        // Reset UI in caso di errore
        if (toggle) {
            toggle.checked = false;
            toggle.disabled = false;
        }
        if (zoneCard) zoneCard.classList.remove('loading-indicator');
        if (durationInput) durationInput.disabled = false;
    });
}

// Disattiva una zona
function deactivateZone(zoneId) {
    console.log(`Disattivazione zona ${zoneId}`);
    
    // Imposta loading state
    const toggle = document.getElementById(`toggle-${zoneId}`);
    const zoneCard = document.getElementById(`zone-${zoneId}`);
    
    if (toggle) toggle.disabled = true;
    if (zoneCard) zoneCard.classList.add('loading-indicator');
    
    fetch('/stop_zone', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ zone_id: zoneId })
    })
    .then(response => {
        if (!response.ok) throw new Error(`Errore HTTP: ${response.status}`);
        return response.json();
    })
    .then(data => {
        // Rimuovi loading state
        if (zoneCard) zoneCard.classList.remove('loading-indicator');
        
        if (data.success) {
            showToast(`Zona ${zoneId + 1} disattivata`, 'info');
            
            // Ferma il timer locale
            stopZoneTimer(zoneId);
            
            // Aggiorna l'UI
            if (zoneCard) zoneCard.classList.remove('active');
            const durationInput = document.getElementById(`duration-${zoneId}`);
            if (durationInput) durationInput.disabled = false;
            
            // Reset barra di progresso
            resetProgressBar(zoneId);
            
            if (toggle) toggle.disabled = false;
            
            fetchZonesStatus(); // Aggiorna lo stato dal server
        } else {
            showToast(`Errore: ${data.error || 'Disattivazione zona fallita'}`, 'error');
            
            // Reset UI in caso di errore
            if (toggle) {
                toggle.checked = true;
                toggle.disabled = false;
            }
        }
    })
    .catch(error => {
        console.error('Errore durante la disattivazione della zona:', error);
        showToast('Errore di rete durante la disattivazione della zona', 'error');
        
        // Reset UI in caso di errore
        if (toggle) {
            toggle.checked = true;
            toggle.disabled = false;
        }
        if (zoneCard) zoneCard.classList.remove('loading-indicator');
    });
}

// ====================== GESTIONE TIMER E PROGRESS BAR ======================
// Avvia il timer per una zona
function startZoneTimer(zoneId, totalSeconds) {
    const zoneId_str = zoneId.toString();
    
    // Ferma il timer esistente se presente
    if (activeZones[zoneId_str] && activeZones[zoneId_str].timer) {
        clearInterval(activeZones[zoneId_str].timer);
    }
    
    // Memorizza i dati della zona
    activeZones[zoneId_str] = {
        totalDuration: totalSeconds,
        remainingTime: totalSeconds,
        startTime: Date.now(),
        timer: null
    };
    
    // Aggiorna subito la barra di progresso
    updateProgressBar(zoneId_str, 0, totalSeconds);
    
    // Avvia il timer
    activeZones[zoneId_str].timer = setInterval(() => {
        // Calcola tempo trascorso
        const now = Date.now();
        const elapsed = Math.floor((now - activeZones[zoneId_str].startTime) / 1000);
        const remaining = Math.max(0, totalSeconds - elapsed);
        
        // Aggiorna tempo rimanente
        activeZones[zoneId_str].remainingTime = remaining;
        
        // Aggiorna la barra di progresso
        updateProgressBar(zoneId_str, elapsed, totalSeconds);
        
        // Se il timer è scaduto, ferma la zona
        if (remaining <= 0) {
            stopZoneTimer(zoneId);
            
            // Reset UI
            const toggle = document.getElementById(`toggle-${zoneId}`);
            const zoneCard = document.getElementById(`zone-${zoneId}`);
            const durationInput = document.getElementById(`duration-${zoneId}`);
            
            if (toggle) {
                toggle.checked = false;
                toggle.disabled = false;
            }
            if (zoneCard) zoneCard.classList.remove('active');
            if (durationInput) durationInput.disabled = false;
            
            // La zona sarà disattivata sul server al prossimo polling
        }
    }, 1000);
}

// Ferma il timer per una zona
function stopZoneTimer(zoneId) {
    const zoneId_str = zoneId.toString();
    
    if (activeZones[zoneId_str] && activeZones[zoneId_str].timer) {
        clearInterval(activeZones[zoneId_str].timer);
        delete activeZones[zoneId_str];
    }
    
    // Resetta la barra di progresso
    resetProgressBar(zoneId);
}

// Aggiorna la barra di progresso
function updateProgressBar(zoneId, elapsed, total) {
    const progressBar = document.getElementById(`progress-${zoneId}`);
    const timerDisplay = document.getElementById(`timer-${zoneId}`);
    
    if (!progressBar || !timerDisplay) return;
    
    // Calcola il valore percentuale
    const percentComplete = Math.min(100, Math.floor((elapsed / total) * 100));
    progressBar.value = percentComplete;
    
    // Aggiorna il display del timer
    const remaining = Math.max(0, total - elapsed);
    const minutes = Math.floor(remaining / 60);
    const seconds = remaining % 60;
    timerDisplay.textContent = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
}

// Resetta la barra di progresso
function resetProgressBar(zoneId) {
    const progressBar = document.getElementById(`progress-${zoneId}`);
    const timerDisplay = document.getElementById(`timer-${zoneId}`);
    
    if (progressBar) progressBar.value = 0;
    if (timerDisplay) timerDisplay.textContent = '00:00';
}

// ====================== GESTIONE STATO SERVER ======================
// Ottiene lo stato delle zone dal server
function fetchZonesStatus() {
    Promise.all([
        fetch('/get_zones_status').then(response => {
            if (!response.ok) throw new Error('Errore nel caricamento dello stato delle zone');
            return response.json();
        }),
        fetch('/get_program_state').then(response => {
            if (!response.ok) throw new Error('Errore nel caricamento dello stato del programma');
            return response.json();
        })
    ])
    .then(([zonesStatus, programState]) => {
        console.log("Stato zone ricevuto:", zonesStatus);
        console.log("Stato programma ricevuto:", programState);
        
        // Gestisci lo stato del programma
        handleProgramState(programState, zonesStatus);
        
        // Aggiorna l'UI delle zone
        updateZonesUI(zonesStatus);
    })
    .catch(error => {
        console.error('Errore nel recupero dello stato:', error);
    });
}

// Gestisce lo stato del programma
function handleProgramState(programState, zonesStatus) {
    const programRunning = programState && programState.program_running;
    
    // Se lo stato è cambiato
    if (programRunning !== disabledManualMode) {
        disabledManualMode = programRunning;
        
        if (programRunning) {
            // Disabilita la pagina manual
            disableManualPage();
        } else {
            // Riabilita la pagina manual
            enableManualPage();
        }
    }
}

// Disabilita la pagina manual
function disableManualPage() {
    console.log("Disabilitazione controllo manuale - Programma in esecuzione");
    
    // Disabilita tutte le card
    document.querySelectorAll('.zone-card').forEach(card => {
        card.classList.add('disabled-mode');
    });
    
    // Disabilita tutti gli input e toggle
    document.querySelectorAll('.zone-toggle, [id^="duration-"]').forEach(el => {
        el.disabled = true;
    });
    
    // Aggiungi overlay se non esiste
    if (!document.getElementById('manual-page-overlay')) {
        const overlay = document.createElement('div');
        overlay.id = 'manual-page-overlay';
        overlay.className = 'manual-page-overlay';
        
        overlay.innerHTML = `
            <div class="overlay-message">
                <h3>Controllo Manuale Disabilitato</h3>
                <p>Un programma è attualmente in esecuzione.<br>Il controllo manuale sarà disponibile al termine del programma.</p>
            </div>
        `;
        
        document.body.appendChild(overlay);
    }
}

// Riabilita la pagina manual
function enableManualPage() {
    console.log("Riabilitazione controllo manuale - Nessun programma in esecuzione");
    
    // Riabilita tutte le card
    document.querySelectorAll('.zone-card').forEach(card => {
        card.classList.remove('disabled-mode');
    });
    
    // Riabilita tutti gli input e toggle (tranne per le zone attive)
    document.querySelectorAll('.zone-toggle:not(:checked), [id^="duration-"]').forEach(el => {
        const zoneId = el.id.split('-')[1];
        const toggle = document.getElementById(`toggle-${zoneId}`);
        
        // Non riabilitare input per zone attive
        if (!toggle || !toggle.checked) {
            el.disabled = false;
        }
    });
    
    // Rimuovi overlay se esiste
    const overlay = document.getElementById('manual-page-overlay');
    if (overlay) {
        overlay.remove();
    }
}

// Aggiorna l'UI delle zone
function updateZonesUI(zonesStatus) {
    if (!Array.isArray(zonesStatus)) return;
    
    // Aggiorna ogni zona
    zonesStatus.forEach(zone => {
        if (!zone || zone.id === undefined) return;
        
        const zoneId = zone.id;
        const toggle = document.getElementById(`toggle-${zoneId}`);
        const zoneCard = document.getElementById(`zone-${zoneId}`);
        const durationInput = document.getElementById(`duration-${zoneId}`);
        
        if (!toggle || !zoneCard) return;
        
        // Aggiorna stato toggle senza triggerare eventi
        if (toggle.checked !== zone.active) {
            // Rimuovi handler temporaneamente
            const originalOnChange = toggle.onchange;
            toggle.onchange = null;
            
            // Cambia stato
            toggle.checked = zone.active;
            
            // Ripristina handler
            setTimeout(() => {
                toggle.onchange = originalOnChange;
            }, 0);
        }
        
        // Aggiorna stato visivo
        if (zone.active) {
            zoneCard.classList.add('active');
            
            // Disabilita l'input durata
            if (durationInput) durationInput.disabled = true;
            
            // Se non c'è un timer locale per questa zona, crealo
            const zoneId_str = zoneId.toString();
            if (!activeZones[zoneId_str] || !activeZones[zoneId_str].timer) {
                // Determina durata totale
                let totalDuration = 0;
                
                // Da input utente
                if (durationInput && durationInput.value) {
                    totalDuration = parseInt(durationInput.value) * 60;
                } else {
                    // Stima dalla zona attiva
                    totalDuration = zone.remaining_time * 1.2; // Stima (rimanente + 20%)
                }
                
                // Imposta timer locale
                startZoneTimer(zoneId, totalDuration);
                
                // Aggiorna con il tempo rimanente dal server
                activeZones[zoneId_str].remainingTime = zone.remaining_time;
                
                // Calcola tempo trascorso
                const elapsed = activeZones[zoneId_str].totalDuration - zone.remaining_time;
                
                // Aggiusta startTime
                activeZones[zoneId_str].startTime = Date.now() - (elapsed * 1000);
            }
        } else {
            zoneCard.classList.remove('active');
            
            // Riabilita l'input durata se non è in modalità disabilitata
            if (durationInput && !disabledManualMode) {
                durationInput.disabled = false;
            }
            
            // Se c'è un timer locale per questa zona, fermalo
            stopZoneTimer(zoneId);
        }
    });
}

// ====================== INIZIALIZZAZIONE ======================
// Inizializzazione a caricamento documento
document.addEventListener('DOMContentLoaded', () => {
    console.log("DOM caricato - Inizializzazione manual.js");
    
    if (window.userData && Object.keys(window.userData).length > 0) {
        initializeManualPage(window.userData);
    }
});