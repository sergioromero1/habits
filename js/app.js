/**
 * HabitSpark - Core Application Logic
 */

document.addEventListener('DOMContentLoaded', () => {
    initApp();
});

// --- State Management ---
let state = {
    view: 'daily',
    habits: [],
    logs: {},
    today: new Date().toISOString().split('T')[0]
};

// --- DOM Elements Container ---
let dom = {};

function initApp() {
    // 1. Initialize State safely
    try {
        state.habits = JSON.parse(localStorage.getItem('habits')) || [];
        state.logs = JSON.parse(localStorage.getItem('logs')) || {};
    } catch (e) {
        console.error("Error parsing LocalStorage", e);
        state.habits = [];
        state.logs = {};
    }

    // 2. Cache DOM Elements
    dom = {
        app: document.getElementById('app'),
        mainContent: document.getElementById('main-content'),
        navBtns: document.querySelectorAll('.nav-btn'),
        addHabitBtn: document.getElementById('add-habit-btn'),
        modalOverlay: document.getElementById('modal-overlay'),
        addHabitForm: document.getElementById('add-habit-form'),
        cancelModalBtn: document.getElementById('cancel-modal'),
        themeToggle: document.getElementById('theme-toggle'),
    };

    // 3. Verify critical elements
    if (!dom.addHabitForm) {
        console.error("Critical: Form 'add-habit-form' not found!");
        return;
    }

    // 4. Start
    render();
    setupEventListeners();
}

// --- Core Functions ---

function saveState() {
    localStorage.setItem('habits', JSON.stringify(state.habits));
    localStorage.setItem('logs', JSON.stringify(state.logs));
}

function switchView(newView) {
    state.view = newView;
    render();
}

// --- Rendering ---

function render() {
    // Update Nav
    dom.navBtns.forEach(btn => {
        if (btn.dataset.view === state.view) {
            btn.classList.add('active');
        } else {
            btn.classList.remove('active');
        }
    });

    // Render View Content
    dom.mainContent.innerHTML = '';

    if (state.view === 'daily') {
        renderDailyView();
    } else if (state.view === 'calendar') {
        renderCalendarView();
    } else if (state.view === 'progress') {
        renderProgressView();
    }
}

function renderDailyView() {
    const header = document.createElement('div');
    header.className = 'view-header';
    header.innerHTML = `
        <h2>Hoy, ${new Date().toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long' })}</h2>
        <p class="subtitle">¡Sigue con tu racha!</p>
    `;
    dom.mainContent.appendChild(header);

    const list = document.createElement('div');
    list.className = 'habit-list';

    if (state.habits.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.innerHTML = '<p>No tienes hábitos aún. ¡Crea el primero!</p>';
        list.appendChild(emptyState);
    } else {
        state.habits.forEach(habit => {
            const isCompleted = state.logs[state.today]?.includes(habit.id);
            const item = document.createElement('div');
            item.className = `habit-item ${isCompleted ? 'completed' : ''}`;
            item.style.setProperty('--habit-color', habit.color);
            item.innerHTML = `
                <div class="habit-icon">
                    ${isCompleted ? '✓' : ''}
                </div>
                <div class="habit-info">
                    <span class="habit-name">${habit.name}</span>
                    <span class="habit-streak">🔥 ${calculateStreak(habit.id)} días</span>
                </div>
            `;
            item.addEventListener('click', () => toggleHabit(habit.id));
            list.appendChild(item);
        });
    }

    dom.mainContent.appendChild(list);
}

