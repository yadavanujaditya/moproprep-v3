const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const path = require('path');
const fs = require('fs');


// Load environment variables FIRST
require('dotenv').config();

const app = express();

// Use CORS with no restrictions
app.use(cors({
    origin: '*',
    methods: ['GET', 'POST'],
    allowedHeaders: ['Content-Type']
}));

app.use(express.json());
app.use(express.static('public'));

const Razorpay = require('razorpay');
const crypto = require('crypto');

// Initialize Razorpay only if keys are provided
let rzp = null;
if (process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET) {
    rzp = new Razorpay({
        key_id: process.env.RAZORPAY_KEY_ID,
        key_secret: process.env.RAZORPAY_KEY_SECRET
    });
    console.log('Razorpay initialized successfully.');
} else {
    console.warn('WARNING: Razorpay keys not set. Payment features disabled.');
}

// --- Visitor Analytics Logger ---
const VISITS_FILE = path.join(__dirname, 'visits.json');

app.use((req, res, next) => {
    // Only log page views and meaningful API calls, ignore static files/favicons
    const isStatic = req.url.includes('.') || req.url.startsWith('/favicon');
    if (isStatic) return next();

    const visit = {
        timestamp: new Date().toISOString(),
        ip: req.headers['x-forwarded-for'] || req.socket.remoteAddress,
        url: req.url,
        ua: req.headers['user-agent']
    };

    // Use async file operations to avoid blocking the event loop
    fs.readFile(VISITS_FILE, 'utf8', (err, data) => {
        let visits = [];
        if (!err && data) {
            try {
                visits = JSON.parse(data);
            } catch (e) { console.error('Parse error visits:', e.message); }
        }
        visits.push(visit);
        if (visits.length > 1000) visits.shift();
        fs.writeFile(VISITS_FILE, JSON.stringify(visits, null, 2), (writeErr) => {
            if (writeErr) console.error('Failed to log visit:', writeErr.message);
        });
    });
    next();
});

// --- Session Duration Tracker ---
const SESSIONS_FILE = path.join(__dirname, 'sessions.json');

app.post('/api/analytics/heartbeat', (req, res) => {
    const { sessionId, view, isNew } = req.body;
    const ip = req.headers['x-forwarded-for'] || req.socket.remoteAddress;

    fs.readFile(SESSIONS_FILE, 'utf8', (err, data) => {
        let sessions = {};
        if (!err && data) {
            try {
                sessions = JSON.parse(data);
            } catch (e) { console.error('Parse error sessions:', e.message); }
        }

        const now = Date.now();
        if (!sessions[sessionId]) {
            sessions[sessionId] = {
                startTime: now,
                lastSeen: now,
                ip,
                ua: req.headers['user-agent'],
                views: {}
            };
        }

        const s = sessions[sessionId];
        if (view) {
            if (!s.views[view]) s.views[view] = 0;
            if (!isNew) {
                s.views[view] += 30; // 30 second interval
            }
        }
        s.lastSeen = now;

        // Cleanup: remove sessions older than 24h
        const ONE_DAY = 24 * 60 * 60 * 1000;
        Object.keys(sessions).forEach(id => {
            if (now - sessions[id].lastSeen > ONE_DAY) delete sessions[id];
        });

        fs.writeFile(SESSIONS_FILE, JSON.stringify(sessions, null, 2), (writeErr) => {
            if (writeErr) console.error('Heartbeat write error:', writeErr.message);
        });
        res.json({ success: true });
    });
});


const SHEET_CSV_URL = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vS2XBDgArRwbSDeYrFOS4gj3pwWafbCV8_RHGd3v9tb_9S35ApQEzG43pvR6KX-zHaiucsQ0iXClaI0/pub?output=csv';

// Cache configuration
let cachedData = null;
let lastFetchTime = 0;
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes in milliseconds


