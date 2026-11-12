// Conversational Voice Interview Controller

// Global Recording & Audio State
let mediaRecorder = null;
let audioChunks = [];
let isRecording = false;

function toggleTranscriptBox() {
    const box = document.getElementById('transcript-toggle-area');
    if (box) box.classList.toggle('hidden');
}

// Pre-answer Thinking Time Countdown (30 seconds to begin speaking)
let thinkingInterval = null;
let thinkingSecondsLeft = 30;
const MAX_THINKING_SECONDS = 30;

// Audio player element
let activeAudioInstance = null;

function startThinkingCountdown() {
    stopThinkingCountdown();
    thinkingSecondsLeft = MAX_THINKING_SECONDS;

    const container = document.getElementById('silence-timer-container');
    const display = document.getElementById('silence-timer-display');
    if (container) {
        container.classList.remove('hidden');
        container.classList.add('flex');
    }
    if (display) {
        display.innerText = `${thinkingSecondsLeft}s`;
        display.className = "font-bold text-amber-400 font-mono";
    }

    thinkingInterval = setInterval(() => {
        thinkingSecondsLeft--;
        if (display) {
            display.innerText = `${thinkingSecondsLeft}s`;
            if (thinkingSecondsLeft <= 10) {
                display.className = "font-bold text-red-500 font-mono animate-pulse";
            } else {
                display.className = "font-bold text-amber-400 font-mono";
            }
        }

        // If candidate does not begin speaking within 30 seconds
        if (thinkingSecondsLeft <= 0) {
            stopThinkingCountdown();
            handleInactivityTimeout();
        }
    }, 1000);
}

function stopThinkingCountdown() {
    if (thinkingInterval) {
        clearInterval(thinkingInterval);
        thinkingInterval = null;
    }
    const container = document.getElementById('silence-timer-container');
    if (container) {
        container.classList.add('hidden');
        container.classList.remove('flex');
    }
}

// Aliases for unified state management
function startSilenceCountdown() { startThinkingCountdown(); }
function stopSilenceCountdown() { stopThinkingCountdown(); }

async function handleInactivityTimeout() {
    stopActiveMicrophoneRecording();

    appendTranscriptEntry('candidate', '[No answer provided: candidate paused for >50s]');
    updateAiStatus('50s Inactivity detected. Advancing to next question...', 'text-amber-400');

    // Automatically submit timeout notice to advance question
    submitCandidateAnswer(null, "[Candidate took >50s pause / silence without answering]");
}

async function startInterviewRoom() {
    if (!appState.sessionId) {
        alert('Please complete resume screening first.');
        return;
    }

    if (typeof showTab === 'function') showTab('interview');
    else if (typeof showView === 'function') showView('interview');

    appState.isInterviewActive = true;
    appState.currentQuestionNumber = 1;

    const candTitle = document.getElementById('interview-candidate-title');
    if (candTitle) candTitle.innerText = `${appState.candidateName} — Live Interview Session`;

    const roleBadge = document.getElementById('interview-role-badge');
    if (roleBadge) roleBadge.innerText = `Role: ${appState.roleTitle}`;

    // Prime Web Speech Synthesis & Audio Context directly on this user click
    primeAudioOnUserGesture();

    // Start edge computer vision proctoring camera
    if (typeof startEdgeProctoring === 'function') {
        startEdgeProctoring();
    }

    // Call backend to generate Question #1
    fetchFirstQuestion();
}

// Preload and cache speech synthesis voices
let availableVoices = [];
function initSpeechVoices() {
    if ('speechSynthesis' in window) {
        availableVoices = window.speechSynthesis.getVoices() || [];
        window.speechSynthesis.onvoiceschanged = () => {
            availableVoices = window.speechSynthesis.getVoices() || [];
        };
    }
}
initSpeechVoices();

// Store latest question audio & text for replay anytime
window.lastQuestionAudioBase64 = null;
window.lastQuestionText = "";

