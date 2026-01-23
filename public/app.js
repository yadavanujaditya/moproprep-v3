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
        reviewMode: false          // Track if we're in review mode
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
        loadYears();
        setupEventListeners();
        checkTheme();

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
        });
    }

    // --- API Calls ---
    async function loadYears() {
        try {
            const res = await fetch('/api/years');
            const data = await res.json();
            state.years = data;
            // No automatic render here, rendered when mode is selected
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

            if (!data || data.length === 0) {
                alert('No questions found for this selection.');
                return;
            }

            state.questions = data.sort((a, b) => (a.id || 0) - (b.id || 0));
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
            renderYears();
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
                const restrictedYears = ['2020', '2022'];
                if (restrictedYears.includes(year.year.toString()) && !AuthService.isLoggedIn()) {
                    const user = await AuthService.login();
                    if (!user) return;
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

        if (tag === 'practiseset') {
            mockQuestions = allQuestions.filter(q => q.tags && q.tags.includes('mocktest'));
            regularQuestions = allQuestions.filter(q => !q.tags || !q.tags.includes('mocktest'));
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

        // Progress
        const progress = ((state.currentQuestionIndex) / state.questions.length) * 100;
        els.progressFill.style.width = `${progress}%`;
        els.questionTracker.innerText = `${state.currentQuestionIndex + 1} / ${state.questions.length}`;

        // Options
        const options = q.options; // Object like {A: "...", B: "..."}

        // Check if answered in test mode
        const savedAnswer = state.testMode ? state.userAnswers[state.currentQuestionIndex] : null;

        Object.keys(options).forEach(key => {
            const btn = document.createElement('button');
            btn.className = 'option-btn';

            // In Test Mode/Review Mode, show selection
            if (state.testMode) {
                if (savedAnswer === key) btn.classList.add('selected');

                // If Review Mode (Submitted), show correct/wrong
                if (state.testSubmitted) {
                    const isCorrect = (key === (q.correct_answer || q.correctAnswer));
                    const isSelected = (savedAnswer === key);

                    if (isCorrect) btn.classList.add('review-correct');
                    if (isSelected && !isCorrect) btn.classList.add('review-wrong');
                }
            }

            btn.innerHTML = `<span class="option-letter">${key}</span> ${options[key]}`;

            // Interaction logic
            if (state.testMode && state.testSubmitted) {
                btn.disabled = true; // Review mode is read-only
            } else {
                btn.onclick = () => handleAnswer(key, q.correct_answer || q.correctAnswer, q.explanation);
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
                // Answer is already saved on click if we want, OR we check if selected.
                // Current logic: click option -> saves.
                // So this button basically just goes to next.
                nextQuestion();
            };
            els.optionsContainer.appendChild(saveBtn);
        }

        // Review Mode: Show explanation
        if (state.testMode && state.testSubmitted) {
            const explanation = q.explanation;
            if (explanation) {
                const processed = explanation
                    .replace(/\\n/g, '\n')
                    .replace(/\[cite:\s*[^\]]+\]/g, '')
                    .replace(/✅|❌/g, '')
                    .trim();
                els.explanationText.innerHTML = marked.parse(processed);
                els.feedbackArea.style.display = 'block';
                // Hide feedback text (correct/incorrect) as colors show it, 
                // but we can show it if we want. Let's hide the standard feedback text.
                els.feedbackText.style.display = 'none';
                // Hide normal next button in feedback area
                els.nextBtn.style.display = 'none';
            }
        }
    }

    function handleAnswer(selectedKey, correctKey, explanation) {

        if (state.testMode) {
            // EXAM MODE LOGIC
            state.userAnswers[state.currentQuestionIndex] = selectedKey;

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
            selectMode('haryanamo', 'Previous Year Papers', 'Practice with real exam questions from previous years.', 'YEAR');
        };

        els.btnProQuiz.onclick = async () => {
            try {
                if (!AuthService.isLoggedIn()) {
                    const user = await AuthService.login();
                    if (!user) return;
                }

                // Force checks against AuthService.user directly
                if (AuthService.isPro()) {
                    selectMode('practiseset', 'HaryanaMo Pro', 'Challenge yourself with structured practice sets.', 'SET');
                } else {
                    if (!AuthService.user || !AuthService.user.email) {
                        alert("User session invalid. Please refresh.");
                        return;
                    }
                    // Trigger Razorpay for non-pro users
                    PaymentService.initiatePayment(AuthService.user.email, () => {
                        // Callback on success - directly go to practice sets!
                        selectMode('practiseset', 'HaryanaMo Pro', 'Challenge yourself with structured practice sets.', 'SET');
                    });
                }
            } catch (err) {
                console.error("Pro button error:", err);
                alert("Something went wrong: " + err.message);
            }
        };

        els.backToHome.onclick = () => switchView('home');
        els.homeLogo.onclick = () => switchView('home');

        // Other Nav
        els.backBtn.onclick = () => switchView(state.mode === 'SHUFFLE' ? 'home' : 'yearSelection');
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

    function shuffleArray(array) {
        for (let i = array.length - 1; i > 0; i--) {
            const j = Math.floor(Math.random() * (i + 1));
            [array[i], array[j]] = [array[j], array[i]];
        }
        return array;
    }
});
