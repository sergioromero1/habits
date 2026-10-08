/**
 * HabitSpark - Firebase Edition
 */

// --- Firebase Config ---
const firebaseConfig = {
    apiKey: "AIzaSyBr1-ak7vkqeQ14tan9z27sys5CQztYTLs",
    authDomain: "habit-tracker-a0513.firebaseapp.com",
    projectId: "habit-tracker-a0513",
    storageBucket: "habit-tracker-a0513.firebasestorage.app",
    messagingSenderId: "332006691188",
    appId: "1:332006691188:web:6c4363c01b1324d883dc21",
    measurementId: "G-Y4NSKM7H6B"
};

// Initialize Firebase (Compat)
firebase.initializeApp(firebaseConfig);
const db = firebase.firestore();
const auth = firebase.auth();
const googleProvider = new firebase.auth.GoogleAuthProvider();

// --- Timezone Helper (Bogota) ---
function getBogotaDate() {
    // Returns a Date object adjusted to Bogota time (UTC-5)
    // Or simpler: returns the ISO string DATE part in Bogota time.
    const now = new Date();
    // locale: 'es-CO', timeZone: 'America/Bogota'
    // Hacky but reliable way to get the YYYY-MM-DD string for Bogota
    const options = { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' };
    const formatter = new Intl.DateTimeFormat('en-CA', options); // en-CA gives YYYY-MM-DD format
    return formatter.format(now);
}

function getBogotaFullDate() {
    return new Date().toLocaleDateString('es-CO', { timeZone: 'America/Bogota', weekday: 'long', day: 'numeric', month: 'long' });
}

// --- State Management ---
let state = {
    user: null, // Firebase User
    view: 'daily',
    habits: [], // Now loaded from Firestore
    currentMonth: new Date(), // This is for UI navigation, local time is fine for navigation usually, but let's stick to standard
    unsubscribeHabits: null,
    pausedOpen: false // UI: "En pausa" section expanded
};

// --- DOM Elements ---
let dom = {};

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

function initApp() {
    dom = {
        app: document.getElementById('app'),
        mainContent: document.getElementById('main-content'),
        navBtns: document.querySelectorAll('.nav-btn'),
        addHabitBtn: document.getElementById('add-habit-btn'),
        modalOverlay: document.getElementById('modal-overlay'),
        addHabitForm: document.getElementById('add-habit-form'),
        cancelModalBtn: document.getElementById('cancel-modal'),
        loginBtn: document.getElementById('login-btn'),
        userArea: document.getElementById('user-area'),
        userProfile: document.getElementById('user-profile'),
        userAvatar: document.getElementById('user-avatar'),
        logoutBtn: document.getElementById('logout-btn'),
        exportBtn: document.getElementById('export-btn'),
    };

    setupEventListeners();

    // Auth Listener
    auth.onAuthStateChanged(async (user) => {
        state.user = user;
        updateUserUI();

        if (user) {
            console.log("User logged in:", user.uid);
            await migrateUserInfo();
            subscribeToHabits(user.uid);
        } else {
            console.log("No user logged in.");
            state.habits = [];
            if (state.unsubscribeHabits) state.unsubscribeHabits();
            loadLocalHabits();
            render();
        }
    });
}

// --- Data Layer ---

function subscribeToHabits(uid) {
    if (state.unsubscribeHabits) state.unsubscribeHabits();

    const habitsRef = db.collection('users').doc(uid).collection('habits');

    // Order by creation time if possible, or client side sort
    state.unsubscribeHabits = habitsRef.onSnapshot((snapshot) => {
        const habits = [];
        snapshot.forEach(doc => {
            habits.push({ id: doc.id, ...doc.data() });
        });
        // Sort by createdAt
        habits.sort((a, b) => (a.createdAt || '').localeCompare(b.createdAt || ''));
        state.habits = habits;
        render();
    }, (error) => {
        console.error("Error fetching habits:", error);
    });
}

function loadLocalHabits() {
    try {
        const localHabits = JSON.parse(localStorage.getItem('habits')) || [];
        const localLogs = JSON.parse(localStorage.getItem('logs')) || {};

        state.habits = localHabits.map(h => {
            const completedDates = [];
            Object.keys(localLogs).forEach(date => {
                if (localLogs[date].includes(h.id)) completedDates.push(date);
            });
            return { ...h, completedDates };
        });
    } catch (e) {
        console.error("Local load error", e);
    }
}

async function migrateUserInfo() {
    const uid = state.user.uid;
    const habitsRef = db.collection('users').doc(uid).collection('habits');
    const snap = await habitsRef.get();

    if (snap.empty) {
        const localHabits = JSON.parse(localStorage.getItem('habits')) || [];
        const localLogs = JSON.parse(localStorage.getItem('logs')) || {};

        if (localHabits.length > 0) {
            if (confirm("¡Tienes datos locales! ¿Quieres subirlos a tu cuenta?")) {
                const batch = db.batch();
                localHabits.forEach(h => {
                    const docRef = habitsRef.doc(h.id);
                    const completedDates = [];
                    Object.keys(localLogs).forEach(date => {
                        if (localLogs[date].includes(h.id)) completedDates.push(date);
                    });

                    batch.set(docRef, {
                        name: h.name,
                        color: h.color,
                        createdAt: h.createdAt || new Date().toISOString(),
                        completedDates: completedDates
                    });
                });
                await batch.commit();
            }
        }
    }
}

// --- Actions ---

async function toggleHabit(habit, sourceEl) {
    if (!state.user) {
        alert("Inicia sesión para guardar tu progreso en la nube.");
        // We could implement local toggle here for guests, but sticking to cloud req for now
        return;
    }
    if (!isHabitActive(habit)) return; // Paused habits are not tracked

    const today = getBogotaDate(); // Bogota Time
    const isCompleted = habit.completedDates?.includes(today);

    const habitRef = db.collection('users').doc(state.user.uid).collection('habits').doc(habit.id);

    try {
        if (isCompleted) {
            await habitRef.update({
                completedDates: firebase.firestore.FieldValue.arrayRemove(today)
            });
        } else {
            // Was this the last pending active habit of the day?
            const allDone = state.habits
                .filter(h => isHabitActive(h) && h.id !== habit.id)
                .every(h => h.completedDates?.includes(today));
            triggerConfetti(sourceEl, allDone);
            await habitRef.update({
                completedDates: firebase.firestore.FieldValue.arrayUnion(today)
            });
        }
    } catch (e) {
        console.error("Error updating habit:", e);
    }
}

async function addHabit(name, color) {
    if (!state.user) {
        alert("Debes iniciar sesión para crear hábitos.");
        return;
    }

    name = name.trim().replace(/\s+/g, ' ');
    const existing = findHabitByName(name);
    if (existing) {
        showNameError(isHabitActive(existing)
            ? `Ya tienes un hábito llamado "${existing.name}".`
            : `Ya tienes un hábito llamado "${existing.name}" (está en pausa). Puedes reactivarlo desde la lista.`);
        return;
    }

    try {
        await db.collection('users').doc(state.user.uid).collection('habits').add({
            name,
            color,
            createdAt: new Date().toISOString(),
            completedDates: [],
            active: true,
            activityLog: []
        });
        closeModal();
    } catch (e) {
        console.error("Error adding habit:", e);
    }
}

// Move a habit between "active" (tracked daily) and "paused" (kept, not tracked).
// activityLog records each change so past days keep their original goal count.
async function setHabitActive(habit, active) {
    if (!state.user) return;

    const today = getBogotaDate();
    const activityLog = (habit.activityLog || []).filter(e => e.date !== today);
    activityLog.push({ date: today, active });

    try {
        await db.collection('users').doc(state.user.uid).collection('habits').doc(habit.id).update({
            active,
            activityLog
        });
    } catch (e) {
        console.error("Error updating habit status:", e);
        alert("Error al cambiar el estado del hábito");
    }
}

async function deleteHabit(habitId) {
    if (!confirm("¿Estás seguro de que quieres eliminar este hábito? Se perderá todo el historial.")) {
        return;
    }

    if (!state.user) return; // Should be guarded by UI anyway

    try {
        await db.collection('users').doc(state.user.uid).collection('habits').doc(habitId).delete();
        // UI updates automatically via snapshot listener
    } catch (e) {
        console.error("Error deleting habit:", e);
        alert("Error al eliminar");
    }
}

// --- Auth Actions ---

function login() {
    auth.signInWithPopup(googleProvider).catch((error) => {
        console.error("Login failed:", error);
        alert("Error al iniciar sesión: " + error.message);
    });
}

function logout() {
    auth.signOut();
}

function exportData() {
    if (state.habits.length === 0) {
        alert("No hay datos para exportar.");
        return;
    }

    const dataStr = JSON.stringify(state.habits, null, 2);
    const dataUri = 'data:application/json;charset=utf-8,' + encodeURIComponent(dataStr);
    const exportFileDefaultName = `habit-tracker-data-${getBogotaDate()}.json`;

    const linkElement = document.createElement('a');
    linkElement.setAttribute('href', dataUri);
    linkElement.setAttribute('download', exportFileDefaultName);
    linkElement.click();
}

// --- UI Rendering ---

function updateUserUI() {
    if (state.user) {
        dom.loginBtn.classList.add('hidden');
        dom.userProfile.classList.remove('hidden');
        dom.userAvatar.src = state.user.photoURL || 'https://via.placeholder.com/40';
    } else {
        dom.loginBtn.classList.remove('hidden');
        dom.userProfile.classList.add('hidden');
    }
}

function render() {
    // Update Nav
    dom.navBtns.forEach(btn => {
        if (btn.dataset.view === state.view) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    dom.mainContent.innerHTML = '';

    if (state.view === 'daily') renderDailyView();
    else if (state.view === 'calendar') renderCalendarView();
    else if (state.view === 'progress') renderProgressView();
}

function renderDailyView() {
    const header = document.createElement('div');
    header.className = 'view-header';
    const bgDate = getBogotaFullDate();
    // capitalize first letter
    const bgDateCap = bgDate.charAt(0).toUpperCase() + bgDate.slice(1);

    header.innerHTML = `<h2>Hoy, ${bgDateCap}</h2><p class="subtitle">¡Sigue con tu racha!</p>`;
    dom.mainContent.appendChild(header);

    const today = getBogotaDate();
    const activeHabits = state.habits.filter(isHabitActive);
    const pausedHabits = state.habits.filter(h => !isHabitActive(h));

    if (activeHabits.length > 0) {
        const done = activeHabits.filter(h => h.completedDates?.includes(today)).length;
        header.querySelector('.subtitle').textContent = done === activeHabits.length
            ? `¡Día completo! ${done}/${activeHabits.length} 🎉`
            : `¡Sigue con tu racha! ${done}/${activeHabits.length} completados`;
    }

    const list = document.createElement('div');
    list.className = 'habit-list';

    if (state.habits.length === 0) {
        list.innerHTML = `<div class="empty-state"><p>${state.user ? "¡Crea tu primer hábito!" : "Inicia sesión para ver tus hábitos"}</p></div>`;
    } else if (activeHabits.length === 0) {
        list.innerHTML = `<div class="empty-state"><p>No tienes hábitos activos. Activa alguno de la lista de pausados.</p></div>`;
    } else {
        activeHabits.forEach(habit => list.appendChild(createHabitItem(habit, today)));
    }
    dom.mainContent.appendChild(list);

    if (pausedHabits.length > 0) {
        const section = document.createElement('details');
        section.className = 'paused-section';
        section.open = state.pausedOpen;
        section.addEventListener('toggle', () => { state.pausedOpen = section.open; });
        section.innerHTML = `<summary>En pausa (${pausedHabits.length})</summary>`;

        const pausedList = document.createElement('div');
        pausedList.className = 'habit-list';
        pausedHabits.forEach(habit => pausedList.appendChild(createHabitItem(habit, today)));
        section.appendChild(pausedList);
        dom.mainContent.appendChild(section);
    }
}

function createHabitItem(habit, today) {
    const active = isHabitActive(habit);
    const isCompleted = active && habit.completedDates?.includes(today);
    const item = document.createElement('div');
    item.className = `habit-item ${isCompleted ? 'completed' : ''} ${active ? '' : 'paused'}`;
    item.style.setProperty('--habit-color', habit.color);

    // Inner HTML structure with Pause/Activate and Delete Buttons
    item.innerHTML = `
        <div class="habit-content-wrapper">
            <div class="habit-icon">${isCompleted ? '✓' : ''}</div>
            <div class="habit-info">
                <span class="habit-name"></span>
                <span class="habit-streak">🔥 ${calculateStreak(habit)} días · ${habit.completedDates?.length || 0} en total</span>
            </div>
        </div>
        <button class="pause-btn" aria-label="${active ? 'Pausar' : 'Activar'} Hábito" title="${active ? 'Pausar (deja de contar en el día)' : 'Activar (vuelve a seguirlo)'}">${active ? '⏸️' : '▶️'}</button>
        <button class="delete-btn" aria-label="Eliminar Hábito">🗑️</button>
    `;
    item.querySelector('.habit-name').textContent = habit.name;

    // Only the content wrapper toggles; buttons stop propagation
    item.querySelector('.habit-content-wrapper').addEventListener('click', (e) => {
        e.stopPropagation();
        toggleHabit(habit, item.querySelector('.habit-icon'));
    });

    item.querySelector('.pause-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        setHabitActive(habit, !active);
    });

    item.querySelector('.delete-btn').addEventListener('click', (e) => {
        e.stopPropagation(); // Stop bubble to item click
        deleteHabit(habit.id);
    });

    return item;
}

function renderCalendarView() {
    const calendarHeader = document.createElement('div');
    calendarHeader.className = 'view-header';
    calendarHeader.innerHTML = `<h2>Calendario</h2><p class="subtitle">Tu constancia mensual</p>`;
    dom.mainContent.appendChild(calendarHeader);

    // Controls
    const controls = document.createElement('div');
    controls.className = 'calendar-controls';
    const currentMonthDate = state.currentMonth;
    const monthName = currentMonthDate.toLocaleDateString('es-CO', { month: 'long', year: 'numeric' });

    controls.innerHTML = `
        <button id="prev-month">←</button>
        <h3>${monthName}</h3>
        <button id="next-month">→</button>
    `;
    dom.mainContent.appendChild(controls);

    // Grid
    const grid = document.createElement('div');
    grid.className = 'calendar-grid';

    // Headers
    ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach(d => {
        const h = document.createElement('div');
        h.className = 'day-header';
        h.textContent = d;
        grid.appendChild(h);
    });

    // Days usage logic similar to before but consistent date string usage
    const year = currentMonthDate.getFullYear();
    const month = currentMonthDate.getMonth();
    const firstDay = new Date(year, month, 1).getDay();
    const adjustedFirstDay = firstDay === 0 ? 6 : firstDay - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Empty cells
    for (let i = 0; i < adjustedFirstDay; i++) {
        const e = document.createElement('div');
        e.className = 'day-cell empty';
        grid.appendChild(e);
    }

    // Days
    for (let d = 1; d <= daysInMonth; d++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
        const dayCell = document.createElement('div');
        dayCell.className = 'day-cell';

        let completedCount = 0;
        state.habits.forEach(h => {
            if (h.completedDates?.includes(dateStr)) completedCount++;
        });

        // Intensity is relative to the habits that were active that day
        const activeOnDay = state.habits.filter(h => isHabitActiveOn(h, dateStr));
        const activeCompleted = activeOnDay.filter(h => h.completedDates?.includes(dateStr)).length;

        if (activeOnDay.length > 0 && completedCount > 0) {
            const intensity = Math.min(1, activeCompleted / activeOnDay.length);
            dayCell.style.backgroundColor = `rgba(99, 102, 241, ${0.2 + (intensity * 0.8)})`;
        }

        const today = getBogotaDate(); // Use Bogota Today
        if (dateStr === today) dayCell.classList.add('today');

        dayCell.innerHTML = `<span class="day-number">${d}</span>`;
        if (completedCount > 0) {
            dayCell.innerHTML += `<div class="dots-indicator" style="display:flex; gap:2px; justify-content:center; margin-top:2px;">
                ${state.habits.map(h => {
                return h.completedDates?.includes(dateStr) ?
                    `<span style="width:4px; height:4px; border-radius:50%; background-color:${h.color}; display:inline-block;"></span>` : '';
            }).join('')}
            </div>`;
        }

        grid.appendChild(dayCell);
    }
    dom.mainContent.appendChild(grid);

    document.getElementById('prev-month').addEventListener('click', () => {
        state.currentMonth.setMonth(state.currentMonth.getMonth() - 1);
        render();
    });
    document.getElementById('next-month').addEventListener('click', () => {
        state.currentMonth.setMonth(state.currentMonth.getMonth() + 1);
        render();
    });
}

function renderProgressView() {
    const ph = document.createElement('div');
    ph.className = 'view-header';
    ph.innerHTML = `<h2>Tu Progreso</h2><p class="subtitle">Estadísticas Anuales</p>`;
    dom.mainContent.appendChild(ph);

    if (state.habits.length === 0) {
        dom.mainContent.innerHTML += `<div class="empty-state">No hay datos.</div>`;
        return;
    }

    const container = document.createElement('div');
    container.className = 'stats-container';

    state.habits.forEach(h => {
        const streak = calculateStreak(h);
        const card = document.createElement('div');
        card.className = 'stat-card';
        card.style.borderLeft = `4px solid ${h.color}`;
        card.innerHTML = `
            <h3>${escapeHtml(h.name)}${isHabitActive(h) ? '' : ' <span class="paused-badge">(en pausa)</span>'}</h3>
            <div class="stat-row"><span>Racha:</span><strong>${streak} días 🔥</strong></div>
            <div class="stat-row"><span>Total:</span><strong>${h.completedDates?.length || 0} veces</strong></div>
        `;
        container.appendChild(card);
    });
    dom.mainContent.appendChild(container);

    // Heatmap
    const hmh = document.createElement('h3');
    hmh.style.marginTop = '2rem';
    hmh.textContent = `Actividad (Últimos 365 Días)`;
    dom.mainContent.appendChild(hmh);

    const scroll = document.createElement('div');
    scroll.className = 'heatmap-scroll';
    const heat = document.createElement('div');
    heat.className = 'heatmap-grid';

    // We want to generate 365 days ending Today.
    // Order: Oldest -> Newest (Standard for vertical reading usually top-left to bottom-right?)
    // Actually standard monthly calendar is L->R, Top->Bottom.
    // Let's do that: Start 364 days ago, fill grid.

    const bogotaOptions = { timeZone: 'America/Bogota', year: 'numeric', month: '2-digit', day: '2-digit' };
    const formatter = new Intl.DateTimeFormat('en-CA', bogotaOptions); // en-CA gives YYYY-MM-DD format

    for (let i = 364; i >= 0; i--) {
        const d = new Date();
        d.setDate(d.getDate() - i);

        // Use the formatter to get the date string in Bogota time, matching the storage format
        const dateStr = formatter.format(d);

        // 1. Calculate Total Habits Active on that Day
        // Naive assumption: Habit existed since its createdAt.
        // If no createdAt (legacy), assume always existed? Or use dateStr comparison.
        let activeHabitsCount = 0;
        let completedCount = 0;

        state.habits.forEach(h => {
            // Only habits that existed and were active (not paused) on this date count
            if (!isHabitActiveOn(h, dateStr)) return;
            activeHabitsCount++;

            if (h.completedDates?.includes(dateStr)) {
                completedCount++;
            }
        });

        const cell = document.createElement('div');
        cell.className = 'heatmap-cell';
        if (i === 0) cell.classList.add('today'); // Highlight Today

        // Coloring Logic
        if (activeHabitsCount > 0 && completedCount > 0) {
            if (completedCount === activeHabitsCount) {
                cell.setAttribute('data-status', 'all'); // Green
                cell.title = `${dateStr}: ¡Todo completado! (${completedCount}/${activeHabitsCount})`;
            } else {
                cell.setAttribute('data-status', 'some'); // Purple
                cell.title = `${dateStr}: Parcial (${completedCount}/${activeHabitsCount})`;
            }
        } else {
            cell.title = `${dateStr}: Sin actividad`;
        }

        heat.appendChild(cell);
    }
    scroll.appendChild(heat);
    dom.mainContent.appendChild(scroll);
}

// --- Helpers ---

function calculateStreak(habit) {
    let streak = 0;
    // Current Bogota Date
    const today = getBogotaDate();

    // Naively checking backwards from today
    // We need a helper to subtract days from a YYYY-MM-DD string reliably
    // Simplified: Parse today, subtract ms, reformat.

    const current = new Date(today); // Parsed as UTC usually if YYYY-MM-DD
    // Actually `new Date("2024-01-01")` is UTC. 

    for (let i = 0; i < 365; i++) {
        const d = new Date(current);
        d.setUTCDate(d.getUTCDate() - i); // Use UTC methods to avoid timezone shift on simple date objects
        const dateStr = d.toISOString().split('T')[0];

        // Allow missing today if it's not over yet
        if (i === 0 && !habit.completedDates?.includes(dateStr)) continue;

        if (habit.completedDates?.includes(dateStr)) {
            streak++;
        } else {
            break;
        }
    }
    return streak;
}

// Habits without the `active` field (created before this feature) are active
function isHabitActive(habit) {
    return habit.active !== false;
}

// Was the habit being tracked on a given YYYY-MM-DD date?
function isHabitActiveOn(habit, dateStr) {
    const createdDateStr = (habit.createdAt || '').split('T')[0];
    if (habit.createdAt && dateStr < createdDateStr) return false;

    // Last status change on or before that date decides
    let active = true;
    (habit.activityLog || [])
        .slice()
        .sort((a, b) => a.date.localeCompare(b.date))
        .forEach(e => { if (e.date <= dateStr) active = e.active; });
    return active;
}

// Case, accent and whitespace insensitive: "Leer", " leer ", "LÉER" are the same habit
function normalizeHabitName(name) {
    return name.normalize('NFD').replace(/[̀-ͯ]/g, '').trim().replace(/\s+/g, ' ').toLowerCase();
}

function findHabitByName(name) {
    const target = normalizeHabitName(name);
    return state.habits.find(h => normalizeHabitName(h.name || '') === target);
}

function showNameError(message) {
    const input = document.getElementById('habit-name');
    const error = document.getElementById('habit-name-error');
    input.classList.add('invalid');
    error.textContent = message;
    error.classList.remove('hidden');
    input.focus();
}

function clearNameError() {
    document.getElementById('habit-name').classList.remove('invalid');
    document.getElementById('habit-name-error').classList.add('hidden');
}

function escapeHtml(str) {
    const div = document.createElement('div');
    div.textContent = str;
    return div.innerHTML;
}

function switchView(v) { state.view = v; render(); }

function triggerConfetti(sourceEl, allDone = false) {
    if (typeof confetti !== 'function') return; // CDN not loaded

    // Burst from the habit's check icon
    let origin = { x: 0.5, y: 0.5 };
    if (sourceEl) {
        const rect = sourceEl.getBoundingClientRect();
        origin = {
            x: (rect.left + rect.width / 2) / window.innerWidth,
            y: (rect.top + rect.height / 2) / window.innerHeight
        };
    }
    confetti({ particleCount: 60, spread: 70, startVelocity: 30, origin, scalar: 0.9 });

    // Bigger celebration when every active habit of the day is done
    if (allDone) {
        const end = Date.now() + 1200;
        (function frame() {
            confetti({ particleCount: 6, angle: 60, spread: 55, origin: { x: 0, y: 0.7 } });
            confetti({ particleCount: 6, angle: 120, spread: 55, origin: { x: 1, y: 0.7 } });
            if (Date.now() < end) requestAnimationFrame(frame);
        })();
    }
}

function closeModal() {
    dom.modalOverlay.classList.add('hidden');
    dom.addHabitForm.reset();
    clearNameError();
}

// --- Listeners ---
function setupEventListeners() {
    dom.navBtns.forEach(btn => btn.addEventListener('click', () => switchView(btn.dataset.view)));

    dom.addHabitBtn?.addEventListener('click', () => {
        if (!state.user) {
            alert("Please login first");
            return;
        }
        dom.modalOverlay.classList.remove('hidden');
    });

    dom.cancelModalBtn?.addEventListener('click', closeModal);

    dom.addHabitForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('habit-name').value;
        const color = document.querySelector('input[name="color"]:checked')?.value || '#FF6B6B';
        if (name.trim()) addHabit(name, color);
    });

    // Warn about duplicates while typing, clear the error once the name is unique
    document.getElementById('habit-name')?.addEventListener('input', (e) => {
        const existing = e.target.value.trim() && findHabitByName(e.target.value);
        if (existing) showNameError(`Ya tienes un hábito llamado "${existing.name}"${isHabitActive(existing) ? '' : ' (está en pausa)'}.`);
        else clearNameError();
    });

    dom.modalOverlay?.addEventListener('click', (e) => {
        if (e.target === dom.modalOverlay) {
            dom.modalOverlay.classList.add('hidden');
        }
    });

    dom.loginBtn?.addEventListener('click', login);
    dom.logoutBtn?.addEventListener('click', logout);
    dom.exportBtn?.addEventListener('click', exportData);
}