// Persistent, Autoplay-Immune Web Audio Engine
let globalAudioContext = null;
let currentSourceNode = null;

function getOrCreateAudioContext() {
    try {
        const AudioCtxClass = window.AudioContext || window.webkitAudioContext;
        if (!globalAudioContext && AudioCtxClass) {
            globalAudioContext = new AudioCtxClass();
        }
        if (globalAudioContext && globalAudioContext.state === 'suspended') {
            globalAudioContext.resume();
        }
    } catch (e) {
        console.warn('AudioContext init notice:', e);
    }
    return globalAudioContext;
}

function base64ToArrayBuffer(base64String) {
    const cleanB64 = base64String.replace(/^data:audio\/\w+;base64,/, '').trim();
    const binary = window.atob(cleanB64);
    const len = binary.length;
    const bytes = new Uint8Array(len);
    for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
    }
    return bytes.buffer;
}

function stopAllAiSpeech() {
    if (currentSourceNode) {
        try {
            currentSourceNode.onended = null;
            currentSourceNode.stop();
        } catch (e) { }
        currentSourceNode = null;
    }
    if (activeAudioInstance) {
        try {
            activeAudioInstance.pause();
            activeAudioInstance.src = "";
        } catch (e) { }
        activeAudioInstance = null;
    }
    if ('speechSynthesis' in window) {
        try {
            window.speechSynthesis.cancel();
        } catch (e) { }
    }
    const waveEq = document.getElementById('waveform-eq');
    if (waveEq) waveEq.classList.remove('wave-active');
}

// Complete teardown for all microphone recording, VAD detection, and AI speech playback
window.stopInterviewAudioAndMic = function () {
    try {
        stopSilenceCountdown();
    } catch (e) { }

    try {
        stopActiveMicrophoneRecording();
    } catch (e) { }

    try {
        stopAllAiSpeech();
    } catch (e) { }

    try {
        if (vadAudioContext && vadAudioContext.state !== 'closed') {
            vadAudioContext.close();
            vadAudioContext = null;
        }
    } catch (e) { }

    try {
        if (globalAudioContext && globalAudioContext.state !== 'closed') {
            globalAudioContext.suspend();
        }
    } catch (e) { }

    if ('speechSynthesis' in window) {
        try {
            window.speechSynthesis.cancel();
        } catch (e) { }
    }

    const micBtn = document.getElementById('btn-mic-record');
    if (micBtn) micBtn.classList.remove('is-recording');

    const waveEq = document.getElementById('waveform-eq');
    if (waveEq) waveEq.classList.remove('wave-active');

    const replayBtnText = document.getElementById('btn-replay-audio-text');
    if (replayBtnText) replayBtnText.innerText = "Listen";
};

function primeAudioOnUserGesture() {
    try {
        getOrCreateAudioContext();
        if ('speechSynthesis' in window) {
            window.speechSynthesis.resume();
        }
    } catch (e) { }
}

window.replayCurrentQuestionAudio = function () {
    const ctx = getOrCreateAudioContext();
    if (ctx && ctx.state === 'suspended') {
        ctx.resume();
    }
    const replayBtn = document.getElementById('btn-replay-audio');
    if (replayBtn) {
        replayBtn.classList.remove('animate-bounce', 'ring-2', 'ring-amber-400', 'bg-amber-600');
    }
    const replayBtnText = document.getElementById('btn-replay-audio-text');
    if (replayBtnText) replayBtnText.innerText = "Playing...";

    if (window.lastQuestionAudioBase64 && window.lastQuestionAudioBase64.length > 100) {
        playAiAudio(window.lastQuestionAudioBase64);
    } else {
        const text = window.lastQuestionText || document.getElementById('ai-active-question-text')?.innerText || '';
        playBrowserSpeechFallback(text);
    }
};