// Helper: Fetch and Parse Data
async function getQuestions(forceRefresh = false) {
    const now = Date.now();

    // Return cached data if valid and no forced refresh
    if (!forceRefresh && cachedData && (now - lastFetchTime < CACHE_TTL)) {
        return cachedData;
    }

    console.log('Fetching fresh data from Google Sheets...');
    console.time('fetchSheets');
    try {
        const response = await axios.get(SHEET_CSV_URL, { timeout: 10000 }); // 10s timeout
        const csvData = response.data;
        console.timeEnd('fetchSheets');

        // Parse CSV
        const records = parse(csvData, {
            columns: true,
            skip_empty_lines: true,
            trim: true // Automatically trim whitespace from cells
        });

        // Transform to App format
        const transformed = records.map(record => {
            const rawYear = String(record.year || record.Year || "").trim();
            const year = parseInt(rawYear) || 0;

            // Handle tags robustly
            let tags = [];
            if (record.tags) {
                tags = record.tags.split(/[|,]/).map(t => t.trim()).filter(Boolean);
            }

            return {
                id: record.id || record.ID,
                year: year,
                question_text: record.question_text || record.questionText,
                options: {
                    A: record.option_A || record.option_a || "",
                    B: record.option_B || record.option_b || "",
                    C: record.option_C || record.option_c || "",
                    D: record.option_D || record.option_d || ""
                },
                correct_answer: (record.correct_answer || record.correctAnswer || "").toString().trim().toUpperCase(),
                explanation: record.explanation || "",
                tags: tags
            };
        });

        cachedData = transformed;
        lastFetchTime = now;
        console.log(`Loaded ${transformed.length} questions from Sheets.`);
        return transformed;

    } catch (err) {
        console.error('Error fetching/parsing Sheets data:', err.message);

        // Fallback to local data.json
        try {
            const dataPath = path.join(__dirname, 'data.json');
            if (fs.existsSync(dataPath)) {
                console.log('Falling back to local data.json...');
                const localData = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
                cachedData = localData;
                lastFetchTime = now; // Mark as "fetched" to avoid immediate retry
                return localData;
            }
        } catch (localErr) {
            console.error('Error reading local data.json:', localErr.message);
        }

        if (cachedData) {
            console.warn('Returning stale cache due to fetch error.');
            return cachedData;
        }
        throw err;
    }
}

// Logs for debugging
app.use((req, res, next) => {
    console.log(`${new Date().toISOString()} - ${req.method} ${req.url}`);
    next();
});

// Root route moved to after static to allow index.html to take precedence
// Or just remove it if you want index.html as home.
// app.get('/', ...); // REMOVED to allow public/index.html to serve as home

// Endpoint: Force Refresh Cache
app.post('/api/refresh', async (req, res) => {
    try {
        const data = await getQuestions(true);
        res.json({ success: true, count: data.length, message: 'Data refreshed from Sheets' });
    } catch (err) {
        res.status(500).json({ error: 'Failed to refresh data: ' + err.message });
    }
});

