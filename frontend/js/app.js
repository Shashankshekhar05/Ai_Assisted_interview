// AI Interview Pro - Clean, Intuitive App Controller & View Manager

const appState = {
    sessionId: null,
    candidateName: 'Aman Kumar',
    roleTitle: 'Full Stack Python & AI Engineer',
    experienceLevel: 'Fresher',
    matchScore: 87,
    currentQuestionNumber: 1,
    maxQuestions: 10,
    strikes: 0,
    maxStrikes: 3,
    isInterviewActive: false
};

// Main Tab Switcher (Recruiter Dashboard, AI Interview Room, Evaluation Report)
function switchMainTab(tabName) {
    // Map aliases
    if (tabName === 'screening') tabName = 'dashboard';

    const tabs = ['dashboard', 'interview', 'report'];
    tabs.forEach(t => {
        const viewEl = document.getElementById(`view-${t}`) || document.getElementById(`tab-${t}`);
        const btnEl = document.getElementById(`tab-btn-${t}`) || document.getElementById(`nav-btn-${t}`);
        
        if (t === tabName) {
            if (viewEl) viewEl.classList.remove('hidden');
            if (btnEl) btnEl.classList.add('active');
        } else {
            if (viewEl) viewEl.classList.add('hidden');
            if (btnEl) btnEl.classList.remove('active');
        }
    });

    if (tabName === 'report' && appState.sessionId) {
        loadFinalReport();
    }
}

// Backward compatibility aliases
function showTab(tabName) {
    switchMainTab(tabName);
}
function showView(viewName) {
    switchMainTab(viewName);
}
function switchPlatformRoute(routeName) {
    if (routeName === 'dashboard' || routeName === 'jobs' || routeName === 'candidates') switchMainTab('dashboard');
    else if (routeName === 'interview-room' || routeName === 'interview') switchMainTab('interview');
    else if (routeName === 'evaluation-report' || routeName === 'report') switchMainTab('report');
}

function scrollToHero() {
    window.scrollTo({ top: 0, behavior: 'smooth' });
}

function focusResumeForm() {
    switchMainTab('dashboard');
    const form = document.getElementById('resume-screener-card');
    if (form) {
        form.scrollIntoView({ behavior: 'smooth', block: 'center' });
        form.classList.add('ring-2', 'ring-violet-500');
        setTimeout(() => form.classList.remove('ring-2', 'ring-violet-500'), 2000);
    }
}

function focusCandidatePreview() {
    switchMainTab('dashboard');
    const result = document.getElementById('screening-result-card');
    if (result && !result.classList.contains('hidden')) {
        result.scrollIntoView({ behavior: 'smooth', block: 'center' });
    } else {
        focusResumeForm();
    }
}

