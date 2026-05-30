const ADMIN_EMAIL = "adityasonofashok@gmail.com";

auth.onAuthStateChanged(async (user) => {
    const loginSection = document.getElementById('login-section');
    const statsContent = document.getElementById('stats-content');
    const logoutBtn = document.getElementById('btn-logout');
    const refreshBtn = document.getElementById('btn-refresh');

    if (user && user.email === ADMIN_EMAIL) {
        loginSection.style.display = 'none';
        statsContent.style.display = 'block';
        logoutBtn.style.display = 'block';
        if (refreshBtn) refreshBtn.style.display = 'block';
        initStats();
    } else if (user) {
        alert("Access Denied: You are not an admin.");
        auth.signOut();
    } else {
        loginSection.style.display = 'flex';
        statsContent.style.display = 'none';
        logoutBtn.style.display = 'none';
        if (refreshBtn) refreshBtn.style.display = 'none';
    }
});

document.getElementById('btn-admin-login').onclick = () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    auth.signInWithPopup(provider);
};

document.getElementById('btn-logout').onclick = () => {
    auth.signOut();
};

async function initStats() {
    loadUserStats();
    loadTrafficStats();
    setupLeaderboardFilter();

    // Auto-refresh traffic stats every 30 seconds
    setInterval(() => {
        loadTrafficStats();
    }, 30000);
}

async function loadUserStats() {
    try {
        // Fetch users from Firestore
        const usersSnap = await db.collection('users').get();
        const totalUsers = usersSnap.size;
        let proUsers = 0;
        const usersByEmail = {};

        usersSnap.forEach(doc => {
            const u = doc.data();
            if (u.isPro) proUsers++;
            if (u.email) usersByEmail[u.email] = u;
        });

        // Revenue calculation (Price is from pricing setting)
        const pricingDoc = await db.collection('settings').doc('pricing').get();
        const price = pricingDoc.exists ? pricingDoc.data().amount : 299;
        const revenue = proUsers * price;

        document.getElementById('val-total-users').innerText = totalUsers;
        document.getElementById('val-pro-users').innerText = proUsers;
        document.getElementById('val-revenue').innerText = '₹' + revenue.toLocaleString();

        // Store for later use by leaderboard filter
        window._usersByEmail = usersByEmail;

    } catch (err) {
        console.error("Error loading user stats:", err);
        document.getElementById('val-total-users').innerText = "Error";
        document.getElementById('val-pro-users').innerText = "Error";
        document.getElementById('val-revenue').innerText = "Error";
    }
}

// --- Leaderboard Filter Logic ---
let currentLeaderboardPeriod = 'day';
let cachedTopUsers = [];

function setupLeaderboardFilter() {
    const filterContainer = document.getElementById('leaderboard-filter');
    if (!filterContainer) return;

    filterContainer.querySelectorAll('button').forEach(btn => {
        btn.addEventListener('click', () => {
            filterContainer.querySelectorAll('button').forEach(b => b.classList.remove('active'));
            btn.classList.add('active');
            currentLeaderboardPeriod = btn.getAttribute('data-period');
            renderTopUsersTable(cachedTopUsers, currentLeaderboardPeriod);
        });
    });
}

function renderTopUsersTable(topUsers, period) {
    const userTableBody = document.getElementById('user-table-body');
    if (!userTableBody) return;
    userTableBody.innerHTML = '';

    const usersByEmail = window._usersByEmail || {};

    // Sort by chosen period
    const timeKey = period === 'day' ? 'dayTime' : period === 'week' ? 'weekTime' : 'monthTime';
    const sorted = [...topUsers].sort((a, b) => b[timeKey] - a[timeKey]).filter(u => u[timeKey] > 0);

    if (sorted.length === 0) {
        userTableBody.innerHTML = `<tr><td colspan="5" style="text-align: center; color: var(--text-muted);">No user activity for this period.</td></tr>`;
        return;
    }

    sorted.forEach((u, idx) => {
        const firestoreUser = usersByEmail[u.email];
        const isPro = firestoreUser ? firestoreUser.isPro : false;
        const displayName = u.displayName || (firestoreUser ? firestoreUser.displayName : null) || 'Anonymous';
        const tierBadge = isPro
            ? '<span class="status-badge badge-pro">PRO</span>'
            : '<span class="status-badge badge-free">Free</span>';

        const timeSpent = formatTime(u[timeKey]);
        const breakdownId = `breakdown-${idx}`;

        const row = `
            <tr style="cursor: pointer;" onclick="toggleBreakdown('${breakdownId}')">
                <td>${displayName}</td>
                <td>${u.email}</td>
                <td style="font-weight: 600; color: var(--primary);">${timeSpent}</td>
                <td>${tierBadge}</td>
                <td style="color: var(--text-muted); font-size: 0.8rem;">▼ Details</td>
            </tr>
            <tr id="${breakdownId}" class="view-breakdown-row">
                <td colspan="5" style="padding: 0.75rem 1rem;">
                    <div style="font-size: 0.8rem; color: var(--text-muted); margin-bottom: 0.4rem;">Page Breakdown:</div>
                    <div class="breakdown-list">
                        ${Object.entries(u.viewsBreakdown || {})
                            .sort((a, b) => b[1] - a[1])
                            .map(([view, time]) => `<span class="breakdown-chip">${view}: ${formatTime(time)}</span>`)
                            .join('')
                        }
                    </div>
                </td>
            </tr>
        `;
        userTableBody.insertAdjacentHTML('beforeend', row);
    });
}