async function fetchFirstQuestion() {
    updateAiStatus('AI Thinking...', 'text-amber-400');
    try {
        const formData = new FormData();
        formData.append('session_id', appState.sessionId);

        const res = await fetch('/api/interview/start', {
            method: 'POST',
            body: formData
        });

        if (!res.ok) throw new Error('Failed to start interview.');

        const data = await res.json();
        handleAiQuestionReceived(data);

    } catch (err) {
        console.error(err);
        appendTranscriptEntry('ai', 'Welcome! Let us begin our technical discussion. Could you introduce yourself and your technical background?');
        updateAiStatus('Ready', 'text-indigo-400');
    }
}

function handleAiQuestionReceived(data) {
    appState.currentQuestionNumber = data.question_number || appState.currentQuestionNumber;

    // Cache latest audio and question text for manual replay or retry
    window.lastQuestionAudioBase64 = data.audio_base64 || null;
    window.lastQuestionText = data.question || "";

    // Update Question counter in format Q 01 / 10
    const qNumStr = appState.currentQuestionNumber < 10 ? `0${appState.currentQuestionNumber}` : appState.currentQuestionNumber;
    const maxQStr = appState.maxQuestions < 10 ? `0${appState.maxQuestions}` : appState.maxQuestions;
    document.getElementById('question-tracker').innerText = `Q ${qNumStr} / ${maxQStr}`;

    // Append AI question to UI transcript & active speech banner
    appendTranscriptEntry('ai', data.question);

    const speechBanner = document.getElementById('ai-active-question-text');
    if (speechBanner) speechBanner.innerText = data.question;

    // Reset replay button text
    const replayBtnText = document.getElementById('btn-replay-audio-text');
    if (replayBtnText) replayBtnText.innerText = "Listen";

    // Play TTS audio
    if (data.audio_base64) {
        playAiAudio(data.audio_base64);
    } else {
        playBrowserSpeechFallback(data.question);
    }

    if (data.is_complete) {
        if (typeof window.stopAllHardwareMedia === 'function') {
            window.stopAllHardwareMedia();
        } else {
            stopSilenceCountdown();
            stopActiveMicrophoneRecording();
            stopAllAiSpeech();
            if (typeof stopAllStreamsAndProctoring === 'function') {
                stopAllStreamsAndProctoring();
            }
        }
        updateAiStatus('Interview Completed', 'text-emerald-400');
        setTimeout(() => {
            loadFinalReport();
        }, 1500);
    }
}

// Web Audio Voice Activity Detection (VAD) for natural auto-recording & auto-submission
let vadAudioContext = null;
let vadAnalyser = null;
let vadMicrophone = null;
let vadCheckInterval = null;
let isSpeaking = false;
let speechStartTime = 0;
let silenceAfterSpeechStartTime = 0;
const SPEECH_VOLUME_THRESHOLD = 0.035; // Sensitivity threshold for candidate voice
const AUTO_SUBMIT_SILENCE_MS = 5000;   // 5 seconds silence after candidate finishes answer to auto-advance

function playAiAudio(base64Uri) {
    try { stopSilenceCountdown(); } catch (e) { }
    try { stopActiveMicrophoneRecording(); } catch (e) { }
    try { stopAllAiSpeech(); } catch (e) { }

    updateAiStatus('AI Speaking...', 'text-indigo-400 font-bold');

    const waveEq = document.getElementById('waveform-eq');
    if (waveEq) waveEq.classList.add('wave-active');

    const replayBtnText = document.getElementById('btn-replay-audio-text');
    if (replayBtnText) replayBtnText.innerText = "Speaking...";

    // 1. PRIMARY: Web Audio API decoding (Autoplay-Immune when audioCtx is resumed)
    const ctx = getOrCreateAudioContext();
    if (ctx && base64Uri && base64Uri.length > 100) {
        try {
            const arrayBuffer = base64ToArrayBuffer(base64Uri);
            ctx.decodeAudioData(arrayBuffer, (decodedAudioBuffer) => {
                if (ctx.state === 'suspended') {
                    ctx.resume();
                }

                const source = ctx.createBufferSource();
                source.buffer = decodedAudioBuffer;
                source.connect(ctx.destination);

                currentSourceNode = source;

                source.onended = () => {
                    currentSourceNode = null;
                    if (waveEq) waveEq.classList.remove('wave-active');
                    if (replayBtnText) replayBtnText.innerText = "Replay";
                    onAiQuestionFinishedSpeaking();
                };

                source.start(0);

                const replayBtn = document.getElementById('btn-replay-audio');
                if (replayBtn) {
                    replayBtn.classList.remove('animate-bounce', 'ring-2', 'ring-amber-400', 'bg-amber-600');
                }
            }, (decodeError) => {
                console.warn('Web Audio decode failed, trying HTML5 Audio fallback:', decodeError);
                playHtml5AudioFallback(base64Uri);
            });
            return;
        } catch (err) {
            console.warn('Web Audio playback error, trying HTML5 fallback:', err);
        }
    }

    // 2. SECONDARY: HTML5 Audio fallback
    playHtml5AudioFallback(base64Uri);
}

