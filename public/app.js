document.addEventListener('DOMContentLoaded', () => {
    // --- State Management ---
    const state = {
        years: [],
        questions: [],
        currentQuestionIndex: 0,
        score: 0,
        currentYear: null,
        activeTag: null,
        previousView: 'home',      // Track which view to go back to from yearSelection
        currentPaper: null,        // Track selected paper for UPSC CMS
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
        bookmarks: [],             // Store bookmarked question IDs or objects
        // UPSC Hub State
        upscAllQuestions: [],
        upscDrillLevel: null,      // 'hub'|'years'|'papers'|'subjects'|'chapters'|'topics'|'difficulty'|'revision'
        upscSubject: null,
        upscChapter: null,
        upscQuizSource: null,
        upscSelectedYear: 'all',
        upscCustomYears: [],
        upscFlow: null,            // 'yearwise' | 'subjectwise'
        // Super CMS Gamification State
        superCmsMode: null,        // null | 'case_file' | 'duel' | 'hot_seat' | 'clearance'
        patientStability: 100,
        savedPatients: 0,
        failedPatients: 0,
        aiQuestionIndex: 0,
        aiScore: 0,
        aiInterval: null,
        streak: 0,
        maxStreak: 0,
        curedCount: 0,
        analyticsBackView: null,
        choiceBackView: null
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

    async function loadCloudSolveHistory() {
        if (!state.user) return;
        try {
            const data = await AuthService.getProgress('moproprep_solve_history');
            if (data && data.history) {
                let localHistory = [];
                try {
                    localHistory = JSON.parse(localStorage.getItem('moproprep_solve_history') || '[]');
                } catch (e) {}
                const merged = [...localHistory];
                const existingKeys = new Set(localHistory.map(h => `${h.qId}_${h.timestamp}`));
                data.history.forEach(h => {
                    const key = `${h.qId}_${h.timestamp}`;
                    if (!existingKeys.has(key)) {
                        merged.push(h);
                    }
                });
                merged.sort((a, b) => a.timestamp - b.timestamp);
                localStorage.setItem('moproprep_solve_history', JSON.stringify(merged));
            }
        } catch (e) {
            console.error("Failed to load cloud solve history", e);
        }
    }

    function calculateStreak(history) {
        if (!history || history.length === 0) return 0;
        const dates = history.map(h => {
            const d = new Date(h.timestamp);
            return `${d.getFullYear()}-${(d.getMonth() + 1).toString().padStart(2, '0')}-${d.getDate().toString().padStart(2, '0')}`;
        });
        const uniqueDates = Array.from(new Set(dates)).sort((a, b) => b.localeCompare(a));
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${(today.getMonth() + 1).toString().padStart(2, '0')}-${today.getDate().toString().padStart(2, '0')}`;
        const yesterday = new Date(Date.now() - 86400000);
        const yesterdayStr = `${yesterday.getFullYear()}-${(yesterday.getMonth() + 1).toString().padStart(2, '0')}-${yesterday.getDate().toString().padStart(2, '0')}`;
        if (uniqueDates[0] !== todayStr && uniqueDates[0] !== yesterdayStr) {
            return 0;
        }
        let streak = 0;
        let checkDate = new Date(uniqueDates[0]);
        for (let i = 0; i < uniqueDates.length; i++) {
            const currentStr = uniqueDates[i];
            const expectedStr = `${checkDate.getFullYear()}-${(checkDate.getMonth() + 1).toString().padStart(2, '0')}-${checkDate.getDate().toString().padStart(2, '0')}`;
            if (currentStr === expectedStr) {
                streak++;
                checkDate.setDate(checkDate.getDate() - 1);
            } else {
                break;
            }
        }
        return streak;
    }

    function filterHistoryByTime(history, preset, startStr = null, endStr = null) {
        const now = new Date();
        let minTime = 0;
        if (preset === 'today') {
            const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
            minTime = startOfToday.getTime();
        } else if (preset === 'week') {
            const startOfSevenDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 6);
            minTime = startOfSevenDaysAgo.getTime();
        } else if (preset === 'month') {
            const startOfThirtyDaysAgo = new Date(now.getFullYear(), now.getMonth(), now.getDate() - 29);
            minTime = startOfThirtyDaysAgo.getTime();
        } else if (preset === 'custom' && startStr && endStr) {
            const start = new Date(startStr);
            const end = new Date(endStr);
            end.setHours(23, 59, 59, 999);
            return history.filter(h => h.timestamp >= start.getTime() && h.timestamp <= end.getTime());
        }
        return minTime ? history.filter(h => h.timestamp >= minTime) : history;
    }

    // --- Elements ---
    const els = {
        mainContent: document.getElementById('main-content'),
        views: {
            home: document.getElementById('home-view'),
            stateSelection: document.getElementById('state-selection-view'),
            upscEntry: document.getElementById('upsc-entry-view'),
            upscHub: document.getElementById('upsc-hub-view'),
            upscSuperCms: document.getElementById('upsc-super-cms-view'),
            upscCustomBuilder: document.getElementById('upsc-custom-builder-view'),
            yearSelection: document.getElementById('year-selection-view'),
            upscAiSelection: document.getElementById('upsc-ai-selection-view'),
            upscChoice: document.getElementById('upsc-choice-view'),
            upscAnalytics: document.getElementById('upsc-analytics-view'),
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

        // Premium Feedback Observer
        const feedbackObserver = new MutationObserver((mutations) => {
            mutations.forEach((mutation) => {
                if (mutation.attributeName === 'style') {
                    const color = els.feedbackText.style.color;
                    if (color === 'rgb(16, 185, 129)' || color === '#10b981') {
                        els.feedbackArea.classList.remove('wrong');
                        els.feedbackArea.classList.add('correct');
                    } else if (color === 'rgb(239, 68, 68)' || color === '#ef4444') {
                        els.feedbackArea.classList.remove('correct');
                        els.feedbackArea.classList.add('wrong');
                    } else if (!color) {
                        els.feedbackArea.classList.remove('correct', 'wrong');
                    }
                }
            });
        });
        if (els.feedbackText) {
            feedbackObserver.observe(els.feedbackText, { attributes: true, attributeFilter: ['style'] });
        }

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
            loadCloudSolveHistory();
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

    async function loadQuestions(year, paper = null) {
        try {
            state.mode = 'YEAR';
            state.currentPaper = paper; // Track which paper was selected
            state.currentYear = year;   // Track year early for back nav
            state.sessionKey = paper
                ? `progress_year_${year}_${state.activeTag}_paper_${paper}`
                : `progress_year_${year}_${state.activeTag}`;
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

                    // Filter by paper if specified
                    if (paper) {
                        filteredData = filteredData.filter(q => q.paper == paper);
                    }
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

    // --- UPSC CMS Learning Hub Logic ---
    async function preloadUpscQuestions() {
        if (state.upscAllQuestions && state.upscAllQuestions.length > 0) {
            populateUpscYearDropdown(state.upscAllQuestions);
            return state.upscAllQuestions;
        }
        try {
            const res = await fetch('/api/tags/upscmo');
            const data = await res.json();
            state.upscAllQuestions = data.sort((a, b) => (a.id || 0) - (b.id || 0));
            populateUpscYearDropdown(state.upscAllQuestions);
            return state.upscAllQuestions;
        } catch (err) {
            console.error('Failed to preload UPSC questions:', err);
            return [];
        }
    }

    function getFilteredUpscQuestions(allQ) {
        if (state.upscSelectedYear === 'custom') {
            if (state.upscCustomYears && state.upscCustomYears.length > 0) {
                return allQ.filter(q => q.year && state.upscCustomYears.includes(q.year.toString()));
            }
            return []; // Return empty if custom selected but nothing checked
        } else if (state.upscSelectedYear && state.upscSelectedYear !== 'all') {
            return allQ.filter(q => q.year && q.year.toString() === state.upscSelectedYear);
        }
        return allQ;
    }

    function populateUpscYearDropdown(allQ) {
        const select = document.getElementById('upsc-year-filter');
        if (!select) return;

        // Extract unique years
        const yearsSet = new Set();
        allQ.forEach(q => {
            if (q.year) yearsSet.add(q.year.toString());
        });

        const sortedYears = Array.from(yearsSet).sort((a, b) => b - a);

        select.innerHTML = `
            <option value="all">All Years</option>
            <option value="custom">Custom Selection...</option>
        `;
        sortedYears.forEach(year => {
            const opt = document.createElement('option');
            opt.value = year;
            opt.innerText = year;
            select.appendChild(opt);
        });

        select.value = state.upscSelectedYear || 'all';

        // Dynamically build checkboxes
        buildCustomYearsCheckboxes(sortedYears);
    }

    function buildCustomYearsCheckboxes(sortedYears) {
        const grid = document.getElementById('upsc-custom-years-grid');
        if (!grid) return;

        grid.innerHTML = '';
        sortedYears.forEach(year => {
            const label = document.createElement('label');
            label.style.display = 'flex';
            label.style.alignItems = 'center';
            label.style.gap = '0.5rem';
            label.style.cursor = 'pointer';
            label.style.fontSize = '0.9rem';
            label.style.color = 'var(--text-main)';

            const isChecked = state.upscCustomYears.includes(year);

            label.innerHTML = `
                <input type="checkbox" value="${year}" ${isChecked ? 'checked' : ''} style="cursor: pointer; width: 16px; height: 16px;">
                <span>${year}</span>
            `;
            grid.appendChild(label);
        });
    }

    function toggleCustomYearsPanel(show) {
        const panel = document.getElementById('upsc-custom-years-panel');
        if (panel) {
            panel.style.display = show ? 'block' : 'none';
        }
    }

    function refreshCurrentUpscView() {
        if (state.activeTag !== 'upscmo') return;

        preloadUpscQuestions().then(allQ => {
            if (state.upscDrillLevel === 'subjects') {
                renderUpscSubjects(allQ);
            } else if (state.upscDrillLevel === 'chapters') {
                renderUpscChapters(state.upscSubject, allQ);
            } else if (state.upscDrillLevel === 'topics') {
                renderUpscTopics(state.upscSubject, state.upscChapter, allQ);
            } else if (state.upscDrillLevel === 'difficulty') {
                renderDifficultySelector(allQ);
            } else if (state.upscDrillLevel === 'revision') {
                renderRevisionSelector(allQ);
            } else if (state.upscDrillLevel === 'highpriority') {
                renderHighPrioritySelector(allQ);
            }
        });
    }

    function showUpscYearFilter(visible) {
        const container = document.getElementById('upsc-year-filter-container');
        if (container) {
            container.style.display = visible ? 'flex' : 'none';
        }
        if (!visible) {
            toggleCustomYearsPanel(false);
        } else if (state.upscSelectedYear === 'custom') {
            toggleCustomYearsPanel(true);
        }
    }

    async function showUpscHub() {
        state.activeTag = 'upscmo';
        state.upscDrillLevel = 'hub';
        switchView('upscHub');
        preloadUpscQuestions(); // Prefetch in background
    }

    function renderUpscSubjects(allQ) {
        els.yearsGrid.innerHTML = '';
        const filteredQ = getFilteredUpscQuestions(allQ);
        const subjectCounts = {};
        filteredQ.forEach(q => {
            const sub = q.subject || 'General';
            subjectCounts[sub] = (subjectCounts[sub] || 0) + 1;
        });

        const orderedList = [
            'Medicine', 'Paediatrics', 'Dermatology', 'Psychiatry', 'Surgery',
            'Obstetrics & Gynaecology', 'Obstetrics and Gynaecology', 'OBG',
            'Preventive & Social Medicine', 'PSM', 'ENT', 'Ophthalmology', 
            'Orthopedics', 'Orthopaedics', 'Anaesthesia'
        ];
        
        const subjects = Object.keys(subjectCounts).sort((a, b) => {
            const idxA = orderedList.findIndex(o => o.toLowerCase() === a.toLowerCase());
            const idxB = orderedList.findIndex(o => o.toLowerCase() === b.toLowerCase());
            if (idxA !== -1 && idxB !== -1) return idxA - idxB;
            if (idxA !== -1) return -1;
            if (idxB !== -1) return 1;
            return a.localeCompare(b);
        });

        subjects.forEach(sub => {
            const card = document.createElement('div');
            card.className = 'year-card';
            card.style.display = 'flex';
            card.style.flexDirection = 'column';
            card.style.justifyContent = 'center';
            card.style.alignItems = 'center';
            card.innerHTML = `
                <div class="year-title" style="font-size: 1.3rem;">🏥 ${sub}</div>
                <div class="card-details">
                    <span class="badge-pill">${subjectCounts[sub]} Questions</span>
                </div>
            `;
            card.onclick = () => {
                state.upscSubject = sub;
                showChoiceScreen('subject', sub, allQ);
            };
            els.yearsGrid.appendChild(card);
        });
    }

    function renderUpscChapters(subject, allQ) {
        els.yearsGrid.innerHTML = '';
        const filteredQ = getFilteredUpscQuestions(allQ);
        const subQs = filteredQ.filter(q => (q.subject || 'General').toLowerCase() === subject.toLowerCase());
        
        const chapterData = {};
        subQs.forEach(q => {
            const chap = q.chapter || 'General';
            if (!chapterData[chap]) {
                chapterData[chap] = { count: 0, years: new Set() };
            }
            chapterData[chap].count++;
            if (q.year) {
                chapterData[chap].years.add(q.year);
            }
        });

        const chapters = Object.keys(chapterData).sort((a, b) => chapterData[b].count - chapterData[a].count);

        chapters.forEach(chap => {
            const data = chapterData[chap];
            const yearsAppeared = data.years.size;
            
            const card = document.createElement('div');
            card.className = 'year-card';
            card.innerHTML = `
                <div class="year-title" style="font-size: 1.1rem; line-height: 1.3;">${chap}</div>
                <div class="card-details">
                    <span class="badge-pill">${data.count} Qs</span>
                    <span class="badge-pill success">${yearsAppeared} Years</span>
                </div>
            `;
            card.onclick = () => {
                state.upscChapter = chap;
                showChoiceScreen('chapter', chap, allQ);
            };
            els.yearsGrid.appendChild(card);
        });
    }

    function renderUpscTopics(subject, chapter, allQ) {
        els.yearsGrid.innerHTML = '';
        const filteredQ = getFilteredUpscQuestions(allQ);
        const chapQs = filteredQ.filter(q => 
            (q.subject || 'General').toLowerCase() === subject.toLowerCase() &&
            (q.chapter || 'General').toLowerCase() === chapter.toLowerCase()
        );

        const topicCounts = {};
        chapQs.forEach(q => {
            const top = q.topic || 'General';
            topicCounts[top] = (topicCounts[top] || 0) + 1;
        });

        const topics = Object.keys(topicCounts).sort((a, b) => topicCounts[b] - topicCounts[a]);

        topics.forEach(top => {
            const count = topicCounts[top];
            const card = document.createElement('div');
            card.className = 'year-card';
            card.innerHTML = `
                <div class="year-title" style="font-size: 1rem; line-height: 1.3;">${top}</div>
                <div class="card-details">
                    <span class="badge-pill">${count} Qs</span>
                </div>
            `;
            card.onclick = () => {
                state.upscQuizSource = 'topics';
                state.questions = chapQs.filter(q => (q.topic || 'General').toLowerCase() === top.toLowerCase());
                state.sessionKey = `progress_upsc_sub_${subject.replace(/\s+/g, '_')}_chap_${chapter.replace(/\s+/g, '_')}_topic_${top.replace(/\s+/g, '_')}_year_${state.upscSelectedYear}`;
                state.mode = 'YEAR';
                startQuiz();
            };
            els.yearsGrid.appendChild(card);
        });
    }

    function renderDifficultySelector(allQ) {
        els.yearsGrid.innerHTML = '';
        const filteredQ = getFilteredUpscQuestions(allQ);
        
        const counts = { Easy: 0, Medium: 0, Hard: 0 };
        filteredQ.forEach(q => {
            let diff = q.difficulty || 'Medium';
            if (diff.toLowerCase().includes('easy')) diff = 'Easy';
            else if (diff.toLowerCase().includes('hard') || diff.toLowerCase().includes('difficult')) diff = 'Hard';
            else diff = 'Medium';
            counts[diff]++;
        });

        const container = document.createElement('div');
        container.className = 'difficulty-selector-container';
        
        const diffs = [
            { key: 'Easy', label: '🟢 Easy', class: 'easy' },
            { key: 'Medium', label: '🟡 Medium', class: 'medium' },
            { key: 'Hard', label: '🔴 Hard', class: 'hard' }
        ];

        diffs.forEach(d => {
            const btn = document.createElement('button');
            btn.className = `difficulty-btn ${d.class}`;
            btn.innerHTML = `
                <span>${d.label}</span>
                <span class="count">${counts[d.key]} Qs</span>
            `;
            btn.onclick = () => {
                const diffQs = filteredQ.filter(q => {
                    let diff = q.difficulty || 'Medium';
                    if (diff.toLowerCase().includes('easy')) diff = 'Easy';
                    else if (diff.toLowerCase().includes('hard') || diff.toLowerCase().includes('difficult')) diff = 'Hard';
                    else diff = 'Medium';
                    return diff === d.key;
                });

                if (diffQs.length === 0) {
                    alert(`No questions found for ${d.key} difficulty.`);
                    return;
                }

                state.upscQuizSource = 'difficulty';
                state.questions = diffQs;
                state.sessionKey = `progress_upsc_diff_${d.key.toLowerCase()}_year_${state.upscSelectedYear}`;
                state.mode = 'YEAR';
                startQuiz();
            };
            container.appendChild(btn);
        });

        els.yearsGrid.appendChild(container);
    }

    function renderRevisionSelector(allQ) {
        els.yearsGrid.innerHTML = '';
        const filteredQ = getFilteredUpscQuestions(allQ);
        
        const seenIds = JSON.parse(localStorage.getItem('moproprep_seen_upsc') || '[]');
        const wrongIds = JSON.parse(localStorage.getItem('moproprep_wrong_upsc') || '[]');
        
        const unseenQs = filteredQ.filter(q => {
            const qId = q.id || `${q.year}_${q.category}_${(q.question_text || q.questionText || '').substring(0, 20)}`;
            return !seenIds.includes(qId.toString());
        });
        
        const wrongQs = filteredQ.filter(q => {
            const qId = q.id || `${q.year}_${q.category}_${(q.question_text || q.questionText || '').substring(0, 20)}`;
            return wrongIds.includes(qId.toString());
        });

        const container = document.createElement('div');
        container.className = 'revision-selector-container';

        const unseenBtn = document.createElement('button');
        unseenBtn.className = 'revision-btn';
        unseenBtn.innerHTML = `
            <span>📖 Unseen Questions</span>
            <span class="count">${unseenQs.length} Qs</span>
        `;
        unseenBtn.onclick = () => {
            if (unseenQs.length === 0) {
                alert("No unseen questions found for this selection.");
                return;
            }
            state.upscQuizSource = 'revision';
            state.questions = unseenQs;
            state.sessionKey = `progress_upsc_revision_unseen_year_${state.upscSelectedYear}`;
            state.mode = 'YEAR';
            startQuiz();
        };
        container.appendChild(unseenBtn);

        const wrongBtn = document.createElement('button');
        wrongBtn.className = 'revision-btn';
        wrongBtn.innerHTML = `
            <span>❌ Incorrectly Answered</span>
            <span class="count">${wrongQs.length} Qs</span>
        `;
        wrongBtn.onclick = () => {
            if (wrongQs.length === 0) {
                alert("No incorrect questions found for this selection.");
                return;
            }
            state.upscQuizSource = 'revision';
            state.questions = wrongQs;
            state.sessionKey = `progress_upsc_revision_wrong_year_${state.upscSelectedYear}`;
            state.mode = 'YEAR';
            startQuiz();
        };
        container.appendChild(wrongBtn);

        els.yearsGrid.appendChild(container);
    }

    function renderHighPrioritySelector(allQ) {
        els.yearsGrid.innerHTML = '';
        const highQ = getFilteredUpscQuestions(allQ).filter(q => q.exam_weightage && q.exam_weightage.toLowerCase() === 'high');
        
        const topicData = {};
        highQ.forEach(q => {
            const sub = q.subject || 'General';
            const chap = q.chapter || 'General';
            const top = q.topic || 'General';
            const key = `${sub}|${chap}|${top}`;
            if (!topicData[key]) {
                topicData[key] = { sub, chap, top, count: 0, questions: [] };
            }
            topicData[key].count++;
            topicData[key].questions.push(q);
        });
        
        const sortedTopics = Object.values(topicData).sort((a, b) => b.count - a.count);
        
        const container = document.createElement('div');
        container.style.cssText = `
            display: flex;
            flex-direction: column;
            gap: 1.5rem;
            width: 100%;
            text-align: left;
        `;
        
        container.innerHTML = `
            <div class="glass-card" style="display: flex; flex-direction: column; gap: 1.25rem; padding: 2rem; width: 100%;">
                <h4 style="margin: 0; font-size: 1.05rem; font-weight: 700; color: var(--text-main);">🎯 High Yield Custom Builder</h4>
                <div style="display: flex; gap: 1rem; flex-wrap: wrap; width: 100%;">
                    <div style="flex: 1; min-width: 180px; display: flex; flex-direction: column; gap: 0.4rem;">
                        <label style="font-weight: 600; font-size: 0.85rem; color: var(--text-muted);">Subject</label>
                        <select id="hp-subject-filter" style="padding: 0.6rem 1rem; border-radius: 10px; font-size: 0.85rem; width: 100%;">
                            <option value="all">All Subjects</option>
                        </select>
                    </div>
                    <div style="flex: 1; min-width: 180px; display: flex; flex-direction: column; gap: 0.4rem;">
                        <label style="font-weight: 600; font-size: 0.85rem; color: var(--text-muted);">Chapter</label>
                        <select id="hp-chapter-filter" style="padding: 0.6rem 1rem; border-radius: 10px; font-size: 0.85rem; width: 100%;">
                            <option value="all">All Chapters</option>
                        </select>
                    </div>
                </div>
                <div style="display: flex; justify-content: space-between; align-items: center; flex-wrap: wrap; gap: 1rem; border-top: 1px solid var(--border); padding-top: 1rem; margin-top: 0.5rem; width: 100%;">
                    <div style="display: flex; gap: 0.5rem;">
                        <button id="btn-hp-select-all" class="secondary-btn" style="padding: 0.4rem 1rem; font-size: 0.85rem; width: auto; height: auto; margin: 0;">Select All</button>
                        <button id="btn-hp-clear-all" class="secondary-btn" style="padding: 0.4rem 1rem; font-size: 0.85rem; width: auto; height: auto; margin: 0;">Clear All</button>
                    </div>
                    <button id="btn-hp-start-quiz" class="primary-btn" style="padding: 0.6rem 2rem; font-size: 0.95rem; width: auto; font-weight: 700; border-radius: 10px;">
                        Start Quiz (0 Qs)
                    </button>
                </div>
            </div>
            
            <h3 style="font-size: 1.15rem; font-weight: 700; color: var(--text-main); margin-top: 0.5rem; display: flex; align-items: center; gap: 0.5rem;">
                <span>🔥</span> High Weightage Topics (Sorted by Importance)
            </h3>
            <div id="hp-topics-grid" style="display: grid; grid-template-columns: repeat(auto-fill, minmax(280px, 1fr)); gap: 1rem; width: 100%;">
                <!-- Topic cards -->
            </div>
        `;
        
        els.yearsGrid.appendChild(container);
        
        const hpSub = document.getElementById('hp-subject-filter');
        const hpChap = document.getElementById('hp-chapter-filter');
        const grid = document.getElementById('hp-topics-grid');
        const startBtn = document.getElementById('btn-hp-start-quiz');
        
        const uniqueSubs = Array.from(new Set(sortedTopics.map(t => t.sub))).sort();
        uniqueSubs.forEach(s => {
            const opt = document.createElement('option');
            opt.value = s;
            opt.innerText = s;
            hpSub.appendChild(opt);
        });
        
        const updateHpChapters = () => {
            const activeSub = hpSub.value;
            hpChap.innerHTML = '<option value="all">All Chapters</option>';
            const uniqueChaps = Array.from(new Set(sortedTopics.filter(t => activeSub === 'all' || t.sub === activeSub).map(t => t.chap))).sort();
            uniqueChaps.forEach(c => {
                const opt = document.createElement('option');
                opt.value = c;
                opt.innerText = c;
                hpChap.appendChild(opt);
            });
        };
        
        const updateHpQuizButton = () => {
            let totalQs = 0;
            const checkedCbs = document.querySelectorAll('.hp-topic-cb:checked');
            checkedCbs.forEach(cb => {
                const [s, c, t] = cb.value.split('|');
                const matched = sortedTopics.find(st => st.sub === s && st.chap === c && st.top === t);
                if (matched) totalQs += matched.count;
            });
            if (startBtn) {
                startBtn.innerText = `Start Quiz (${totalQs} Qs)`;
                startBtn.disabled = totalQs === 0;
                startBtn.style.opacity = totalQs === 0 ? '0.5' : '1';
            }
        };
        
        const renderHpTopicsList = () => {
            const subFilter = hpSub.value;
            const chapFilter = hpChap.value;
            grid.innerHTML = '';
            
            const filteredHp = sortedTopics.filter(t => {
                const matchSub = (subFilter === 'all' || t.sub === subFilter);
                const matchChap = (chapFilter === 'all' || t.chap === chapFilter);
                return matchSub && matchChap;
            });
            
            if (filteredHp.length === 0) {
                grid.innerHTML = '<div style="grid-column: 1/-1; text-align: center; color: var(--text-muted); padding: 2rem;">No high priority topics match your filters.</div>';
                updateHpQuizButton();
                return;
            }
            
            filteredHp.forEach(t => {
                const card = document.createElement('label');
                card.style.cssText = `
                    display: flex;
                    align-items: flex-start;
                    gap: 0.75rem;
                    padding: 1.25rem;
                    border-radius: 14px;
                    cursor: pointer;
                    transition: all 0.2s ease;
                    border: 1px solid var(--border);
                    position: relative;
                    background: var(--surface);
                `;
                
                card.innerHTML = `
                    <input type="checkbox" class="hp-topic-cb" value="${t.sub}|${t.chap}|${t.top}" checked style="margin-top: 0.25rem; width: 18px; height: 18px; cursor: pointer;">
                    <div style="flex: 1; display: flex; flex-direction: column; gap: 0.25rem;">
                        <span style="font-weight: 700; font-size: 0.95rem; color: var(--text-main); line-height: 1.3;">${t.top}</span>
                        <span style="font-size: 0.75rem; color: var(--text-muted);">${t.sub} › ${t.chap}</span>
                    </div>
                    <span class="badge-pill" style="background: rgba(194, 24, 91, 0.1); color: var(--primary); font-weight: 700; font-size: 0.8rem; padding: 0.25rem 0.6rem; border-radius: 9999px; margin-left: 0.5rem; white-space: nowrap;">
                        ${t.count} Qs
                    </span>
                `;
                
                const cb = card.querySelector('.hp-topic-cb');
                const updateCardStyle = () => {
                    if (cb.checked) {
                        card.style.borderColor = 'var(--primary)';
                        card.style.background = 'linear-gradient(135deg, rgba(194, 24, 91, 0.04), rgba(255, 141, 161, 0.02))';
                        card.style.boxShadow = '0 4px 12px rgba(194, 24, 91, 0.08)';
                    } else {
                        card.style.borderColor = 'var(--border)';
                        card.style.background = 'var(--surface)';
                        card.style.boxShadow = 'none';
                    }
                    updateHpQuizButton();
                };
                
                cb.onchange = updateCardStyle;
                updateCardStyle();
                
                grid.appendChild(card);
            });
        };
        
        hpSub.onchange = () => {
            updateHpChapters();
            renderHpTopicsList();
        };
        
        hpChap.onchange = () => {
            renderHpTopicsList();
        };
        
        document.getElementById('btn-hp-select-all').onclick = () => {
            document.querySelectorAll('.hp-topic-cb').forEach(cb => {
                cb.checked = true;
                cb.dispatchEvent(new Event('change'));
            });
        };
        document.getElementById('btn-hp-clear-all').onclick = () => {
            document.querySelectorAll('.hp-topic-cb').forEach(cb => {
                cb.checked = false;
                cb.dispatchEvent(new Event('change'));
            });
        };
        
        if (startBtn) {
            startBtn.onclick = () => {
                const selectedQs = [];
                const checkedCbs = document.querySelectorAll('.hp-topic-cb:checked');
                checkedCbs.forEach(cb => {
                    const [s, c, t] = cb.value.split('|');
                    const matched = sortedTopics.find(st => st.sub === s && st.chap === c && st.top === t);
                    if (matched) {
                        selectedQs.push(...matched.questions);
                    }
                });
                
                if (selectedQs.length === 0) {
                    alert("Please select at least one topic to start.");
                    return;
                }
                
                state.upscQuizSource = 'highpriority';
                state.questions = shuffleArray([...selectedQs]);
                state.sessionKey = 'progress_upsc_highpriority_custom';
                state.mode = 'YEAR';
                startQuiz();
            };
        }
        
        updateHpChapters();
        renderHpTopicsList();
    }

    function showClearanceChoiceScreen(allQ) {
        state.choiceBackView = 'supercms';
        switchView('upscChoice');
        const titleEl = document.getElementById('choice-title');
        const descEl = document.getElementById('choice-desc');
        const seeTitle = document.getElementById('choice-see-title');
        const seeDesc = document.getElementById('choice-see-desc');
        const solveDesc = document.getElementById('choice-solve-desc');
        const solveH3 = document.querySelector('#btn-choice-solve h3');
        
        if (titleEl) titleEl.innerText = "Error Clearance Mode";
        if (descEl) descEl.innerText = "Choose which questions you want to solve in Error Clearance.";
        if (solveH3) solveH3.innerText = "Wrongly Marked";
        if (solveDesc) solveDesc.innerText = "Practice questions you previously got wrong to master them.";
        if (seeTitle) seeTitle.innerText = "Not Touched";
        if (seeDesc) seeDesc.innerText = "Solve questions you haven't attempted yet.";

        document.getElementById('btn-choice-solve').onclick = () => {
            startSuperCms('clearance', 'wrong');
        };

        document.getElementById('btn-choice-see').onclick = () => {
            startSuperCms('clearance', 'unseen');
        };
    }

    function showChoiceScreen(type, name, allQ) {
        state.choiceBackView = null;
        const solveH3 = document.querySelector('#btn-choice-solve h3');
        if (solveH3) solveH3.innerText = "Solve Entire Section";

        switchView('upscChoice');
        const titleEl = document.getElementById('choice-title');
        const descEl = document.getElementById('choice-desc');
        const seeTitle = document.getElementById('choice-see-title');
        const seeDesc = document.getElementById('choice-see-desc');
        const solveDesc = document.getElementById('choice-solve-desc');
        
        if (titleEl) titleEl.innerText = name;
        
        const filteredQ = getFilteredUpscQuestions(allQ);
        
        if (type === 'subject') {
            const subQs = filteredQ.filter(q => (q.subject || 'General').toLowerCase() === name.toLowerCase());
            
            if (descEl) descEl.innerText = `Choose whether to solve all ${name} questions or browse chapters.`;
            if (solveDesc) solveDesc.innerText = `Start practicing immediately with all ${subQs.length} questions in this subject.`;
            if (seeTitle) seeTitle.innerText = 'See Chapters';
            if (seeDesc) seeDesc.innerText = 'Drill down further and select specific chapters/topics to practice.';
            
            document.getElementById('btn-choice-solve').onclick = () => {
                if (subQs.length === 0) {
                    alert("No questions found for this subject and year selection.");
                    return;
                }
                state.upscQuizSource = 'subject_solve';
                state.questions = subQs;
                state.sessionKey = `progress_upsc_sub_${name.replace(/\s+/g, '_')}_year_${state.upscSelectedYear}`;
                state.mode = 'YEAR';
                startQuiz();
            };
            
            document.getElementById('btn-choice-see').onclick = () => {
                state.upscDrillLevel = 'chapters';
                switchView('yearSelection');
                els.viewTitle.innerText = name;
                els.viewDesc.innerText = 'Select a chapter to drill down.';
                renderUpscChapters(name, allQ);
            };
        } else if (type === 'chapter') {
            const chapQs = filteredQ.filter(q => 
                (q.subject || 'General').toLowerCase() === state.upscSubject.toLowerCase() &&
                (q.chapter || 'General').toLowerCase() === name.toLowerCase()
            );
            
            if (descEl) descEl.innerText = `Choose whether to solve all ${name} questions or browse topics.`;
            if (solveDesc) solveDesc.innerText = `Start practicing immediately with all ${chapQs.length} questions in this chapter.`;
            if (seeTitle) seeTitle.innerText = 'See Topics';
            if (seeDesc) seeDesc.innerText = 'Drill down further and select specific topics to practice.';
            
            document.getElementById('btn-choice-solve').onclick = () => {
                if (chapQs.length === 0) {
                    alert("No questions found for this chapter and year selection.");
                    return;
                }
                state.upscQuizSource = 'chapter_solve';
                state.questions = chapQs;
                state.sessionKey = `progress_upsc_sub_${state.upscSubject.replace(/\s+/g, '_')}_chap_${name.replace(/\s+/g, '_')}_year_${state.upscSelectedYear}`;
                state.mode = 'YEAR';
                startQuiz();
            };
            
            document.getElementById('btn-choice-see').onclick = () => {
                state.upscDrillLevel = 'topics';
                switchView('yearSelection');
                els.viewTitle.innerText = name;
                els.viewDesc.innerText = 'Select a topic to start quiz.';
                renderUpscTopics(state.upscSubject, name, allQ);
            };
        }
    }

    async function showAnalytics() {
        state.activeTag = 'upscmo';
        state.upscDrillLevel = 'analytics';
        switchView('upscAnalytics');
        const allQ = await preloadUpscQuestions();
        initAnalytics(allQ);
    }

    let analyticsInitialized = false;
    let analyticsPreset = 'week';
    
    function initAnalytics(allQ) {
        if (analyticsInitialized) {
            updateAnalyticsOptions(allQ);
            renderAnalytics(allQ);
            return;
        }
        
        const btnToday = document.getElementById('btn-analytics-today');
        const btnWeek = document.getElementById('btn-analytics-week');
        const btnMonth = document.getElementById('btn-analytics-month');
        const btnCustom = document.getElementById('btn-analytics-custom');
        const customPanel = document.getElementById('analytics-custom-dates');
        const btnApplyCustom = document.getElementById('btn-analytics-apply-custom');
        
        const setPresetActive = (activeBtn) => {
            [btnToday, btnWeek, btnMonth, btnCustom].forEach(btn => {
                if (btn) btn.classList.remove('active', 'primary-btn');
                if (btn) btn.classList.add('secondary-btn');
            });
            if (activeBtn) {
                activeBtn.classList.remove('secondary-btn');
                activeBtn.classList.add('active', 'primary-btn');
            }
        };
        
        setPresetActive(btnWeek);
        
        if (btnToday) {
            btnToday.onclick = () => {
                analyticsPreset = 'today';
                if (customPanel) customPanel.style.display = 'none';
                setPresetActive(btnToday);
                renderAnalytics(allQ);
            };
        }
        if (btnWeek) {
            btnWeek.onclick = () => {
                analyticsPreset = 'week';
                if (customPanel) customPanel.style.display = 'none';
                setPresetActive(btnWeek);
                renderAnalytics(allQ);
            };
        }
        if (btnMonth) {
            btnMonth.onclick = () => {
                analyticsPreset = 'month';
                if (customPanel) customPanel.style.display = 'none';
                setPresetActive(btnMonth);
                renderAnalytics(allQ);
            };
        }
        if (btnCustom) {
            btnCustom.onclick = () => {
                analyticsPreset = 'custom';
                if (customPanel) customPanel.style.display = 'flex';
                setPresetActive(btnCustom);
            };
        }
        if (btnApplyCustom) {
            btnApplyCustom.onclick = () => {
                renderAnalytics(allQ);
            };
        }
        
        const subSelect = document.getElementById('analytics-subject');
        const chapSelect = document.getElementById('analytics-chapter');
        const topSelect = document.getElementById('analytics-topic');
        
        if (subSelect) {
            subSelect.onchange = () => {
                updateAnalyticsOptions(allQ, 'analytics-subject');
                renderAnalytics(allQ);
            };
        }
        if (chapSelect) {
            chapSelect.onchange = () => {
                updateAnalyticsOptions(allQ, 'analytics-chapter');
                renderAnalytics(allQ);
            };
        }
        if (topSelect) {
            topSelect.onchange = () => {
                renderAnalytics(allQ);
            };
        }
        
        analyticsInitialized = true;
        updateAnalyticsOptions(allQ);
        renderAnalytics(allQ);
    }

    function updateAnalyticsOptions(allQ, changedFieldId = null) {
        const subSelect = document.getElementById('analytics-subject');
        const chapSelect = document.getElementById('analytics-chapter');
        const topSelect = document.getElementById('analytics-topic');
        if (!subSelect) return;
        
        if (changedFieldId === null) {
            const currentSub = subSelect.value;
            const subjectsSet = new Set();
            allQ.forEach(q => { if (q.subject) subjectsSet.add(q.subject); });
            const sortedSubjects = Array.from(subjectsSet).sort();
            
            subSelect.innerHTML = '<option value="all">All Subjects</option>';
            sortedSubjects.forEach(sub => {
                const opt = document.createElement('option');
                opt.value = sub;
                opt.innerText = sub;
                subSelect.appendChild(opt);
            });
            subSelect.value = sortedSubjects.includes(currentSub) ? currentSub : 'all';
        }
        
        const activeSubject = subSelect.value;
        
        if (changedFieldId === null || changedFieldId === 'analytics-subject') {
            const currentChap = chapSelect.value;
            const chaptersSet = new Set();
            allQ.forEach(q => {
                if (q.chapter && (activeSubject === 'all' || q.subject === activeSubject)) {
                    chaptersSet.add(q.chapter);
                }
            });
            const sortedChapters = Array.from(chaptersSet).sort();
            
            chapSelect.innerHTML = '<option value="all">All Chapters</option>';
            sortedChapters.forEach(chap => {
                const opt = document.createElement('option');
                opt.value = chap;
                opt.innerText = chap;
                chapSelect.appendChild(opt);
            });
            chapSelect.value = sortedChapters.includes(currentChap) ? currentChap : 'all';
        }
        
        const activeChapter = chapSelect.value;
        
        if (changedFieldId === null || changedFieldId === 'analytics-subject' || changedFieldId === 'analytics-chapter') {
            const currentTopic = topSelect.value;
            const topicsSet = new Set();
            allQ.forEach(q => {
                const subMatch = (activeSubject === 'all' || q.subject === activeSubject);
                const chapMatch = (activeChapter === 'all' || q.chapter === activeChapter);
                if (q.topic && subMatch && chapMatch) {
                    topicsSet.add(q.topic);
                }
            });
            const sortedTopics = Array.from(topicsSet).sort();
            
            topSelect.innerHTML = '<option value="all">All Topics</option>';
            sortedTopics.forEach(top => {
                const opt = document.createElement('option');
                opt.value = top;
                opt.innerText = top;
                topSelect.appendChild(opt);
            });
            topSelect.value = sortedTopics.includes(currentTopic) ? currentTopic : 'all';
        }
    }

    function renderAnalytics(allQ) {
        let history = [];
        try {
            history = JSON.parse(localStorage.getItem('moproprep_solve_history') || '[]');
        } catch (e) {}
        
        const streak = calculateStreak(history);
        const streakEl = document.getElementById('stat-streak');
        if (streakEl) streakEl.innerText = `${streak} Day${streak === 1 ? '' : 's'}`;
        
        const startVal = document.getElementById('analytics-start-date').value;
        const endVal = document.getElementById('analytics-end-date').value;
        let filteredHistory = filterHistoryByTime(history, analyticsPreset, startVal, endVal);
        
        const activeSubject = document.getElementById('analytics-subject').value;
        const activeChapter = document.getElementById('analytics-chapter').value;
        const activeTopic = document.getElementById('analytics-topic').value;
        
        if (activeSubject !== 'all') {
            filteredHistory = filteredHistory.filter(h => h.subject === activeSubject);
        }
        if (activeChapter !== 'all') {
            filteredHistory = filteredHistory.filter(h => h.chapter === activeChapter);
        }
        if (activeTopic !== 'all') {
            filteredHistory = filteredHistory.filter(h => h.topic === activeTopic);
        }
        
        const totalSolved = filteredHistory.length;
        const correctCount = filteredHistory.filter(h => h.isCorrect).length;
        const accuracy = totalSolved > 0 ? Math.round((correctCount / totalSolved) * 100) : 0;
        
        const totalSolvedEl = document.getElementById('stat-total-solved');
        const accuracyEl = document.getElementById('stat-accuracy');
        
        if (totalSolvedEl) totalSolvedEl.innerText = totalSolved;
        if (accuracyEl) accuracyEl.innerText = `${accuracy}%`;
        
        const uniqueSolvedQIds = new Set(history.map(h => h.qId));
        
        const subjectTotalCounts = {};
        const subjectSolvedCounts = {};
        allQ.forEach(q => {
            const sub = q.subject || 'General';
            subjectTotalCounts[sub] = (subjectTotalCounts[sub] || 0) + 1;
            const qId = q.id || `${q.year}_${q.category || q.tags?.[0] || 'General'}_${(q.question_text || q.questionText || '').substring(0, 20)}`;
            if (uniqueSolvedQIds.has(qId.toString())) {
                subjectSolvedCounts[sub] = (subjectSolvedCounts[sub] || 0) + 1;
            }
        });
        
        const breakdownEl = document.getElementById('analytics-subjects-breakdown');
        if (breakdownEl) {
            breakdownEl.innerHTML = '';
            const subjects = Object.keys(subjectTotalCounts).sort();
            subjects.forEach(sub => {
                const total = subjectTotalCounts[sub];
                const solved = subjectSolvedCounts[sub] || 0;
                const percent = Math.round((solved / total) * 100);
                
                const barContainer = document.createElement('div');
                barContainer.style.cssText = 'display: flex; flex-direction: column; gap: 0.4rem; width: 100%;';
                barContainer.innerHTML = `
                    <div style="display: flex; justify-content: space-between; font-size: 0.9rem; font-weight: 600; color: var(--text-main);">
                        <span>${sub}</span>
                        <span>${solved} / ${total} Solved (${percent}%)</span>
                    </div>
                    <div class="progress-bar" style="background: rgba(0,0,0,0.06); height: 10px; border-radius: 9999px; overflow: hidden; border: 1px solid rgba(255,255,255,0.05);">
                        <div style="width: ${percent}%; height: 100%; background: linear-gradient(90deg, var(--primary) 0%, var(--secondary) 100%); border-radius: 9999px; transition: width 0.3s ease;"></div>
                    </div>
                `;
                breakdownEl.appendChild(barContainer);
            });
        }
        
        const topicTotalCounts = {};
        const topicSolvedCounts = {};
        allQ.forEach(q => {
            const sub = q.subject || 'General';
            const chap = q.chapter || 'General';
            const top = q.topic || 'General';
            
            if (activeSubject !== 'all' && sub !== activeSubject) return;
            if (activeChapter !== 'all' && chap !== activeChapter) return;
            
            const key = `${sub}|${chap}|${top}`;
            topicTotalCounts[key] = (topicTotalCounts[key] || 0) + 1;
            const qId = q.id || `${q.year}_${q.category || q.tags?.[0] || 'General'}_${(q.question_text || q.questionText || '').substring(0, 20)}`;
            if (uniqueSolvedQIds.has(qId.toString())) {
                topicSolvedCounts[key] = (topicSolvedCounts[key] || 0) + 1;
            }
        });
        
        const pendingTopics = [];
        Object.keys(topicTotalCounts).forEach(key => {
            const total = topicTotalCounts[key];
            const solved = topicSolvedCounts[key] || 0;
            if (solved < total) {
                const [sub, chap, top] = key.split('|');
                pendingTopics.push({ sub, chap, top, solved, total, pending: total - solved });
            }
        });
        
        pendingTopics.sort((a, b) => b.pending - a.pending);
        
        const pendingTopicsEl = document.getElementById('analytics-pending-topics');
        if (pendingTopicsEl) {
            pendingTopicsEl.innerHTML = '';
            if (pendingTopics.length === 0) {
                pendingTopicsEl.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 1rem;">All topics completed! 🎉</div>';
            } else {
                pendingTopics.slice(0, 15).forEach(pt => {
                    const item = document.createElement('div');
                    item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0.8rem; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border); border-radius: 10px; font-size: 0.85rem;';
                    item.innerHTML = `
                        <div style="display: flex; flex-direction: column; gap: 0.15rem;">
                            <span style="font-weight: 700; color: var(--text-main);">${pt.top}</span>
                            <span style="font-size: 0.7rem; color: var(--text-muted);">${pt.sub} › ${pt.chap}</span>
                        </div>
                        <span style="color: var(--secondary); font-weight: 700; font-size: 0.8rem; white-space: nowrap;">
                            ${pt.pending} Qs pending
                        </span>
                    `;
                    pendingTopicsEl.appendChild(item);
                });
            }
        }
        
        const paperTotalCounts = {};
        const paperSolvedCounts = {};
        allQ.forEach(q => {
            if (!q.year || !q.paper) return;
            const key = `${q.year}|Paper ${q.paper}`;
            paperTotalCounts[key] = (paperTotalCounts[key] || 0) + 1;
            const qId = q.id || `${q.year}_${q.category || q.tags?.[0] || 'General'}_${(q.question_text || q.questionText || '').substring(0, 20)}`;
            if (uniqueSolvedQIds.has(qId.toString())) {
                paperSolvedCounts[key] = (paperSolvedCounts[key] || 0) + 1;
            }
        });
        
        const pendingPapers = [];
        Object.keys(paperTotalCounts).forEach(key => {
            const total = paperTotalCounts[key];
            const solved = paperSolvedCounts[key] || 0;
            if (solved < total) {
                const [year, paperName] = key.split('|');
                pendingPapers.push({ year: parseInt(year, 10), paperName, solved, total, pending: total - solved });
            }
        });
        
        pendingPapers.sort((a, b) => {
            if (b.year !== a.year) return b.year - a.year;
            return a.paperName.localeCompare(b.paperName);
        });
        
        const pendingPapersEl = document.getElementById('analytics-pending-papers');
        if (pendingPapersEl) {
            pendingPapersEl.innerHTML = '';
            if (pendingPapers.length === 0) {
                pendingPapersEl.innerHTML = '<div style="color: var(--text-muted); font-size: 0.9rem; text-align: center; padding: 1rem;">All papers completed! 🏆</div>';
            } else {
                pendingPapers.forEach(pp => {
                    const item = document.createElement('div');
                    item.style.cssText = 'display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0.8rem; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border); border-radius: 10px; font-size: 0.85rem;';
                    item.innerHTML = `
                        <div style="display: flex; justify-content: space-between; align-items: center; padding: 0.6rem 0.8rem; background: rgba(255, 255, 255, 0.02); border: 1px solid var(--border); border-radius: 10px; font-size: 0.85rem;">
                            <div style="display: flex; flex-direction: column; gap: 0.15rem;">
                                <span style="font-weight: 700; color: var(--text-main);">${pp.year} ${pp.paperName}</span>
                                <span style="font-size: 0.75rem; color: var(--text-muted);">${pp.solved} / ${pp.total} Qs solved</span>
                            </div>
                            <span style="color: var(--secondary); font-weight: 700; font-size: 0.8rem; white-space: nowrap;">
                                ${pp.pending} pending
                            </span>
                        </div>
                    `;
                    pendingPapersEl.appendChild(item);
                });
            }
        }
    }

    function upscGoBack() {
        if (state.upscDrillLevel === 'years') {
            state.upscDrillLevel = 'hub';
            showUpscHub();
        } else if (state.upscDrillLevel === 'papers') {
            state.upscDrillLevel = 'years';
            selectMode('upscmo', 'UPSC CMS Previous Year Papers', 'Practice with real UPSC Combined Medical Services exam questions.', 'YEAR', 'upscHub');
        } else if (state.upscDrillLevel === 'subjects') {
            if (state.upscFlow === 'yearwise') {
                state.upscDrillLevel = 'years';
                state.upscSelectedYear = 'all';
                const yf = document.getElementById('upsc-year-filter');
                if (yf) yf.value = 'all';
                selectMode('upscmo', 'UPSC CMS Previous Year Papers', 'Practice with real UPSC Combined Medical Services exam questions.', 'YEAR', 'upscHub');
            } else {
                state.upscDrillLevel = 'hub';
                showUpscHub();
            }
        } else if (state.upscDrillLevel === 'chapters') {
            state.upscDrillLevel = 'subjects';
            preloadUpscQuestions().then(allQ => {
                els.viewTitle.innerText = 'Select Subject';
                els.viewDesc.innerText = 'Choose a subject to practice.';
                renderUpscSubjects(allQ);
            });
        } else if (state.upscDrillLevel === 'topics') {
            state.upscDrillLevel = 'chapters';
            preloadUpscQuestions().then(allQ => {
                els.viewTitle.innerText = `${state.upscSubject}`;
                els.viewDesc.innerText = 'Select a chapter to drill down.';
                renderUpscChapters(state.upscSubject, allQ);
            });
        } else if (state.upscDrillLevel === 'difficulty') {
            state.upscDrillLevel = 'hub';
            showUpscHub();
        } else if (state.upscDrillLevel === 'revision') {
            state.upscDrillLevel = 'hub';
            showUpscHub();
        } else if (state.upscDrillLevel === 'highpriority') {
            state.upscDrillLevel = 'hub';
            showUpscHub();
        } else if (state.upscDrillLevel === 'custombuilder') {
            state.upscDrillLevel = 'hub';
            showUpscHub();
        } else if (state.upscDrillLevel === 'analytics') {
            state.upscDrillLevel = 'hub';
            showUpscHub();
        } else {
            showUpscHub();
        }
    }

    // --- UPSC Custom Quiz Builder Logic ---
    let builderInitialized = false;

    function showCustomBuilder() {
        state.activeTag = 'upscmo';
        state.upscDrillLevel = 'custombuilder';
        switchView('upscCustomBuilder');
        preloadUpscQuestions().then(allQ => {
            initCustomBuilder(allQ);
        });
    }

    function initCustomBuilder(allQ) {
        if (!builderInitialized) {
            // Populate Years Grid checkbox dynamically
            const yearsSet = new Set();
            allQ.forEach(q => {
                if (q.year) yearsSet.add(q.year.toString());
            });
            const sortedYears = Array.from(yearsSet).sort((a, b) => b - a);

            const yearsGrid = document.getElementById('builder-years-grid');
            if (yearsGrid) {
                yearsGrid.innerHTML = '';
                sortedYears.forEach(year => {
                    const label = document.createElement('label');
                    label.style.display = 'flex';
                    label.style.alignItems = 'center';
                    label.style.gap = '0.5rem';
                    label.style.cursor = 'pointer';
                    label.style.fontSize = '0.9rem';
                    label.style.color = 'var(--text-main)';
                    label.innerHTML = `
                        <input type="checkbox" class="builder-year-cb" value="${year}" checked style="width: 16px; height: 16px; cursor: pointer;">
                        <span>${year}</span>
                    `;
                    yearsGrid.appendChild(label);
                });
            }
            builderInitialized = true;
        }

        updateBuilderOptions(allQ);
    }

    function updateBuilderOptions(allQ, changedFieldId = null) {
        const subSelect = document.getElementById('builder-subject');
        const chapSelect = document.getElementById('builder-chapter');
        const topSelect = document.getElementById('builder-topic');

        // Retrieve active year filters
        const selectedYears = [];
        document.querySelectorAll('.builder-year-cb:checked').forEach(cb => {
            selectedYears.push(cb.value);
        });

        // Filter all questions by selected years first
        const questionsInSelectedYears = allQ.filter(q => q.year && selectedYears.includes(q.year.toString()));

        // Populate subjects (only if entering or if years changed: changedFieldId is null)
        if (subSelect && changedFieldId === null) {
            const currentSub = subSelect.value;
            const subjectsSet = new Set();
            questionsInSelectedYears.forEach(q => { if (q.subject) subjectsSet.add(q.subject); });
            const sortedSubjects = Array.from(subjectsSet).sort();

            subSelect.innerHTML = '<option value="all">All Subjects</option>';
            sortedSubjects.forEach(sub => {
                const opt = document.createElement('option');
                opt.value = sub;
                opt.innerText = sub;
                subSelect.appendChild(opt);
            });

            if (sortedSubjects.includes(currentSub)) {
                subSelect.value = currentSub;
            } else {
                subSelect.value = 'all';
            }
        }

        const activeSubject = subSelect ? subSelect.value : 'all';

        // Populate chapters (if years changed or subject changed)
        if (chapSelect && (changedFieldId === null || changedFieldId === 'builder-subject')) {
            const currentChap = chapSelect.value;
            const chaptersSet = new Set();
            questionsInSelectedYears.forEach(q => {
                if (q.chapter && (activeSubject === 'all' || q.subject === activeSubject)) {
                    chaptersSet.add(q.chapter);
                }
            });
            const sortedChapters = Array.from(chaptersSet).sort();

            chapSelect.innerHTML = '<option value="all">All Chapters</option>';
            sortedChapters.forEach(chap => {
                const opt = document.createElement('option');
                opt.value = chap;
                opt.innerText = chap;
                chapSelect.appendChild(opt);
            });

            if (sortedChapters.includes(currentChap)) {
                chapSelect.value = currentChap;
            } else {
                chapSelect.value = 'all';
            }
        }

        const activeChapter = chapSelect ? chapSelect.value : 'all';

        // Populate topics (if years, subject, or chapter changed)
        if (topSelect && (changedFieldId === null || changedFieldId === 'builder-subject' || changedFieldId === 'builder-chapter')) {
            const currentTopic = topSelect.value;
            const topicsSet = new Set();
            questionsInSelectedYears.forEach(q => {
                const subMatch = (activeSubject === 'all' || q.subject === activeSubject);
                const chapMatch = (activeChapter === 'all' || q.chapter === activeChapter);
                if (q.topic && subMatch && chapMatch) {
                    topicsSet.add(q.topic);
                }
            });
            const sortedTopics = Array.from(topicsSet).sort();

            topSelect.innerHTML = '<option value="all">All Topics</option>';
            sortedTopics.forEach(top => {
                const opt = document.createElement('option');
                opt.value = top;
                opt.innerText = top;
                topSelect.appendChild(opt);
            });

            if (sortedTopics.includes(currentTopic)) {
                topSelect.value = currentTopic;
            } else {
                topSelect.value = 'all';
            }
        }

        // Update matches count
        const filtered = getFilteredBuilderQuestions(allQ);
        const countEl = document.getElementById('builder-q-count');
        if (countEl) {
            countEl.innerText = filtered.length;
        }
    }

    function getFilteredBuilderQuestions(allQ) {
        const subSelect = document.getElementById('builder-subject');
        const chapSelect = document.getElementById('builder-chapter');
        const topSelect = document.getElementById('builder-topic');

        const activeSubject = subSelect ? subSelect.value : 'all';
        const activeChapter = chapSelect ? chapSelect.value : 'all';
        const activeTopic = topSelect ? topSelect.value : 'all';

        const weightageEl = document.querySelector('input[name="builder-weightage"]:checked');
        const activeWeightage = weightageEl ? weightageEl.value : 'all';

        const statusEl = document.querySelector('input[name="builder-status"]:checked');
        const activeStatus = statusEl ? statusEl.value : 'all';

        const selectedYears = [];
        document.querySelectorAll('.builder-year-cb:checked').forEach(cb => {
            selectedYears.push(cb.value);
        });

        let filtered = allQ;

        // 1. Year filter
        filtered = filtered.filter(q => q.year && selectedYears.includes(q.year.toString()));

        // 2. Subject filter
        if (activeSubject !== 'all') {
            filtered = filtered.filter(q => q.subject === activeSubject);
        }

        // 3. Chapter filter
        if (activeChapter !== 'all') {
            filtered = filtered.filter(q => q.chapter === activeChapter);
        }

        // 4. Topic filter
        if (activeTopic !== 'all') {
            filtered = filtered.filter(q => q.topic === activeTopic);
        }

        // 5. Weightage filter
        if (activeWeightage === 'high') {
            filtered = filtered.filter(q => q.exam_weightage && q.exam_weightage.toLowerCase() === 'high');
        }

        // 6. Status filter
        const seenIds = JSON.parse(localStorage.getItem('moproprep_seen_upsc') || '[]');
        const wrongIds = JSON.parse(localStorage.getItem('moproprep_wrong_upsc') || '[]');

        if (activeStatus === 'unseen') {
            filtered = filtered.filter(q => {
                const qId = q.id || `${q.year}_${q.category}_${(q.question_text || q.questionText || '').substring(0, 20)}`;
                return !seenIds.includes(qId.toString());
            });
        } else if (activeStatus === 'incorrect') {
            filtered = filtered.filter(q => {
                const qId = q.id || `${q.year}_${q.category}_${(q.question_text || q.questionText || '').substring(0, 20)}`;
                return wrongIds.includes(qId.toString());
            });
        }

        return filtered;
    }

    // --- AI Duel Custom Selection Filter ---
    let aiDuelBuilderInitialized = false;

    function initAiDuelBuilder(allQ) {
        if (!aiDuelBuilderInitialized) {
            // Populate Years Grid checkbox dynamically
            const yearsSet = new Set();
            allQ.forEach(q => {
                if (q.year) yearsSet.add(q.year.toString());
            });
            const sortedYears = Array.from(yearsSet).sort((a, b) => b - a);

            const yearsGrid = document.getElementById('ai-duel-years-grid');
            if (yearsGrid) {
                yearsGrid.innerHTML = '';
                sortedYears.forEach(year => {
                    const label = document.createElement('label');
                    label.style.display = 'flex';
                    label.style.alignItems = 'center';
                    label.style.gap = '0.5rem';
                    label.style.cursor = 'pointer';
                    label.style.fontSize = '0.9rem';
                    label.style.color = 'var(--text-main)';
                    label.innerHTML = `
                        <input type="checkbox" class="ai-duel-year-cb" value="${year}" checked style="width: 16px; height: 16px; cursor: pointer;">
                        <span>${year}</span>
                    `;
                    yearsGrid.appendChild(label);
                });
            }
            aiDuelBuilderInitialized = true;
        }

        updateAiDuelBuilderOptions(allQ);
    }

    function updateAiDuelBuilderOptions(allQ, changedFieldId = null) {
        const subSelect = document.getElementById('ai-duel-subject');
        const chapSelect = document.getElementById('ai-duel-chapter');
        const topSelect = document.getElementById('ai-duel-topic');

        // Retrieve active year filters
        const selectedYears = [];
        document.querySelectorAll('.ai-duel-year-cb:checked').forEach(cb => {
            selectedYears.push(cb.value);
        });

        // Filter all questions by selected years first
        const questionsInSelectedYears = allQ.filter(q => q.year && selectedYears.includes(q.year.toString()));

        // Populate subjects
        if (subSelect && changedFieldId === null) {
            const currentSub = subSelect.value;
            const subjectsSet = new Set();
            questionsInSelectedYears.forEach(q => { if (q.subject) subjectsSet.add(q.subject); });
            const sortedSubjects = Array.from(subjectsSet).sort();

            subSelect.innerHTML = '<option value="all">All Subjects</option>';
            sortedSubjects.forEach(sub => {
                const opt = document.createElement('option');
                opt.value = sub;
                opt.innerText = sub;
                subSelect.appendChild(opt);
            });

            if (sortedSubjects.includes(currentSub)) {
                subSelect.value = currentSub;
            } else {
                subSelect.value = 'all';
            }
        }

        const activeSubject = subSelect ? subSelect.value : 'all';

        // Populate chapters
        if (chapSelect && (changedFieldId === null || changedFieldId === 'ai-duel-subject')) {
            const currentChap = chapSelect.value;
            const chaptersSet = new Set();
            questionsInSelectedYears.forEach(q => {
                if (q.chapter && (activeSubject === 'all' || q.subject === activeSubject)) {
                    chaptersSet.add(q.chapter);
                }
            });
            const sortedChapters = Array.from(chaptersSet).sort();

            chapSelect.innerHTML = '<option value="all">All Chapters</option>';
            sortedChapters.forEach(chap => {
                const opt = document.createElement('option');
                opt.value = chap;
                opt.innerText = chap;
                chapSelect.appendChild(opt);
            });

            if (sortedChapters.includes(currentChap)) {
                chapSelect.value = currentChap;
            } else {
                chapSelect.value = 'all';
            }
        }

        const activeChapter = chapSelect ? chapSelect.value : 'all';

        // Populate topics
        if (topSelect && (changedFieldId === null || changedFieldId === 'ai-duel-subject' || changedFieldId === 'ai-duel-chapter')) {
            const currentTopic = topSelect.value;
            const topicsSet = new Set();
            questionsInSelectedYears.forEach(q => {
                const subMatch = (activeSubject === 'all' || q.subject === activeSubject);
                const chapMatch = (activeChapter === 'all' || q.chapter === activeChapter);
                if (q.topic && subMatch && chapMatch) {
                    topicsSet.add(q.topic);
                }
            });
            const sortedTopics = Array.from(topicsSet).sort();

            topSelect.innerHTML = '<option value="all">All Topics</option>';
            sortedTopics.forEach(top => {
                const opt = document.createElement('option');
                opt.value = top;
                opt.innerText = top;
                topSelect.appendChild(opt);
            });

            if (sortedTopics.includes(currentTopic)) {
                topSelect.value = currentTopic;
            } else {
                topSelect.value = 'all';
            }
        }

        // Update matches count
        const filtered = getFilteredAiDuelQuestions(allQ);
        const countEl = document.getElementById('ai-duel-q-count');
        if (countEl) {
            countEl.innerText = filtered.length;
        }
    }

    function getFilteredAiDuelQuestions(allQ) {
        const subSelect = document.getElementById('ai-duel-subject');
        const chapSelect = document.getElementById('ai-duel-chapter');
        const topSelect = document.getElementById('ai-duel-topic');

        const activeSubject = subSelect ? subSelect.value : 'all';
        const activeChapter = chapSelect ? chapSelect.value : 'all';
        const activeTopic = topSelect ? topSelect.value : 'all';

        const selectedYears = [];
        document.querySelectorAll('.ai-duel-year-cb:checked').forEach(cb => {
            selectedYears.push(cb.value);
        });

        let filtered = allQ;

        // 1. Year filter
        filtered = filtered.filter(q => q.year && selectedYears.includes(q.year.toString()));

        // 2. Subject filter
        if (activeSubject !== 'all') {
            filtered = filtered.filter(q => q.subject === activeSubject);
        }

        // 3. Chapter filter
        if (activeChapter !== 'all') {
            filtered = filtered.filter(q => q.chapter === activeChapter);
        }

        // 4. Topic filter
        if (activeTopic !== 'all') {
            filtered = filtered.filter(q => q.topic === activeTopic);
        }

        return filtered;
    }

    // --- UPSC Super CMS Gamification Functions ---
    function initDailyLives() {
        const today = new Date().toISOString().split('T')[0]; // YYYY-MM-DD
        const savedDate = localStorage.getItem('moproprep_lives_date');
        
        if (savedDate !== today) {
            localStorage.setItem('moproprep_lives_date', today);
            localStorage.setItem('moproprep_lives_count', '3');
            return 3;
        }
        
        const count = localStorage.getItem('moproprep_lives_count');
        return count ? parseInt(count, 10) : 3;
    }
    
    function getDailyLives() {
        const count = localStorage.getItem('moproprep_lives_count');
        return count ? parseInt(count, 10) : 3;
    }

    function deductDailyLife() {
        let count = getDailyLives();
        count = Math.max(0, count - 1);
        localStorage.setItem('moproprep_lives_count', count.toString());
        return count;
    }

    function updatePatientStatusUI() {
        const cond = document.getElementById('patient-condition-text');
        const fill = document.getElementById('stability-fill');
        
        const health = state.patientStability;
        let barColor = 'linear-gradient(90deg, #81c784, #4caf50)'; // Green default
        
        if (health >= 90) {
            if (cond) {
                cond.innerText = "Stable Condition 🟢";
                cond.style.color = "#66bb6a";
            }
            barColor = 'linear-gradient(90deg, #81c784, #4caf50)';
        } else if (health >= 60) {
            if (cond) {
                cond.innerText = "Moderate Distress 🟡";
                cond.style.color = "#ffca28";
            }
            barColor = 'linear-gradient(90deg, #ffd54f, #ffca28)';
        } else if (health >= 30) {
            if (cond) {
                cond.innerText = "Severe Distress 🟠";
                cond.style.color = "#ff9100";
            }
            barColor = 'linear-gradient(90deg, #ffb74d, #ff9100)';
        } else if (health >= 1) {
            if (cond) {
                cond.innerText = "Critical Condition 🔴";
                cond.style.color = "#ef5350";
            }
            barColor = 'linear-gradient(90deg, #e57373, #ef5350)';
        } else {
            if (cond) {
                cond.innerText = "Deceased 💀";
                cond.style.color = "#8e0000";
            }
            barColor = 'linear-gradient(90deg, #b0bec5, #78909c)'; // Gray/flatline color
        }
        
        if (fill) {
            fill.style.background = barColor;
        }
    }

    function updatePatientWalkingTrack() {
        const totalSteps = state.questions.length;
        const currentStep = state.currentQuestionIndex;
        
        const trackLength = 20;
        const stepSize = totalSteps > 0 ? trackLength / totalSteps : 1;
        const runnerIndex = Math.min(trackLength - 1, Math.round(currentStep * stepSize));
        
        // Dynamic deteriorating mascot based on stability
        let mascot = '🏃';
        const health = state.patientStability;
        if (health >= 90) {
            mascot = '🏃'; // Energetic running
        } else if (health >= 60) {
            mascot = '🚶'; // Walking tiredly
        } else if (health >= 30) {
            mascot = '🤕'; // Sick, bandaged head
        } else if (health >= 1) {
            mascot = '🛌'; // Critically ill, bedridden
        } else {
            mascot = '💀'; // Deceased
        }

        let middleTrack = "";
        for (let i = 0; i < trackLength; i++) {
            if (i === runnerIndex) {
                middleTrack += `<span class="mascot-live">${mascot}</span>`;
            } else {
                middleTrack += "-";
            }
        }
        
        const walkTrackEl = document.getElementById('patient-walk-track');
        if (walkTrackEl) {
            walkTrackEl.innerHTML = `🚑 ${middleTrack} 🏠`;
        }
    }

    function showUpscEntry() {
        state.activeTag = 'upscmo';
        state.upscDrillLevel = 'entry';
        switchView('upscEntry');
        preloadUpscQuestions();
    }

    function showUpscSuperCms() {
        state.activeTag = 'upscmo';
        state.upscDrillLevel = 'supercms';
        switchView('upscSuperCms');
        preloadUpscQuestions();
    }

    function startSuperCms(mode, subtype) {
        state.superCmsMode = mode;
        state.activeTag = 'upscmo';
        state.upscQuizSource = 'supercms';

        // Reset gamification state variables
        state.patientStability = 100;
        state.savedPatients = 0;
        state.failedPatients = 0;
        state.streak = 0;
        state.maxStreak = 0;
        state.curedCount = 0;

        if (state.aiInterval) {
            clearInterval(state.aiInterval);
            state.aiInterval = null;
        }
        state.aiQuestionIndex = 0;
        state.aiScore = 0;

        preloadUpscQuestions().then(allQ => {
            let selectedQuestions = [];

            if (mode === 'clearance') {
                if (subtype === 'unseen') {
                    const seenIds = JSON.parse(localStorage.getItem('moproprep_seen_upsc') || '[]');
                    selectedQuestions = allQ.filter(q => {
                        const qId = q.id || `${q.year}_${q.category}_${(q.question_text || q.questionText || '').substring(0, 20)}`;
                        return !seenIds.includes(qId.toString());
                    });
                    if (selectedQuestions.length === 0) {
                        alert("Great job! You have touched all questions. Solve wrongly marked ones or check out other sections.");
                        return;
                    }
                } else {
                    const wrongIds = JSON.parse(localStorage.getItem('moproprep_wrong_upsc') || '[]');
                    if (wrongIds.length === 0) {
                        alert("Congratulations! You have no incorrect questions in your history. Go play other modes to test your limits.");
                        return;
                    }
                    selectedQuestions = allQ.filter(q => {
                        const qId = q.id || `${q.year}_${q.category}_${(q.question_text || q.questionText || '').substring(0, 20)}`;
                        return wrongIds.includes(qId.toString());
                    });
                }
                selectedQuestions = shuffleArray([...selectedQuestions]);
            } else if (mode === 'duel') {
                const filtered = getFilteredAiDuelQuestions(allQ);
                if (filtered.length === 0) {
                    alert("No questions found matching your filter selection. Please adjust your criteria.");
                    return;
                }
                const shuffled = shuffleArray([...filtered]);
                selectedQuestions = shuffled.slice(0, 10);
            } else {
                const shuffled = shuffleArray([...allQ]);
                selectedQuestions = shuffled.slice(0, 10);
            }

            if (selectedQuestions.length === 0) {
                alert("No questions found.");
                return;
            }

            state.questions = selectedQuestions;
            state.sessionKey = 'progress_upsc_super_cms_' + mode;
            state.mode = 'YEAR';

            // Show gamified elements and hide others
            const panel = document.getElementById('super-cms-panel');
            if (panel) panel.style.display = 'flex';

            const stabilityContainer = document.getElementById('gamified-stability-container');
            const aiContainer = document.getElementById('gamified-ai-container');
            const streakContainer = document.getElementById('gamified-streak-container');

            if (stabilityContainer) stabilityContainer.style.display = (mode === 'case_file') ? 'flex' : 'none';
            if (aiContainer) aiContainer.style.display = (mode === 'duel') ? 'flex' : 'none';
            if (streakContainer) streakContainer.style.display = (mode === 'hot_seat') ? 'flex' : 'none';

            const stabilityFill = document.getElementById('stability-fill');
            const stabilityPercent = document.getElementById('stability-percent');
            if (stabilityFill) stabilityFill.style.width = '100%';
            if (stabilityPercent) stabilityPercent.innerText = '100%';

            if (mode === 'case_file') {
                initDailyLives();
                const livesText = document.getElementById('lives-counter-text');
                if (livesText) livesText.innerText = getDailyLives();
                
                const cond = document.getElementById('patient-condition-text');
                if (cond) {
                    cond.innerText = "Stable Condition 🟢";
                    cond.style.color = "#66bb6a";
                }
                
                updatePatientWalkingTrack();
            }

            if (mode === 'duel') {
                const userInd = document.getElementById('duel-user-indicator');
                const aiInd = document.getElementById('duel-ai-indicator');
                if (userInd) {
                    userInd.style.left = '0%';
                    userInd.innerHTML = '<span class="mascot-live">🩺</span> You';
                }
                if (aiInd) {
                    aiInd.style.left = '0%';
                    aiInd.innerHTML = `<span class="mascot-live">${state.aiMascot || '🤖'}</span> AI`;
                }

                const userScoreEl = document.getElementById('user-score-stat');
                const aiScoreEl = document.getElementById('ai-score-stat');
                if (userScoreEl) userScoreEl.innerText = '0';
                if (aiScoreEl) aiScoreEl.innerText = '0';

                const statusTxt = document.getElementById('ai-status-text');
                const name = state.aiName || "AI Resident";
                if (statusTxt) statusTxt.innerHTML = `<span class="mascot-live">${state.aiMascot || '🤖'}</span> ${name} ready...`;

                startAiSimulation(selectedQuestions.length);
            }

            startQuiz();
        });
    }

    function startAiSimulation(totalQuestions) {
        state.aiQuestionIndex = 0;
        state.aiScore = 0;

        const accuracy = state.aiAccuracy || 0.50;
        const speed = state.aiSpeed || 9500;
        const name = state.aiName || "AI Resident";

        state.aiInterval = setInterval(() => {
            if (state.aiQuestionIndex >= totalQuestions) {
                clearInterval(state.aiInterval);
                state.aiInterval = null;
                const statusTxt = document.getElementById('ai-status-text');
                if (statusTxt) statusTxt.innerHTML = `<span class="mascot-live">${state.aiMascot || '🤖'}</span> Finished!`;
                return;
            }

            state.aiQuestionIndex++;
            const isCorrect = Math.random() < accuracy;
            if (isCorrect) state.aiScore++;

            const aiPercent = Math.round((state.aiQuestionIndex / totalQuestions) * 100);
            const aiInd = document.getElementById('duel-ai-indicator');
            if (aiInd) aiInd.style.left = `calc(${aiPercent}% - 30px)`;

            const aiScoreEl = document.getElementById('ai-score-stat');
            if (aiScoreEl) {
                aiScoreEl.innerText = state.aiScore;
            }

            const statusTxt = document.getElementById('ai-status-text');
            if (statusTxt) {
                statusTxt.innerHTML = `<span class="mascot-live">${state.aiMascot || '🤖'}</span> Q${Math.min(state.aiQuestionIndex + 1, totalQuestions)}...`;
            }
        }, speed + (Math.random() * 3000 - 1500));
    }

    // --- Logic & Rendering ---
    function selectMode(tag, title, desc, mode = 'YEAR', backView = 'home') {
        state.activeTag = tag;
        state.mode = mode;
        state.previousView = backView; // Remember where to go back to
        state.currentPaper = null;     // Reset paper selection
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
                } else if (state.activeTag === 'upscmo') {
                    state.upscFlow = 'yearwise';
                    state.upscSelectedYear = year.year.toString();
                    state.upscDrillLevel = 'subjects';
                    switchView('yearSelection');
                    els.viewTitle.innerText = 'Select Subject';
                    els.viewDesc.innerText = `Choose a subject in ${year.year} to practice.`;
                    els.yearsGrid.innerHTML = '<div class="loader"></div>';
                    preloadUpscQuestions().then(allQ => {
                        const yf = document.getElementById('upsc-year-filter');
                        if (yf) yf.value = year.year.toString();
                        renderUpscSubjects(allQ);
                    });
                    return;
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

    function renderPapers(year) {
        els.yearsGrid.innerHTML = '';

        // BACK CARD
        const backCard = document.createElement('div');
        backCard.className = 'year-card';
        backCard.style.opacity = '0.8';
        backCard.innerHTML = `
            <div class="year-title">⬅️ Back</div>
            <div class="year-desc">Return to Year Selection</div>
        `;
        backCard.onclick = () => {
            state.upscDrillLevel = 'years';
            renderYears();
        };
        els.yearsGrid.appendChild(backCard);

        // Render Paper 1 Card
        const keyP1 = `progress_year_${year}_upscmo_paper_1`;
        const savedP1 = getSavedProgress(keyP1);
        const progressP1 = savedP1 ? `<div class="card-status">Progress: ${savedP1.index + 1}/${savedP1.total}</div>` : '';

        const cardP1 = document.createElement('div');
        cardP1.className = 'year-card';
        cardP1.innerHTML = `
            <div class="year-title">Paper 1</div>
            <div class="year-desc">UPSC CMS ${year} Paper 1</div>
            ${progressP1}
        `;
        cardP1.onclick = () => loadQuestions(year, 1);
        els.yearsGrid.appendChild(cardP1);

        // Render Paper 2 Card
        const keyP2 = `progress_year_${year}_upscmo_paper_2`;
        const savedP2 = getSavedProgress(keyP2);
        const progressP2 = savedP2 ? `<div class="card-status">Progress: ${savedP2.index + 1}/${savedP2.total}</div>` : '';

        const cardP2 = document.createElement('div');
        cardP2.className = 'year-card';
        cardP2.innerHTML = `
            <div class="year-title">Paper 2</div>
            <div class="year-desc">UPSC CMS ${year} Paper 2</div>
            ${progressP2}
        `;
        cardP2.onclick = () => loadQuestions(year, 2);
        els.yearsGrid.appendChild(cardP2);
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

        // Log solved questions to history
        let history = [];
        try {
            history = JSON.parse(localStorage.getItem('moproprep_solve_history') || '[]');
        } catch (e) {}

        state.questions.forEach((q, index) => {
            const userAns = state.userAnswers[index];
            if (userAns) {
                const isCorrect = userAns === (q.correct_answer || q.correctAnswer);
                const qId = q.id || `${q.year}_${q.category || q.tags?.[0] || 'General'}_${(q.question_text || q.questionText || '').substring(0, 20)}`;
                const entry = {
                    qId: qId.toString(),
                    timestamp: Date.now(),
                    isCorrect: isCorrect,
                    subject: q.subject || 'General',
                    chapter: q.chapter || 'General',
                    topic: q.topic || 'General',
                    year: q.year ? parseInt(q.year, 10) : 0,
                    paper: q.paper ? parseInt(q.paper, 10) : 0
                };
                history.push(entry);
            }
        });

        localStorage.setItem('moproprep_solve_history', JSON.stringify(history));
        
        if (AuthService.isLoggedIn()) {
            AuthService.saveProgress('moproprep_solve_history', { history: history });
        }

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

    function formatExplanationMarkdown(text) {
        if (!text) return 'No explanation available.';
        
        let processed = text.replace(/\\n/g, '\n').replace(/\r\n/g, '\n');
        processed = processed.replace(/\[cite:\s*[^\]]+\]/g, '');
        
        // 1. Convert bold headers to H3
        processed = processed.replace(/^\s*\*\*(1\.\s*DIRECT\s*ANSWER\s*(?:&\s*CORE\s*EXPLANATION)?)\*\*/gmi, '### $1');
        processed = processed.replace(/^\s*\*\*(2\.\s*BREAKDOWN\s*OF\s*OPTIONS)\*\*/gmi, '### $1');
        processed = processed.replace(/^\s*\*\*(3\.\s*MEMORY\s*AID\s*(?:\(MNEMONIC\))?)\*\*/gmi, '### $1');
        processed = processed.replace(/^\s*\*\*(4\.\s*FUTURE\s*QUESTIONS\s*(?:&\s*CONNECTIONS)?)\*\*/gmi, '### $1');

        // 2. Convert plain headers to H3
        processed = processed.replace(/^(?!\s*#)(?!\s*\*)\s*(1\.\s*DIRECT\s*ANSWER\s*(?:&\s*CORE\s*EXPLANATION)?)/gmi, '### $1');
        processed = processed.replace(/^(?!\s*#)(?!\s*\*)\s*(2\.\s*BREAKDOWN\s*OF\s*OPTIONS)/gmi, '### $1');
        processed = processed.replace(/^(?!\s*#)(?!\s*\*)\s*(3\.\s*MEMORY\s*AID\s*(?:\(MNEMONIC\))?)/gmi, '### $1');
        processed = processed.replace(/^(?!\s*#)(?!\s*\*)\s*(4\.\s*FUTURE\s*QUESTIONS\s*(?:&\s*CONNECTIONS)?)/gmi, '### $1');

        // 3. Fix running-together heading bug
        processed = processed.replace(/^(### 1\.\s*DIRECT\s*ANSWER\s*(?:&\s*CORE\s*EXPLANATION)?\s*)([^\s\n].*)$/gmi, '$1\n$2');
        processed = processed.replace(/^(### 2\.\s*BREAKDOWN\s*OF\s*OPTIONS\s*)([^\s\n].*)$/gmi, '$1\n$2');
        processed = processed.replace(/^(### 3\.\s*MEMORY\s*AID\s*(?:\(MNEMONIC\))?\s*)([^\s\n].*)$/gmi, '$1\n$2');
        processed = processed.replace(/^(### 4\.\s*FUTURE\s*QUESTIONS\s*(?:&\s*CONNECTIONS)?\s*)([^\s\n].*)$/gmi, '$1\n$2');

        // 4. Remove tick/cross emojis and style breakdown option headings
        processed = processed.replace(/^(\s*[-*]?\s*)✅\s*\*\*([^*]+)\*\*/gmi, '$1<strong class="correct-option-heading">$2</strong>');
        processed = processed.replace(/^(\s*[-*]?\s*)❌\s*\*\*([^*]+)\*\*/gmi, '$1<strong class="wrong-option-heading">$2</strong>');

        return processed.trim();
    }

    function renderQuestion() {
        if (!state.questions[state.currentQuestionIndex]) {
            console.error("Question not found at index:", state.currentQuestionIndex);
            showResults();
            return;
        }
        const q = state.questions[state.currentQuestionIndex];

        // Update user position on progress track for AI Duel
        if (state.superCmsMode === 'duel') {
            const userPercent = Math.round((state.currentQuestionIndex / state.questions.length) * 100);
            const userInd = document.getElementById('duel-user-indicator');
            if (userInd) userInd.style.left = `calc(${userPercent}% - 35px)`;

            const userScoreEl = document.getElementById('user-score-stat');
            if (userScoreEl) {
                userScoreEl.innerText = state.score;
            }
        }

        // Reset UI - PROPERLY hide and clear feedback
        els.feedbackArea.style.display = 'none';
        els.feedbackText.innerText = '';
        els.feedbackText.style.color = '';
        els.feedbackArea.classList.remove('correct', 'wrong');
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
        if (state.activeTag === 'upscmo') {
            const paperStr = q.paper ? ` | Paper ${q.paper}` : '';
            const subjectStr = q.subject ? ` | ${q.subject}` : '';
            const chapStr = q.chapter ? ` | ${q.chapter}` : '';
            els.qCategory.innerText = `UPSC CMS${paperStr}${subjectStr}${chapStr}`;
        } else {
            els.qCategory.innerText = (q.tags && q.tags[0]) ? q.tags[0] : 'General';
        }

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

        if (state.superCmsMode === 'case_file') {
            updatePatientWalkingTrack();
        }

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
                els.explanationText.innerHTML = marked.parse(formatExplanationMarkdown(explanation));
                els.feedbackArea.style.display = 'block';

                if (state.testMode) {
                    els.feedbackText.style.display = 'none';
                    els.nextBtn.style.display = 'none';
                } else {
                    // Practice Mode
                    const isCorrect = savedAnswer === correctKey;
                    els.feedbackText.innerText = isCorrect ? 'Correct! 🎉' : `Incorrect. The correct answer is ${correctKey}.`;
                    els.feedbackText.style.color = isCorrect ? '#10b981' : '#ef4444';
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
        const q = state.questions[state.currentQuestionIndex];

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

        // Log solved question to history
        if (q) {
            const qId = q.id || `${q.year}_${q.category || q.tags?.[0] || 'General'}_${(q.question_text || q.questionText || '').substring(0, 20)}`;
            const entry = {
                qId: qId.toString(),
                timestamp: Date.now(),
                isCorrect: isCorrect,
                subject: q.subject || 'General',
                chapter: q.chapter || 'General',
                topic: q.topic || 'General',
                year: q.year ? parseInt(q.year, 10) : 0,
                paper: q.paper ? parseInt(q.paper, 10) : 0
            };
            let history = [];
            try {
                history = JSON.parse(localStorage.getItem('moproprep_solve_history') || '[]');
            } catch (e) {}
            history.push(entry);
            localStorage.setItem('moproprep_solve_history', JSON.stringify(history));

            if (AuthService.isLoggedIn()) {
                AuthService.saveProgress('moproprep_solve_history', { history: history });
            }
        }

        // Track seen and wrong answers for UPSC revision
        if (state.activeTag === 'upscmo' && q) {
            const qId = q.id || `${q.year}_${q.category}_${(q.question_text || q.questionText || '').substring(0, 20)}`;
            const qIdStr = qId.toString();
            
            // Mark as seen
            try {
                let seenIds = JSON.parse(localStorage.getItem('moproprep_seen_upsc') || '[]');
                if (!seenIds.includes(qIdStr)) {
                    seenIds.push(qIdStr);
                    localStorage.setItem('moproprep_seen_upsc', JSON.stringify(seenIds));
                }
            } catch (e) {
                console.error("Failed to update seen questions:", e);
            }

            // Mark as wrong/correct
            try {
                let wrongIds = JSON.parse(localStorage.getItem('moproprep_wrong_upsc') || '[]');
                if (!isCorrect) {
                    if (!wrongIds.includes(qIdStr)) {
                        wrongIds.push(qIdStr);
                        localStorage.setItem('moproprep_wrong_upsc', JSON.stringify(wrongIds));
                    }
                } else {
                    const idx = wrongIds.indexOf(qIdStr);
                    if (idx > -1) {
                        wrongIds.splice(idx, 1);
                        localStorage.setItem('moproprep_wrong_upsc', JSON.stringify(wrongIds));
                    }
                }
            } catch (e) {
                console.error("Failed to update wrong questions:", e);
            }
        }

        // Highlight logic
        buttons.forEach(btn => {
            const letter = btn.querySelector('.option-letter').innerText;
            if (letter === correctKey) btn.classList.add('correct');
            if (letter === selectedKey && !isCorrect) btn.classList.add('wrong');
        });

        if (isCorrect) {
            state.score++;
            els.currentScore.innerText = state.score;
            
            if (state.superCmsMode === 'case_file') {
                state.patientStability = Math.min(100, state.patientStability + 20);
                const fill = document.getElementById('stability-fill');
                const pct = document.getElementById('stability-percent');
                if (fill) fill.style.width = `${state.patientStability}%`;
                if (pct) pct.innerText = `${state.patientStability}%`;
                
                updatePatientStatusUI();
                updatePatientWalkingTrack();
                
                els.feedbackText.innerText = `Successful Diagnosis! Patient stabilized (+20% Stability). 🎉`;
                els.feedbackText.style.color = '#10b981';
                state.savedPatients++;
            } else if (state.superCmsMode === 'hot_seat') {
                state.streak++;
                state.maxStreak = Math.max(state.maxStreak, state.streak);
                let mult = 1.0;
                if (state.streak >= 7) mult = 3.0;
                else if (state.streak >= 5) mult = 2.0;
                else if (state.streak >= 3) mult = 1.5;
                
                const streakCounter = document.getElementById('streak-counter');
                const streakMultiplier = document.getElementById('streak-multiplier');
                if (streakCounter) streakCounter.innerText = state.streak;
                if (streakMultiplier) streakMultiplier.innerText = `${mult}x`;
                
                els.feedbackText.innerText = `Correct! Streak: ${state.streak} 🔥 (${mult}x multiplier active)`;
                els.feedbackText.style.color = '#10b981';
            } else if (state.superCmsMode === 'clearance') {
                state.curedCount++;
                els.feedbackText.innerText = `Cured! Anomaly successfully cleared from your memory logs. 🛡️`;
                els.feedbackText.style.color = '#10b981';
            } else if (state.superCmsMode === 'duel') {
                const userScoreEl = document.getElementById('user-score-stat');
                if (userScoreEl) userScoreEl.innerText = state.score;
                els.feedbackText.innerText = 'Correct! 🎉';
                els.feedbackText.style.color = '#10b981';
            } else {
                els.feedbackText.innerText = 'Correct! 🎉';
                els.feedbackText.style.color = '#10b981';
            }
        } else {
            if (state.superCmsMode === 'case_file') {
                state.patientStability = Math.max(0, state.patientStability - 35);
                const fill = document.getElementById('stability-fill');
                const pct = document.getElementById('stability-percent');
                if (fill) fill.style.width = `${state.patientStability}%`;
                if (pct) pct.innerText = `${state.patientStability}%`;
                
                updatePatientStatusUI();
                updatePatientWalkingTrack();
                
                if (state.patientStability === 0) {
                    els.feedbackText.innerText = `Critical Failure! Patient lost stability. Correct answer is ${correctKey}.`;
                    state.failedPatients++;
                    
                    // Trigger resuscitation flow
                    setTimeout(() => {
                        const modal = document.getElementById('resuscitate-modal');
                        const msg = document.getElementById('resuscitate-msg');
                        const btnRes = document.getElementById('btn-resuscitate');
                        const lives = getDailyLives();
                        
                        if (modal) {
                            modal.style.display = 'flex';
                            if (msg) {
                                msg.innerHTML = `Your patient is deceased! 💀 You have <strong>${lives}</strong> daily lives left today. Spend 1 life to resuscitate them and continue?`;
                            }
                            if (btnRes) {
                                if (lives > 0) {
                                    btnRes.disabled = false;
                                    btnRes.style.opacity = '1';
                                    btnRes.innerText = `❤️ Resuscitate (Use 1 Life)`;
                                } else {
                                    btnRes.disabled = true;
                                    btnRes.style.opacity = '0.5';
                                    btnRes.innerText = `❌ No Lives Remaining`;
                                }
                            }
                        }
                    }, 1200);
                } else {
                    els.feedbackText.innerText = `Incorrect diagnosis. Patient stability dropped to ${state.patientStability}%! Correct answer is ${correctKey}.`;
                }
                els.feedbackText.style.color = '#ef4444';
            } else if (state.superCmsMode === 'hot_seat') {
                state.streak = 0;
                const streakCounter = document.getElementById('streak-counter');
                const streakMultiplier = document.getElementById('streak-multiplier');
                if (streakCounter) streakCounter.innerText = '0';
                if (streakMultiplier) streakMultiplier.innerText = '1.0x';
                els.feedbackText.innerText = `Incorrect. Streak reset. The correct answer was ${correctKey}.`;
                els.feedbackText.style.color = '#ef4444';
            } else {
                els.feedbackText.innerText = `Incorrect. The correct answer is ${correctKey}.`;
                els.feedbackText.style.color = '#ef4444';
            }
        }

        els.explanationText.innerHTML = marked.parse(formatExplanationMarkdown(explanation));

        els.feedbackArea.style.display = 'block';

        // Save progress after answering
        saveProgress();

        // Track question solve in Firestore for Admin Stats
        if (AuthService.isLoggedIn() && isCorrect) {
            const qId = q ? (q.id || q.ID) : null;
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

        // Stop timer & AI Simulation interval
        if (state.timerInterval) clearInterval(state.timerInterval);
        if (state.aiInterval) {
            clearInterval(state.aiInterval);
            state.aiInterval = null;
        }

        // Clear progress when quiz is finished
        clearProgress();

        const superCmsResults = document.getElementById('super-cms-results');
        const caseCard = document.getElementById('results-case-file-card');
        const aiCard = document.getElementById('results-ai-duel-card');
        const streakCard = document.getElementById('results-hot-seat-card');
        const clearanceCard = document.getElementById('results-clearance-card');

        // Hide all gamified cards by default
        if (superCmsResults) superCmsResults.style.display = 'none';
        if (caseCard) caseCard.style.display = 'none';
        if (aiCard) aiCard.style.display = 'none';
        if (streakCard) streakCard.style.display = 'none';
        if (clearanceCard) clearanceCard.style.display = 'none';

        const percentage = (state.score / state.questions.length) * 100;
        if (percentage >= 80) els.performanceMsg.innerText = "Outstanding! You're a pro! 🌟";
        else if (percentage >= 50) els.performanceMsg.innerText = "Good job! Keep practicing. 👍";
        else els.performanceMsg.innerText = "Keep studying, you'll get there! 📚";

        if (state.superCmsMode) {
            if (superCmsResults) superCmsResults.style.display = 'flex';

            if (state.superCmsMode === 'case_file') {
                if (caseCard) caseCard.style.display = 'block';
                // Calculate stars based on saved patients vs total
                const starsCount = Math.ceil((state.savedPatients / state.questions.length) * 3);
                const starIcons = '⭐'.repeat(starsCount) + '☆'.repeat(3 - starsCount);
                const starEl = document.getElementById('case-file-stars');
                if (starEl) starEl.innerText = starIcons || '☆☆☆';
                
                const savedEl = document.getElementById('results-saved-patients');
                if (savedEl) savedEl.innerText = state.savedPatients;
                
                const failedEl = document.getElementById('results-failed-patients');
                if (failedEl) failedEl.innerText = state.failedPatients;
                
                els.performanceMsg.innerText = `Diagnostic run complete! Accuracy: ${Math.round((state.savedPatients / state.questions.length) * 100)}%`;
            } else if (state.superCmsMode === 'duel') {
                if (aiCard) aiCard.style.display = 'block';
                const userWon = state.score > state.aiScore || (state.score === state.aiScore && state.currentQuestionIndex <= state.aiQuestionIndex);
                
                const outcomeIcon = document.getElementById('ai-duel-outcome-icon');
                if (outcomeIcon) outcomeIcon.innerText = userWon ? '🏆' : '💀';
                
                const outcomeTitle = document.getElementById('ai-duel-outcome-title');
                if (outcomeTitle) outcomeTitle.innerText = userWon ? 'Victory! You outpaced the AI.' : 'Defeat! The AI outpaced you.';
                
                const userScoreEl = document.getElementById('results-user-score');
                if (userScoreEl) userScoreEl.innerText = `${state.score} / ${state.questions.length}`;
                
                const aiScoreEl = document.getElementById('results-ai-score');
                if (aiScoreEl) aiScoreEl.innerText = `${state.aiScore} / ${state.questions.length}`;
                
                els.performanceMsg.innerText = userWon ? "Outstanding! You outpaced the AI in this clinical duel!" : "The AI Resident out-diagnosed you. Practice makes perfect!";
            } else if (state.superCmsMode === 'hot_seat') {
                if (streakCard) streakCard.style.display = 'block';
                let finalMult = 1.0;
                if (state.streak >= 7) finalMult = 3.0;
                else if (state.streak >= 5) finalMult = 2.0;
                else if (state.streak >= 3) finalMult = 1.5;
                
                const maxStreakEl = document.getElementById('results-max-streak');
                if (maxStreakEl) maxStreakEl.innerText = `${state.maxStreak} Correct`;
                
                const finalMultEl = document.getElementById('results-final-multiplier');
                if (finalMultEl) finalMultEl.innerText = `${finalMult}x`;
                
                els.performanceMsg.innerText = `Hot Seat session ended. Highest Streak: ${state.maxStreak}`;
            } else if (state.superCmsMode === 'clearance') {
                if (clearanceCard) clearanceCard.style.display = 'block';
                
                const curedEl = document.getElementById('results-cured-count');
                if (curedEl) curedEl.innerText = state.curedCount;
                
                els.performanceMsg.innerText = `Cleared ${state.curedCount} clinical anomalies from your memory logs!`;
            }
        }

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
            els.retryBtn.onclick = () => {
                if (state.superCmsMode) {
                    startSuperCms(state.superCmsMode);
                } else {
                    startQuiz();
                }
            };
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

        // Manage UPSC CMS Year Filter visibility dynamically
        if (viewName === 'yearSelection' && state.activeTag === 'upscmo' && 
            state.upscDrillLevel !== 'years' && state.upscDrillLevel !== 'papers') {
            showUpscYearFilter(true);
        } else {
            showUpscYearFilter(false);
        }
    }


    function setupEventListeners() {
        // Home Menu Navigation
        els.btnPrevYear.onclick = async () => {
            switchView('stateSelection');
            await checkStatesAvailability();
        };

        // Direct UPSC CMS button on home screen
        const btnUpscCms = document.getElementById('btn-upsc-cms');
        if (btnUpscCms) {
            btnUpscCms.onclick = async () => {
                if (!AuthService.isLoggedIn()) {
                    const user = await AuthService.login();
                    if (!user) return;
                }
                showUpscEntry();
            };
        }

        // UPSC Entry View Buttons
        const btnCmsLearningHub = document.getElementById('btn-cms-learning-hub');
        if (btnCmsLearningHub) {
            btnCmsLearningHub.onclick = () => {
                showUpscHub();
            };
        }

        const btnSuperCmsEntry = document.getElementById('btn-super-cms-entry');
        if (btnSuperCmsEntry) {
            btnSuperCmsEntry.onclick = () => {
                if (!AuthService.isLoggedIn()) {
                    alert("Please login to access this section.");
                    return;
                }
                if (!AuthService.isPro()) {
                    alert("Super CMS (Gamified Arena) is locked for Pro members only.");
                    if (AuthService.user && AuthService.user.email) {
                        PaymentService.initiatePayment(AuthService.user.email, () => {
                            showUpscSuperCms();
                        });
                    }
                    return;
                }
                showUpscSuperCms();
            };
        }

        const btnBackFromUpscEntry = document.getElementById('back-to-home-from-upsc-entry');
        if (btnBackFromUpscEntry) {
            btnBackFromUpscEntry.onclick = () => {
                switchView('home');
            };
        }

        const btnBackFromSuper = document.getElementById('back-to-entry-from-super');
        if (btnBackFromSuper) {
            btnBackFromSuper.onclick = () => {
                showUpscEntry();
            };
        }

        // UPSC Super CMS Mode Buttons
        const btnModeCaseFile = document.getElementById('btn-mode-case-file');
        if (btnModeCaseFile) {
            btnModeCaseFile.onclick = () => startSuperCms('case_file');
        }

        const btnModeAiDuel = document.getElementById('btn-mode-ai-duel');
        if (btnModeAiDuel) {
            btnModeAiDuel.onclick = async () => {
                state.upscDrillLevel = 'aiselection';
                switchView('upscAiSelection');
                const allQ = await preloadUpscQuestions();
                initAiDuelBuilder(allQ);
            };
        }

        // AI Duel Custom Filters Event Listeners
        const aiDuelSelectAllBtn = document.getElementById('ai-duel-years-select-all');
        if (aiDuelSelectAllBtn) {
            aiDuelSelectAllBtn.onclick = () => {
                document.querySelectorAll('.ai-duel-year-cb').forEach(cb => cb.checked = true);
                updateAiDuelBuilderOptions(state.upscAllQuestions);
            };
        }

        const aiDuelClearAllBtn = document.getElementById('ai-duel-years-clear-all');
        if (aiDuelClearAllBtn) {
            aiDuelClearAllBtn.onclick = () => {
                document.querySelectorAll('.ai-duel-year-cb').forEach(cb => cb.checked = false);
                updateAiDuelBuilderOptions(state.upscAllQuestions);
            };
        }

        const aiDuelFields = [
            document.getElementById('ai-duel-subject'),
            document.getElementById('ai-duel-chapter'),
            document.getElementById('ai-duel-topic')
        ];
        aiDuelFields.forEach(el => {
            if (el) {
                el.onchange = () => updateAiDuelBuilderOptions(state.upscAllQuestions, el.id);
            }
        });

        const aiDuelYearsGrid = document.getElementById('ai-duel-years-grid');
        if (aiDuelYearsGrid) {
            aiDuelYearsGrid.onchange = () => updateAiDuelBuilderOptions(state.upscAllQuestions);
        }

        const btnBackFromAiSelection = document.getElementById('back-to-super-from-ai');
        if (btnBackFromAiSelection) {
            btnBackFromAiSelection.onclick = () => {
                state.upscDrillLevel = 'supercms';
                switchView('upscSuperCms');
            };
        }

        // AI level selection card click handlers
        document.querySelectorAll('.ai-level-card').forEach(card => {
            card.onclick = () => {
                state.aiLevel = card.getAttribute('data-level');
                state.aiAccuracy = parseFloat(card.getAttribute('data-accuracy'));
                state.aiSpeed = parseInt(card.getAttribute('data-speed'), 10);
                state.aiName = card.getAttribute('data-name');
                
                const mascots = {
                    '1st_year': '🐣',
                    '2nd_year': '📚',
                    '4th_year': '🩺',
                    'intern': '⚡',
                    'jr': '👨‍⚕️',
                    'sr': '👩‍⚕️',
                    'consultant': '👑'
                };
                state.aiMascot = mascots[state.aiLevel] || '🤖';
                
                startSuperCms('duel');
            };
        });

        const btnModeHotSeat = document.getElementById('btn-mode-hot-seat');
        if (btnModeHotSeat) {
            btnModeHotSeat.onclick = () => startSuperCms('hot_seat');
        }

        const btnModeClearance = document.getElementById('btn-mode-clearance');
        if (btnModeClearance) {
            btnModeClearance.onclick = async () => {
                const allQ = await preloadUpscQuestions();
                showClearanceChoiceScreen(allQ);
            };
        }

        // UPSC CMS Hub Buttons
        const btnUpscYearwise = document.getElementById('btn-upsc-yearwise');
        if (btnUpscYearwise) {
            btnUpscYearwise.onclick = () => {
                state.upscDrillLevel = 'years';
                selectMode('upscmo', 'UPSC CMS Previous Year Papers', 'Practice with real UPSC Combined Medical Services exam questions.', 'YEAR', 'upscHub');
            };
        }

        const btnUpscSubjectwise = document.getElementById('btn-upsc-subjectwise');
        if (btnUpscSubjectwise) {
            btnUpscSubjectwise.onclick = async () => {
                state.upscFlow = 'subjectwise';
                state.upscSelectedYear = 'all';
                const yf = document.getElementById('upsc-year-filter');
                if (yf) yf.value = 'all';
                state.upscDrillLevel = 'subjects';
                switchView('yearSelection');
                els.viewTitle.innerText = 'Select Subject';
                els.viewDesc.innerText = 'Choose a subject to practice.';
                els.yearsGrid.innerHTML = '<div class="loader"></div>';
                
                const allQ = await preloadUpscQuestions();
                renderUpscSubjects(allQ);
            };
        }

        const btnUpscAnalytics = document.getElementById('btn-upsc-analytics');
        if (btnUpscAnalytics) {
            btnUpscAnalytics.onclick = () => {
                state.analyticsBackView = 'upscHub';
                showAnalytics();
            };
        }

        const btnSuperCmsAnalytics = document.getElementById('btn-super-cms-analytics');
        if (btnSuperCmsAnalytics) {
            btnSuperCmsAnalytics.onclick = () => {
                state.analyticsBackView = 'upscSuperCms';
                showAnalytics();
            };
        }

        const btnBackFromChoice = document.getElementById('back-from-choice');
        if (btnBackFromChoice) {
            btnBackFromChoice.onclick = () => {
                if (state.choiceBackView === 'supercms') {
                    showUpscSuperCms();
                    return;
                }
                if (state.upscDrillLevel === 'chapters') {
                    state.upscDrillLevel = 'subjects';
                    switchView('yearSelection');
                    els.viewTitle.innerText = 'Select Subject';
                    preloadUpscQuestions().then(allQ => renderUpscSubjects(allQ));
                } else if (state.upscDrillLevel === 'topics') {
                    state.upscDrillLevel = 'chapters';
                    switchView('yearSelection');
                    els.viewTitle.innerText = state.upscSubject;
                    preloadUpscQuestions().then(allQ => renderUpscChapters(state.upscSubject, allQ));
                } else {
                    state.upscDrillLevel = 'subjects';
                    switchView('yearSelection');
                    preloadUpscQuestions().then(allQ => renderUpscSubjects(allQ));
                }
            };
        }

        const btnBackFromAnalytics = document.getElementById('back-to-hub-from-analytics');
        if (btnBackFromAnalytics) {
            btnBackFromAnalytics.onclick = () => {
                if (state.analyticsBackView === 'upscSuperCms') {
                    showUpscSuperCms();
                } else {
                    state.upscDrillLevel = 'hub';
                    showUpscHub();
                }
            };
        }

        const btnUpscHighpriority = document.getElementById('btn-upsc-highpriority');
        if (btnUpscHighpriority) {
            btnUpscHighpriority.onclick = async () => {
                state.upscDrillLevel = 'highpriority';
                switchView('yearSelection');
                els.viewTitle.innerText = 'High Priority Weightage';
                els.viewDesc.innerText = 'Practice only high priority / high yield questions.';
                els.yearsGrid.innerHTML = '<div class="loader"></div>';
                
                const allQ = await preloadUpscQuestions();
                renderHighPrioritySelector(allQ);
            };
        }

        const btnUpscDifficulty = document.getElementById('btn-upsc-difficulty');
        if (btnUpscDifficulty) {
            btnUpscDifficulty.onclick = async () => {
                state.upscDrillLevel = 'difficulty';
                switchView('yearSelection');
                els.viewTitle.innerText = 'Difficulty Mode';
                els.viewDesc.innerText = 'Choose a difficulty level to practice.';
                els.yearsGrid.innerHTML = '<div class="loader"></div>';
                
                const allQ = await preloadUpscQuestions();
                renderDifficultySelector(allQ);
            };
        }

        const btnUpscRevision = document.getElementById('btn-upsc-revision');
        if (btnUpscRevision) {
            btnUpscRevision.onclick = async () => {
                state.upscDrillLevel = 'revision';
                switchView('yearSelection');
                els.viewTitle.innerText = 'Revision Mode';
                els.viewDesc.innerText = 'Practice unseen questions or review your errors.';
                els.yearsGrid.innerHTML = '<div class="loader"></div>';
                
                const allQ = await preloadUpscQuestions();
                renderRevisionSelector(allQ);
            };
        }

        const btnUpscCustomBuilder = document.getElementById('btn-upsc-custom-builder');
        if (btnUpscCustomBuilder) {
            btnUpscCustomBuilder.onclick = () => {
                showCustomBuilder();
            };
        }

        // UPSC Custom Quiz Builder Event Listeners (Bound Once)
        const builderSelectAllBtn = document.getElementById('builder-years-select-all');
        if (builderSelectAllBtn) {
            builderSelectAllBtn.onclick = () => {
                document.querySelectorAll('.builder-year-cb').forEach(cb => cb.checked = true);
                updateBuilderOptions(state.upscAllQuestions);
            };
        }

        const builderClearAllBtn = document.getElementById('builder-years-clear-all');
        if (builderClearAllBtn) {
            builderClearAllBtn.onclick = () => {
                document.querySelectorAll('.builder-year-cb').forEach(cb => cb.checked = false);
                updateBuilderOptions(state.upscAllQuestions);
            };
        }

        const builderFields = [
            document.getElementById('builder-subject'),
            document.getElementById('builder-chapter'),
            document.getElementById('builder-topic')
        ];
        builderFields.forEach(el => {
            if (el) {
                el.onchange = () => updateBuilderOptions(state.upscAllQuestions, el.id);
            }
        });

        document.querySelectorAll('input[name="builder-weightage"]').forEach(radio => {
            radio.onchange = () => updateBuilderOptions(state.upscAllQuestions);
        });

        document.querySelectorAll('input[name="builder-status"]').forEach(radio => {
            radio.onchange = () => updateBuilderOptions(state.upscAllQuestions);
        });

        const builderYearsGrid = document.getElementById('builder-years-grid');
        if (builderYearsGrid) {
            builderYearsGrid.onchange = () => updateBuilderOptions(state.upscAllQuestions);
        }

        const builderStartBtn = document.getElementById('builder-start-btn');
        if (builderStartBtn) {
            builderStartBtn.onclick = () => {
                const filtered = getFilteredBuilderQuestions(state.upscAllQuestions);
                if (filtered.length === 0) {
                    alert("No questions found matching your filter selection. Please adjust your criteria.");
                    return;
                }
                state.upscQuizSource = 'custombuilder';
                state.questions = filtered;
                state.sessionKey = 'progress_upsc_custom_builder';
                state.mode = 'YEAR';
                startQuiz();
            };
        }

        const btnBackFromUpscHub = document.getElementById('back-to-home-from-upsc-hub');
        if (btnBackFromUpscHub) {
            btnBackFromUpscHub.onclick = () => showUpscEntry();
        }

        const btnBackFromCustom = document.getElementById('back-to-hub-from-custom');
        if (btnBackFromCustom) {
            btnBackFromCustom.onclick = () => {
                state.upscDrillLevel = 'hub';
                showUpscHub();
            };
        }

        async function checkStatesAvailability() {
            const tags = ['haryanamo', 'rajasthanmo'];
            const btnIds = {
                'haryanamo': 'btn-pyq-haryana',
                'rajasthanmo': 'btn-pyq-rajasthan'
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
            selectMode('haryanamo', 'Previous Year Question Haryana', 'Practice with real state MO exam questions from Haryana.', 'YEAR', 'stateSelection');
        };

        document.getElementById('btn-pyq-rajasthan').onclick = () => {
            selectMode('rajasthanmo', 'Previous Year Question Rajasthan', 'Practice with real state MO exam questions from Rajasthan.', 'YEAR', 'stateSelection');
        };

        document.getElementById('back-to-home-from-state').onclick = () => switchView('home');

        els.btnProQuiz.onclick = () => {
            showToast('🚀 MoProPrep Pro — Coming Soon! Stay tuned for premium content.', 4000);
        };

        if (els.btnBookmarksHeader) {
            els.btnBookmarksHeader.onclick = loadBookmarksQuiz;
        }

        if (els.bookmarkBtn) {
            els.bookmarkBtn.onclick = toggleBookmark;
        }

        // "← Back to Menu" button in yearSelection view
        els.backToHome.onclick = () => {
            if (state.activeTag === 'upscmo') {
                upscGoBack();
            } else {
                switchView(state.previousView || 'home');
            }
        };
        els.homeLogo.onclick = () => switchView('home');

        // "← Back" button inside the quiz view
        els.backBtn.onclick = () => {
            if (state.mode === 'SHUFFLE' || state.mode === 'BOOKMARKS') {
                switchView('home');
            } else if (state.activeTag === 'upscmo') {
                if (state.upscQuizSource === 'topics') {
                    state.upscDrillLevel = 'topics';
                    switchView('yearSelection');
                    els.viewTitle.innerText = state.upscChapter;
                    els.viewDesc.innerText = 'Select a topic to start quiz.';
                    els.yearsGrid.innerHTML = '<div class="loader"></div>';
                    preloadUpscQuestions().then(allQ => renderUpscTopics(state.upscSubject, state.upscChapter, allQ));
                } else if (state.upscQuizSource === 'subject_solve') {
                    state.upscDrillLevel = 'subjects';
                    switchView('yearSelection');
                    els.viewTitle.innerText = 'Select Subject';
                    els.yearsGrid.innerHTML = '<div class="loader"></div>';
                    preloadUpscQuestions().then(allQ => renderUpscSubjects(allQ));
                } else if (state.upscQuizSource === 'chapter_solve') {
                    state.upscDrillLevel = 'chapters';
                    switchView('yearSelection');
                    els.viewTitle.innerText = state.upscSubject;
                    els.yearsGrid.innerHTML = '<div class="loader"></div>';
                    preloadUpscQuestions().then(allQ => renderUpscChapters(state.upscSubject, allQ));
                } else if (state.upscQuizSource === 'highpriority') {
                    state.upscDrillLevel = 'highpriority';
                    switchView('yearSelection');
                    els.viewTitle.innerText = 'High Priority Weightage';
                    els.viewDesc.innerText = 'Practice only high priority / high yield questions.';
                    els.yearsGrid.innerHTML = '<div class="loader"></div>';
                    preloadUpscQuestions().then(allQ => renderHighPrioritySelector(allQ));
                } else if (state.upscQuizSource === 'difficulty') {
                    state.upscDrillLevel = 'difficulty';
                    switchView('yearSelection');
                    els.viewTitle.innerText = 'Difficulty Mode';
                    els.viewDesc.innerText = 'Choose a difficulty level to practice.';
                    els.yearsGrid.innerHTML = '<div class="loader"></div>';
                    preloadUpscQuestions().then(allQ => renderDifficultySelector(allQ));
                } else if (state.upscQuizSource === 'revision') {
                    state.upscDrillLevel = 'revision';
                    switchView('yearSelection');
                    els.viewTitle.innerText = 'Revision Mode';
                    els.viewDesc.innerText = 'Practice unseen questions or review your errors.';
                    els.yearsGrid.innerHTML = '<div class="loader"></div>';
                    preloadUpscQuestions().then(allQ => renderRevisionSelector(allQ));
                } else if (state.upscQuizSource === 'custombuilder') {
                    state.upscDrillLevel = 'custombuilder';
                    switchView('upscCustomBuilder');
                } else if (state.upscQuizSource === 'supercms') {
                    if (state.aiInterval) {
                        clearInterval(state.aiInterval);
                        state.aiInterval = null;
                    }
                    const panel = document.getElementById('super-cms-panel');
                    if (panel) panel.style.display = 'none';
                    state.superCmsMode = null;
                    state.upscDrillLevel = 'supercms';
                    switchView('upscSuperCms');
                } else if (state.currentPaper) {
                    state.upscDrillLevel = 'papers';
                    renderPapers(state.currentYear);
                    switchView('yearSelection');
                } else {
                    state.upscDrillLevel = 'years';
                    switchView('yearSelection');
                }
            } else {
                // Normal year-based quiz — go back to year grid
                switchView('yearSelection');
            }
        };
        els.prevBtn.onclick = previousQuestion;
        els.retryBtn.onclick = () => {
            if (state.superCmsMode) {
                startSuperCms(state.superCmsMode);
            } else {
                startQuiz();
            }
        };
        els.homeBtn.onclick = () => {
            if (state.aiInterval) {
                clearInterval(state.aiInterval);
                state.aiInterval = null;
            }
            const panel = document.getElementById('super-cms-panel');
            if (panel) panel.style.display = 'none';
            state.superCmsMode = null;
            switchView('home');
        };

        // Resuscitation Modal Buttons
        const btnResuscitate = document.getElementById('btn-resuscitate');
        if (btnResuscitate) {
            btnResuscitate.onclick = () => {
                const lives = getDailyLives();
                if (lives > 0) {
                    deductDailyLife();
                    state.patientStability = 100;
                    
                    // Reset stability UI
                    const fill = document.getElementById('stability-fill');
                    const pct = document.getElementById('stability-percent');
                    if (fill) fill.style.width = '100%';
                    if (pct) pct.innerText = '100%';
                    
                    const cond = document.getElementById('patient-condition-text');
                    if (cond) {
                        cond.innerText = "Stable Condition 🟢";
                        cond.style.color = "#66bb6a";
                    }
                    
                    const livesText = document.getElementById('lives-counter-text');
                    if (livesText) livesText.innerText = getDailyLives();
                    
                    // Hide modal
                    const modal = document.getElementById('resuscitate-modal');
                    if (modal) modal.style.display = 'none';
                }
            };
        }

        const btnExitResuscitate = document.getElementById('btn-exit-resuscitate');
        if (btnExitResuscitate) {
            btnExitResuscitate.onclick = () => {
                const modal = document.getElementById('resuscitate-modal');
                if (modal) modal.style.display = 'none';
                
                // Clear state
                state.superCmsMode = null;
                const panel = document.getElementById('super-cms-panel');
                if (panel) panel.style.display = 'none';
                
                state.upscDrillLevel = 'supercms';
                switchView('upscSuperCms');
            };
        }

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

        const upscYearFilter = document.getElementById('upsc-year-filter');
        if (upscYearFilter) {
            upscYearFilter.onchange = (e) => {
                state.upscSelectedYear = e.target.value;
                if (state.upscSelectedYear === 'custom') {
                    toggleCustomYearsPanel(true);
                } else {
                    toggleCustomYearsPanel(false);
                    refreshCurrentUpscView();
                }
            };
        }

        // Custom Years Panel button listeners
        const customYearsSelectAll = document.getElementById('upsc-custom-years-select-all');
        if (customYearsSelectAll) {
            customYearsSelectAll.onclick = () => {
                const checkboxes = document.querySelectorAll('#upsc-custom-years-grid input[type="checkbox"]');
                checkboxes.forEach(cb => cb.checked = true);
            };
        }

        const customYearsClearAll = document.getElementById('upsc-custom-years-clear-all');
        if (customYearsClearAll) {
            customYearsClearAll.onclick = () => {
                const checkboxes = document.querySelectorAll('#upsc-custom-years-grid input[type="checkbox"]');
                checkboxes.forEach(cb => cb.checked = false);
            };
        }

        const customYearsApply = document.getElementById('upsc-custom-years-apply');
        if (customYearsApply) {
            customYearsApply.onclick = () => {
                const checkboxes = document.querySelectorAll('#upsc-custom-years-grid input[type="checkbox"]');
                const checked = [];
                checkboxes.forEach(cb => {
                    if (cb.checked) checked.push(cb.value);
                });
                state.upscCustomYears = checked;
                
                // Hide panel and refresh
                toggleCustomYearsPanel(false);
                refreshCurrentUpscView();
            };
        }

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

    function showToast(message, duration = 3000) {
        // Remove any existing toast
        const existing = document.getElementById('mpp-toast');
        if (existing) existing.remove();

        const isDark = document.body.getAttribute('data-theme') === 'dark' || document.documentElement.getAttribute('data-theme') === 'dark';
        
        const toast = document.createElement('div');
        toast.id = 'mpp-toast';
        
        // Premium container styling
        toast.style.cssText = `
            position: fixed;
            bottom: 2.5rem;
            left: 50%;
            transform: translateX(-50%) translateY(30px);
            background: ${isDark ? 'rgba(30, 41, 59, 0.9)' : 'rgba(255, 255, 255, 0.9)'};
            backdrop-filter: blur(12px);
            -webkit-backdrop-filter: blur(12px);
            border: 1px solid ${isDark ? 'rgba(255, 255, 255, 0.08)' : 'rgba(0, 0, 0, 0.06)'};
            color: ${isDark ? '#f8fafc' : '#0f172a'};
            padding: 0.9rem 1.6rem;
            border-radius: 16px;
            font-size: 0.95rem;
            font-weight: 600;
            box-shadow: ${isDark ? '0 10px 30px -5px rgba(0,0,0,0.5), 0 0 1px 1px rgba(255,255,255,0.1)' : '0 10px 30px -5px rgba(0,0,0,0.1)'};
            z-index: 9999;
            transition: transform 0.4s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.4s ease;
            opacity: 0;
            max-width: 90vw;
            display: flex;
            align-items: center;
            gap: 0.6rem;
            overflow: hidden;
        `;

        // Content
        toast.innerText = message;

        // Progress bar indicator
        const progress = document.createElement('div');
        progress.style.cssText = `
            position: absolute;
            bottom: 0;
            left: 0;
            height: 3px;
            width: 100%;
            background: linear-gradient(90deg, #6366F1, #10B981);
            transition: width ${duration}ms linear;
        `;
        toast.appendChild(progress);

        document.body.appendChild(toast);

        // Trigger animations
        requestAnimationFrame(() => {
            toast.style.transform = 'translateX(-50%) translateY(0)';
            toast.style.opacity = '1';
            
            // Shrink progress bar
            setTimeout(() => {
                progress.style.width = '0%';
            }, 50);
        });

        // Hide and remove
        setTimeout(() => {
            toast.style.transform = 'translateX(-50%) translateY(30px)';
            toast.style.opacity = '0';
            setTimeout(() => toast.remove(), 400);
        }, duration);
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