// Toggle collapsible breakdown row
window.toggleBreakdown = function(id) {
    const row = document.getElementById(id);
    if (row) row.classList.toggle('show');
};

async function loadTrafficStats() {
    try {
        // Show loading state
        const trafficTableBody = document.getElementById('traffic-table-body');
        if (trafficTableBody) {
            trafficTableBody.innerHTML = '<tr><td colspan="4" style="text-align: center;">Loading traffic data...</td></tr>';
        }

        const res = await fetch('/api/admin/stats', {
            headers: {
                'Authorization': 'token-admin'
            }
        });

        if (!res.ok) {
            throw new Error(`HTTP ${res.status}: ${res.statusText}`);
        }

        const data = await res.json();

        if (data.error) {
            console.error("Traffic API error:", data.error);
            document.getElementById('val-visits').innerText = 'Error';
            document.getElementById('val-avg-time').innerText = 'Error';
            return;
        }

        // --- Update Top Level Stats ---
        document.getElementById('val-visits').innerText = data.totalVisits || 0;
        document.getElementById('val-avg-time').innerText = formatTime(data.avgDuration || 0);

        // --- Traffic Table ---
        if (trafficTableBody) {
            trafficTableBody.innerHTML = '';
            if (data.recentVisits && data.recentVisits.length > 0) {
                data.recentVisits.forEach(v => {
                    const date = new Date(v.timestamp);
                    const timeStr = date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    const device = v.ua && v.ua.includes('Mobile') ? '📱 Mobile' : '💻 Desktop';
                    const row = `
                        <tr>
                            <td>${timeStr}</td>
                            <td>${v.ip || 'Unknown'}</td>
                            <td style="color: var(--primary)">${v.url || '/'}</td>
                            <td>${device}</td>
                        </tr>
                    `;
                    trafficTableBody.insertAdjacentHTML('beforeend', row);
                });
            } else {
                trafficTableBody.innerHTML = '<tr><td colspan="4" style="text-align: center;">No recent traffic data. Visit the main site to generate traffic.</td></tr>';
            }
        }

        // --- Page Engagement Table ---
        const pageStatsBody = document.getElementById('page-stats-body');
        if (pageStatsBody) {
            pageStatsBody.innerHTML = '';
            if (data.topPages && data.topPages.length > 0) {
                data.topPages.forEach(p => {
                    const row = `
                        <tr>
                            <td>${p.name}</td>
                            <td style="font-weight: 600;">${formatTime(p.time)}</td>
                        </tr>
                    `;
                    pageStatsBody.insertAdjacentHTML('beforeend', row);
                });
            } else {
                pageStatsBody.innerHTML = '<tr><td colspan="2" style="text-align: center;">No engagement data yet. Users need to browse the site to generate data.</td></tr>';
            }
        }

        // --- Top Users Leaderboard ---
        if (data.topUsers) {
            cachedTopUsers = data.topUsers;
            renderTopUsersTable(cachedTopUsers, currentLeaderboardPeriod);
        }

    } catch (err) {
        console.error("Error loading traffic stats:", err);

        // Show error in UI
        document.getElementById('val-visits').innerText = '⚠️';
        document.getElementById('val-avg-time').innerText = '⚠️';

        const trafficTableBody = document.getElementById('traffic-table-body');
        if (trafficTableBody) {
            trafficTableBody.innerHTML = `<tr><td colspan="4" style="text-align: center; color: #f87171;">Failed to load: ${err.message}</td></tr>`;
        }
    }
}

function formatTime(seconds) {
    if (seconds === 0) return '0s';
    if (seconds < 60) return `${Math.round(seconds)}s`;
    const mins = Math.floor(seconds / 60);
    const secs = Math.round(seconds % 60);
    if (mins >= 60) {
        const hours = Math.floor(mins / 60);
        const rmins = mins % 60;
        return `${hours}h ${rmins}m`;
    }
    return `${mins}m ${secs}s`;
}