function playHtml5AudioFallback(base64Uri) {
    if (!base64Uri || base64Uri.length < 100) {
        const text = window.lastQuestionText || document.getElementById('ai-active-question-text')?.innerText || '';
        playBrowserSpeechFallback(text);
        return;
    }

    let audioSrc = base64Uri;
    if (audioSrc.startsWith('data:audio/mp3;')) {
        audioSrc = audioSrc.replace('data:audio/mp3;', 'data:audio/mpeg;');
    }

    activeAudioInstance = new Audio();
    activeAudioInstance.src = audioSrc;
    activeAudioInstance.volume = 1.0;

    const waveEq = document.getElementById('waveform-eq');
    const replayBtnText = document.getElementById('btn-replay-audio-text');

    activeAudioInstance.onended = () => {
        activeAudioInstance = null;
        if (waveEq) waveEq.classList.remove('wave-active');
        if (replayBtnText) replayBtnText.innerText = "Replay";
        onAiQuestionFinishedSpeaking();
    };

    activeAudioInstance.onerror = (e) => {
        console.warn('HTML5 Audio error, trying SpeechSynthesis fallback:', e);
        activeAudioInstance = null;
        const text = window.lastQuestionText || document.getElementById('ai-active-question-text')?.innerText || '';
        playBrowserSpeechFallback(text);
    };

    const playPromise = activeAudioInstance.play();
    if (playPromise !== undefined) {
        playPromise.then(() => {
            const replayBtn = document.getElementById('btn-replay-audio');
            if (replayBtn) {
                replayBtn.classList.remove('animate-bounce', 'ring-2', 'ring-amber-400', 'bg-amber-600');
            }
        }).catch(e => {
            console.warn('HTML5 Audio auto-play policy restricted by browser:', e);
            const replayBtn = document.getElementById('btn-replay-audio');
            if (replayBtn) {
                replayBtn.classList.add('animate-bounce', 'ring-2', 'ring-amber-400', 'bg-amber-600');
                if (replayBtnText) replayBtnText.innerText = "🔊 Tap to Listen";
            }
            updateAiStatus('Tap "Listen" to hear AI Question', 'text-amber-400 font-bold');

            // Attach a one-time click listener anywhere on document to trigger playback on click
            const playOnDocumentClick = () => {
                document.removeEventListener('click', playOnDocumentClick);
                if (replayBtn) {
                    replayBtn.classList.remove('animate-bounce', 'ring-2', 'ring-amber-400', 'bg-amber-600');
                }
                replayCurrentQuestionAudio();
            };
            document.addEventListener('click', playOnDocumentClick, { once: true, passive: true });
        });
    }
}

