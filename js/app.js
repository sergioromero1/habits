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
    unsubscribeHabits: null
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

async function toggleHabit(habit) {
    if (!state.user) {
        alert("Inicia sesión para guardar tu progreso en la nube.");
        // We could implement local toggle here for guests, but sticking to cloud req for now
        return;
    }

    const today = getBogotaDate(); // Bogota Time
    const isCompleted = habit.completedDates?.includes(today);

    const habitRef = db.collection('users').doc(state.user.uid).collection('habits').doc(habit.id);

    try {
        if (isCompleted) {
            await habitRef.update({
                completedDates: firebase.firestore.FieldValue.arrayRemove(today)
            });
        } else {
            await habitRef.update({
                completedDates: firebase.firestore.FieldValue.arrayUnion(today)
            });
            triggerConfetti();
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

    try {
        await db.collection('users').doc(state.user.uid).collection('habits').add({
            name,
            color,
            createdAt: new Date().toISOString(),
            completedDates: []
        });
        closeModal();
    } catch (e) {
        console.error("Error adding habit:", e);
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

    const list = document.createElement('div');
    list.className = 'habit-list';

    if (state.habits.length === 0) {
        list.innerHTML = `<div class="empty-state"><p>${state.user ? "¡Crea tu primer hábito!" : "Inicia sesión para ver tus hábitos"}</p></div>`;
    } else {
        const today = getBogotaDate();

        state.habits.forEach(habit => {
            const isCompleted = habit.completedDates?.includes(today);
            const item = document.createElement('div');
            item.className = `habit-item ${isCompleted ? 'completed' : ''}`;
            item.style.setProperty('--habit-color', habit.color);

            // Inner HTML structure with Delete Button
            item.innerHTML = `
                <div class="habit-content-wrapper">
                    <div class="habit-icon">${isCompleted ? '✓' : ''}</div>
                    <div class="habit-info">
                        <span class="habit-name">${habit.name}</span>
                        <span class="habit-streak">🔥 ${calculateStreak(habit)} días</span>
                    </div>
                </div>
                <button class="delete-btn" aria-label="Eliminar Hábito">🗑️</button>
            `;

            // Click on ITEM toggles
            // We need to make sure clicking delete doesn't toggle
            const contentWrapper = item.querySelector('.habit-content-wrapper');
            contentWrapper.addEventListener('click', (e) => {
                // Prevent bubbling just in case, though structure separates them
                e.stopPropagation();
                toggleHabit(habit);
            });

            // Clicking outer item toggles too? Better UX: Only wrapper toggles.
            // Or make Delete button float right and stop propagation.

            const deleteBtn = item.querySelector('.delete-btn');
            deleteBtn.addEventListener('click', (e) => {
                e.stopPropagation(); // Stop bubble to item click
                deleteHabit(habit.id);
            });

            list.appendChild(item);
        });
    }
    dom.mainContent.appendChild(list);
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

        if (state.habits.length > 0 && completedCount > 0) {
            const intensity = completedCount / state.habits.length;
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
            <h3>${h.name}</h3>
            <div class="stat-row"><span>Racha:</span><strong>${streak} días 🔥</strong></div>
            <div class="stat-row"><span>Total:</span><strong>${h.completedDates?.length || 0} veces</strong></div>
        `;
        container.appendChild(card);
    });
    dom.mainContent.appendChild(container);

    // Heatmap
    const hmh = document.createElement('h3');
    hmh.style.marginTop = '2rem';
    hmh.textContent = `Actividad ${new Date().getFullYear()}`;
    dom.mainContent.appendChild(hmh);

    const scroll = document.createElement('div');
    scroll.className = 'heatmap-scroll';
    const heat = document.createElement('div');
    heat.className = 'heatmap-grid';

    // Calculate Heatmap based on Bogota dates relative to Today?
    // Using standard JS date arithmetic is fine as long as we compare apples to apples (date strings)
    const today = new Date();
    // Getting the "Bogota Date" object is tricky without libs, but
    // since we store date STRINGS (YYYY-MM-DD), we can just iterate back 365 days
    // and check if those string keys exist.

    // We need to iterate 365 days back from TODAY (In Bogota).
    // Let's assume the user's system time is somewhat correct for relative "days ago" logic,
    // OR we specifically construct the date strings.

    for (let i = 0; i < 365; i++) {
        // Construct date string i days ago
        const d = new Date();
        d.setDate(d.getDate() - (364 - i));

        // Format to YYYY-MM-DD
        // Note: This 'd' is local time. Ideally we'd shift it.
        // Simple fallback: ISO string split.
        const dateStr = d.toISOString().split('T')[0];

        let dailyCount = 0;
        state.habits.forEach(h => {
            if (h.completedDates?.includes(dateStr)) dailyCount++;
        });

        const cell = document.createElement('div');
        cell.className = 'heatmap-cell';
        if (dailyCount > 0) {
            const intensity = Math.min(dailyCount, 4);
            cell.dataset.level = intensity;
            cell.title = `${dateStr}: ${dailyCount}`;
        } else {
            cell.style.opacity = "0.1";
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

function switchView(v) { state.view = v; render(); }
function triggerConfetti() { console.log("Confetti!"); }

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

    dom.cancelModalBtn?.addEventListener('click', () => {
        dom.modalOverlay.classList.add('hidden');
        dom.addHabitForm.reset();
    });

    dom.addHabitForm?.addEventListener('submit', (e) => {
        e.preventDefault();
        const name = document.getElementById('habit-name').value;
        const color = document.querySelector('input[name="color"]:checked')?.value || '#FF6B6B';
        if (name) addHabit(name, color);
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
