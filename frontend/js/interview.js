// Conversational Voice Interview Controller

// ElevenLabs Style Reactive Canvas Waveform / Glowing Voice Orb
let audioCtx = null;
let analyser = null;
let dataArray = null;
let orbCanvas = null;
let orbCtx = null;
let orbAnimationId = null;

function initAudioVisualizerCanvas() {
    orbCanvas = document.getElementById('audio-orb-canvas');
    if (!orbCanvas) return;
    orbCtx = orbCanvas.getContext('2d');
    
    // Start drawing resting/reactive loop
    drawGlowingVoiceOrb();
}

function drawGlowingVoiceOrb() {
    if (!orbCtx || !orbCanvas) return;
    orbCtx.clearRect(0, 0, orbCanvas.width, orbCanvas.height);

    const centerX = orbCanvas.width / 2;
    const centerY = orbCanvas.height / 2;
    const time = Date.now() * 0.003;

    // Determine state
    let baseRadius = 55;
    let waveAmplitude = 12;
    let colorCore = '#38BDF8';
    let glowColor = 'rgba(56, 189, 248, 0.4)';

    if (isRecording) {
        baseRadius = 62;
        waveAmplitude = 20;
        colorCore = '#F43F5E';
        glowColor = 'rgba(244, 63, 94, 0.55)';
    } else if (ttsAudio && !ttsAudio.paused) {
        baseRadius = 60;
        waveAmplitude = 18;
        colorCore = '#38BDF8';
        glowColor = 'rgba(56, 189, 248, 0.55)';
    }

    // Outer concentric pulsating halos
    orbCtx.save();
    for (let i = 2; i >= 1; i--) {
        const haloRadius = baseRadius + (i * 18) + (Math.sin(time + i) * 6);
        orbCtx.beginPath();
        orbCtx.arc(centerX, centerY, haloRadius, 0, Math.PI * 2);
        orbCtx.strokeStyle = glowColor.replace('0.4', '0.12').replace('0.55', '0.15');
        orbCtx.lineWidth = 1.5;
        orbCtx.stroke();
    }

    // Dynamic wave perimeter around core
    orbCtx.beginPath();
    const points = 60;
    for (let i = 0; i < points; i++) {
        const angle = (i / points) * Math.PI * 2;
        const wave = Math.sin(angle * 6 + time * 4) * (waveAmplitude * 0.35)
                   + Math.cos(angle * 3 - time * 2) * (waveAmplitude * 0.25);
        const r = baseRadius + wave;
        const x = centerX + Math.cos(angle) * r;
        const y = centerY + Math.sin(angle) * r;

        if (i === 0) orbCtx.moveTo(x, y);
        else orbCtx.lineTo(x, y);
    }
    orbCtx.closePath();

    // Fill Core with Gradient
    const grad = orbCtx.createRadialGradient(centerX, centerY, 5, centerX, centerY, baseRadius + 15);
    grad.addColorStop(0, '#FFFFFF');
    grad.addColorStop(0.4, colorCore);
    grad.addColorStop(1, 'rgba(7, 9, 14, 0.95)');

    orbCtx.fillStyle = grad;
    orbCtx.shadowColor = colorCore;
    orbCtx.shadowBlur = 30;
    orbCtx.fill();
    orbCtx.restore();

    orbAnimationId = requestAnimationFrame(drawGlowingVoiceOrb);
}

function toggleTranscriptBox() {
    const box = document.getElementById('transcript-toggle-area');
    if (box) box.classList.toggle('hidden');
}

// 50-Second Silence & Inactivity Countdown Timer State
let silenceInterval = null;
let silenceSecondsLeft = 50;
const MAX_SILENCE_SECONDS = 50;

// Audio player element
const ttsAudio = document.getElementById('tts-audio-player');

function startSilenceCountdown() {
    stopSilenceCountdown();
    silenceSecondsLeft = MAX_SILENCE_SECONDS;
    
    const container = document.getElementById('silence-timer-container');
    const display = document.getElementById('silence-timer-display');
    if (container) container.classList.remove('hidden');
    if (container) container.classList.add('flex');
    if (display) display.innerText = `${silenceSecondsLeft}s`;

    silenceInterval = setInterval(() => {
        silenceSecondsLeft--;
        if (display) {
            display.innerText = `${silenceSecondsLeft}s`;
            if (silenceSecondsLeft <= 10) {
                display.className = "font-bold text-red-500 font-mono animate-pulse";
            } else {
                display.className = "font-bold text-amber-400 font-mono";
            }
        }

        // If 50 seconds elapse with silence / no answer
        if (silenceSecondsLeft <= 0) {
            stopSilenceCountdown();
            handleInactivityTimeout();
        }
    }, 1000);
}

function stopSilenceCountdown() {
    if (silenceInterval) {
        clearInterval(silenceInterval);
        silenceInterval = null;
    }
    const container = document.getElementById('silence-timer-container');
    if (container) {
        container.classList.add('hidden');
        container.classList.remove('flex');
    }
}