function playBrowserSpeechFallback(text) {
    stopSilenceCountdown();
    stopActiveMicrophoneRecording();

    if ('speechSynthesis' in window && text) {
        window.speechSynthesis.cancel();
        window.speechSynthesis.resume();

        const utterance = new SpeechSynthesisUtterance(text);
        utterance.rate = 1.0;
        utterance.pitch = 1.0;
        utterance.volume = 1.0;

        // Select the best natural English voice
        const voices = availableVoices.length > 0 ? availableVoices : (window.speechSynthesis.getVoices() || []);
        const enVoice = voices.find(v => v.lang.startsWith('en') && (v.name.includes('Natural') || v.name.includes('Neural') || v.name.includes('Google') || v.name.includes('Jenny') || v.name.includes('Aria') || v.name.includes('Online')))
            || voices.find(v => v.lang.startsWith('en'))
            || voices[0];
        if (enVoice) utterance.voice = enVoice;

        const waveEq = document.getElementById('waveform-eq');
        const replayBtnText = document.getElementById('btn-replay-audio-text');

        utterance.onstart = () => {
            updateAiStatus('AI Speaking...', 'text-indigo-400 font-bold');
            if (waveEq) waveEq.classList.add('wave-active');
            if (replayBtnText) replayBtnText.innerText = "Speaking...";
        };

        utterance.onend = () => {
            if (waveEq) waveEq.classList.remove('wave-active');
            if (replayBtnText) replayBtnText.innerText = "Replay";
            onAiQuestionFinishedSpeaking();
        };

        utterance.onerror = (err) => {
            console.warn('SpeechSynthesis error:', err);
            if (waveEq) waveEq.classList.remove('wave-active');
            const replayBtn = document.getElementById('btn-replay-audio');
            if (replayBtn) {
                replayBtn.classList.add('animate-bounce', 'ring-2', 'ring-amber-400', 'bg-amber-600');
            }
            if (replayBtnText) replayBtnText.innerText = "🔊 Tap to Listen";
            updateAiStatus('Tap "Listen" to hear AI Question', 'text-amber-400 font-bold');
        };

        // Chromium speech bug workaround: keep speaking alive if longer than 15s
        const resumeTimer = setInterval(() => {
            if (!window.speechSynthesis.speaking) {
                clearInterval(resumeTimer);
            } else {
                window.speechSynthesis.pause();
                window.speechSynthesis.resume();
            }
        }, 4000);

        window.speechSynthesis.speak(utterance);
    } else {
        onAiQuestionFinishedSpeaking();
    }
}

// Pre-cached audio dictionary for instant warning delivery via Edge-TTS
const warningAudioMap = {
    phone: null,
    face: null
};

// 10-second Warning Voice Cooldown to prevent voice overlap
let lastWarningVoiceTime = 0;
const WARNING_VOICE_COOLDOWN_MS = 10000;

window.speakWarning = async function (type) {
    const now = Date.now();
    if (now - lastWarningVoiceTime < WARNING_VOICE_COOLDOWN_MS) {
        return; // Suppress duplicate speech if spoken in the last 10 seconds
    }
    lastWarningVoiceTime = now;

    let text = "Please do not move, look at the screen";
    let key = "face";
    const lower = String(type || '').toLowerCase();
    if (lower.includes('phone') || lower.includes('device') || lower.includes('cell')) {
        text = "Please do not use any other device";
        key = "phone";
    }

    try {
        if (!warningAudioMap[key]) {
            const res = await fetch(`/api/tts?text=${encodeURIComponent(text)}`);
            if (res.ok) {
                const data = await res.json();
                if (data.audio_base64) {
                    warningAudioMap[key] = data.audio_base64;
                }
            }
        }

        if (warningAudioMap[key]) {
            playWarningAudioBuffer(warningAudioMap[key]);
            return;
        }
    } catch (e) {
        console.warn('Edge-TTS warning audio notice:', e);
    }

    // Secondary Fallback: browser SpeechSynthesis
    if ('speechSynthesis' in window) {
        try {
            window.speechSynthesis.cancel();
            window.speechSynthesis.resume();
            const u = new SpeechSynthesisUtterance(text);
            u.rate = 1.0;
            window.speechSynthesis.speak(u);
        } catch (e) { }
    }
};