function renderCalendarView() {
    const calendarHeader = document.createElement('div');
    calendarHeader.className = 'view-header';
    calendarHeader.innerHTML = `
        <h2>Calendario</h2>
        <p class="subtitle">Tu constancia mes a mes</p>
    `;
    dom.mainContent.appendChild(calendarHeader);

    // Controls for Month Navigation
    const controls = document.createElement('div');
    controls.className = 'calendar-controls';
    const currentMonthDate = state.currentMonth || new Date();
    const monthName = currentMonthDate.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });

    controls.innerHTML = `
        <button id="prev-month">←</button>
        <h3>${monthName}</h3>
        <button id="next-month">→</button>
    `;
    dom.mainContent.appendChild(controls);

    // Grid Container
    const grid = document.createElement('div');
    grid.className = 'calendar-grid';

    const days = ['L', 'M', 'M', 'J', 'V', 'S', 'D'];
    days.forEach(day => {
        const dayHeader = document.createElement('div');
        dayHeader.className = 'day-header';
        dayHeader.textContent = day;
        grid.appendChild(dayHeader);
    });

    // Days Generation
    const year = currentMonthDate.getFullYear();
    const month = currentMonthDate.getMonth();

    const firstDayOfMonth = new Date(year, month, 1).getDay(); // 0 is Sunday
    const adjustedFirstDay = firstDayOfMonth === 0 ? 6 : firstDayOfMonth - 1;
    const daysInMonth = new Date(year, month + 1, 0).getDate();

    // Empty slots
    for (let i = 0; i < adjustedFirstDay; i++) {
        const empty = document.createElement('div');
        empty.className = 'day-cell empty';
        grid.appendChild(empty);
    }

    // Actual Days
    for (let day = 1; day <= daysInMonth; day++) {
        const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        const dayCell = document.createElement('div');
        dayCell.className = 'day-cell';

        const dayLogs = state.logs[dateStr] || [];
        const completionCount = dayLogs.length;
        const totalHabits = state.habits.length;

        if (totalHabits > 0 && completionCount > 0) {
            const intensity = completionCount / totalHabits;
            dayCell.style.backgroundColor = `rgba(99, 102, 241, ${0.2 + (intensity * 0.8)})`;
            dayCell.style.borderColor = 'var(--primary)';
        }

        if (dateStr === state.today) {
            dayCell.classList.add('today');
        }

        dayCell.innerHTML = `<span class="day-number">${day}</span>`;
        if (completionCount > 0) {
            dayCell.innerHTML += `<div class="dots-indicator" style="display:flex; gap:2px; justify-content:center; margin-top:2px;">
                ${dayLogs.map(id => {
                const h = state.habits.find(h => h.id === id);
                return h ? `<span style="width:4px; height:4px; border-radius:50%; background-color:${h.color}; display:inline-block;"></span>` : '';
            }).join('')}
            </div>`;
        }

        grid.appendChild(dayCell);
    }

    dom.mainContent.appendChild(grid);

    // Event Listeners for controls
    // Using simple approach since DOM is fresh
    document.getElementById('prev-month').addEventListener('click', () => changeMonth(-1));
    document.getElementById('next-month').addEventListener('click', () => changeMonth(1));
}

function renderProgressView() {
    const progressHeader = document.createElement('div');
    progressHeader.className = 'view-header';
    progressHeader.innerHTML = `
        <h2>Tu Progreso</h2>
        <p class="subtitle">Estadísticas Anuales</p>
    `;
    dom.mainContent.appendChild(progressHeader);

    if (state.habits.length === 0) {
        const emptyState = document.createElement('div');
        emptyState.className = 'empty-state';
        emptyState.innerHTML = '<p>Crea hábitos para ver estadísticas.</p>';
        dom.mainContent.appendChild(emptyState);
        return;
    }

    const statsContainer = document.createElement('div');
    statsContainer.className = 'stats-container';

    state.habits.forEach(habit => {
        const streak = calculateStreak(habit.id);
        const card = document.createElement('div');
        card.className = 'stat-card';
        card.style.borderLeft = `4px solid ${habit.color}`;
        card.innerHTML = `
            <h3>${habit.name}</h3>
            <div class="stat-row">
                <span>Racha actual:</span>
                <strong>${streak} días 🔥</strong>
            </div>
            <div class="stat-row">
                <span>Total completado:</span>
                <strong>${countTotalCompletions(habit.id)} veces</strong>
            </div>
        `;
        statsContainer.appendChild(card);
    });

    dom.mainContent.appendChild(statsContainer);

    // Year Heatmap
    const heatmapHeader = document.createElement('h3');
    heatmapHeader.style.marginTop = '2rem';
    heatmapHeader.textContent = `Mapa de Calor ${new Date().getFullYear()}`;
    dom.mainContent.appendChild(heatmapHeader);

    const scrollContainer = document.createElement('div');
    scrollContainer.className = 'heatmap-scroll';

    const heatmap = document.createElement('div');
    heatmap.className = 'heatmap-grid';

    const today = new Date();
    // Render last 365 days
    for (let i = 0; i < 365; i++) {
        const d = new Date();
        d.setDate(today.getDate() - (364 - i));
        const dateStr = d.toISOString().split('T')[0];

        const cell = document.createElement('div');
        cell.className = 'heatmap-cell';

        const dayLogs = state.logs[dateStr] || [];
        const intensity = Math.min(dayLogs.length, 4); // 0-4

        if (dayLogs.length > 0) {
            cell.dataset.level = intensity;
            cell.title = `${dateStr}: ${dayLogs.length} hábitos`;
        } else {
            cell.style.opacity = "0.1"; // Base style
        }

        heatmap.appendChild(cell);
    }

    scrollContainer.appendChild(heatmap);
    dom.mainContent.appendChild(scrollContainer);
}