async function handleInactivityTimeout() {
    if (isRecording) {
        // Stop recording if running
        try {
            if (mediaRecorder && mediaRecorder.state !== 'inactive') {
                mediaRecorder.stop();
            }
        } catch (e) {}
        isRecording = false;
        micBtn.classList.remove('is-recording');
    }

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

function primeAudioOnUserGesture() {
    try {
        if ('speechSynthesis' in window) {
            window.speechSynthesis.resume();
        }
        if (ttsAudio) {
            ttsAudio.muted = false;
            ttsAudio.volume = 1.0;
            // Play a silent 1-sample WAV to prime audio engine without making sound
            if (!ttsAudio.src || ttsAudio.paused) {
                const silentWav = "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBIAAAABAAEARKwAAIhYAQACABAAAABkYXRhAgAAAAEA";
                ttsAudio.src = silentWav;
                const p = ttsAudio.play();
                if (p) p.then(() => ttsAudio.pause()).catch(() => {});
            }
        }
    } catch (e) {}
}

window.replayCurrentQuestionAudio = function() {
    primeAudioOnUserGesture();
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
        stopSilenceCountdown();
        updateAiStatus('Interview Completed', 'text-emerald-400');
        if (typeof stopAllStreamsAndProctoring === 'function') {
            stopAllStreamsAndProctoring();
        }
        setTimeout(() => {
            loadFinalReport();
        }, 2000);
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
const AUTO_SUBMIT_SILENCE_MS = 2500;   // 2.5 seconds of silence after candidate speaks to auto-submit answer

function playAiAudio(base64Uri) {
    stopSilenceCountdown();
    stopActiveMicrophoneRecording();

    updateAiStatus('AI Speaking...', 'text-indigo-400 font-bold');

    const waveEq = document.getElementById('waveform-eq');
    if (waveEq) waveEq.classList.add('wave-active');

    const replayBtnText = document.getElementById('btn-replay-audio-text');
    if (replayBtnText) replayBtnText.innerText = "Speaking...";

    // Handle in-memory audio playback
    if (base64Uri && base64Uri.length > 100) {
        ttsAudio.muted = false;
        ttsAudio.volume = 1.0;

        ttsAudio.onended = () => {
            if (waveEq) waveEq.classList.remove('wave-active');
            if (replayBtnText) replayBtnText.innerText = "Replay";
            onAiQuestionFinishedSpeaking();
        };

        ttsAudio.onerror = (e) => {
            console.warn('Audio tag playback error, falling back to Web Speech:', e);
            if (replayBtnText) replayBtnText.innerText = "Replay";
            const activeText = window.lastQuestionText || document.getElementById('ai-active-question-text')?.innerText || '';
            playBrowserSpeechFallback(activeText);
        };

        ttsAudio.src = base64Uri;
        const playPromise = ttsAudio.play();

        if (playPromise !== undefined) {
            playPromise.then(() => {
                const replayBtn = document.getElementById('btn-replay-audio');
                if (replayBtn) {
                    replayBtn.classList.remove('animate-bounce', 'ring-2', 'ring-amber-400', 'bg-amber-600');
                }
            }).catch(e => {
                console.warn('Audio auto-play policy restricted by browser:', e);
                // Highlight Listen button so candidate can click once to listen
                const replayBtn = document.getElementById('btn-replay-audio');
                if (replayBtn) {
                    replayBtn.classList.add('animate-bounce', 'ring-2', 'ring-amber-400', 'bg-amber-600');
                    if (replayBtnText) replayBtnText.innerText = "🔊 Tap to Listen";
                }
                updateAiStatus('Tap "Listen" to hear AI Question', 'text-amber-400 font-bold');

                // Fallback to Web Speech
                const activeText = window.lastQuestionText || document.getElementById('ai-active-question-text')?.innerText || '';
                playBrowserSpeechFallback(activeText);
            });
        }
    } else {
        // Fallback to browser SpeechSynthesis if audio base64 is empty
        const activeText = window.lastQuestionText || document.getElementById('ai-active-question-text')?.innerText || '';
        playBrowserSpeechFallback(activeText);
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
            if (replayBtnText) replayBtnText.innerText = "Replay";
            onAiQuestionFinishedSpeaking();
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

// Automatically triggers when AI finishes asking its question
function onAiQuestionFinishedSpeaking() {
    updateAiStatus('Listening (Speak naturally, auto-records)...', 'text-emerald-600 font-bold');
    
    // 1. Start the 50-second overall timeout countdown
    startSilenceCountdown();

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
                    // Candidate has spoken something and is now quiet
                    if (!silenceAfterSpeechStartTime) {
                        silenceAfterSpeechStartTime = now;
                    } else if (now - silenceAfterSpeechStartTime >= AUTO_SUBMIT_SILENCE_MS) {
                        // Candidate stopped speaking for 2.5 seconds -> AUTOMATICALLY SUBMIT ANSWER
                        clearInterval(vadCheckInterval);
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
    if (vadCheckInterval) {
        clearInterval(vadCheckInterval);
        vadCheckInterval = null;
    }
    if (vadAudioContext && vadAudioContext.state !== 'closed') {
        try { vadAudioContext.close(); } catch (e) {}
    }
    if (mediaRecorder && isRecording) {
        try {
            mediaRecorder.stop();
            mediaRecorder.stream.getTracks().forEach(track => track.stop());
        } catch (e) {}
    }
    isRecording = false;
    const micBtn = document.getElementById('btn-mic-record');
    if (micBtn) micBtn.classList.remove('is-recording');
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
    } catch (e) {}

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

        // Render transcribed candidate answer
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
document.getElementById('btn-end-interview').addEventListener('click', () => {
    if (confirm('Are you sure you want to end the interview and view the audit dossier?')) {
        stopSilenceCountdown();
        if (typeof stopAllStreamsAndProctoring === 'function') {
            stopAllStreamsAndProctoring();
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


