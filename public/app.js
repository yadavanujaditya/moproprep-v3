document.addEventListener('DOMContentLoaded', () => {
    // --- State Management ---
    const state = {
        years: [],
        questions: [],
        currentQuestionIndex: 0,
        score: 0,
        currentYear: null,
        activeTag: null,
        mode: 'YEAR', // 'YEAR', 'SET', or 'SHUFFLE'
        sessionKey: null, // Unique key for localStorage
        // Test Mode (Exam Mode)
        testMode: false,           // true for exam mode, false for practice
        userAnswers: {},           // Store {questionIndex: selectedAnswer}
        timerEndTime: null,        // Timestamp when timer should end
        timerInterval: null,       // Interval ID for timer updates
        testSubmitted: false,      // Track if test was submitted
        reviewMode: false,         // Track if we're in review mode
        userRating: 0,             // Store current star selection
        bookmarks: []              // Store bookmarked question IDs or objects
    };

    // --- Helpers ---
    function getSavedProgress(key) {
        try {
            const item = localStorage.getItem(key);
            return item ? JSON.parse(item) : null;
        } catch (e) {
            console.error("Error parsing progress for key:", key, e);
            localStorage.removeItem(key); // Clear bad data
            return null;
        }
    }

    // --- Elements ---
    const els = {
        mainContent: document.getElementById('main-content'),
        views: {
            home: document.getElementById('home-view'),
            stateSelection: document.getElementById('state-selection-view'),
            yearSelection: document.getElementById('year-selection-view'),
            quiz: document.getElementById('quiz-view'),
            results: document.getElementById('results-view')
        },
        yearsGrid: document.getElementById('years-grid'),
        themeToggle: document.getElementById('checkbox'),
        homeLogo: document.getElementById('home-logo'),
        // Home Menu items
        btnPrevYear: document.getElementById('btn-prev-year'),
        btnProQuiz: document.getElementById('btn-pro-quiz'),
        btnBookmarksHeader: document.getElementById('btn-bookmarks-header'),
        backToHome: document.getElementById('back-to-home'),
        // Headings
        viewTitle: document.getElementById('view-title'),
        viewDesc: document.getElementById('view-desc'),
        // Quiz Elements
        questionText: document.getElementById('question-text'),
        optionsContainer: document.getElementById('options-container'),
        qYear: document.getElementById('q-year'),
        qCategory: document.getElementById('q-category'),
        progressFill: document.getElementById('progress-fill'),
        questionTracker: document.getElementById('question-tracker'),
        currentScore: document.getElementById('current-score'),
        backBtn: document.getElementById('back-to-years'),
        prevBtn: document.getElementById('prev-question-btn'),
        bookmarkBtn: document.getElementById('bookmark-btn'),
        // Feedback
        feedbackArea: document.getElementById('feedback-area'),
        feedbackText: document.getElementById('feedback-text'),
        explanationText: document.getElementById('explanation-text'),
        nextBtn: document.getElementById('next-btn'),
        // Results
        finalScore: document.getElementById('final-score'),
        totalQuestions: document.getElementById('total-questions'),
        performanceMsg: document.getElementById('performance-msg'),
        retryBtn: document.getElementById('retry-btn'),
        homeBtn: document.getElementById('home-btn')
    };

    // --- Init ---
    init();

    function init() {
        // loadYears(); // Removed initial load, now loaded on demand in selectMode
        setupEventListeners();
        checkTheme();
        initRatingSystem();
        loadBookmarks();

        // --- Auth Initialization ---
        AuthService.init((user) => {
            state.user = user;
            // Update logout link visibility
            const logoutLink = document.getElementById('logout-link');
            if (logoutLink) {
                logoutLink.style.display = user ? 'inline' : 'none';
            }
            // Update PRO badge visibility
            const proBadge = document.getElementById('pro-badge');
            if (proBadge) {
                proBadge.style.display = (user && user.isPro) ? 'inline' : 'none';
            }
            // Load cloud bookmarks if available
            loadCloudBookmarks();
        });
    }

    // --- Bookmarks Logic ---
    function loadBookmarks() {
        const saved = localStorage.getItem('moproprep_bookmarks');
        if (saved) {
            try {
                state.bookmarks = JSON.parse(saved);
            } catch (e) {
                console.error("Failed to parse bookmarks", e);
                state.bookmarks = [];
            }
        }
    }

    async function loadCloudBookmarks() {
        if (!state.user) return;
        try {
            const data = await AuthService.getProgress('bookmarks_sync');
            if (data && data.bookmarks) {
                // Merge or take cloud as truth? Let's merge simple strategy
                const cloudMap = new Map(data.bookmarks.map(q => [q.id, q]));
                state.bookmarks.forEach(q => {
                    if (!cloudMap.has(q.id)) data.bookmarks.push(q);
                });
                state.bookmarks = data.bookmarks;
                localStorage.setItem('moproprep_bookmarks', JSON.stringify(state.bookmarks));
            }
        } catch (e) {
            console.error("Failed to load cloud bookmarks", e);
        }
    }

    function toggleBookmark(e) {
        if (e) e.stopPropagation();

        const q = state.questions[state.currentQuestionIndex];
        if (!q) return;

        // Use a unique ID
        const qId = q.id || `${q.year}_${q.category}_${q.question_text.substring(0, 20)}`;
        const index = state.bookmarks.findIndex(b => (b.id === qId));

        if (index > -1) {
            state.bookmarks.splice(index, 1);
            els.bookmarkBtn.classList.remove('active');
        } else {
            // Store enough info to render later
            const bookmark = {
                id: qId,
                question_text: q.question_text || q.questionText,
                options: q.options,
                correct_answer: q.correct_answer || q.correctAnswer,
                explanation: q.explanation,
                year: q.year,
                tags: q.tags
            };
            state.bookmarks.push(bookmark);
            els.bookmarkBtn.classList.add('active');
        }

        localStorage.setItem('moproprep_bookmarks', JSON.stringify(state.bookmarks));

        // Sync to cloud
        if (state.user) {
            AuthService.saveProgress('bookmarks_sync', { bookmarks: state.bookmarks });
        }
    }

    // --- API Calls ---
    async function loadYears(tag = null) {
        try {
            const url = tag ? `/api/years?tag=${tag}` : '/api/years';
            const res = await fetch(url);
            const data = await res.json();
            state.years = data;
            renderYears(); // Render immediately after loading
        } catch (err) {
            console.error('Failed to load years:', err);
            els.yearsGrid.innerHTML = '<p class="error">Failed to load quizzes. Please try again later.</p>';
        }
    }

    async function loadQuestions(year) {
        try {
            state.mode = 'YEAR';
            state.sessionKey = `progress_year_${year}_${state.activeTag}`;
            const url = `/api/questions/${year}${state.activeTag ? `?tags=${state.activeTag}` : ''}`;
            const res = await fetch(url);
            const data = await res.json();

            let filteredData = data;

            // Strict Client-Side Filtering to prevent crossover
            if (state.activeTag) {
                const tag = state.activeTag.toLowerCase();

                // Helper to safely check tags
                const hasInfo = (q, t) => q.tags && q.tags.some(x => x.toLowerCase() === t);

                if (tag === 'haryanamo') {
                    // Show ONLY if it has haryanamo AND does NOT have rajasthanmo or upscmo
                    filteredData = data.filter(q =>
                        hasInfo(q, 'haryanamo') &&
                        !hasInfo(q, 'rajasthanmo') &&
                        !hasInfo(q, 'upscmo')
                    );
                } else if (tag === 'rajasthanmo') {
                    // Show ONLY if it has rajasthanmo AND does NOT have haryanamo or upscmo
                    filteredData = data.filter(q =>
                        hasInfo(q, 'rajasthanmo') &&
                        !hasInfo(q, 'haryanamo') &&
                        !hasInfo(q, 'upscmo')
                    );
                } else if (tag === 'upscmo') {
                    // Show ONLY if it has upscmo AND does NOT have haryanamo or rajasthanmo
                    filteredData = data.filter(q =>
                        hasInfo(q, 'upscmo') &&
                        !hasInfo(q, 'haryanamo') &&
                        !hasInfo(q, 'rajasthanmo')
                    );
                }
            }

            if (!filteredData || filteredData.length === 0) {
                alert('No questions found for this selection.');
                return;
            }

            state.questions = filteredData.sort((a, b) => (a.id || 0) - (b.id || 0));
            state.currentYear = year;
            startQuiz();
        } catch (err) {
            console.error('Failed to load questions:', err);
            alert('Error loading questions.');
        }
    }

    async function loadQuestionsByTag(tag, isShuffle = false) {
        try {
            const res = await fetch(`/api/tags/${tag}`);
            const data = await res.json();

            if (!data || data.length === 0) {
                alert('No questions found for this selection.');
                return [];
            }

            if (isShuffle) {
                state.mode = 'SHUFFLE';
                state.sessionKey = `progress_shuffle_${tag}`;

                // Load existing progress if any
                const saved = getSavedProgress(state.sessionKey);

                // If we have saved questions, use them. Otherwise pick 50 random ones.
                if (saved && saved.questions && Array.isArray(saved.questions) && saved.questions.length > 0) {
                    state.questions = saved.questions;
                } else {
                    const shuffled = shuffleArray([...data]);
                    state.questions = shuffled.slice(0, 50);
                }

                startQuiz();
            } else {
                return data.sort((a, b) => (a.id || 0) - (b.id || 0));
            }
        } catch (err) {
            console.error('Failed to load questions by tag:', err);
            return [];
        }
    }

    // --- Logic & Rendering ---
    function selectMode(tag, title, desc, mode = 'YEAR') {
        state.activeTag = tag;
        state.mode = mode;
        els.viewTitle.innerText = title;
        els.viewDesc.innerText = desc;

        if (mode === 'SET') {
            renderSets(tag);
        } else {
            // Load years specifically filtered for this tag
            els.yearsGrid.innerHTML = '<div class="loader"></div>';
            loadYears(tag);
        }
        switchView('yearSelection');
    }

    function renderYears() {
        els.yearsGrid.innerHTML = '';
        state.years.forEach(year => {
            const card = document.createElement('div');
            card.className = 'year-card';

            // Progress check
            const key = `progress_year_${year.year}_${state.activeTag}`;
            const saved = getSavedProgress(key);
            const progressInfo = saved ? `<div class="card-status">Progress: ${saved.index + 1}/${saved.total}</div>` : '';

            card.innerHTML = `
                <div class="year-title">${year.year}</div>
                <div class="year-desc">${year.description || 'Practice Questions'}</div>
                ${progressInfo}
            `;
            card.onclick = async () => {
                const yStr = year.year.toString();

                // Specific Logic for Rajasthan MO
                if (state.activeTag === 'rajasthanmo') {
                    // Free years: 2019, 2020 (no login required check here specifically, or just no Pro check)
                    // If strict "free accessible to all" means public, we skip checks.
                    if (['2019', '2020'].includes(yStr)) {
                        // Free, proceed.
                    }
                    // Pro years: 2015, 2016, 2018
                    else if (['2015', '2016', '2018'].includes(yStr)) {
                        // Must be Pro
                        if (!AuthService.isLoggedIn()) {
                            alert("This year is for Pro members only. Please login.");
                            const user = await AuthService.login();
                            if (!user) return;
                        }

                        if (!AuthService.isPro()) {
                            alert("This specific year is locked for Pro members only.");
                            // Trigger Payment Flow
                            if (AuthService.user && AuthService.user.email) {
                                PaymentService.initiatePayment(AuthService.user.email, () => {
                                    loadQuestions(year.year);
                                });
                            }
                            return;
                        }
                    }
                    // For any other years in Rajasthan not mentioned, we fall back to standard behavior or open.
                    // Assuming open for now unless listed.
                } else {
                    // Standard Logic for other categories
                    const restrictedYears = ['2020', '2022'];
                    if (restrictedYears.includes(yStr) && !AuthService.isLoggedIn()) {
                        const user = await AuthService.login();
                        if (!user) return;
                    }
                }

                loadQuestions(year.year);
            };
            els.yearsGrid.appendChild(card);
        });
    }

    async function renderSets(tag) {
        els.yearsGrid.innerHTML = '<div class="loader"></div>';
        const allQuestions = await loadQuestionsByTag(tag);
        els.yearsGrid.innerHTML = '';

        // Separate Mock Tests if tag is 'practiseset'
        let regularQuestions = allQuestions;
        let mockQuestions = [];
        let currentAffairsQuestions = [];
        let freqAskedQuestions = [];

        if (tag === 'practiseset') {
            // Helper for case-insensitive tag check
            const hasTag = (q, partialTag) => q.tags && q.tags.some(t => t.toLowerCase().includes(partialTag.toLowerCase()));

            // 1. Extract Special Groups
            mockQuestions = allQuestions.filter(q => q.tags && q.tags.includes('mocktest'));

            // Current Affairs (Moved/Separated)
            currentAffairsQuestions = allQuestions.filter(q => hasTag(q, 'current affairs'));

            // Frequently Asked (Copied/Duplicated)
            freqAskedQuestions = allQuestions.filter(q => hasTag(q, 'frequently asked'));

            // 2. Define Regular Questions 
            // Exclude Mock Tests AND Current Affairs (but keep Frequently Asked as they are just copied)
            regularQuestions = allQuestions.filter(q => {
                const isMock = q.tags && q.tags.includes('mocktest');
                const isCA = hasTag(q, 'current affairs');
                return !isMock && !isCA;
            });


        }

        // ADD EXTRA CARD FIRST: Previous Year Shuffle
        const sKey = `progress_shuffle_haryanamo`;
        const sSaved = getSavedProgress(sKey);
        const sStatus = sSaved ? `<div class="card-status">Progress: ${sSaved.index + 1}/${sSaved.total}</div>` : '';

        const shuffleCard = document.createElement('div');
        shuffleCard.className = 'year-card';
        shuffleCard.style.border = '1px solid var(--secondary)';
        shuffleCard.innerHTML = `
            <div class="year-title">🔄 Shuffle</div>
            <div class="year-desc">Random mix of 50 Questions from Past Papers</div>
            ${sStatus}
        `;
        shuffleCard.onclick = () => loadQuestionsByTag('haryanamo', true);
        els.yearsGrid.appendChild(shuffleCard);

        // --- ADD SPECIAL CARDS (Current Affairs & Frequently Asked) ---
        if (currentAffairsQuestions.length > 0) {
            const caKey = `progress_special_current_affairs`;
            const caSaved = getSavedProgress(caKey);
            const caStatus = caSaved ? `<div class="card-status">Progress: ${caSaved.index + 1}/${caSaved.total}</div>` : '';

            const caCard = document.createElement('div');
            caCard.className = 'year-card';
            caCard.style.border = '1px solid var(--info, #17a2b8)';
            caCard.innerHTML = `
                <div class="year-title">📰 Current Affairs</div>
                <div class="year-desc">Latest updates and events (${currentAffairsQuestions.length})</div>
                ${caStatus}
            `;
            caCard.onclick = () => {
                state.mode = 'SET';
                state.sessionKey = caKey;
                state.questions = currentAffairsQuestions;
                startQuiz();
            };
            els.yearsGrid.appendChild(caCard);
        }

        if (freqAskedQuestions.length > 0) {
            const freqKey = `progress_special_freq_asked`;
            const freqSaved = getSavedProgress(freqKey);
            const freqStatus = freqSaved ? `<div class="card-status">Progress: ${freqSaved.index + 1}/${freqSaved.total}</div>` : '';

            const freqCard = document.createElement('div');
            freqCard.className = 'year-card';
            freqCard.style.border = '1px solid var(--success, #28a745)';
            freqCard.innerHTML = `
                <div class="year-title">🔥 Frequently Asked</div>
                <div class="year-desc">High yield questions (${freqAskedQuestions.length})</div>
                ${freqStatus}
            `;
            freqCard.onclick = () => {
                state.mode = 'SET';
                state.sessionKey = freqKey;
                state.questions = freqAskedQuestions;
                startQuiz();
            };
            els.yearsGrid.appendChild(freqCard);
        }

        // ADD MOCK TEST CARD if we have mock questions
        if (mockQuestions.length > 0) {
            const mockCard = document.createElement('div');
            mockCard.className = 'year-card';
            mockCard.style.border = '1px solid var(--accent, #FFD700)';
            mockCard.innerHTML = `
                <div class="year-title">📝 Mock Test</div>
                <div class="year-desc">Practice with structured mock test papers</div>
            `;
            mockCard.onclick = () => renderMockTests(tag, mockQuestions);
            els.yearsGrid.appendChild(mockCard);
        }

        if (!regularQuestions || regularQuestions.length === 0) {
            return;
        }

        const setSize = 50;
        const totalSets = Math.ceil(regularQuestions.length / setSize);

        for (let i = 0; i < totalSets; i++) {
            const setQuestions = regularQuestions.slice(i * setSize, (i + 1) * setSize);
            const key = `progress_set_${tag}_${i}`;
            const saved = getSavedProgress(key);
            const progressInfo = saved ? `<div class="card-status">Progress: ${saved.index + 1}/${saved.total}</div>` : '';

            const card = document.createElement('div');
            card.className = 'year-card';
            card.innerHTML = `
                <div class="year-title">Set ${i + 1}</div>
                <div class="year-desc">Questions ${i * setSize + 1} - ${Math.min((i + 1) * setSize, regularQuestions.length)}</div>
                ${progressInfo}
            `;
            card.onclick = () => {
                state.mode = 'SET';
                state.sessionKey = key;
                state.questions = setQuestions;
                startQuiz();
            };
            els.yearsGrid.appendChild(card);
        }
    }

    function renderMockTests(tag, mockQuestions) {
        els.yearsGrid.innerHTML = '';

        // BACK CARD
        const backCard = document.createElement('div');
        backCard.className = 'year-card';
        backCard.style.opacity = '0.8';
        backCard.innerHTML = `
            <div class="year-title">⬅️ Back</div>
            <div class="year-desc">Return to Pro Menu</div>
        `;
        backCard.onclick = () => renderSets(tag);
        els.yearsGrid.appendChild(backCard);

        // Group by paper tag (mocktest1, mocktest2, etc.)
        const papers = {};
        mockQuestions.forEach(q => {
            const paperTag = q.tags.find(t => t.startsWith('mocktest') && t !== 'mocktest');
            if (paperTag) {
                if (!papers[paperTag]) papers[paperTag] = [];
                papers[paperTag].push(q);
            }
        });

        // Sort papers by name (mocktest1, mocktest10, etc. - simple sort)
        const sortedPaperTags = Object.keys(papers).sort((a, b) => {
            const numA = parseInt(a.replace('mocktest', '')) || 0;
            const numB = parseInt(b.replace('mocktest', '')) || 0;
            return numA - numB;
        });

        sortedPaperTags.forEach(paperTag => {
            const paperQuestions = papers[paperTag];
            const paperName = paperTag.replace('mocktest', 'Mock Test ');
            const displayPaperName = paperName.charAt(0).toUpperCase() + paperName.slice(1);

            const key = `progress_mock_${paperTag}`;
            const saved = getSavedProgress(key);
            const progressInfo = saved ? `<div class="card-status">Progress: ${saved.index + 1}/${saved.total}</div>` : '';

            const card = document.createElement('div');
            card.className = 'year-card';
            card.innerHTML = `
                <div class="year-title">${displayPaperName}</div>
                <div class="year-desc">${paperQuestions.length} Questions</div>
                ${progressInfo}
            `;
            card.onclick = () => {
                state.mode = 'SET';
                state.sessionKey = key;
                state.questions = paperQuestions;
                // Start in EXAM MODE for mock tests
                startTestMode();
            };
            els.yearsGrid.appendChild(card);
        });
    }

    // --- Test Mode Logic ---
    function startTestMode() {
        // Confirmation / Instructions
        const msg = "Starting Mock Test Mode:\n\n- 90 Minutes Timer\n- No immediate answers\n- Submit at the end to see results\n\nReady to begin?";
        if (!confirm(msg)) return;

        state.testMode = true;
        state.userAnswers = {};
        state.testSubmitted = false;
        state.reviewMode = false;

        // 90 Minutes = 5400 seconds
        state.timerEndTime = Date.now() + 90 * 60 * 1000;

        if (state.timerInterval) clearInterval(state.timerInterval);
        state.timerInterval = setInterval(updateTimer, 1000);

        // Show Test UI elements
        document.getElementById('test-timer').style.display = 'flex';
        document.getElementById('submit-test-btn').style.display = 'block';
        document.getElementById('score-container').style.display = 'none';
        document.getElementById('question-navigator').style.display = 'flex';

        startQuiz();
    }

    function updateTimer() {
        if (!state.timerEndTime) return;

        const now = Date.now();
        const diff = state.timerEndTime - now;

        if (diff <= 0) {
            clearInterval(state.timerInterval);
            document.getElementById('timer-display').innerText = "00:00";
            alert("Time's up! Submitting test automatically.");
            submitTest();
            return;
        }

        const minutes = Math.floor(diff / 60000);
        const seconds = Math.floor((diff % 60000) / 1000);

        const display = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
        const timerEl = document.getElementById('timer-display');
        const timerContainer = document.getElementById('test-timer');

        timerEl.innerText = display;

        // Visual warnings
        if (minutes < 10) {
            timerContainer.classList.add('warning');
        }
        if (minutes < 1) {
            timerContainer.classList.remove('warning');
            timerContainer.classList.add('critical');
        }
    }

    function submitTest() {
        if (!confirm("Are you sure you want to submit the test?")) return;

        clearInterval(state.timerInterval);
        state.testSubmitted = true;

        // Calculate Score
        let correctCount = 0;
        state.questions.forEach((q, index) => {
            const userAns = state.userAnswers[index];
            if (userAns && userAns === (q.correct_answer || q.correctAnswer)) {
                correctCount++;
            }
        });
        state.score = correctCount;

        showResults();
    }

    async function startQuiz() {
        // IMPORTANT: Reset testMode for non-Mock-Test quizzes
        // Mock Tests call startTestMode() BEFORE startQuiz(), which sets testMode = true
        // All other quiz types call startQuiz() directly, so we reset here
        if (!state.testMode) {
            state.testMode = false;
            state.testSubmitted = false;
            state.userAnswers = {};
            state.reviewMode = false;
        }

        if (!state.questions || state.questions.length === 0) {
            alert("No questions available to start the quiz.");
            switchView('home');
            return;
        }

        let saved = getSavedProgress(state.sessionKey);

        // SYNC: Check cloud progress if logged in
        if (AuthService.isLoggedIn()) {
            try {
                const cloudSaved = await AuthService.getProgress(state.sessionKey);
                if (cloudSaved) {
                    console.log("Cloud progress found for", state.sessionKey, cloudSaved);
                    // If cloud has data, and we either have no local data OR cloud is ahead/equal
                    // We just take Cloud as source of truth if it exists, to support switching devices easily.
                    // But if local is ahead (e.g. played offline), we might want to keep local.
                    // Let's use simple logic: Take whichever has higher index.
                    if (!saved || (cloudSaved.index > saved.index)) {
                        saved = cloudSaved;
                        // Update local to match cloud so we have it for next reload
                        localStorage.setItem(state.sessionKey, JSON.stringify(saved));
                    }
                }
            } catch (err) {
                console.error("Error fetching cloud progress:", err);
            }
        }

        if (saved && saved.index < saved.total - 1) {
            const msg = `You have saved progress (${saved.index + 1}/${saved.total}).\n\n- OK to RESUME where you left off.\n- CANCEL to RESET and start a new quiz.`;
            if (confirm(msg)) {
                // Resume
                state.currentQuestionIndex = saved.index;
                state.score = saved.score;
                // If saved has questions (SHUFFLE mode), restore them
                if (saved.questions && Array.isArray(saved.questions)) {
                    state.questions = saved.questions;
                }
            } else {
                // Reset
                state.currentQuestionIndex = 0;
                state.score = 0;
                localStorage.removeItem(state.sessionKey);
                // If we were in shuffle mode, we actually want FRESH questions now
                if (state.mode === 'SHUFFLE') {
                    // We need to re-trigger loadQuestionsByTag to get fresh shuffle?
                    // Or just shuffle the current ones? Let's just shuffle current ones for speed.
                    state.questions = shuffleArray([...state.questions]);
                }
            }
        } else {
            state.currentQuestionIndex = 0;
            state.score = 0;
        }

        // Reset Timer UI if NOT test mode (or fresh start handled in startTestMode)
        if (!state.testMode) {
            if (state.timerInterval) clearInterval(state.timerInterval);
            document.getElementById('test-timer').style.display = 'none';
            document.getElementById('submit-test-btn').style.display = 'none';
            document.getElementById('score-container').style.display = 'block';
            document.getElementById('question-navigator').style.display = 'none';
        }

        els.currentScore.innerText = state.score;
        switchView('quiz');
        renderQuestion();

        if (state.testMode) {
            renderQuestionNavigator();
            // Setup Submit Button
            document.getElementById('submit-test-btn').onclick = submitTest;
        }
    }

    function renderQuestionNavigator() {
        const nav = document.getElementById('question-navigator');
        if (!nav) return;
        nav.innerHTML = '';

        state.questions.forEach((q, i) => {
            const btn = document.createElement('button');
            btn.innerText = i + 1;

            // Build class list
            let classes = ['nav-btn'];

            // 1. Current Question Highlight
            // Use abstract equality (==) to handle potential string/number mismatches
            if (i == state.currentQuestionIndex) {
                classes.push('current');
            }

            // 2. Mode-specific coloring
            const userAns = state.userAnswers[i];

            if (state.testMode && state.testSubmitted) {
                // --- REVIEW MODE ---
                const correctAns = q.correct_answer || q.correctAnswer;

                if (!userAns) {
                    classes.push('review-unanswered'); // Yellow
                } else if (userAns === correctAns) {
                    classes.push('review-correct'); // Green
                } else {
                    classes.push('review-wrong'); // Red
                }
            } else {
                // --- EXAM MODE ---
                // In Exam mode, we show "Answered" status (Blue or standard color)
                if (userAns) {
                    classes.push('answered');
                }
            }

            btn.className = classes.join(' ');

            btn.onclick = () => {
                state.currentQuestionIndex = i;
                renderQuestion();
                renderQuestionNavigator();
            };

            nav.appendChild(btn);
        });
    }

    function saveProgress() {
        if (!state.sessionKey) return;
        const progress = {
            index: state.currentQuestionIndex,
            score: state.score,
            total: state.questions.length,
            // If in shuffle mode, we must save the specific 50 questions we picked
            questions: state.mode === 'SHUFFLE' ? state.questions : null
        };
        localStorage.setItem(state.sessionKey, JSON.stringify(progress));

        // SYNC: Save to cloud if logged in
        if (AuthService.isLoggedIn()) {
            AuthService.saveProgress(state.sessionKey, progress);
        }
    }

    function clearProgress() {
        if (state.sessionKey) {
            localStorage.removeItem(state.sessionKey);
        }
    }

    function renderQuestion() {
        if (!state.questions[state.currentQuestionIndex]) {
            console.error("Question not found at index:", state.currentQuestionIndex);
            showResults();
            return;
        }
        const q = state.questions[state.currentQuestionIndex];

        // Reset UI - PROPERLY hide and clear feedback
        els.feedbackArea.style.display = 'none';
        els.feedbackText.innerText = '';
        els.explanationText.innerHTML = '';
        els.optionsContainer.innerHTML = '';
        els.nextBtn.onclick = nextQuestion;

        // Remove old 'Save & Next' if exists (cleaning up dynamic buttons)
        const oldSaveBtn = document.getElementById('save-next-btn');
        if (oldSaveBtn) oldSaveBtn.remove();

        // Content
        els.questionText.innerText = q.question_text || q.questionText;
        const displayYear = (q.year && q.year.toString() !== '0' && q.year.toString() !== '0000') ? q.year : 'Practice Question';
        els.qYear.innerText = displayYear;
        els.qCategory.innerText = (q.tags && q.tags[0]) ? q.tags[0] : 'General';

        // Bookmark status
        const qId = q.id || `${q.year}_${q.category}_${q.question_text.substring(0, 20)}`;
        const isBookmarked = state.bookmarks.some(b => b.id === qId);
        if (els.bookmarkBtn) {
            if (isBookmarked) {
                els.bookmarkBtn.classList.add('active');
            } else {
                els.bookmarkBtn.classList.remove('active');
            }
        }

        // Progress
        const progress = ((state.currentQuestionIndex) / state.questions.length) * 100;
        els.progressFill.style.width = `${progress}%`;
        els.questionTracker.innerText = `${state.currentQuestionIndex + 1} / ${state.questions.length}`;

        // Previous Button Visibility
        els.prevBtn.style.display = (state.currentQuestionIndex > 0) ? 'block' : 'none';

        // Options
        const options = q.options; // Object like {A: "...", B: "..."}

        // Check if answered
        const savedAnswer = state.userAnswers[state.currentQuestionIndex];
        const correctKey = q.correct_answer || q.correctAnswer;

        Object.keys(options).forEach(key => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';

            // In Test Mode/Review Mode, show selection
            if (state.testMode) {
                if (savedAnswer === key) btn.classList.add('selected');

                // If Review Mode (Submitted), show correct/wrong
                if (state.testSubmitted) {
                    const isCorrect = (key === correctKey);
                    const isSelected = (savedAnswer === key);

                    if (isCorrect) btn.classList.add('review-correct');
                    if (isSelected && !isCorrect) btn.classList.add('review-wrong');
                }
            } else if (savedAnswer) {
                // Practice Mode - Answered state (when going back)
                const isCorrect = savedAnswer === correctKey;
                if (key === correctKey) btn.classList.add('correct');
                if (key === savedAnswer && !isCorrect) btn.classList.add('wrong');
                btn.disabled = true;
            }

            btn.innerHTML = `<span class="option-letter">${key}</span> ${options[key]}`;

            // Interaction logic
            if ((state.testMode && state.testSubmitted) || (!state.testMode && savedAnswer)) {
                btn.disabled = true; // Answered practice mode or review mode is read-only
            } else {
                btn.onclick = () => handleAnswer(key, correctKey, q.explanation);
            }

            els.optionsContainer.appendChild(btn);
        });

        // Test Mode: Add "Save & Next" Button below options
        if (state.testMode && !state.testSubmitted) {
            const saveBtn = document.createElement('button');
            saveBtn.id = 'save-next-btn';
            saveBtn.className = 'primary-btn';
            saveBtn.style.marginTop = '1rem';
            saveBtn.innerText = state.currentQuestionIndex === state.questions.length - 1 ? 'Finish Test section' : 'Save & Next';
            saveBtn.onclick = () => {
                nextQuestion();
            };
            els.optionsContainer.appendChild(saveBtn);
        }

        // Show explanation if answered (Practice Mode or Review Mode)
        if (savedAnswer && (state.testSubmitted || !state.testMode)) {
            const explanation = q.explanation;
            if (explanation) {
                const processed = explanation
                    .replace(/\\n/g, '\n')
                    .replace(/\[cite:\s*[^\]]+\]/g, '')
                    .replace(/✅|❌/g, '')
                    .trim();
                els.explanationText.innerHTML = marked.parse(processed);
                els.feedbackArea.style.display = 'block';

                if (state.testMode) {
                    els.feedbackText.style.display = 'none';
                    els.nextBtn.style.display = 'none';
                } else {
                    // Practice Mode
                    const isCorrect = savedAnswer === correctKey;
                    els.feedbackText.innerText = isCorrect ? 'Correct! 🎉' : `Incorrect. The correct answer is ${correctKey}.`;
                    els.feedbackText.style.color = isCorrect ? 'var(--secondary)' : 'var(--danger)';
                    els.feedbackText.style.display = 'block';
                    els.nextBtn.style.display = 'block';
                }
            } else if (!state.testMode) {
                els.explanationText.innerHTML = '<p>No explanation available.</p>';
                els.feedbackArea.style.display = 'block';
                els.nextBtn.style.display = 'block';
            }
        }
    }

    function handleAnswer(selectedKey, correctKey, explanation) {
        state.userAnswers[state.currentQuestionIndex] = selectedKey;

        if (state.testMode) {
            // EXAM MODE LOGIC

            // Update UI (select button)
            const buttons = els.optionsContainer.querySelectorAll('.option-btn');
            buttons.forEach(btn => {
                const letter = btn.querySelector('.option-letter').innerText;
                btn.classList.remove('selected');
                if (letter === selectedKey) btn.classList.add('selected');
            });

            // Update Navigator
            renderQuestionNavigator();
            return; // EXIT - do not show feedback
        }

        // PRACTICE MODE LOGIC (Original)
        // Disable all buttons
        const buttons = els.optionsContainer.querySelectorAll('.option-btn');
        buttons.forEach(btn => btn.disabled = true);

        const isCorrect = selectedKey === correctKey;

        // Highlight logic
        buttons.forEach(btn => {
            const letter = btn.querySelector('.option-letter').innerText;
            if (letter === correctKey) btn.classList.add('correct');
            if (letter === selectedKey && !isCorrect) btn.classList.add('wrong');
        });

        if (isCorrect) {
            state.score++;
            els.currentScore.innerText = state.score;
            els.feedbackText.innerText = 'Correct! 🎉';
            els.feedbackText.style.color = 'var(--secondary)';
        } else {
            els.feedbackText.innerText = `Incorrect. The correct answer is ${correctKey}.`;
            els.feedbackText.style.color = 'var(--danger)';
        }

        if (explanation) {
            // Process literal \n, remove citations [cite: ...], and remove ticks/crosses
            const processedExplanation = explanation
                .replace(/\\n/g, '\n')
                .replace(/\[cite:\s*[^\]]+\]/g, '') // Remove citations
                .replace(/✅|❌/g, '')              // Remove marks
                .trim();

            els.explanationText.innerHTML = marked.parse(processedExplanation);
        } else {
            els.explanationText.innerHTML = '<p>No explanation available.</p>';
        }

        els.feedbackArea.style.display = 'block';

        // Save progress after answering
        saveProgress();

        // Track question solve in Firestore for Admin Stats
        if (AuthService.isLoggedIn() && isCorrect) {
            const qId = q.id || q.ID;
            if (qId) {
                db.collection('stats').doc('questions').collection(qId.toString()).doc(AuthService.user.uid).set({
                    solvedAt: firebase.firestore.FieldValue.serverTimestamp()
                }, { merge: true });
            }
        }

        // Scroll to feedback (mobile friendly)
        els.feedbackArea.scrollIntoView({ behavior: 'smooth' });
    }

    function previousQuestion() {
        if (state.currentQuestionIndex > 0) {
            state.currentQuestionIndex--;
            renderQuestion();
            if (state.testMode) {
                renderQuestionNavigator();
            }
        }
    }

    function nextQuestion() {
        state.currentQuestionIndex++;
        if (state.currentQuestionIndex < state.questions.length) {
            renderQuestion();
            // Force Navigator Update in Test Mode to sync highlight
            if (state.testMode) {
                renderQuestionNavigator();
            }
        } else {
            showResults();
        }
    }

    function showResults() {
        if (state.testMode && !state.testSubmitted) {
            // If manual navigation reached end, prompt submit
            submitTest();
            return;
        }

        switchView('results');
        els.finalScore.innerText = state.score;
        els.totalQuestions.innerText = state.questions.length;

        // Stop timer
        if (state.timerInterval) clearInterval(state.timerInterval);

        // Clear progress when quiz is finished
        clearProgress();

        const percentage = (state.score / state.questions.length) * 100;
        if (percentage >= 80) els.performanceMsg.innerText = "Outstanding! You're a pro! 🌟";
        else if (percentage >= 50) els.performanceMsg.innerText = "Good job! Keep practicing. 👍";
        else els.performanceMsg.innerText = "Keep studying, you'll get there! 📚";

        // Add Review Button for Test Mode
        if (state.testMode) {
            els.retryBtn.innerText = "Review Answers";
            els.retryBtn.onclick = () => {
                state.currentQuestionIndex = 0;
                switchView('quiz');
                renderQuestion();
                renderQuestionNavigator();
            }
        } else {
            els.retryBtn.innerText = "Try Again";
            els.retryBtn.onclick = () => startQuiz();
        }
    }

    // --- Helpers ---
    function switchView(viewName) {
        Object.values(els.views).forEach(el => {
            el.classList.remove('active-view');
            el.classList.add('hidden-view');
        });

        const target = els.views[viewName];
        if (target) {

            target.classList.remove('hidden-view');
            target.classList.add('active-view');

            // Notify Analytics Tracker
            if (window.AnalyticsTracker) {
                const viewLabels = {
                    home: 'Home',
                    stateSelection: 'State Selection',
                    yearSelection: 'Year Selection',
                    quiz: 'Quiz',
                    results: 'Results'
                };
                window.AnalyticsTracker.setView(viewLabels[viewName] || viewName);
            }
        }
    }


    function setupEventListeners() {
        // Home Menu Navigation
        els.btnPrevYear.onclick = async () => {
            switchView('stateSelection');
            await checkStatesAvailability();
        };

        async function checkStatesAvailability() {
            const tags = ['haryanamo', 'rajasthanmo', 'upscmo'];
            const btnIds = {
                'haryanamo': 'btn-pyq-haryana',
                'rajasthanmo': 'btn-pyq-rajasthan',
                'upscmo': 'btn-pyq-upsc'
            };

            // Show a loader or just handle per button
            for (const tag of tags) {
                const btn = document.getElementById(btnIds[tag]);
                if (!btn) continue;

                try {
                    const res = await fetch(`/api/tags/${tag}`);
                    const data = await res.json();
                    if (data && data.length > 0) {
                        btn.style.display = 'flex';
                    } else {
                        btn.style.display = 'none';
                    }
                } catch (err) {
                    console.error(`Check failed for ${tag}:`, err);
                    // Default to hidden if check fails? Or visible? Let's keep visible on error just in case.
                    btn.style.display = 'flex';
                }
            }
        }

        document.getElementById('btn-pyq-haryana').onclick = () => {
            selectMode('haryanamo', 'Previous Year Question Haryana', 'Practice with real state MO exam questions from Haryana.', 'YEAR');
        };

        document.getElementById('btn-pyq-rajasthan').onclick = () => {
            selectMode('rajasthanmo', 'Previous Year Question Rajasthan', 'Practice with real state MO exam questions from Rajasthan.', 'YEAR');
        };

        document.getElementById('btn-pyq-upsc').onclick = () => {
            selectMode('upscmo', 'Previous Year Question UPSC', 'Practice with real UPSC Medical Officer (MO) exam questions.', 'YEAR');
        };

        document.getElementById('back-to-home-from-state').onclick = () => switchView('home');

        els.btnProQuiz.onclick = async () => {
            try {
                if (!AuthService.isLoggedIn()) {
                    const user = await AuthService.login();
                    if (!user) return;
                }

                // Force checks against AuthService.user directly
                if (AuthService.isPro()) {
                    selectMode('practiseset', 'MoProPrep Pro', 'Challenge yourself with structured practice sets.', 'SET');
                } else {
                    if (!AuthService.user || !AuthService.user.email) {
                        alert("User session invalid. Please refresh.");
                        return;
                    }
                    // Trigger Razorpay for non-pro users
                    PaymentService.initiatePayment(AuthService.user.email, () => {
                        // Callback on success - directly go to practice sets!
                        selectMode('practiseset', 'MoProPrep Pro', 'Challenge yourself with structured practice sets.', 'SET');
                    });
                }
            } catch (err) {
                console.error("Pro button error:", err);
                alert("Something went wrong: " + err.message);
            }
        };

        if (els.btnBookmarksHeader) {
            els.btnBookmarksHeader.onclick = loadBookmarksQuiz;
        }

        if (els.bookmarkBtn) {
            els.bookmarkBtn.onclick = toggleBookmark;
        }

        els.backToHome.onclick = () => switchView('home');
        els.homeLogo.onclick = () => switchView('home');

        // Other Nav
        els.backBtn.onclick = () => {
            if (state.mode === 'SHUFFLE' || state.mode === 'BOOKMARKS') {
                switchView('home');
            } else {
                switchView('yearSelection');
            }
        };
        els.prevBtn.onclick = previousQuestion;
        els.retryBtn.onclick = () => startQuiz();
        els.homeBtn.onclick = () => switchView('home');

        // Logout Link
        const logoutLink = document.getElementById('logout-link');
        if (logoutLink) {
            logoutLink.onclick = (e) => {
                e.preventDefault();
                AuthService.logout();
            };
        }

        // Add a global clear for debugging/resetting if needed
        const resetProgressBtn = document.createElement('button');
        resetProgressBtn.className = 'secondary-btn';
        resetProgressBtn.innerText = 'Reset All Data';
        resetProgressBtn.style.marginTop = '1rem';
        resetProgressBtn.onclick = () => {
            if (confirm("This will permanently clear ALL your saved progress and scores. Proceed?")) {
                localStorage.clear();
                alert("All progress cleared.");
                location.reload();
            }
        };
        els.views.home.appendChild(resetProgressBtn);

        els.themeToggle.addEventListener('change', toggleTheme);
    }

    function toggleTheme(e) {
        const next = e.target.checked ? 'light' : 'dark';
        document.body.setAttribute('data-theme', next);
        localStorage.setItem('theme', next);
    }

    function checkTheme() {
        const savedTheme = localStorage.getItem('theme') || 'dark';
        document.body.setAttribute('data-theme', savedTheme);
        els.themeToggle.checked = (savedTheme === 'light');
    }

    function loadBookmarksQuiz() {
        if (state.bookmarks.length === 0) {
            alert("No bookmarks found. Start saving questions to view them here!");
            return;
        }

        state.mode = 'BOOKMARKS';
        state.sessionKey = 'progress_bookmarks';
        state.questions = [...state.bookmarks];
        state.activeTag = 'bookmarks';

        startQuiz();
    }

    function shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }

    // --- Rating System ---
    function initRatingSystem() {
        const modal = document.getElementById('rating-modal');
        const ratingBtns = document.querySelectorAll('.rating-btn');
        const submitBtn = document.getElementById('submit-rating-btn');
        const closeBtn = document.getElementById('close-rating-modal');
        const suggestionInput = document.getElementById('feedback-suggestion');
        const thankYouMsg = document.getElementById('rating-thank-you');

        if (!modal || !submitBtn) return;

        // Check if already rated or dismissed
        if (localStorage.getItem('haryanaMo_feedback_submitted')) return;

        // Show popup after 90 seconds (1.5 minutes)
        setTimeout(() => {
            // Only show if not already closed/submitted in this session
            if (!localStorage.getItem('haryanaMo_feedback_submitted')) {
                modal.style.display = 'flex';
            }
        }, 90000);

        // Star/Number Selection
        ratingBtns.forEach(btn => {
            btn.onclick = () => {
                const val = parseInt(btn.getAttribute('data-value'));
                state.userRating = val;

                // Update UI: highlight selected button
                ratingBtns.forEach(b => b.classList.remove('active'));
                btn.classList.add('active');
            };
        });

        // Close Modal
        closeBtn.onclick = () => {
            modal.style.display = 'none';
        };

        // Submit Feedback
        submitBtn.onclick = async () => {
            if (state.userRating === 0) {
                alert("Please select a star rating first!");
                return;
            }

            const suggestion = suggestionInput.value.trim();
            submitBtn.disabled = true;
            submitBtn.innerText = 'Submitting...';

            try {
                await db.collection('feedback').add({
                    rating: state.userRating,
                    suggestion: suggestion,
                    timestamp: firebase.firestore.FieldValue.serverTimestamp(),
                    userId: AuthService.user ? AuthService.user.uid : 'anonymous',
                    userEmail: AuthService.user ? AuthService.user.email : 'anonymous'
                });

                // Show success UI
                submitBtn.style.display = 'none';
                suggestionInput.parentElement.style.display = 'none';
                thankYouMsg.style.display = 'block';

                // Mark as submitted
                localStorage.setItem('haryanaMo_feedback_submitted', 'true');

                // Auto-close after 2 seconds
                setTimeout(() => {
                    modal.style.display = 'none';
                }, 2000);

            } catch (err) {
                console.error("Feedback submission error:", err);
                alert("Error submitting feedback. Please try again.");
                submitBtn.disabled = false;
                submitBtn.innerText = 'Submit Feedback';
            }
        };
    }
});
