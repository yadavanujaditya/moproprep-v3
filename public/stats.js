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

        const userTableBody = document.getElementById('user-table-body');
        userTableBody.innerHTML = '';

        usersSnap.forEach(doc => {
            const u = doc.data();
            if (u.isPro) proUsers++;

            const row = `
                <tr>
                    <td>${u.displayName || 'N/A'}</td>
                    <td>${u.email}</td>
                    <td><span class="status-badge ${u.isPro ? 'badge-pro' : 'badge-free'}">${u.isPro ? 'PRO' : 'Free'}</span></td>
                </tr>
            `;
            userTableBody.insertAdjacentHTML('beforeend', row);
        });

        // Revenue calculation (Price is from pricing setting)
        const pricingDoc = await db.collection('settings').doc('pricing').get();
        const price = pricingDoc.exists ? pricingDoc.data().amount : 299;
        const revenue = proUsers * price;

        document.getElementById('val-total-users').innerText = totalUsers;
        document.getElementById('val-pro-users').innerText = proUsers;
        document.getElementById('val-revenue').innerText = '₹' + revenue.toLocaleString();

    } catch (err) {
        console.error("Error loading user stats:", err);
    }
}

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

