const express = require('express');
const cors = require('cors');
const axios = require('axios');
const { parse } = require('csv-parse/sync');
const path = require('path');
const fs = require('fs');

// --- Global Crash Guards: keep server alive on unexpected errors ---
process.on('uncaughtException', (err) => {
    console.error('[CRASH GUARD] Uncaught Exception:', err.message);
});
process.on('unhandledRejection', (reason) => {
    console.error('[CRASH GUARD] Unhandled Promise Rejection:', reason);
});

// Firebase Admin SDK for server-side Firestore operations
const admin = require('firebase-admin');

// Load environment variables FIRST
require('dotenv').config();

// Initialize Firebase Admin
// Check if service account file exists, otherwise use default credentials
const serviceAccountPath = path.join(__dirname, 'serviceAccountKey.json');
if (fs.existsSync(serviceAccountPath)) {
    const serviceAccount = require(serviceAccountPath);
    admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
    });
    console.log('Firebase Admin initialized with service account.');
} else if (process.env.FIREBASE_PROJECT_ID) {
    // Use environment variables (for Vercel/production)
    admin.initializeApp({
        credential: admin.credential.cert({
            projectId: process.env.FIREBASE_PROJECT_ID,
            clientEmail: process.env.FIREBASE_CLIENT_EMAIL,
            privateKey: process.env.FIREBASE_PRIVATE_KEY?.replace(/\\n/g, '\n')
        })
    });
    console.log('Firebase Admin initialized with environment variables.');
} else {
    console.warn('WARNING: Firebase Admin not initialized. Payment verification will not update Firestore.');
}

