// App State Manager
const App = {
  // Data caches
  chapters: [],
  exams: {},
  predictions: [],

  // User performance state (stored in localStorage)
  userState: {
    quizzesCompleted: 0,
    examsCompleted: 0,
    averageScore: 0,
    quizHistory: [], // { type: 'quiz'|'exam', name: string, score: number, total: number, date: string }
    chapterAnalytics: {} // chapterId: { correct: number, total: number }
  },

  // Active quiz/exam session state
  session: {
    type: null, // 'quiz' | 'exam' | 'prediction'
    id: null, // chapterId or examId
    variant: null, // "A" | "B" | "C" for predictions
    questions: [],
    currentIndex: 0,
    answers: {}, // questionIndex: selectedOptionString
    flags: {}, // questionIndex: boolean
    timer: null,
    timeRemaining: 0, // in seconds
    isSubmitted: false
  },

  // Initialize App
  async init() {
    this.loadUserState();
    this.applyTheme();
    await this.loadData();
    this.setupRouter();
    this.setupEventListeners();
    this.renderSidebarSummary();
    
    // Initial route trigger
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  },

  // Load User Stats from Local Storage
  loadUserState() {
    const saved = localStorage.getItem('db_revision_user_state');
    if (saved) {
      try {
        this.userState = JSON.parse(saved);
      } catch (e) {
        console.error('Error parsing user state', e);
      }
    }
    // Set default theme to dark if not set
    if (!this.userState.theme) {
      this.userState.theme = 'dark';
    }
  },

  // Save User Stats
  saveUserState() {
    localStorage.setItem('db_revision_user_state', JSON.stringify(this.userState));
    this.renderSidebarSummary();
  },

  // Apply Current Theme Mode
  applyTheme() {
    const theme = this.userState.theme || 'dark';
    document.body.setAttribute('data-theme', theme);
    this.updateThemeUI();
  },

  // Toggle Theme Mode
  toggleTheme() {
    const currentTheme = this.userState.theme || 'dark';
    const nextTheme = currentTheme === 'dark' ? 'light' : 'dark';
    this.userState.theme = nextTheme;
    document.body.setAttribute('data-theme', nextTheme);
    this.saveUserState();
    this.updateThemeUI();
  },

  // Update Theme Switcher Buttons
  updateThemeUI() {
    const theme = this.userState.theme || 'dark';
    const textEl = document.getElementById('theme-text');
    const iconEl = document.getElementById('theme-icon');
    const mobileIconEl = document.getElementById('theme-toggle-btn-mobile')?.querySelector('i');
    
    if (theme === 'light') {
      if (textEl) textEl.innerText = 'Dark Mode';
      if (iconEl) iconEl.className = 'bi bi-moon-stars-fill';
      if (mobileIconEl) mobileIconEl.className = 'bi bi-moon-stars-fill';
    } else {
      if (textEl) textEl.innerText = 'Light Mode';
      if (iconEl) iconEl.className = 'bi bi-sun';
      if (mobileIconEl) mobileIconEl.className = 'bi bi-sun';
    }
  },

  // Fetch JSON resources
  async loadData() {
    try {
      // 1. Fetch chapters
      const [ch1, ch2, ch3] = await Promise.all([
        fetch('data/chapters-part1.json').then(r => r.json()),
        fetch('data/chapters-part2.json').then(r => r.json()),
        fetch('data/chapters-part3.json').then(r => r.json())
      ]);
      this.chapters = [...ch1, ...ch2, ...ch3];

      // 2. Fetch past exams
      const [ex2024, ex2025, ex2025Credit] = await Promise.all([
        fetch('data/exams/2024.json').then(r => r.json()),
        fetch('data/exams/2025.json').then(r => r.json()),
        fetch('data/exams/2025_credit.json').then(r => r.json())
      ]);
      this.exams = {
        '2024': ex2024,
        '2025': ex2025,
        '2025_credit': ex2025Credit
      };

      // 3. Fetch predictions
      this.predictions = await fetch('data/predictions.json').then(r => r.json());
      
    } catch (err) {
      console.error('Failed to load JSON data files', err);
      // Display visual error notice to user
      const container = document.getElementById('main-content-view');
      if (container) {
        container.innerHTML = `
          <div class="alert alert-danger m-5 glass-card" role="alert">
            <h4 class="alert-heading"><i class="bi bi-exclamation-triangle-fill me-2"></i>Data Loading Error</h4>
            <p>Could not load the revision datasets. Ensure you are running this app using a local static web server (such as Python's <code>http.server</code> or Live Server) rather than directly via <code>file://</code>.</p>
          </div>
        `;
      }
    }
  },

  // Client-Side Router
  setupRouter() {
    window.addEventListener('hashchange', () => {
      const hash = window.location.hash || '#dashboard';
      const sections = document.querySelectorAll('.app-section');
      
      // Stop any active timers
      if (this.session.timer) {
        clearInterval(this.session.timer);
      }

      // Hide all sections
      sections.forEach(s => s.classList.remove('active'));
      
      // Update active nav link
      const navLinks = document.querySelectorAll('.nav-item');
      navLinks.forEach(item => {
        const link = item.querySelector('a');
        if (link.getAttribute('href') === hash) {
          item.classList.add('active');
        } else {
          item.classList.remove('active');
        }
      });

      // Parse Hash parameters
      const [view, id, extra] = hash.slice(1).split('/');
      
      const targetSection = document.getElementById(`${view}-section`);
      if (targetSection) {
        targetSection.classList.add('active');
        
        // Render views dynamically
        if (view === 'dashboard') {
          this.renderDashboard();
        } else if (view === 'chapters') {
          if (id) {
            this.renderChapterDetails(id, extra);
          } else {
            this.renderChaptersList();
          }
        } else if (view === 'exams') {
          if (id) {
            this.renderExamSolver(id);
          } else {
            this.renderExamsList();
          }
        } else if (view === 'predictions') {
          if (id) {
            this.renderPredictionSolver(id); // id here is Variant "A", "B", or "C"
          } else {
            this.renderPredictionsHome();
          }
        } else if (view === 'analytics') {
          this.renderAnalytics();
        }
      }
      
      // Scroll to top
      window.scrollTo(0, 0);
    });
  },

  // Sidebar Progress Summary
  renderSidebarSummary() {
    const totalChapters = this.chapters.length || 9;
    const completedChapters = this.chapters.filter(ch => {
      const stat = this.userState.chapterAnalytics[ch.id];
      return stat && stat.total > 0;
    }).length;

    const progressPercent = Math.round((completedChapters / totalChapters) * 100) || 0;
    
    document.getElementById('sidebar-progress-percent').innerText = `${progressPercent}%`;
    document.getElementById('sidebar-progress-bar').style.width = `${progressPercent}%`;
    document.getElementById('sidebar-quizzes-count').innerText = this.userState.quizzesCompleted;
    document.getElementById('sidebar-exams-count').innerText = this.userState.examsCompleted;
  },

  // Setup Event Listeners
  setupEventListeners() {
    // Mobile sidebar toggler
    const toggleBtn = document.getElementById('sidebar-toggle-btn');
    const sidebar = document.querySelector('.sidebar');
    if (toggleBtn && sidebar) {
      toggleBtn.addEventListener('click', () => {
        sidebar.classList.toggle('show');
      });
      // Close sidebar when clicking menu items on mobile
      sidebar.addEventListener('click', (e) => {
        if (e.target.closest('a')) {
          sidebar.classList.remove('show');
        }
      });
    }

    // Theme togglers
    const themeBtn = document.getElementById('theme-toggle-btn');
    const themeBtnMobile = document.getElementById('theme-toggle-btn-mobile');
    if (themeBtn) {
      themeBtn.addEventListener('click', () => App.toggleTheme());
    }
    if (themeBtnMobile) {
      themeBtnMobile.addEventListener('click', () => App.toggleTheme());
    }
  },

  // 1. Dashboard View
  renderDashboard() {
    const container = document.getElementById('dashboard-section');
    
    // Calculate dashboard statistics
    const quizzesCount = this.userState.quizzesCompleted;
    const examsCount = this.userState.examsCompleted;
    const avgScore = this.userState.averageScore;
    
    // Quick recommendations
    let recommendationHTML = '';
    const weakChapters = Object.entries(this.userState.chapterAnalytics)
      .map(([id, data]) => ({ id, accuracy: (data.correct / data.total) * 100 }))
      .sort((a, b) => a.accuracy - b.accuracy);
      
    if (weakChapters.length > 0 && weakChapters[0].accuracy < 70) {
      const weakCh = this.chapters.find(c => c.id === weakChapters[0].id);
      recommendationHTML = `
        <div class="alert alert-warning glass-card d-flex align-items-center gap-3 border-warning border-opacity-20 mb-4">
          <div class="stat-icon yellow"><i class="bi bi-lightbulb-fill"></i></div>
          <div>
            <h6 class="mb-1 text-white font-outfit">Recommended Practice</h6>
            <p class="mb-0 text-muted text-sm">Your accuracy in <strong>${weakCh.title}</strong> is currently at ${Math.round(weakChapters[0].accuracy)}%. Take a practice quiz to improve your score.</p>
            <a href="#chapters/${weakCh.id}/quiz" class="btn btn-sm btn-cyan mt-2">Practice Now</a>
          </div>
        </div>
      `;
    } else {
      recommendationHTML = `
        <div class="alert alert-success glass-card d-flex align-items-center gap-3 border-success border-opacity-20 mb-4">
          <div class="stat-icon green"><i class="bi bi-shield-check"></i></div>
          <div>
            <h6 class="mb-1 text-white font-outfit">Ready for the Finals?</h6>
            <p class="mb-0 text-muted text-sm">Solve a full timed past exam simulator to benchmark your readiness.</p>
            <a href="#exams" class="btn btn-sm btn-cyan mt-2">Solve Past Exams</a>
          </div>
        </div>
      `;
    }

    // Recent Activity list
    let recentActivityHTML = '';
    if (this.userState.quizHistory.length === 0) {
      recentActivityHTML = `<p class="text-muted mb-0">No study history recorded yet. Complete a quiz or exam to see your stats!</p>`;
    } else {
      const recent = [...this.userState.quizHistory].reverse().slice(0, 3);
      recentActivityHTML = `
        <div class="table-responsive">
          <table class="table table-dark table-borderless align-middle mb-0">
            <thead>
              <tr class="text-muted text-xs border-bottom border-secondary border-opacity-10">
                <th>Session</th>
                <th>Score</th>
                <th>Result</th>
                <th>Date</th>
              </tr>
            </thead>
            <tbody>
              ${recent.map(item => {
                const percent = Math.round((item.score / item.total) * 100);
                const badgeClass = percent >= 80 ? 'bg-success text-success-light' : percent >= 50 ? 'bg-warning text-warning-light' : 'bg-danger text-danger-light';
                return `
                  <tr class="text-sm">
                    <td class="fw-semibold">${item.name}</td>
                    <td>${item.score}/${item.total}</td>
                    <td><span class="badge ${badgeClass} bg-opacity-10 px-2 py-1">${percent}%</span></td>
                    <td class="text-muted text-xs">${item.date}</td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="row mb-4">
        <div class="col-12">
          <h2 class="font-outfit text-white mb-1">Study Dashboard</h2>
          <p class="text-muted">Monitor your preparation progress and select revision modules.</p>
        </div>
      </div>

      <!-- Stats Grid -->
      <div class="row g-4 mb-4">
        <div class="col-md-4 col-sm-6">
          <div class="glass-card stat-card d-flex align-items-center gap-3">
            <div class="stat-icon cyan"><i class="bi bi-journal-check"></i></div>
            <div>
              <div class="text-muted text-xs">Quizzes Completed</div>
              <h3 class="text-white mb-0 font-outfit mt-1">${quizzesCount}</h3>
            </div>
          </div>
        </div>
        <div class="col-md-4 col-sm-6">
          <div class="glass-card stat-card d-flex align-items-center gap-3">
            <div class="stat-icon purple"><i class="bi bi-file-earmark-check"></i></div>
            <div>
              <div class="text-muted text-xs">Exams Simulated</div>
              <h3 class="text-white mb-0 font-outfit mt-1">${examsCount}</h3>
            </div>
          </div>
        </div>
        <div class="col-md-4 col-sm-12">
          <div class="glass-card stat-card d-flex align-items-center gap-3">
            <div class="stat-icon green"><i class="bi bi-award"></i></div>
            <div>
              <div class="text-muted text-xs">Average Score</div>
              <h3 class="text-white mb-0 font-outfit mt-1">${avgScore}%</h3>
            </div>
          </div>
        </div>
      </div>

      <div class="row g-4">
        <div class="col-lg-8">
          ${recommendationHTML}
          
          <!-- Quick Access Chapters -->
          <div class="glass-card p-4 mb-4">
            <div class="d-flex justify-content-between align-items-center mb-3">
              <h5 class="text-white font-outfit mb-0">Study Chapters</h5>
              <a href="#chapters" class="text-sm text-decoration-none text-cyan">View All</a>
            </div>
            <div class="row g-3">
              ${this.chapters.slice(0, 4).map(ch => `
                <div class="col-sm-6">
                  <div class="glass-card p-3 h-100 hover-lift cursor-pointer" onclick="window.location.hash='#chapters/${ch.id}'">
                    <span class="chapter-number">Chapter ${ch.number}</span>
                    <h6 class="text-white text-sm mb-0 mt-1">${ch.title}</h6>
                  </div>
                </div>
              `).join('')}
            </div>
          </div>
        </div>
        
        <!-- Recent Log -->
        <div class="col-lg-4">
          <div class="glass-card p-4 h-100">
            <h5 class="text-white font-outfit mb-3">Recent Activity Log</h5>
            ${recentActivityHTML}
          </div>
        </div>
      </div>
    `;
  },

  // 2. Chapters List View
  renderChaptersList() {
    const container = document.getElementById('chapters-section');
    container.innerHTML = `
      <div class="row mb-4">
        <div class="col-12">
          <h2 class="font-outfit text-white mb-1">Study Chapters</h2>
          <p class="text-muted">Master database concepts chapter by chapter, then test your knowledge with revision quizzes.</p>
        </div>
      </div>
      <div class="row g-4">
        ${this.chapters.map(ch => {
          const stats = this.userState.chapterAnalytics[ch.id];
          const accuracy = stats && stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
          return `
            <div class="col-lg-4 col-md-6">
              <div class="glass-card chapter-card d-flex flex-column" onclick="window.location.hash='#chapters/${ch.id}'">
                <div class="d-flex justify-content-between align-items-start mb-2">
                  <span class="chapter-number">Chapter ${ch.number}</span>
                  ${stats ? `<span class="badge bg-success bg-opacity-10 text-success text-xs px-2 py-1">${accuracy}% Accuracy</span>` : `<span class="badge bg-secondary bg-opacity-10 text-muted text-xs px-2 py-1">Unstarted</span>`}
                </div>
                <h5 class="text-white mb-3 font-outfit">${ch.title}</h5>
                <p class="text-muted text-xs mb-4 flex-grow-1">${ch.sections.map(s => s.title).slice(0, 3).join(', ')}...</p>
                <div class="d-flex justify-content-between align-items-center pt-3 border-top border-secondary border-opacity-10 mt-auto">
                  <span class="text-xs text-muted"><i class="bi bi-book me-1"></i> ${ch.sections.length} Concepts</span>
                  <span class="text-xs text-cyan">Study Notes <i class="bi bi-chevron-right ms-1"></i></span>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  // Chapter Study Notes & Quiz Trigger
  renderChapterDetails(chapterId, mode) {
    const container = document.getElementById('chapters-section');
    const ch = this.chapters.find(c => c.id === chapterId);
    
    if (!ch) {
      container.innerHTML = `<div class="alert alert-danger m-5">Chapter not found</div>`;
      return;
    }

    if (mode === 'quiz') {
      this.startChapterQuiz(ch);
      return;
    }

    // Render Study Notes view
    container.innerHTML = `
      <div class="row mb-4 align-items-center">
        <div class="col-md-8">
          <a href="#chapters" class="text-sm text-decoration-none text-cyan mb-2 d-inline-block"><i class="bi bi-arrow-left me-1"></i> Back to Chapters</a>
          <h2 class="font-outfit text-white mb-1">Chapter ${ch.number}: ${ch.title}</h2>
        </div>
        <div class="col-md-4 text-md-end mt-3 mt-md-0">
          <a href="#chapters/${ch.id}/quiz" class="btn btn-cyan px-4 py-2"><i class="bi bi-patch-question me-2"></i> Start Practice Quiz</a>
        </div>
      </div>

      <div class="row g-4">
        <div class="col-lg-8">
          <!-- Main Study Material Accordion -->
          <div class="accordion accordion-dark" id="chapterAccordion">
            ${ch.sections.map((section, idx) => `
              <div class="accordion-item glass-card mb-3 border-0 overflow-hidden">
                <h2 class="accordion-header" id="heading${idx}">
                  <button class="accordion-button ${idx === 0 ? '' : 'collapsed'} bg-transparent text-white font-outfit" type="button" data-bs-toggle="collapse" data-bs-target="#collapse${idx}" aria-expanded="${idx === 0 ? 'true' : 'false'}" aria-controls="collapse${idx}">
                    <span class="badge bg-cyan bg-opacity-10 text-cyan me-3">${ch.number}.${idx + 1}</span> ${section.title}
                  </button>
                </h2>
                <div id="collapse${idx}" class="accordion-collapse collapse ${idx === 0 ? 'show' : ''}" aria-labelledby="heading${idx}" data-bs-parent="#chapterAccordion">
                  <div class="accordion-body text-muted border-top border-secondary border-opacity-10 pt-3">
                    <p class="mb-3 text-sm">${section.content}</p>
                    ${section.examples && section.examples.length > 0 ? `
                      <div class="bg-black bg-opacity-30 p-3 rounded-12 border border-secondary border-opacity-10">
                        <span class="text-xs text-white fw-bold mb-2 d-block"><i class="bi bi-terminal me-1 text-cyan"></i> Notes & Code Examples</span>
                        <pre class="mb-0 text-cyan text-xs font-monospace overflow-auto" style="max-height:200px;">${section.examples.join('\n')}</pre>
                      </div>
                    ` : ''}
                  </div>
                </div>
              </div>
            `).join('')}
          </div>
        </div>
        
        <!-- Sidebar context info -->
        <div class="col-lg-4">
          <div class="glass-card p-4 mb-4">
            <h5 class="text-white font-outfit mb-3">Revision Checkpoints</h5>
            <ul class="list-unstyled text-sm text-muted d-flex flex-column gap-2 mb-0">
              <li class="d-flex align-items-center gap-2"><i class="bi bi-check-circle-fill text-cyan"></i> Read structural notes</li>
              <li class="d-flex align-items-center gap-2"><i class="bi bi-check-circle-fill text-cyan"></i> Analyze code blocks / SQL scripts</li>
              <li class="d-flex align-items-center gap-2"><i class="bi bi-check-circle-fill text-cyan"></i> Solve chapter review quiz</li>
            </ul>
          </div>
        </div>
      </div>
    `;
  },

  // Start Chapter Practice Quiz
  startChapterQuiz(chapter) {
    // Generate questions for this chapter. Since we don't have stored quizzes per chapter in this phase, 
    // we dynamically query past exams and predictions for questions belonging to this chapterId!
    // This allows the revision database platform to serve actual exam questions filtered by chapter.
    let quizQuestions = [];
    
    // Scan past exams
    Object.values(this.exams).forEach(exam => {
      exam.sections.forEach(sec => {
        sec.questions.forEach(q => {
          if (q.chapterId === chapter.id) {
            quizQuestions.push({ ...q, source: exam.title });
          }
        });
      });
    });

    // Scan predictions
    this.predictions.forEach(q => {
      if (q.relatedChapter === chapter.id) {
        quizQuestions.push({
          id: q.id,
          number: q.questionNumber,
          type: 'mcq',
          question: q.question,
          options: q.options,
          correctAnswer: q.correctAnswer,
          explanation: q.explanation,
          source: `Variant ${q.examVariant} Prediction`
        });
      }
    });

    // Fallback: If zero questions exist for this chapter in exams, generate simple concepts questions
    if (quizQuestions.length === 0) {
      quizQuestions = [
        {
          id: `${chapter.id}-dynamic-q1`,
          number: 1,
          type: 'mcq',
          question: `Which of the following topics represents a core focus of ${chapter.title}?`,
          options: chapter.sections.map(s => s.title).slice(0, 4),
          correctAnswer: chapter.sections[0].title,
          explanation: `The main concepts in this chapter cover: ${chapter.sections.map(s => s.title).join(', ')}.`,
          source: 'Concept Revision'
        }
      ];
    }

    // Initialize session
    this.session = {
      type: 'quiz',
      id: chapter.id,
      questions: quizQuestions,
      currentIndex: 0,
      answers: {},
      flags: {},
      isSubmitted: false
    };

    this.renderQuizQuestion();
  },

  // Renders a single active quiz question
  renderQuizQuestion() {
    const container = document.getElementById('chapters-section');
    const q = this.session.questions[this.session.currentIndex];
    const isFirst = this.session.currentIndex === 0;
    const isLast = this.session.currentIndex === this.session.questions.length - 1;
    const answeredOption = this.session.answers[this.session.currentIndex];
    
    // Header tracking
    const progressPercent = Math.round(((this.session.currentIndex + 1) / this.session.questions.length) * 100);

    container.innerHTML = `
      <div class="row mb-4">
        <div class="col-12">
          <a href="#chapters/${this.session.id}" class="text-sm text-decoration-none text-cyan mb-2 d-inline-block"><i class="bi bi-arrow-left me-1"></i> Exit Quiz</a>
          <div class="d-flex justify-content-between align-items-center">
            <h3 class="text-white font-outfit mb-0">Practice Quiz: ${this.chapters.find(c => c.id === this.session.id).title}</h3>
            <span class="text-sm text-muted">Question ${this.session.currentIndex + 1} of ${this.session.questions.length}</span>
          </div>
          <div class="custom-progress mt-3">
            <div class="custom-progress-bar cyan" style="width: ${progressPercent}%"></div>
          </div>
        </div>
      </div>

      <div class="row g-4">
        <div class="col-lg-8">
          <div class="glass-card question-card">
            <!-- Question Source tag -->
            <span class="badge bg-secondary bg-opacity-10 text-muted align-self-start mb-3 text-xs px-2 py-1">${q.source || 'Revision'}</span>
            <h4 class="text-white mb-4 text-md font-outfit">${q.question}</h4>
            
            <!-- MCQ Options -->
            <div class="options-container">
              ${q.options.map((opt, idx) => {
                const isSelected = answeredOption === opt;
                // If submitted, show correctness styling
                let optClass = '';
                if (this.session.isSubmitted) {
                  const isCorrectOpt = opt === q.correctAnswer;
                  if (isSelected && isCorrectOpt) {
                    optClass = 'correct';
                  } else if (isSelected && !isCorrectOpt) {
                    optClass = 'incorrect';
                  } else if (isCorrectOpt) {
                    optClass = 'correct';
                  }
                } else if (isSelected) {
                  optClass = 'selected';
                }

                return `
                  <button class="option-btn ${optClass}" onclick="App.selectQuizOption('${opt}')" ${this.session.isSubmitted ? 'disabled' : ''}>
                    <span class="option-badge">${String.fromCharCode(65 + idx)}</span>
                    <span>${opt}</span>
                  </button>
                `;
              }).join('')}
            </div>

            <!-- Quiz Explanations / Feedback Panel (shown immediately after submission) -->
            ${this.session.isSubmitted ? `
              <div class="feedback-panel">
                <h6 class="font-outfit ${answeredOption === q.correctAnswer ? 'text-success' : 'text-danger'} mb-2">
                  <i class="bi ${answeredOption === q.correctAnswer ? 'bi-check-circle-fill' : 'bi-x-circle-fill'} me-2"></i>
                  ${answeredOption === q.correctAnswer ? 'Correct!' : 'Incorrect'}
                </h6>
                <p class="text-sm text-muted mb-0"><strong>Explanation:</strong> ${q.explanation}</p>
              </div>
            ` : ''}

            <!-- Control Buttons -->
            <div class="d-flex justify-content-between mt-auto pt-4 border-top border-secondary border-opacity-10">
              <button class="btn btn-outline-glass" onclick="App.navigateQuiz(-1)" ${isFirst ? 'disabled' : ''}>
                <i class="bi bi-chevron-left me-1"></i> Prev
              </button>
              
              ${!this.session.isSubmitted ? `
                <button class="btn btn-cyan px-4" onclick="App.submitQuizQuestion()">Check Answer</button>
              ` : `
                <button class="btn btn-cyan px-4" onclick="App.navigateQuiz(1)" ${isLast ? 'style="display:none;"' : ''}>Next <i class="bi bi-chevron-right ms-1"></i></button>
                ${isLast ? `<button class="btn btn-success px-4" onclick="App.finishQuizSession()"><i class="bi bi-check2-all me-1"></i> Finish</button>` : ''}
              `}
            </div>
          </div>
        </div>
        
        <!-- Quick stats / question checklist in sidebar -->
        <div class="col-lg-4">
          <div class="glass-card p-4">
            <h5 class="text-white font-outfit mb-3">Questions</h5>
            <div class="d-flex flex-wrap gap-2">
              ${this.session.questions.map((_, idx) => {
                let statusClass = '';
                if (idx === this.session.currentIndex) {
                  statusClass = 'active';
                } else if (this.session.answers[idx] !== undefined && this.session.answers[idx].trim() !== '') {
                  statusClass = 'answered';
                }
                return `
                  <button class="q-nav-btn ${statusClass}" onclick="App.jumpToQuizQuestion(${idx})" style="width: 40px; height: 40px;">
                    ${idx + 1}
                  </button>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  },

  updateNavGridState() {
    const idx = this.session.currentIndex;
    const navBtn = document.querySelectorAll('.q-nav-btn')[idx];
    if (navBtn) {
      const answer = this.session.answers[idx];
      const hasAnswered = answer !== undefined && answer.trim() !== '';
      if (hasAnswered) {
        navBtn.classList.add('answered');
      } else {
        navBtn.classList.remove('answered');
      }
    }
  },

  selectQuizOption(opt) {
    if (this.session.isSubmitted) return;
    this.session.answers[this.session.currentIndex] = opt;
    this.renderQuizQuestion();
  },

  submitQuizQuestion() {
    const q = this.session.questions[this.session.currentIndex];

    if (this.session.answers[this.session.currentIndex] === undefined) {
      alert('Please select an option first.');
      return;
    }
    this.session.isSubmitted = true;
    
    // Save results to userState chapterAnalytics on checking the answer
    const isCorrect = this.session.answers[this.session.currentIndex] === q.correctAnswer;
    
    // Find matching chapter (use chapterId from question)
    const chId = q.chapterId || this.session.id;
    if (!this.userState.chapterAnalytics[chId]) {
      this.userState.chapterAnalytics[chId] = { correct: 0, total: 0 };
    }
    
    this.userState.chapterAnalytics[chId].total += 1;
    if (isCorrect) {
      this.userState.chapterAnalytics[chId].correct += 1;
    }
    
    this.renderQuizQuestion();
  },

  navigateQuiz(dir) {
    this.session.currentIndex += dir;
    this.session.isSubmitted = false; // Reset checking flag for next question if not already completed
    
    // Check if the current question has been previously checked (in case of moving back/forward)
    // For simplicity, we only let them check once, and going forward unlocks the next question.
    this.renderQuizQuestion();
  },

  jumpToQuizQuestion(idx) {
    this.session.currentIndex = idx;
    this.session.isSubmitted = false;
    this.renderQuizQuestion();
  },

  finishQuizSession() {
    // Calculate final score
    let correctCount = 0;
    this.session.questions.forEach((q, idx) => {
      if (this.session.answers[idx] === q.correctAnswer) {
        correctCount += 1;
      }
    });

    const total = this.session.questions.length;
    const percent = Math.round((correctCount / total) * 100);

    // Save to user history
    const chapterTitle = this.chapters.find(c => c.id === this.session.id).title;
    this.userState.quizzesCompleted += 1;
    this.userState.quizHistory.push({
      type: 'quiz',
      name: `Quiz: ${chapterTitle}`,
      score: correctCount,
      total: total,
      date: new Date().toLocaleDateString()
    });

    // Re-calculate average score
    const totalScorePercents = this.userState.quizHistory.map(item => (item.score / item.total) * 100);
    this.userState.averageScore = Math.round(totalScorePercents.reduce((a, b) => a + b, 0) / totalScorePercents.length);

    this.saveUserState();

    // Show summary modal or return to chapter
    alert(`Quiz completed! You scored ${correctCount}/${total} (${percent}%). Your analytics have been updated.`);
    window.location.hash = `#chapters/${this.session.id}`;
  },

  // 3. Past Exams List View
  renderExamsList() {
    const container = document.getElementById('exams-section');
    container.innerHTML = `
      <div class="row mb-4">
        <div class="col-12">
          <h2 class="font-outfit text-white mb-1">Past Exam Simulators</h2>
          <p class="text-muted">Simulate real examination conditions with our interactive, timed past paper solvers.</p>
        </div>
      </div>
      <div class="row g-4">
        ${Object.values(this.exams).map(ex => {
          return `
            <div class="col-lg-4 col-md-6">
              <div class="glass-card exam-card d-flex flex-column h-100">
                <div class="d-flex justify-content-between align-items-center mb-3">
                  <span class="badge bg-cyan bg-opacity-10 text-cyan px-2 py-1 text-xs font-semibold">${ex.year} Final Paper</span>
                  <span class="text-muted text-xs"><i class="bi bi-clock me-1"></i> ${ex.duration || '2 Hours'}</span>
                </div>
                <h4 class="text-white mb-2 font-outfit">${ex.title}</h4>
                <p class="text-muted text-xs mb-4">Contains <strong>${ex.sections[0].questions.length} Exam Questions</strong> spanning database normalization, relational algebra, and complex SQL joins.</p>
                <div class="mt-auto d-flex justify-content-between align-items-center pt-3 border-top border-secondary border-opacity-10">
                  <span class="text-xs text-muted">Marks: ${ex.totalMarks || 60}</span>
                  <button class="btn btn-cyan btn-sm px-3" onclick="window.location.hash='#exams/${ex.id}'">Simulate Exam</button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  // 4. Timed Exam Solver Simulator
  renderExamSolver(examId) {
    const container = document.getElementById('exams-section');
    const exam = this.exams[examId];
    if (!exam) {
      container.innerHTML = `<div class="alert alert-danger m-5">Exam not found</div>`;
      return;
    }

    // If session is empty or different, initialize exam session
    if (this.session.id !== examId || this.session.type !== 'exam') {
      const examQuestions = exam.sections[0].questions;
      this.session = {
        type: 'exam',
        id: examId,
        questions: examQuestions,
        currentIndex: 0,
        answers: {},
        flags: {},
        timeRemaining: 120 * 60, // 2 Hours in seconds
        isSubmitted: false
      };

      // Setup timer tick
      this.session.timer = setInterval(() => {
        App.session.timeRemaining -= 1;
        if (App.session.timeRemaining <= 0) {
          clearInterval(App.session.timer);
          alert('Time is up! Submitting exam automatically.');
          App.submitExam();
        } else {
          App.updateTimerDisplay();
        }
      }, 1000);
    }

    this.renderExamInterface();
  },

  updateTimerDisplay() {
    const display = document.getElementById('timer-display');
    if (!display) return;
    
    const minutes = Math.floor(this.session.timeRemaining / 60);
    const seconds = this.session.timeRemaining % 60;
    display.innerText = `${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
    
    if (this.session.timeRemaining < 10 * 60) {
      display.parentElement.classList.add('warning');
    }
  },

  renderExamInterface() {
    const container = document.getElementById('exams-section');
    const exam = this.exams[this.session.id];
    const q = this.session.questions[this.session.currentIndex];
    
    const isFirst = this.session.currentIndex === 0;
    const isLast = this.session.currentIndex === this.session.questions.length - 1;
    const isFlagged = this.session.flags[this.session.currentIndex];
    const selectedAnswer = this.session.answers[this.session.currentIndex];

    container.innerHTML = `
      <div class="row align-items-center mb-4 g-3">
        <div class="col-sm-6">
          <h3 class="text-white font-outfit mb-0">${exam.title}</h3>
        </div>
        <div class="col-sm-6 d-flex justify-sm-end gap-3 align-items-center">
          <div class="exam-timer">
            <i class="bi bi-clock-fill"></i>
            <span id="timer-display">--:--</span>
          </div>
          <button class="btn btn-danger btn-sm px-3" onclick="App.confirmExamSubmission()">Submit Paper</button>
        </div>
      </div>

      <div class="exam-body">
        <!-- Main Question Pane -->
        <div class="glass-card question-card">
          <div class="d-flex justify-content-between align-items-center mb-3">
            <span class="badge bg-cyan bg-opacity-10 text-cyan px-2 py-1 text-xs">Question ${this.session.currentIndex + 1} of ${this.session.questions.length}</span>
            <button class="btn btn-sm ${isFlagged ? 'btn-warning' : 'btn-outline-glass'} px-2 py-1 text-xs" onclick="App.toggleQuestionFlag()">
              <i class="bi ${isFlagged ? 'bi-flag-fill' : 'bi-flag'} me-1"></i> Flag for Review
            </button>
          </div>

          <h4 class="text-white mb-4 text-md font-outfit leading-relaxed">${q.question}</h4>

          <!-- MCQ Options -->
          <div class="options-container">
            ${q.options.map((opt, idx) => {
              const isSelected = selectedAnswer === opt;
              return `
                <button class="option-btn ${isSelected ? 'selected' : ''}" onclick="App.selectExamOption('${opt}')">
                  <span class="option-badge">${String.fromCharCode(65 + idx)}</span>
                  <span>${opt}</span>
                </button>
              `;
            }).join('')}
          </div>

          <!-- Question Controls -->
          <div class="d-flex justify-content-between mt-auto pt-4 border-top border-secondary border-opacity-10">
            <button class="btn btn-outline-glass" onclick="App.navigateExam(-1)" ${isFirst ? 'disabled' : ''}>
              <i class="bi bi-chevron-left me-1"></i> Prev
            </button>
            <button class="btn btn-cyan px-4" onclick="App.navigateExam(1)" ${isLast ? 'disabled' : ''}>
              Next <i class="bi bi-chevron-right ms-1"></i>
            </button>
          </div>
        </div>

        <!-- Navigation Grid Sidebar -->
        <div class="glass-card p-4 d-flex flex-column" style="height: fit-content;">
          <h5 class="text-white font-outfit mb-3">Question Navigator</h5>
          <div class="question-nav-grid mb-4">
            ${this.session.questions.map((_, idx) => {
              let statusClass = '';
              if (idx === this.session.currentIndex) {
                statusClass = 'active';
              } else if (this.session.flags[idx]) {
                statusClass = 'flagged';
              } else if (this.session.answers[idx] !== undefined && this.session.answers[idx].trim() !== '') {
                statusClass = 'answered';
              }
              return `
                <button class="q-nav-btn ${statusClass}" onclick="App.jumpToExamQuestion(${idx})">
                  ${idx + 1}
                </button>
              `;
            }).join('')}
          </div>
          
          <div class="d-flex justify-content-between text-xs text-muted border-top border-secondary border-opacity-10 pt-3">
            <span class="d-flex align-items-center gap-1"><span class="badge bg-success rounded-circle p-1">&nbsp;</span> Answered</span>
            <span class="d-flex align-items-center gap-1"><span class="badge bg-warning rounded-circle p-1">&nbsp;</span> Flagged</span>
            <span class="d-flex align-items-center gap-1"><span class="badge bg-cyan rounded-circle p-1">&nbsp;</span> Active</span>
          </div>
        </div>
      </div>
    `;

    this.updateTimerDisplay();
  },

  selectExamOption(opt) {
    this.session.answers[this.session.currentIndex] = opt;
    this.renderExamInterface();
  },

  toggleQuestionFlag() {
    this.session.flags[this.session.currentIndex] = !this.session.flags[this.session.currentIndex];
    this.renderExamInterface();
  },

  navigateExam(dir) {
    this.session.currentIndex += dir;
    this.renderExamInterface();
  },

  jumpToExamQuestion(idx) {
    this.session.currentIndex = idx;
    this.renderExamInterface();
  },

  confirmExamSubmission() {
    const unanswered = this.session.questions.length - Object.keys(this.session.answers).length;
    let message = 'Are you sure you want to submit your exam?';
    if (unanswered > 0) {
      message = `You have ${unanswered} unanswered questions. Are you sure you want to submit your exam?`;
    }
    if (confirm(message)) {
      this.submitExam();
    }
  },

  submitExam() {
    clearInterval(this.session.timer);
    
    // Calculate Score
    let correctCount = 0;
    const reportData = []; // details for report review card

    this.session.questions.forEach((q, idx) => {
      const userAns = this.session.answers[idx] || '';
      const isCorrect = userAns === q.correctAnswer;
      
      if (isCorrect) {
        correctCount += 1;
      }
      
      // Save results to userState chapterAnalytics on checking the answer
      const chId = q.chapterId || 'ch1';
      if (!this.userState.chapterAnalytics[chId]) {
        this.userState.chapterAnalytics[chId] = { correct: 0, total: 0 };
      }
      this.userState.chapterAnalytics[chId].total += 1;
      if (isCorrect) {
        this.userState.chapterAnalytics[chId].correct += 1;
      }

      reportData.push({
        type: 'mcq',
        question: q.question,
        options: q.options,
        userAnswer: userAns,
        correctAnswer: q.correctAnswer,
        explanation: q.explanation,
        isCorrect: isCorrect,
        chapterId: q.chapterId || 'ch1'
      });
    });

    const total = this.session.questions.length;
    const scorePercent = Math.round((correctCount / total) * 100);

    // Save stats
    this.userState.examsCompleted += 1;
    this.userState.quizHistory.push({
      type: 'exam',
      name: this.exams[this.session.id].title,
      score: correctCount,
      total: total,
      date: new Date().toLocaleDateString()
    });

    // Re-calculate average score
    const totalScorePercents = this.userState.quizHistory.map(item => (item.score / item.total) * 100);
    this.userState.averageScore = Math.round(totalScorePercents.reduce((a, b) => a + b, 0) / totalScorePercents.length);
    this.saveUserState();

    // Render Exam Results Summary Page
    this.renderExamReport(correctCount, total, scorePercent, reportData);
  },

  renderExamReport(correct, total, percent, report, isReRender = false) {
    const container = document.getElementById('exams-section');
    
    // Save report data
    if (!isReRender) {
      this.lastExamReport = {
        examId: this.session.id,
        correctCount: correct,
        total: total,
        reportData: report
      };
    }
    
    container.innerHTML = `
      <div class="row mb-4">
        <div class="col-12">
          <h2 class="font-outfit text-white mb-1">Simulated Exam Results</h2>
          <p class="text-muted">A detailed analysis of your performance in the exam.</p>
        </div>
      </div>

      <div class="row g-4 mb-4">
        <!-- Score Overview Card -->
        <div class="col-md-4">
          <div class="glass-card p-4 text-center h-100 d-flex flex-column justify-content-center align-items-center">
            <span class="text-sm text-muted mb-2">Simulated Score</span>
            <h1 class="font-outfit text-white display-3 mb-2" style="background: linear-gradient(135deg, var(--accent-cyan), var(--accent-purple)); -webkit-background-clip: text; -webkit-text-fill-color: transparent;">${percent}%</h1>
            <span class="badge bg-cyan bg-opacity-10 text-cyan px-3 py-2 text-sm">${correct} / ${total} Correct Answers</span>
            <a href="#exams" class="btn btn-cyan mt-4 w-100">Solve Another Exam</a>
          </div>
        </div>

        <!-- Performance Summary Card -->
        <div class="col-md-8">
          <div class="glass-card p-4 h-100">
            <h5 class="text-white font-outfit mb-3">Topic breakdown & performance</h5>
            <p class="text-muted text-sm mb-4">Your answers have been processed and mapped to core database topics. Re-read your weak areas to improve your chances in the finals.</p>
            
            <div class="d-flex flex-column gap-3">
              ${this.chapters.map(ch => {
                // Find how many questions in this exam belonged to this chapter, and how many user got right
                let chQuestionsCount = 0;
                let chCorrectCount = 0;
                
                this.lastExamReport.reportData.forEach((item) => {
                  if (item.chapterId === ch.id) {
                    chQuestionsCount += 1;
                    if (item.isCorrect) {
                      chCorrectCount += 1;
                    }
                  }
                });

                if (chQuestionsCount === 0) return ''; // Skip if chapter was not tested in this exam

                const accuracy = Math.round((chCorrectCount / chQuestionsCount) * 100);
                const progressColor = accuracy >= 80 ? 'green' : accuracy >= 50 ? 'cyan' : 'purple';

                return `
                  <div class="metric-row">
                    <div class="metric-label">
                      <span class="text-white text-xs">${ch.title}</span>
                      <span class="text-muted text-xs">${chCorrectCount}/${chQuestionsCount} (${accuracy}%)</span>
                    </div>
                    <div class="custom-progress">
                      <div class="custom-progress-bar ${progressColor}" style="width: ${accuracy}%"></div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      </div>

      <!-- Detailed Question-by-Question Review -->
      <div class="row g-4">
        <div class="col-12">
          <div class="glass-card p-4">
            <h5 class="text-white font-outfit mb-4">Question Review</h5>
            <div class="d-flex flex-column gap-4">
              ${report.map((item, idx) => {
                return `
                <div class="border-bottom border-secondary border-opacity-10 pb-4">
                  <div class="d-flex justify-content-between align-items-start gap-3 mb-2">
                    <h6 class="text-white text-sm font-outfit mb-0">Q${idx + 1}. ${item.question}</h6>
                    <span class="badge ${item.isCorrect ? 'bg-success text-success' : 'bg-danger text-danger'} bg-opacity-10 px-2 py-1 text-xs">
                      ${item.isCorrect ? 'Correct' : 'Incorrect'}
                    </span>
                  </div>
                  
                  <div class="row g-2 mt-2">
                    ${item.options.map((opt, oIdx) => {
                      let btnBorder = 'var(--card-border)';
                      let badgeBg = 'rgba(255,255,255,0.08)';
                      let badgeColor = 'inherit';
                      
                      if (opt === item.correctAnswer) {
                        btnBorder = 'var(--emerald-green)';
                        badgeBg = 'var(--emerald-green)';
                        badgeColor = '#060913';
                      } else if (opt === item.userAnswer && !item.isCorrect) {
                        btnBorder = 'var(--rose-red)';
                        badgeBg = 'var(--rose-red)';
                        badgeColor = '#060913';
                      }
                      
                      return `
                        <div class="col-md-6">
                          <div class="p-2 text-xs rounded-8 d-flex align-items-center gap-2 border" style="border-color: ${btnBorder} !important; background: rgba(255,255,255,0.01);">
                            <span class="option-badge m-0" style="background: ${badgeBg}; color: ${badgeColor}; width: 22px; height: 22px; font-size:0.75rem;">${String.fromCharCode(65 + oIdx)}</span>
                            <span class="${opt === item.correctAnswer ? 'text-success fw-bold' : opt === item.userAnswer ? 'text-danger fw-bold' : 'text-muted'}">${opt}</span>
                          </div>
                        </div>
                      `;
                    }).join('')}
                  </div>

                  <div class="bg-black bg-opacity-20 p-3 rounded-12 mt-3 text-xs border border-secondary border-opacity-5">
                    <strong class="text-white mb-1 d-block"><i class="bi bi-info-circle me-1 text-cyan"></i> Explanation:</strong>
                    <span class="text-muted">${item.explanation}</span>
                  </div>
                </div>
              `}).join('')}
            </div>
          </div>
        </div>
      </div>
    `;

    if (!isReRender) {
      // Clear active session since exam is finished
      this.session = {
        type: null,
        id: null,
        questions: [],
        currentIndex: 0,
        answers: {},
        flags: {},
        isSubmitted: false
      };
    }
  },

  // 5. Predictions Home View
  renderPredictionsHome() {
    const container = document.getElementById('predictions-section');
    container.innerHTML = `
      <div class="row mb-4">
        <div class="col-12">
          <h2 class="font-outfit text-white mb-1">Predicted Final Exams</h2>
          <p class="text-muted">High-probability topics and expected questions gathered by cross-referencing previous syllabus concepts.</p>
        </div>
      </div>
      <div class="row g-4">
        ${['A', 'B', 'C'].map(variant => {
          const variantQs = this.predictions.filter(p => p.examVariant === variant);
          return `
            <div class="col-lg-4">
              <div class="glass-card exam-card d-flex flex-column h-100">
                <div class="d-flex justify-content-between align-items-center mb-3">
                  <span class="badge bg-cyan bg-opacity-10 text-cyan px-2 py-1 text-xs font-semibold">Variant ${variant}</span>
                  <span class="pred-pill very-high">High Probability</span>
                </div>
                <h4 class="text-white mb-2 font-outfit">Predicted Paper ${variant}</h4>
                <p class="text-muted text-xs mb-4">Consists of ${variantQs.length} expected questions selected from high-frequency topics such as relational calculus, distributed database partitioning, and 3NF/BCNF normalization.</p>
                <div class="mt-auto d-flex justify-content-between align-items-center pt-3 border-top border-secondary border-opacity-10">
                  <span class="text-xs text-muted">Estimated frequency: Very High</span>
                  <button class="btn btn-cyan btn-sm px-3" onclick="window.location.hash='#predictions/${variant}'">Solve variant ${variant}</button>
                </div>
              </div>
            </div>
          `;
        }).join('')}
      </div>
    `;
  },

  // Renders Simulated Predicted Exam
  renderPredictionSolver(variant) {
    const container = document.getElementById('predictions-section');
    const variantQs = this.predictions.filter(p => p.examVariant === variant);
    
    if (variantQs.length === 0) {
      container.innerHTML = `<div class="alert alert-danger m-5">Variant not found</div>`;
      return;
    }

    if (this.session.variant !== variant || this.session.type !== 'prediction') {
      this.session = {
        type: 'prediction',
        id: variant,
        variant: variant,
        questions: variantQs,
        currentIndex: 0,
        answers: {},
        flags: {},
        isSubmitted: false
      };
    }

    this.renderPredictionQuestion();
  },

  renderPredictionQuestion() {
    const container = document.getElementById('predictions-section');
    const q = this.session.questions[this.session.currentIndex];
    const isFirst = this.session.currentIndex === 0;
    const isLast = this.session.currentIndex === this.session.questions.length - 1;
    const selectedAnswer = this.session.answers[this.session.currentIndex];

    container.innerHTML = `
      <div class="row mb-4">
        <div class="col-12">
          <a href="#predictions" class="text-sm text-decoration-none text-cyan mb-2 d-inline-block"><i class="bi bi-arrow-left me-1"></i> Exit Predictions</a>
          <div class="d-flex justify-content-between align-items-center">
            <h3 class="text-white font-outfit mb-0">Predicted Variant ${this.session.variant}</h3>
            <span class="text-sm text-muted">Expected Question ${this.session.currentIndex + 1} of ${this.session.questions.length}</span>
          </div>
        </div>
      </div>

      <div class="row g-4">
        <div class="col-lg-8">
          <div class="glass-card question-card">
            <div class="d-flex align-items-center gap-2 mb-3">
              <span class="pred-pill ${q.probability === 'very-high' ? 'very-high' : q.probability === 'high' ? 'high' : 'medium'}">${q.probability}</span>
              <span class="text-xs text-muted">Topic Frequency: ${q.topicFrequency} appearances in past finals</span>
            </div>
            
            <h4 class="text-white mb-4 text-md font-outfit">${q.question}</h4>

            <!-- Options -->
            <div class="options-container">
              ${q.options.map((opt, idx) => {
                const isSelected = selectedAnswer === opt;
                let optClass = '';
                if (this.session.isSubmitted) {
                  const isCorrectOpt = opt === q.correctAnswer;
                  if (isSelected && isCorrectOpt) {
                    optClass = 'correct';
                  } else if (isSelected && !isCorrectOpt) {
                    optClass = 'incorrect';
                  } else if (isCorrectOpt) {
                    optClass = 'correct';
                  }
                } else if (isSelected) {
                  optClass = 'selected';
                }

                return `
                  <button class="option-btn ${optClass}" onclick="App.selectPredictionOption('${opt}')" ${this.session.isSubmitted ? 'disabled' : ''}>
                    <span class="option-badge">${String.fromCharCode(65 + idx)}</span>
                    <span>${opt}</span>
                  </button>
                `;
              }).join('')}
            </div>

            <!-- Explanation & Reason for Prediction -->
            ${this.session.isSubmitted ? `
              <div class="feedback-panel">
                <h6 class="font-outfit text-white mb-2"><i class="bi bi-graph-up text-cyan me-2"></i> Why we predicted this question:</h6>
                <p class="text-sm text-muted mb-3">${q.reason}</p>
                
                <h6 class="font-outfit text-white mb-2"><i class="bi bi-info-circle text-cyan me-2"></i> Model Answer:</h6>
                <pre class="bg-success bg-opacity-5 text-success p-3 rounded-12 border border-success border-opacity-20 font-monospace overflow-auto mb-3 text-xs" style="max-height: 150px;">${q.correctAnswer}</pre>
                
                <p class="text-sm text-muted mb-0"><strong>Explanation:</strong> ${q.explanation}</p>
              </div>
            ` : ''}

            <!-- Controls -->
            <div class="d-flex justify-content-between mt-auto pt-4 border-top border-secondary border-opacity-10">
              <button class="btn btn-outline-glass" onclick="App.navigatePrediction(-1)" ${isFirst ? 'disabled' : ''}>
                <i class="bi bi-chevron-left me-1"></i> Prev
              </button>
              
              ${!this.session.isSubmitted ? `
                <button class="btn btn-cyan px-4" onclick="App.submitPredictionQuestion()">Check Answer</button>
              ` : `
                <button class="btn btn-cyan px-4" onclick="App.navigatePrediction(1)" ${isLast ? 'style="display:none;"' : ''}>Next <i class="bi bi-chevron-right ms-1"></i></button>
                ${isLast ? `<button class="btn btn-success px-4" onclick="App.finishPredictionSession()"><i class="bi bi-check2-all me-1"></i> Done</button>` : ''}
              `}
            </div>
          </div>
        </div>

        <!-- Navigator -->
        <div class="col-lg-4">
          <div class="glass-card p-4">
            <h5 class="text-white font-outfit mb-3">Questions</h5>
            <div class="d-flex flex-wrap gap-2">
              ${this.session.questions.map((_, idx) => {
                let statusClass = '';
                if (idx === this.session.currentIndex) {
                  statusClass = 'active';
                } else if (this.session.answers[idx] !== undefined && this.session.answers[idx].trim() !== '') {
                  statusClass = 'answered';
                }
                return `
                  <button class="q-nav-btn ${statusClass}" onclick="App.jumpToPredictionQuestion(${idx})" style="width: 40px; height: 40px;">
                    ${idx + 1}
                  </button>
                `;
              }).join('')}
            </div>
          </div>
        </div>
      </div>
    `;
  },

  selectPredictionOption(opt) {
    if (this.session.isSubmitted) return;
    this.session.answers[this.session.currentIndex] = opt;
    this.renderPredictionQuestion();
  },

  submitPredictionQuestion() {
    const q = this.session.questions[this.session.currentIndex];

    if (this.session.answers[this.session.currentIndex] === undefined) {
      alert('Please select an option first.');
      return;
    }
    this.session.isSubmitted = true;
    
    // Save results to userState chapterAnalytics on checking the answer
    const isCorrect = this.session.answers[this.session.currentIndex] === q.correctAnswer;
    const chId = q.relatedChapter || 'ch1';
    
    if (!this.userState.chapterAnalytics[chId]) {
      this.userState.chapterAnalytics[chId] = { correct: 0, total: 0 };
    }
    this.userState.chapterAnalytics[chId].total += 1;
    if (isCorrect) {
      this.userState.chapterAnalytics[chId].correct += 1;
    }

    this.renderPredictionQuestion();
  },

  navigatePrediction(dir) {
    this.session.currentIndex += dir;
    this.session.isSubmitted = false;
    this.renderPredictionQuestion();
  },

  jumpToPredictionQuestion(idx) {
    this.session.currentIndex = idx;
    this.session.isSubmitted = false;
    this.renderPredictionQuestion();
  },

  finishPredictionSession() {
    let correctCount = 0;
    this.session.questions.forEach((q, idx) => {
      if (this.session.answers[idx] === q.correctAnswer) {
        correctCount += 1;
      }
    });

    const total = this.session.questions.length;
    
    this.userState.quizzesCompleted += 1; // Count predictions variant as a revision quiz
    this.userState.quizHistory.push({
      type: 'quiz',
      name: `Predicted variant ${this.session.variant}`,
      score: correctCount,
      total: total,
      date: new Date().toLocaleDateString()
    });

    // Re-calculate average score
    const totalScorePercents = this.userState.quizHistory.map(item => (item.score / item.total) * 100);
    this.userState.averageScore = Math.round(totalScorePercents.reduce((a, b) => a + b, 0) / totalScorePercents.length);
    this.saveUserState();

    alert(`Completed Variant ${this.session.variant}! You answered ${correctCount}/${total} correctly. Your history log is updated.`);
    window.location.hash = '#predictions';
  },

  // 6. Analytics Dashboard View
  renderAnalytics() {
    const container = document.getElementById('analytics-section');
    
    // Calculate stats
    let historyHTML = '';
    if (this.userState.quizHistory.length === 0) {
      historyHTML = `<div class="text-muted text-sm text-center py-4">No logged history yet. Start practice tests to display logs.</div>`;
    } else {
      historyHTML = `
        <div class="table-responsive">
          <table class="table table-dark table-borderless align-middle mb-0">
            <thead>
              <tr class="text-muted text-xs border-bottom border-secondary border-opacity-10">
                <th>Activity name</th>
                <th>Attempt Date</th>
                <th>Correct answers</th>
                <th>Percentage</th>
              </tr>
            </thead>
            <tbody>
              ${[...this.userState.quizHistory].reverse().map(item => {
                const percent = Math.round((item.score / item.total) * 100);
                const barColor = percent >= 80 ? 'green' : percent >= 50 ? 'cyan' : 'purple';
                return `
                  <tr class="text-sm">
                    <td class="fw-semibold">${item.name}</td>
                    <td class="text-muted text-xs">${item.date}</td>
                    <td>${item.score} / ${item.total}</td>
                    <td>
                      <div class="d-flex align-items-center gap-2" style="min-width: 120px;">
                        <span class="text-xs fw-bold" style="width: 32px;">${percent}%</span>
                        <div class="custom-progress flex-grow-1">
                          <div class="custom-progress-bar ${barColor}" style="width: ${percent}%"></div>
                        </div>
                      </div>
                    </td>
                  </tr>
                `;
              }).join('')}
            </tbody>
          </table>
        </div>
      `;
    }

    // Recommendation logic for weak chapters
    const performanceArray = this.chapters.map(ch => {
      const stats = this.userState.chapterAnalytics[ch.id];
      const accuracy = stats && stats.total > 0 ? (stats.correct / stats.total) * 100 : null;
      return { chapter: ch, accuracy, stats };
    });

    const evaluatedChapters = performanceArray.filter(item => item.accuracy !== null);
    const weakChapters = [...evaluatedChapters].sort((a, b) => a.accuracy - b.accuracy);
    const strongChapters = [...evaluatedChapters].sort((a, b) => b.accuracy - a.accuracy);

    let adviceHTML = '';
    if (evaluatedChapters.length === 0) {
      adviceHTML = `<p class="text-muted text-sm mb-0">Complete at least one chapter quiz or mock exam to generate performance analysis and revision guidelines.</p>`;
    } else {
      adviceHTML = `
        <div class="row g-4">
          <div class="col-md-6">
            <div class="p-3 bg-danger bg-opacity-5 border border-danger border-opacity-10 rounded-12 h-100">
              <h6 class="text-danger font-outfit mb-2"><i class="bi bi-exclamation-octagon-fill me-1"></i> Focus Areas (Weakest Topics)</h6>
              <ul class="mb-0 text-sm text-muted ps-3">
                ${weakChapters.slice(0, 2).map(item => `
                  <li class="mb-1"><strong>${item.chapter.title}</strong>: ${Math.round(item.accuracy)}% accuracy (${item.stats.correct}/${item.stats.total} answers)</li>
                `).join('')}
              </ul>
            </div>
          </div>
          <div class="col-md-6">
            <div class="p-3 bg-success bg-opacity-5 border border-success border-opacity-10 rounded-12 h-100">
              <h6 class="text-success font-outfit mb-2"><i class="bi bi-shield-check me-1"></i> Strong Topics</h6>
              <ul class="mb-0 text-sm text-muted ps-3">
                ${strongChapters.slice(0, 2).map(item => `
                  <li class="mb-1"><strong>${item.chapter.title}</strong>: ${Math.round(item.accuracy)}% accuracy (${item.stats.correct}/${item.stats.total} answers)</li>
                `).join('')}
              </ul>
            </div>
          </div>
        </div>
      `;
    }

    container.innerHTML = `
      <div class="row mb-4">
        <div class="col-12">
          <h2 class="font-outfit text-white mb-1">Performance Analytics</h2>
          <p class="text-muted">A comprehensive breakdown of your strengths and weaker study areas.</p>
        </div>
      </div>

      <div class="row g-4 mb-4">
        <!-- Main accuracy progress grid -->
        <div class="col-lg-7">
          <div class="glass-card p-4 h-100">
            <h5 class="text-white font-outfit mb-4">accuracy by Study Chapter</h5>
            <div class="d-flex flex-column gap-3">
              ${this.chapters.map(ch => {
                const stats = this.userState.chapterAnalytics[ch.id];
                const accuracy = stats && stats.total > 0 ? Math.round((stats.correct / stats.total) * 100) : 0;
                const accuracyText = stats ? `${accuracy}% (${stats.correct}/${stats.total})` : 'No Data';
                const progressColor = stats ? (accuracy >= 80 ? 'green' : accuracy >= 50 ? 'cyan' : 'purple') : 'transparent';
                
                return `
                  <div class="metric-row">
                    <div class="metric-label">
                      <span class="text-white text-xs">${ch.title}</span>
                      <span class="text-muted text-xs">${accuracyText}</span>
                    </div>
                    <div class="custom-progress">
                      <div class="custom-progress-bar ${progressColor}" style="width: ${stats ? accuracy : 0}%"></div>
                    </div>
                  </div>
                `;
              }).join('')}
            </div>
          </div>
        </div>

        <div class="col-lg-5 d-flex flex-column gap-4">
          <!-- Reset State Card -->
          <div class="glass-card p-4 text-center">
            <h5 class="text-white font-outfit mb-2">Reset Analytics</h5>
            <p class="text-muted text-xs mb-3">Clear all cached scores, logged history, and database quiz entries to start your studies fresh.</p>
            <button class="btn btn-danger btn-sm px-4" onclick="App.confirmResetState()">Reset Progress</button>
          </div>
          
          <!-- Recommendation feedback -->
          <div class="glass-card p-4 flex-grow-1">
            <h5 class="text-white font-outfit mb-3">Study recommendation</h5>
            ${adviceHTML}
          </div>
        </div>
      </div>

      <div class="row g-4">
        <div class="col-12">
          <div class="glass-card p-4">
            <h5 class="text-white font-outfit mb-4">Complete Activity History</h5>
            ${historyHTML}
          </div>
        </div>
      </div>
    `;
  },

  confirmResetState() {
    if (confirm('Are you sure you want to reset your study progress? This will erase all history logs and chapter accuracy data.')) {
      this.userState = {
        quizzesCompleted: 0,
        examsCompleted: 0,
        averageScore: 0,
        quizHistory: [],
        chapterAnalytics: {}
      };
      this.saveUserState();
      this.renderAnalytics();
    }
  }
};

// Start App when page finishes loading
document.addEventListener('DOMContentLoaded', () => App.init());
