(function () {
    const HEARTBEAT_INTERVAL = 30000; // 30 seconds
    let sessionId = sessionStorage.getItem('analytics_session_id');
    if (!sessionId) {
        sessionId = 'sess_' + Math.random().toString(36).substr(2, 9) + '_' + Date.now();
        sessionStorage.setItem('analytics_session_id', sessionId);
    }

    let currentView = 'Home';

    async function sendHeartbeat(isNew = false) {
        try {
            await fetch('/api/analytics/heartbeat', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    sessionId,
                    view: currentView,
                    isNew
                })
            });
        } catch (e) {
            // Silently fail to not disturb user
        }
    }

    // Initial ping
    sendHeartbeat(true);

    // Periodic heartbeat
    setInterval(() => sendHeartbeat(false), HEARTBEAT_INTERVAL);

    // Expose global for app logic to update view
    window.AnalyticsTracker = {
        setView: (view) => {
            if (currentView !== view) {
                currentView = view;
                sendHeartbeat(false); // Send immediate update on view change
            }
        }
    };
})();