function playWarningAudioBuffer(base64Uri) {
    const ctx = getOrCreateAudioContext();
    if (ctx) {
        try {
            const arrayBuffer = base64ToArrayBuffer(base64Uri);
            ctx.decodeAudioData(arrayBuffer, (decodedBuffer) => {
                if (ctx.state === 'suspended') ctx.resume();
                const source = ctx.createBufferSource();
                source.buffer = decodedBuffer;
                source.connect(ctx.destination);
                source.start(0);
            }, () => {
                const sound = new Audio(base64Uri);
                sound.play().catch(() => { });
            });
            return;
        } catch (e) { }
    }
    const sound = new Audio(base64Uri);
    sound.play().catch(() => { });
}

// Automatically triggers when AI finishes asking its question
function onAiQuestionFinishedSpeaking() {
    updateAiStatus('Thinking Time (30s to prepare, speak when ready)...', 'text-sky-400 font-bold');

    // 1. Start the 30-second thinking time countdown
    startThinkingCountdown();

    // 2. AUTOMATICALLY turn on candidate microphone & start recording (Zero manual click needed)
    startRecordingAutomatically();
}

async function startRecordingAutomatically() {
    if (isRecording) return;
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        audioChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.start(250); // Record chunks every 250ms
        isRecording = true;

        const micBtn = document.getElementById('btn-mic-record');
        if (micBtn) micBtn.classList.add('is-recording');

        // Initialize Web Audio VAD to detect when user starts and stops speaking
        initVoiceActivityDetection(stream);

    } catch (err) {
        console.error('Microphone auto-record error:', err);
    }
}

function initVoiceActivityDetection(stream) {
    if (vadCheckInterval) clearInterval(vadCheckInterval);

    try {
        vadAudioContext = new (window.AudioContext || window.webkitAudioContext)();
        vadAnalyser = vadAudioContext.createAnalyser();
        vadAnalyser.fftSize = 512;
        vadMicrophone = vadAudioContext.createMediaStreamSource(stream);
        vadMicrophone.connect(vadAnalyser);

        const bufferLength = vadAnalyser.frequencyBinCount;
        const dataArray = new Uint8Array(bufferLength);

        isSpeaking = false;
        speechStartTime = 0;
        silenceAfterSpeechStartTime = 0;

        vadCheckInterval = setInterval(() => {
            if (!isRecording) {
                clearInterval(vadCheckInterval);
                return;
            }

            vadAnalyser.getByteFrequencyData(dataArray);
            let sum = 0;
            for (let i = 0; i < bufferLength; i++) {
                sum += dataArray[i];
            }
            const averageVolume = sum / bufferLength / 255; // Normalized volume 0.0 to 1.0

            const now = Date.now();

            if (averageVolume > SPEECH_VOLUME_THRESHOLD) {
                // Candidate is actively speaking
                if (!isSpeaking) {
                    isSpeaking = true;
                    speechStartTime = now;
                    // Candidate began talking -> pause the 50s silence auto-skip timer
                    stopSilenceCountdown();
                    updateAiStatus('Listening (Recording candidate voice)...', 'text-emerald-600 font-bold');
                }
                silenceAfterSpeechStartTime = 0; // Reset silence anchor
            } else {
                // Candidate is quiet
                if (isSpeaking) {
                    // Candidate has spoken and is now pausing
                    if (!silenceAfterSpeechStartTime) {
                        silenceAfterSpeechStartTime = now;
                    }
                    const silentElapsed = now - silenceAfterSpeechStartTime;
                    const secLeft = Math.max(1, Math.ceil((AUTO_SUBMIT_SILENCE_MS - silentElapsed) / 1000));
                    
                    updateAiStatus(`Answer detected. Submitting in ${secLeft}s...`, 'text-amber-400 font-bold');

                    if (silentElapsed >= AUTO_SUBMIT_SILENCE_MS) {
                        // Candidate stopped speaking for 5 seconds -> AUTOMATICALLY ADVANCE TO NEXT QUESTION
                        clearInterval(vadCheckInterval);
                        vadCheckInterval = null;
                        updateAiStatus('Evaluating response...', 'text-violet-400 font-bold');
                        stopRecordingAndSubmit();
                    }
                }
            }
        }, 150);

    } catch (e) {
        console.warn('VAD AudioContext warning:', e);
    }
}