// Fast Resume Screening Submission
document.getElementById('btn-run-match')?.addEventListener('click', async () => {
    const roleTitle = document.getElementById('input-role-title').value.trim();
    const jdText = document.getElementById('input-jd-text').value.trim();
    const threshold = document.getElementById('input-threshold').value;
    const resumeFileInput = document.getElementById('input-resume-file');

    if (!roleTitle || !jdText) {
        alert('Please enter both Role Title and Job Description.');
        return;
    }

    if (!resumeFileInput.files || resumeFileInput.files.length === 0) {
        alert('Please select a Candidate Resume PDF file to upload.');
        return;
    }

    const btn = document.getElementById('btn-run-match');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Calculating Alignment...`;
    btn.disabled = true;

    try {
        const formData = new FormData();
        formData.append('role_title', roleTitle);
        formData.append('jd_text', jdText);
        formData.append('threshold', threshold);
        formData.append('resume_file', resumeFileInput.files[0]);

        const response = await fetch('/api/match-resume', {
            method: 'POST',
            body: formData
        });

        if (!response.ok) {
            const err = await response.json();
            throw new Error(err.detail || 'Failed to analyze resume.');
        }

        const data = await response.json();
        renderScreeningResults(data, roleTitle);

    } catch (error) {
        alert('Error: ' + error.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
});

function renderScreeningResults(data, roleTitle) {
    appState.sessionId = data.session_id;
    appState.candidateName = data.candidate_name || 'Aman Kumar';
    appState.roleTitle = roleTitle;
    appState.experienceLevel = data.experience_level || 'Fresher';
    appState.matchScore = data.match_percentage || 87;

    const card = document.getElementById('screening-result-card');
    if (card) {
        card.classList.remove('hidden');
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }

    const nameEl = document.getElementById('res-candidate-name');
    if (nameEl) nameEl.innerText = appState.candidateName;

    const yoeEl = document.getElementById('res-yoe');
    if (yoeEl) yoeEl.innerText = `${data.years_of_experience || 1.0} yrs exp`;

    const expBadge = document.getElementById('res-experience-badge');
    if (expBadge) expBadge.innerText = appState.experienceLevel;

    const scoreBadge = document.getElementById('res-score-badge');
    if (scoreBadge) scoreBadge.innerText = `${appState.matchScore}%`;

    const summaryText = document.getElementById('res-summary-text');
    if (summaryText) summaryText.innerText = data.evaluation_summary || 'Strong candidate alignment.';

    const matchedContainer = document.getElementById('res-matched-skills');
    if (matchedContainer) {
        matchedContainer.innerHTML = '';
        (data.key_strengths || ['Python', 'FastAPI', 'SQL']).forEach(skill => {
            const span = document.createElement('span');
            span.className = "px-2 py-0.5 bg-emerald-100 text-emerald-800 rounded text-[10px] font-semibold";
            span.innerText = skill;
            matchedContainer.appendChild(span);
        });
    }

    // Launch room trigger
    const launchBtn = document.getElementById('btn-launch-interview');
    if (launchBtn) {
        launchBtn.onclick = () => {
            if (typeof openPermissionModal === 'function') {
                openPermissionModal();
            } else {
                switchMainTab('interview');
                if (typeof startInterviewRoom === 'function') startInterviewRoom();
            }
        };
    }
}

// Load and Render Final Auditor Dossier (View 3)
async function loadFinalReport() {
    appState.isInterviewActive = false;
    switchMainTab('report');

    const qaContainer = document.getElementById('report-qa-container') || document.getElementById('report-qa-list');
    const timelineContainer = document.getElementById('report-violations-timeline');
    if (qaContainer) qaContainer.innerHTML = '<div class="text-xs text-slate-400"><i class="fa-solid fa-spinner fa-spin mr-1"></i> Compiling evaluation dossier...</div>';
    if (timelineContainer) timelineContainer.innerHTML = '';

    try {
        const res = await fetch(`/api/interview/${appState.sessionId}/report`);
        if (!res.ok) throw new Error('Could not compile report.');

        const data = await res.json();

        const candName = document.getElementById('report-candidate-name');
        if (candName) candName.innerText = appState.candidateName;

        const roleTitle = document.getElementById('report-target-role') || document.getElementById('report-role-title');
        if (roleTitle) roleTitle.innerText = `${appState.roleTitle} (${appState.experienceLevel} Track)`;
        
        const matchScoreEl = document.getElementById('report-jd-match-score') || document.getElementById('report-match-badge');
        if (matchScoreEl) matchScoreEl.innerText = `${appState.matchScore}%`;

        const overallPct = document.getElementById('report-overall-score-pct');
        if (overallPct) overallPct.innerText = `${Math.round(data.technical_score * 10)}%`;

        const circleEl = document.getElementById('report-score-circle');
        if (circleEl) {
            const pct = Math.min(100, Math.max(0, data.technical_score * 10));
            const circumference = 251.2;
            const offset = circumference - (pct / 100) * circumference;
            circleEl.style.strokeDashoffset = offset;
        }

        const recEl = document.getElementById('report-rec-text') || document.getElementById('report-summary-text');
        if (recEl && data.summary) recEl.innerText = data.summary;

        // Render Q&A Critique Cards
        if (qaContainer) {
            qaContainer.innerHTML = '';
            const critiques = data.qa_critique || [];
            if (critiques.length === 0) {
                qaContainer.innerHTML = '<div class="text-xs text-slate-400 font-mono">No answered questions logged.</div>';
            } else {
                critiques.forEach((item, idx) => {
                    const card = document.createElement('div');
                    card.className = "p-4 rounded-xl bg-slate-50 border border-slate-200 space-y-2 text-xs";
                    card.innerHTML = `
                        <div class="flex items-center justify-between text-slate-900 font-bold">
                            <span>Question ${idx + 1}: ${item.question}</span>
                            <span class="text-violet-600 font-mono font-bold bg-violet-50 px-2 py-0.5 rounded border border-violet-200">Score: ${item.rating}/10</span>
                        </div>
                        <div class="text-slate-800 bg-white p-2.5 rounded-lg border border-slate-200">
                            <strong>Candidate Answer:</strong> ${item.answer}
                        </div>
                        <div class="text-emerald-700 italic">
                            <strong class="not-italic font-semibold">Evaluation:</strong> ${item.feedback}
                        </div>
                    `;
                    qaContainer.appendChild(card);
                });
            }
        }

        // Render Proctoring Incident Timeline
        if (timelineContainer) {
            const violations = data.violations || [];
            const badge = document.getElementById('report-strikes-count-badge');
            if (badge) badge.innerText = `${violations.length} Incidents Logged`;
            timelineContainer.innerHTML = '';

            if (violations.length === 0) {
                timelineContainer.innerHTML = `
                    <div class="bg-emerald-50 border border-emerald-200 rounded-xl p-3.5 text-xs text-emerald-800 flex items-center gap-2">
                        <i class="fa-solid fa-circle-check text-emerald-600"></i>
                        <span>Clean session. Zero integrity violations detected during the interview.</span>
                    </div>
                `;
            } else {
                violations.forEach(v => {
                    const vCard = document.createElement('div');
                    vCard.className = "p-4 rounded-xl bg-slate-50 border border-red-200 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4";
                    
                    const snapImg = v.snapshot_base64 
                        ? `<img src="${v.snapshot_base64}" alt="Proof" class="w-28 h-20 object-cover rounded-lg border border-red-300 shadow">`
                        : `<div class="w-28 h-20 bg-white rounded-lg border border-slate-200 flex items-center justify-center text-[10px] text-slate-400 font-mono">No Image</div>`;

                    vCard.innerHTML = `
                        <div class="flex items-center space-x-3.5">
                            ${snapImg}
                            <div class="space-y-1">
                                <span class="text-xs font-bold text-red-600 uppercase font-mono">Strike ${v.strike_number}: ${v.violation_type}</span>
                                <p class="text-xs text-slate-600">${v.notes || 'Logged by Edge AI'}</p>
                                <span class="text-[10px] text-slate-400 font-mono">${v.timestamp}</span>
                            </div>
                        </div>
                        <span class="px-2.5 py-1 rounded-full bg-red-100 text-red-700 text-xs font-mono font-bold">Confidence: ${Math.round((v.confidence || 1.0) * 100)}%</span>
                    `;
                    timelineContainer.appendChild(vCard);
                });
            }
        }

    } catch (err) {
        console.error(err);
        if (qaContainer) qaContainer.innerHTML = `<div class="text-xs text-red-600">Failed to compile report: ${err.message}</div>`;
    }
}

// Recruiter Decision Action
async function submitRecruiterDecision(decision) {
    if (!appState.sessionId) return;
    try {
        const res = await fetch(`/api/interview/${appState.sessionId}/decision`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ decision })
        });
        if (!res.ok) throw new Error('Could not update decision.');
        alert(`Candidate decision '${decision}' saved to database.`);
    } catch (e) {
        alert('Error: ' + e.message);
    }
}
