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

// --- State Management ---
let state = {
    user: null, // Firebase User
    view: 'daily',
    habits: [], // Now loaded from Firestore
    currentMonth: new Date(),
    unsubscribeHabits: null // Listener cleanup
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
            // Migrate local data if needed, then subscribe
            await migrateUserInfo();
            subscribeToHabits(user.uid);
        } else {
            console.log("No user logged in. Using offline mode (incomplete implementation for purely offline, asking for login).");
            // For now, clear habits if logged out
            state.habits = [];
            if (state.unsubscribeHabits) state.unsubscribeHabits();

            // Optionally: Load localstorage as fallback?
            // To keep simple: "Login to sync". Or fallback to local if desired.
            // Let's fallback to local just so app isn't empty on load for guests.
            loadLocalHabits();
            render();
        }
    });
}

// --- Data Layer (Firebase + Local Fallback) ---

function subscribeToHabits(uid) {
    if (state.unsubscribeHabits) state.unsubscribeHabits();

    const habitsRef = db.collection('users').doc(uid).collection('habits');

    state.unsubscribeHabits = habitsRef.onSnapshot((snapshot) => {
        const habits = [];
        snapshot.forEach(doc => {
            habits.push({ id: doc.id, ...doc.data() });
        });
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

        // Convert old structure to new unified structure for display compatibility
        state.habits = localHabits.map(h => {
            // Find completion dates for this habit
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
    // One-time check: If user has 0 habits in cloud, upload local habits
    const uid = state.user.uid;
    const habitsRef = db.collection('users').doc(uid).collection('habits');
    const snap = await habitsRef.get();

    if (snap.empty) {
        console.log("New cloud user, checking local data...");
        const localHabits = JSON.parse(localStorage.getItem('habits')) || [];
        const localLogs = JSON.parse(localStorage.getItem('logs')) || {};

        if (localHabits.length > 0) {
            if (confirm("¡Tienes datos locales! ¿Quieres subirlos a tu cuenta?")) {
                const batch = db.batch();
                localHabits.forEach(h => {
                    const docRef = habitsRef.doc(h.id); // Use same ID or new
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
                console.log("Migration complete.");
                // Optional: Clear local storage? localStorage.clear();
            }
        }
    }
}

// --- Actions ---

async function toggleHabit(habit) {
    if (!state.user) {
        alert("Inicia sesión para guardar tu progreso en la nube.");
        return; // Or handle local toggle
    }

    const today = new Date().toISOString().split('T')[0];
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

    const exportFileDefaultName = `habit-tracker-data-${new Date().toISOString().split('T')[0]}.json`;

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
    const todayStr = new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' });
    header.innerHTML = `<h2>Hoy, ${todayStr}</h2><p class="subtitle">¡Sigue con tu racha!</p>`;
    dom.mainContent.appendChild(header);

    const list = document.createElement('div');
    list.className = 'habit-list';

    if (state.habits.length === 0) {
        list.innerHTML = `<div class="empty-state"><p>${state.user ? "¡Crea tu primer hábito!" : "Inicia sesión para ver tus hábitos"}</p></div>`;
    } else {
        const today = new Date().toISOString().split('T')[0];

        state.habits.forEach(habit => {
            const isCompleted = habit.completedDates?.includes(today);
            const item = document.createElement('div');
            item.className = `habit-item ${isCompleted ? 'completed' : ''}`;
            item.style.setProperty('--habit-color', habit.color);
            item.innerHTML = `
                <div class="habit-icon">${isCompleted ? '✓' : ''}</div>
                <div class="habit-info">
                    <span class="habit-name">${habit.name}</span>
                    <span class="habit-streak">🔥 ${calculateStreak(habit)} días</span>
                </div>
            `;
            item.addEventListener('click', () => toggleHabit(habit));
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
    const monthName = currentMonthDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

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

    // Days extraction
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

        const today = new Date().toISOString().split('T')[0];
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

    const today = new Date();
    for (let i = 0; i < 365; i++) {
        const d = new Date();
        d.setDate(today.getDate() - (364 - i));
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
    const today = new Date();

    // Check backwards 365 days
    for (let i = 0; i < 365; i++) {
        const d = new Date();
        d.setDate(today.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];

        // If today is NOT done, skip it (streak continues from yesterday)
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