function stopActiveMicrophoneRecording() {
    try {
        if (vadCheckInterval) {
            clearInterval(vadCheckInterval);
            vadCheckInterval = null;
        }
        if (vadAudioContext && vadAudioContext.state !== 'closed') {
            try { vadAudioContext.close(); } catch (e) { }
            vadAudioContext = null;
        }
        if (typeof mediaRecorder !== 'undefined' && mediaRecorder && mediaRecorder.state !== 'inactive') {
            try {
                mediaRecorder.stop();
            } catch (e) { }
            try {
                if (mediaRecorder.stream) {
                    mediaRecorder.stream.getTracks().forEach(track => track.stop());
                }
            } catch (e) { }
        }
    } catch (e) {
        console.warn('stopActiveMicrophoneRecording notice:', e);
    } finally {
        isRecording = false;
        const micBtn = document.getElementById('btn-mic-record');
        if (micBtn) micBtn.classList.remove('is-recording');
    }
}

function updateAiStatus(statusText, colorClass = 'text-sky-400') {
    const label = document.getElementById('ai-status-label');
    if (label) {
        label.innerText = statusText;
        label.className = `text-xs font-mono-code font-bold uppercase tracking-widest ${colorClass}`;
    }
}

function appendTranscriptEntry(speaker, text) {
    const box = document.getElementById('live-transcript-feed') || document.getElementById('interview-transcript-box');
    if (!box) return;
    const msgDiv = document.createElement('div');

    if (speaker === 'ai') {
        msgDiv.className = "flex items-start space-x-2 text-left";
        msgDiv.innerHTML = `
            <div class="w-5 h-5 rounded-md bg-violet-500/20 text-violet-400 border border-violet-500/30 flex items-center justify-center shrink-0 text-[9px]">
                <i class="fa-solid fa-robot"></i>
            </div>
            <div class="bg-black/60 border border-white/10 rounded-lg p-2 max-w-[90%] text-slate-200 text-xs leading-relaxed">
                ${text}
            </div>
        `;
    } else {
        msgDiv.className = "flex items-start justify-end space-x-2 text-right";
        msgDiv.innerHTML = `
            <div class="bg-violet-600 rounded-lg p-2 max-w-[90%] text-white text-xs leading-relaxed">
                ${text}
            </div>
            <div class="w-5 h-5 rounded-md bg-emerald-500/20 text-emerald-400 border border-emerald-500/30 flex items-center justify-center shrink-0 text-[9px]">
                <i class="fa-solid fa-user"></i>
            </div>
        `;
    }

    box.appendChild(msgDiv);
    box.scrollTop = box.scrollHeight;
}

// Push-to-Talk Microphone Handler
const micBtn = document.getElementById('btn-mic-record');
micBtn?.addEventListener('click', async () => {
    if (!isRecording) {
        startRecording();
    } else {
        stopRecordingAndSubmit();
    }
});

async function startRecording() {
    stopSilenceCountdown(); // Pause timer while actively speaking
    try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        mediaRecorder = new MediaRecorder(stream, { mimeType: 'audio/webm' });
        audioChunks = [];

        mediaRecorder.ondataavailable = (e) => {
            if (e.data.size > 0) audioChunks.push(e.data);
        };

        mediaRecorder.start();
        isRecording = true;
        if (micBtn) micBtn.classList.add('is-recording');
        const micLabel = document.getElementById('mic-instruction-label');
        if (micLabel) micLabel.innerText = "Recording... Click again to submit answer";
        updateAiStatus('Recording candidate voice...', 'text-red-400');

    } catch (err) {
        console.error('Microphone access denied:', err);
    }
}