// Get all years
app.get('/api/years', async (req, res) => {
    try {
        const questions = await getQuestions();
        const uniqueYears = [...new Set(questions.map(q => q.year))]
            .filter(year => year && year != 0)
            .sort((a, b) => b - a);

        const years = uniqueYears.map(year => ({
            _id: year.toString(),
            year: year.toString(),
            description: `Quiz Year ${year}`
        }));

        res.json(years);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get questions for a specific year
app.get('/api/questions/:year', async (req, res) => {
    const { tags } = req.query;
    try {
        const questions = await getQuestions();
        let filtered = questions.filter(q => q.year.toString() === req.params.year);

        if (tags) {
            const tagList = tags.split(',').map(t => t.trim().toLowerCase());
            filtered = filtered.filter(q =>
                q.tags && q.tags.some(tag => tagList.some(t => tag.toLowerCase().includes(t)))
            );
        }

        res.json(filtered);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Get questions by tag
app.get('/api/tags/:tag', async (req, res) => {
    try {
        const questions = await getQuestions();
        const tagToMatch = req.params.tag.toLowerCase();

        const filtered = questions.filter(q =>
            q.tags && q.tags.some(tag => tag.toLowerCase() === tagToMatch)
        );

        res.json(filtered);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// --- Razorpay Endpoints ---

// Step 1: Create Order
app.post('/api/create-order', async (req, res) => {
    const { amount } = req.body;
    try {
        const order = await rzp.orders.create({
            amount: amount * 100, // Razorpay works in paise
            currency: "INR",
            receipt: `receipt_${Date.now()}`
        });
        res.json(order);
    } catch (err) {
        res.status(500).json({ error: err.message });
    }
});

// Step 2: Verify Payment
// NOTE: For full security, we'd use Firebase Admin SDK to update Firestore
// Here we just return success, and the frontend handles the immediate UI update after verification
app.post('/api/verify-payment', async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, uid } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(body.toString())
        .digest("hex");

    if (expectedSignature === razorpay_signature) {
        // Ideally: Use firebase-admin to update firestore: users[uid].isPro = true
        // For now, return success to frontend
        res.json({ success: true });
    } else {
        res.status(400).json({ success: false });
    }
});

// Analytics Endpoint
app.get('/api/admin/stats', requireAuth, (req, res) => {
    try {
        let stats = { totalVisits: 0, uniqueVisitors: 0, recentVisits: [], avgDuration: 0, topPages: [] };

        if (fs.existsSync(VISITS_FILE)) {
            const visits = JSON.parse(fs.readFileSync(VISITS_FILE, 'utf8'));
            stats.totalVisits = visits.length;
            stats.uniqueVisitors = new Set(visits.map(v => v.ip)).size;
            stats.recentVisits = visits.slice(-20).reverse();
        }

        if (fs.existsSync(SESSIONS_FILE)) {
            const sessions = JSON.parse(fs.readFileSync(SESSIONS_FILE, 'utf8'));
            const sessionValues = Object.values(sessions);

            const totalDuration = sessionValues.reduce((acc, s) => {
                const duration = Object.values(s.views).reduce((a, b) => a + b, 0);
                return acc + duration;
            }, 0);

            stats.avgDuration = sessionValues.length > 0 ? (totalDuration / sessionValues.length) : 0;

            const pageTotals = {};
            sessionValues.forEach(s => {
                Object.entries(s.views).forEach(([view, time]) => {
                    pageTotals[view] = (pageTotals[view] || 0) + time;
                });
            });
            stats.topPages = Object.entries(pageTotals)
                .map(([name, time]) => ({ name, time }))
                .sort((a, b) => b.time - a.time);
        }

        res.json(stats);
    } catch (e) {
        res.status(500).json({ error: e.message });
    }
});


// Admin endpoints (Read-only mode message)
const ADMIN_CREDENTIALS = { username: "admin", password: "password123" };

app.post('/api/admin/login', (req, res) => {
    const { username, password } = req.body;
    if (username === ADMIN_CREDENTIALS.username && password === ADMIN_CREDENTIALS.password) {
        res.json({ success: true, token: `token-${username}` });
    } else {
        res.status(401).json({ success: false, error: 'Invalid credentials' });
    }
});

function requireAuth(req, res, next) {
    const token = req.headers['authorization'];
    if (token === `token-${ADMIN_CREDENTIALS.username}`) next();
    else res.status(401).json({ error: 'Unauthorized' });
}

const READ_ONLY_MSG = "Database is now managed via Google Sheets. Is read only mode.";

app.post('/api/admin/verify-json', requireAuth, (req, res) => res.status(400).json({ error: READ_ONLY_MSG }));
app.post('/api/admin/import-json', requireAuth, (req, res) => res.status(400).json({ error: READ_ONLY_MSG }));
app.post('/api/admin/clear-questions', requireAuth, (req, res) => res.status(400).json({ error: READ_ONLY_MSG }));

// Start server
const PORT = process.env.PORT || 3000;
app.listen(PORT, '0.0.0.0', async () => {
    console.log(`\n╔════════════════════════════════════╗`);
    console.log(`║    DATA SOURCE: GOOGLE SHEETS      ║`);
    console.log(`╠════════════════════════════════════╣`);
    console.log(`║ Server running on port ${PORT}        ║`);
    console.log(`╚════════════════════════════════════╝\n`);

    await getQuestions().catch(err => console.error("Initial fetch failed:", err.message));
});