// Get Firestore instance (if Admin is initialized)
const adminDb = admin.apps.length > 0 ? admin.firestore() : null;

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
let visitsWriteLock = false; // Prevent concurrent writes corrupting JSON

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

    // Skip write if lock is active (prevents concurrent write corruption)
    if (visitsWriteLock) return next();
    visitsWriteLock = true;

    fs.readFile(VISITS_FILE, 'utf8', (err, data) => {
        let visits = [];
        if (!err && data) {
            try {
                visits = JSON.parse(data);
                if (!Array.isArray(visits)) visits = [];
            } catch (e) {
                console.warn('visits.json corrupted — resetting.');
                visits = []; // Auto-heal: reset corrupted file
            }
        }
        visits.push(visit);
        if (visits.length > 1000) visits = visits.slice(-1000);
        fs.writeFile(VISITS_FILE, JSON.stringify(visits), (writeErr) => {
            if (writeErr) console.error('Failed to log visit:', writeErr.message);
            visitsWriteLock = false; // Release lock
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
const UPSC_CMS_SHEET_URL = 'https://docs.google.com/spreadsheets/d/1eiXDqtyMgHf-k-AdcKx0VWmFG1Dz22K5LJ2pLtQFFDg/export?format=csv';

// Cache configuration
let cachedData = null;
let lastFetchTime = 0;
let fetchPromise = null; // Lock: prevents multiple simultaneous fetches
const CACHE_TTL = 30 * 60 * 1000; // 30 minutes — reduces Google Sheets fetch load


// Helper: Fetch and Parse Data
async function getQuestions(forceRefresh = false) {
    const now = Date.now();

    // Return cached data if valid and no forced refresh
    if (!forceRefresh && cachedData && (now - lastFetchTime < CACHE_TTL)) {
        return cachedData;
    }

    // If a fetch is already in progress, wait for it instead of starting another
    if (fetchPromise) {
        return fetchPromise;
    }

    console.log('Fetching fresh data from Google Sheets...');
    fetchPromise = _doFetch().finally(() => { fetchPromise = null; });
    return fetchPromise;
}

async function _doFetch() {
    
    // --- 1. Fetch State MO questions ---
    let stateMOQuestions = [];
    console.time('fetchStateMOSheets');
    try {
        const response = await axios.get(SHEET_CSV_URL, { timeout: 10000 }); // 10s timeout
        const csvData = response.data;
        console.timeEnd('fetchStateMOSheets');

        // Parse CSV
        const records = parse(csvData, {
            columns: true,
            skip_empty_lines: true,
            trim: true // Automatically trim whitespace from cells
        });

        // Transform to App format
        stateMOQuestions = records.map(record => {
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
        console.log(`Loaded ${stateMOQuestions.length} State MO questions from Sheets.`);
    } catch (err) {
        console.error('Error fetching/parsing State MO Sheets data:', err.message);
        // Fallback to local data.json
        try {
            const dataPath = path.join(__dirname, 'data.json');
            if (fs.existsSync(dataPath)) {
                console.log('Falling back to local data.json...');
                stateMOQuestions = JSON.parse(fs.readFileSync(dataPath, 'utf8'));
            }
        } catch (localErr) {
            console.error('Error reading local data.json:', localErr.message);
        }
    }

    // --- 2. Fetch UPSC CMS questions ---
    let upscCMSQuestions = [];
    console.time('fetchUPSCCMSSheets');
    try {
        const response = await axios.get(UPSC_CMS_SHEET_URL, { timeout: 10000 }); // 10s timeout
        const csvData = response.data;
        console.timeEnd('fetchUPSCCMSSheets');

        // Parse CSV
        const records = parse(csvData, {
            columns: true,
            skip_empty_lines: true,
            trim: true
        });

        // Transform to App format (UPSC CMS specific mapping)
        upscCMSQuestions = records.map(record => {
            const rawYear = String(record.year || record.Year || "").trim();
            const year = parseInt(rawYear) || 0;

            // Generate tags automatically for UPSC CMS
            let tags = ['upscmo']; // Default tag to match frontend selectMode('upscmo')
            if (record.examtype) tags.push(record.examtype.toString().trim());
            if (record.subject) tags.push(record.subject.toString().trim());
            if (record.chapter) tags.push(record.chapter.toString().trim());
            if (record.topic) tags.push(record.topic.toString().trim());
            if (record.paper) tags.push(`Paper ${record.paper}`);
            
            // Merge any existing explicit tags
            if (record.tags) {
                const extraTags = record.tags.split(/[|,]/).map(t => t.trim()).filter(Boolean);
                tags = [...new Set([...tags, ...extraTags])];
            }

            return {
                id: record.id || record.ID,
                question_no: record.question_no ? parseInt(record.question_no) : undefined,
                examtype: record.examtype,
                year: year,
                paper: record.paper ? parseInt(record.paper) : undefined,
                question_text: record.question_text || record.questionText,
                option_a: record.option_a || record.option_A || "",
                option_b: record.option_b || record.option_B || "",
                option_c: record.option_c || record.option_C || "",
                option_d: record.option_d || record.option_D || "",
                options: {
                    A: record.option_a || record.option_A || "",
                    B: record.option_b || record.option_B || "",
                    C: record.option_c || record.option_C || "",
                    D: record.option_d || record.option_D || ""
                },
                correct_answer: (record.correct_answer || record.correctAnswer || "").toString().trim().toUpperCase(),
                explanation: record.explanation || "",
                difficulty: record.difficulty,
                subject: record.subject,
                chapter: record.chapter,
                topic: record.topic,
                exam_weightage: record.exam_weightage,
                tags: tags
            };
        });
        console.log(`Loaded ${upscCMSQuestions.length} UPSC CMS questions from Sheets.`);
    } catch (err) {
        console.error('Error fetching/parsing UPSC CMS Sheets data:', err.message);
        // Fallback to local upsc_cms_data.json
        try {
            const upscDataPath = path.join(__dirname, 'upsc_cms_data.json');
            if (fs.existsSync(upscDataPath)) {
                console.log('Falling back to local upsc_cms_data.json...');
                const localData = JSON.parse(fs.readFileSync(upscDataPath, 'utf8'));
                upscCMSQuestions = localData.map(record => {
                    const rawYear = String(record.year || record.Year || "").trim();
                    const year = parseInt(rawYear) || 0;
                    
                    let tags = ['upscmo'];
                    if (record.examtype) tags.push(record.examtype.toString().trim());
                    if (record.subject) tags.push(record.subject.toString().trim());
                    if (record.chapter) tags.push(record.chapter.toString().trim());
                    if (record.topic) tags.push(record.topic.toString().trim());
                    if (record.paper) tags.push(`Paper ${record.paper}`);

                    if (record.tags) {
                        const extraTags = Array.isArray(record.tags) ? record.tags : record.tags.split(/[|,]/).map(t => t.trim()).filter(Boolean);
                        tags = [...new Set([...tags, ...extraTags])];
                    }

                    return {
                        id: record.id || record.ID,
                        question_no: record.question_no ? parseInt(record.question_no) : undefined,
                        examtype: record.examtype,
                        year: year,
                        paper: record.paper ? parseInt(record.paper) : undefined,
                        question_text: record.question_text || record.questionText,
                        option_a: record.option_a || record.option_A || "",
                        option_b: record.option_b || record.option_B || "",
                        option_c: record.option_c || record.option_C || "",
                        option_d: record.option_d || record.option_D || "",
                        options: {
                            A: record.option_a || record.option_A || "",
                            B: record.option_b || record.option_B || "",
                            C: record.option_c || record.option_C || "",
                            D: record.option_d || record.option_D || ""
                        },
                        correct_answer: (record.correct_answer || record.correctAnswer || "").toString().trim().toUpperCase(),
                        explanation: record.explanation || "",
                        difficulty: record.difficulty,
                        subject: record.subject,
                        chapter: record.chapter,
                        topic: record.topic,
                        exam_weightage: record.exam_weightage,
                        tags: tags
                    };
                });
            }
        } catch (localErr) {
            console.error('Error reading local upsc_cms_data.json:', localErr.message);
        }
    }

    // Merge both arrays
    const combinedQuestions = [...stateMOQuestions, ...upscCMSQuestions];

    if (combinedQuestions.length === 0) {
        if (cachedData) {
            console.warn('Returning stale cache due to empty combined dataset.');
            return cachedData;
        }
        throw new Error('No questions could be loaded from sheets or local fallbacks.');
    }

    cachedData = combinedQuestions;
    lastFetchTime = Date.now();
    console.log(`Successfully cached ${cachedData.length} total questions.`);
    return cachedData;
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

// Get all years (optionally filtered by tag)
app.get('/api/years', async (req, res) => {
    const { tag } = req.query;
    try {
        const questions = await getQuestions();
        let relevantQuestions = questions;

        if (tag) {
            const tagList = tag.split(',').map(t => t.trim().toLowerCase());
            relevantQuestions = questions.filter(q =>
                q.tags && q.tags.some(t => tagList.some(reqTag => t.toLowerCase().includes(reqTag)))
            );
        }

        const uniqueYears = [...new Set(relevantQuestions.map(q => q.year))]
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

// Step 2: Verify Payment and Update Firestore
app.post('/api/verify-payment', async (req, res) => {
    const { razorpay_order_id, razorpay_payment_id, razorpay_signature, uid, purpose } = req.body;

    const body = razorpay_order_id + "|" + razorpay_payment_id;
    const expectedSignature = crypto
        .createHmac("sha256", process.env.RAZORPAY_KEY_SECRET)
        .update(body.toString())
        .digest("hex");

    if (expectedSignature === razorpay_signature) {
        console.log(`Payment verified for user ${uid}, purpose: ${purpose || 'Pro status'}, payment ID: ${razorpay_payment_id}`);

        if (adminDb && uid) {
            try {
                if (purpose === 'ai_coach') {
                    // Reset AI Coach daily limit counter for today
                    const todayStr = new Date().toISOString().split('T')[0];
                    await adminDb.collection('users').doc(uid).update({
                        'aiCoachStats.lastDate': todayStr,
                        'aiCoachStats.count': 0,
                        'aiCoachStats.lastPaymentId': razorpay_payment_id
                    });
                    console.log(`Successfully reset AI Coach request limit for user ${uid}`);
                } else {
                    // Update Firestore to grant Pro status
                    await adminDb.collection('users').doc(uid).update({
                        isPro: true,
                        proGrantedAt: admin.firestore.FieldValue.serverTimestamp(),
                        paymentId: razorpay_payment_id,
                        orderId: razorpay_order_id
                    });
                    console.log(`Successfully granted Pro status to user ${uid}`);

                    // --- Referral Conversion Tracking ---
                    const userDoc = await adminDb.collection('users').doc(uid).get();
                    if (userDoc.exists && userDoc.data().referredBy) {
                        const referrerUid = userDoc.data().referredBy;
                        await adminDb.collection('users').doc(referrerUid)
                            .collection('referrals').doc(uid)
                            .update({
                                isPro: true,
                                convertedAt: admin.firestore.FieldValue.serverTimestamp()
                            }).catch(err => console.error("Failed to update referral conversion log:", err));
                        console.log(`Updated referral conversion for referrer ${referrerUid}`);
                    }
                }
            } catch (firestoreError) {
                console.error("Failed to update Firestore after payment:", firestoreError);
            }
        } else {
            console.warn("Firestore admin not available or no uid provided. Payment verified but not recorded in database.");
        }

        res.json({ success: true });
    } else {
        console.error("Payment signature verification failed");
        res.status(400).json({ success: false, error: "Invalid signature" });
    }
});

// --- AI Coach Endpoint ---
app.post('/api/ai-coach', async (req, res) => {
    const { uid, history } = req.body;
    if (!uid) {
        return res.status(400).json({ error: "Missing User ID (uid)." });
    }

    const todayStr = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
    let limitReached = false;
    let requestsRemaining = 2;

    if (adminDb) {
        try {
            const userDocRef = adminDb.collection('users').doc(uid);
            const userDoc = await userDocRef.get();
            if (userDoc.exists) {
                const userData = userDoc.data();
                const isPro = userData.isPro === true;
                const coachStats = userData.aiCoachStats || {};
                const lastDate = coachStats.lastDate || "";
                let count = coachStats.count || 0;

                if (lastDate === todayStr) {
                    if (count >= 2 && !isPro) {
                        limitReached = true;
                    }
                    requestsRemaining = Math.max(0, 2 - count);
                } else {
                    count = 0; // Reset for new day
                    requestsRemaining = 2;
                }

                if (!limitReached) {
                    count++;
                    await userDocRef.update({
                        'aiCoachStats.lastDate': todayStr,
                        'aiCoachStats.count': count
                    });
                    requestsRemaining = Math.max(0, 2 - count);
                }
            }
        } catch (err) {
            console.error("Error checking/updating AI limit in Firestore:", err);
        }
    }

    if (limitReached) {
        return res.json({
            limitReached: true,
            message: "You have used your 2 free AI planner requests for today. Unlock MoProPrep Pro for unlimited advice, or pay ₹10 to unlock an extra request."
        });
    }

    const geminiKey = process.env.GEMINI_API_KEY;
    let coachPlan = "";

    if (geminiKey) {
        try {
            const promptText = `
You are the MoProPrep AI Study Coach, an expert medical preparation mentor for the UPSC Combined Medical Services (CMS) exam which is scheduled for August 2, 2026.
Analyze the student's study history below and provide a concise, encouraging revision plan on individual basis.
History: ${JSON.stringify(history || [])}
Focus on high-weightage subjects: Medicine (Cardiology, Pulmonology), Surgery (General & Abdominal), OBGY (Antenatal Care, Labor), Pediatrics (Neonatology, Immunization), PSM (Epidemiology, Health Programs).
Suggest the exact top 1-2 topics they got wrong or have not solved that have high weightage and suggest they revise these first. Tell them to start a custom quiz for those topics.
Keep the response engaging, professional, and clear. Format in markdown.
`;
            const response = await axios.post(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${geminiKey}`, {
                contents: [{ parts: [{ text: promptText }] }]
            }, { headers: { 'Content-Type': 'application/json' }, timeout: 10000 });

            if (response.data && response.data.candidates && response.data.candidates[0].content.parts[0].text) {
                coachPlan = response.data.candidates[0].content.parts[0].text;
            } else {
                throw new Error("Invalid response structure from Gemini API");
            }
        } catch (geminiErr) {
            console.error("Gemini API error, falling back to local advisor logic:", geminiErr.message);
            coachPlan = getHeuristicPlan(history);
        }
    } else {
        coachPlan = getHeuristicPlan(history);
    }

    res.json({
        limitReached: false,
        requestsRemaining: requestsRemaining,
        plan: coachPlan
    });
});

function getHeuristicPlan(history) {
    const wrongTopics = {};
    if (Array.isArray(history)) {
        history.forEach(h => {
            if (h.isCorrect === false && h.topic) {
                wrongTopics[h.topic] = (wrongTopics[h.topic] || 0) + 1;
            }
        });
    }

    const sortedWrong = Object.entries(wrongTopics).sort((a, b) => b[1] - a[1]);
    if (sortedWrong.length > 0) {
        const topWrong = sortedWrong[0][0];
        return `### 🩺 UPSC CMS Personalized Study Plan

Hello Dr. Anuj! Based on your revision log, you have recently struggled with **${topWrong}**. 

**Why this matters:**
*   This topic holds high weightage in the UPSC CMS exam.
*   Getting this correct can lift your Paper score significantly.

**Your Action Plan:**
1.  **Immediate Revision:** Go back to your clinical notes for **${topWrong}**.
2.  **Custom Practice:** Head to the **Custom Quiz Builder** and select **${topWrong}** to test your updated understanding.
3.  **Peer Review:** Discuss any doubts with your **Study Squad** to solidify your concepts.

*Keep climbing, the exam is on August 2, 2026! 🏁*`;
    } else {
        return `### 🩺 UPSC CMS Study Plan

Hello Dr. Anuj! Let's build your active recall dashboard:

**Your Action Plan:**
1.  **Solve a Practice Set:** Complete at least 20 questions in the **CMS Learning Hub** under *Medicine* or *Pediatrics*.
2.  **Highlight Areas:** Once we record your performance, I will construct a tailored revision roadmap highlighting your exact weak areas.
3.  **Active Recall:** Focus on high-weightage chapters like **Cardiology** and **Neonatology** early.

*Exam Date: August 2, 2026. Let's make every solve count! 🏁*`;
    }
}


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