function stopRecordingAndSubmit() {
    if (!mediaRecorder) return;

    mediaRecorder.onstop = async () => {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        submitCandidateAnswer(audioBlob, null);
    };

    mediaRecorder.stop();
    // Stop tracks
    try {
        mediaRecorder.stream.getTracks().forEach(track => track.stop());
    } catch (e) { }

    isRecording = false;
    if (micBtn) micBtn.classList.remove('is-recording');
    const micLabel = document.getElementById('mic-instruction-label');
    if (micLabel) micLabel.innerText = "Click microphone to speak your answer";
    updateAiStatus('Transcribing voice response...', 'text-violet-400');
}

// Text Answer Handler
document.getElementById('btn-send-text-answer')?.addEventListener('click', () => {
    const textInput = document.getElementById('input-text-answer');
    if (!textInput) return;
    const val = textInput.value.trim();
    if (!val) return;
    textInput.value = '';

    submitCandidateAnswer(null, val);
});

document.getElementById('input-text-answer')?.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
        document.getElementById('btn-send-text-answer')?.click();
    }
});

async function submitCandidateAnswer(audioBlob, textAnswer) {
    updateAiStatus('AI Analyzing your response...', 'text-amber-400');

    const formData = new FormData();
    formData.append('session_id', appState.sessionId);
    formData.append('question_number', appState.currentQuestionNumber);

    if (audioBlob) {
        formData.append('audio_file', audioBlob, 'candidate_voice.webm');
    }
    if (textAnswer) {
        formData.append('text_answer', textAnswer);
    }

    try {
        const res = await fetch('/api/interview/answer', {
            method: 'POST',
            body: formData
        });

        if (!res.ok) throw new Error('Failed to evaluate answer.');

        const data = await res.json();

        // 1. Candidate requested to repeat current question (within max 2 limit)
        if (data.is_repeat_request) {
            const countStr = data.repeat_count && data.max_repeats ? ` (${data.repeat_count}/${data.max_repeats})` : '';
            updateAiStatus(`Repeating question${countStr}...`, 'text-amber-400 font-bold');
            if (data.candidate_transcript) {
                appendTranscriptEntry('candidate', `${data.candidate_transcript} 🔄 (Repeat Request${countStr})`);
            }
            // Replay current question audio immediately
            replayCurrentQuestionAudio();
            return;
        }

        // 2. Candidate exceeded max repeats (> 2): Question skipped to prevent infinite loop
        if (data.skipped_due_to_repeat_limit) {
            updateAiStatus('Max repeat limit reached (2/2). Moving to next question...', 'text-rose-400 font-bold');
            if (data.candidate_transcript) {
                appendTranscriptEntry('candidate', data.candidate_transcript);
            }
            // Process next question automatically
            handleAiQuestionReceived(data);
            return;
        }

        // 3. Normal candidate response
        if (data.candidate_transcript) {
            appendTranscriptEntry('candidate', data.candidate_transcript);
        }

        // Process follow-up question
        handleAiQuestionReceived(data);

    } catch (err) {
        console.error(err);
        alert('Error processing response: ' + err.message);
        updateAiStatus('Ready', 'text-indigo-400');
    }
}

// Manual End Interview button
document.getElementById('btn-end-interview')?.addEventListener('click', () => {
    if (confirm('Are you sure you want to end the interview and view the audit dossier?')) {
        if (typeof window.stopAllHardwareMedia === 'function') {
            window.stopAllHardwareMedia();
        } else {
            stopSilenceCountdown();
            stopActiveMicrophoneRecording();
            stopAllAiSpeech();
            if (typeof stopAllStreamsAndProctoring === 'function') {
                stopAllStreamsAndProctoring();
            }
        }
        loadFinalReport();
    }
});

// Global user gesture listener: primes audio context on any user interaction anywhere
document.addEventListener('click', () => {
    if (typeof primeAudioOnUserGesture === 'function') {
        primeAudioOnUserGesture();
    }
}, { passive: true });