// --- Actions ---

function toggleHabit(habitId) {
    if (!state.logs[state.today]) {
        state.logs[state.today] = [];
    }

    const index = state.logs[state.today].indexOf(habitId);
    if (index === -1) {
        state.logs[state.today].push(habitId);
        triggerConfetti();
    } else {
        state.logs[state.today].splice(index, 1);
    }

    saveState();
    render();
}

function addHabit(name, color) {
    console.log("Adding habit:", name, color);
    const newHabit = {
        id: Date.now().toString(),
        name,
        color,
        createdAt: new Date().toISOString()
    };
    state.habits.push(newHabit);
    saveState();
    closeModal();
    render();
}

function changeMonth(delta) {
    if (!state.currentMonth) state.currentMonth = new Date();
    state.currentMonth.setMonth(state.currentMonth.getMonth() + delta);
    render();
}

function calculateStreak(habitId) {
    let streak = 0;
    const today = new Date();

    for (let i = 0; i < 365; i++) {
        const d = new Date();
        d.setDate(today.getDate() - i);
        const dateStr = d.toISOString().split('T')[0];

        // Allow missing today if it's not over yet? 
        // Logic: if today is NOT done, start streak count from yesterday.
        if (i === 0 && !state.logs[dateStr]?.includes(habitId)) {
            continue;
        }

        if (state.logs[dateStr]?.includes(habitId)) {
            streak++;
        } else {
            break;
        }
    }
    return streak;
}

function countTotalCompletions(habitId) {
    let total = 0;
    Object.values(state.logs).forEach(dayList => {
        if (dayList.includes(habitId)) total++;
    });
    return total;
}

// --- Event Listeners ---

function setupEventListeners() {
    dom.navBtns.forEach(btn => {
        btn.addEventListener('click', () => switchView(btn.dataset.view));
    });

    if (dom.addHabitBtn) {
        dom.addHabitBtn.addEventListener('click', openModal);
    }

    if (dom.cancelModalBtn) {
        dom.cancelModalBtn.addEventListener('click', closeModal);
    }

    if (dom.addHabitForm) {
        dom.addHabitForm.addEventListener('submit', (e) => {
            e.preventDefault();
            console.log("Form submitted!");

            const nameInput = document.getElementById('habit-name');
            const name = nameInput.value;

            const colorInput = document.querySelector('input[name="color"]:checked');
            const color = colorInput ? colorInput.value : '#FF6B6B';

            if (name) {
                addHabit(name, color);
            } else {
                console.warn("Name is empty");
            }
        });
    } else {
        console.error("ADD HABIT FORM NOT FOUND IN SETUP");
    }

    // Close modal on outside click
    if (dom.modalOverlay) {
        dom.modalOverlay.addEventListener('click', (e) => {
            if (e.target === dom.modalOverlay) closeModal();
        });
    }
}

function openModal() {
    if (dom.modalOverlay) {
        dom.modalOverlay.classList.remove('hidden');
        setTimeout(() => {
            const input = document.getElementById('habit-name');
            if (input) input.focus();
        }, 50);
    }
}

function closeModal() {
    if (dom.modalOverlay) {
        dom.modalOverlay.classList.add('hidden');
    }
    if (dom.addHabitForm) {
        dom.addHabitForm.reset();
    }
}

function triggerConfetti() {
    console.log("Confetti!");
}
