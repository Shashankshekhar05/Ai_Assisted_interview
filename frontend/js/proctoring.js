// Edge AI Proctoring Engine (Zero-Cost Client Inference)
// Incorporates Technical Safeguards #1 (5s cooldown + visibilitychange), #2 (Visual Proof Snapshots), #3 (True Eye Gaze Blendshapes), Screen Share & Auto Hardware Teardown

let videoEl = null;
let canvasEl = null;
let canvasCtx = null;
let cocoModel = null;
let faceLandmarker = null;
let isProctoringRunning = false;
let animationFrameId = null;

// Hardware MediaStream references for clean teardown
let cameraStream = null;
let screenStream = null;

// Proctoring State & Safeguard #1: Anti-Chain-Reaction Timer
let strikeCount = 0;
const maxStrikes = 3;
let lastViolationTime = 0;
const VIOLATION_COOLDOWN_MS = 5000; // 5-second cooldown

// Eye Gaze Averted Duration Tracker
let gazeAvertedStartTime = null;
const GAZE_THRESHOLD_MS = 3000; // 3 seconds continuous averted gaze

// Pre-Interview Permission Setup Flow
function openPermissionModal() {
    const modal = document.getElementById('permission-modal');
    if (modal) modal.classList.remove('hidden');
}

document.getElementById('btn-cancel-permission').addEventListener('click', () => {
    document.getElementById('permission-modal').classList.add('hidden');
    if (typeof window.stopAllHardwareMedia === 'function') {
        window.stopAllHardwareMedia();
    }
});

document.getElementById('btn-grant-all-permissions').addEventListener('click', async () => {
    // Prime browser audio context & speech synthesis synchronously on direct user gesture
    if (typeof primeAudioOnUserGesture === 'function') {
        primeAudioOnUserGesture();
    }

    const btn = document.getElementById('btn-grant-all-permissions');
    const originalText = btn.innerHTML;
    btn.innerHTML = `<i class="fa-solid fa-spinner fa-spin"></i> Initializing...`;
    btn.disabled = true;

    try {
        // 1. Request Webcam & Audio
        const camBadge = document.getElementById('perm-cam-status');
        const micBadge = document.getElementById('perm-mic-status');
        const screenBadge = document.getElementById('perm-screen-status');

        cameraStream = await navigator.mediaDevices.getUserMedia({
            video: { width: 640, height: 480, facingMode: 'user' },
            audio: true
        });
        camBadge.innerText = "Granted";
        camBadge.className = "px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono text-[10px]";
        micBadge.innerText = "Granted";
        micBadge.className = "px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono text-[10px]";

        // 2. Request Screen Sharing
        screenStream = await navigator.mediaDevices.getDisplayMedia({
            video: true,
            audio: false
        });
        screenBadge.innerText = "Granted";
        screenBadge.className = "px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 font-mono text-[10px]";

        // Listen for screen share cancellation/stop
        screenStream.getVideoTracks()[0].onended = () => {
            if (appState.isInterviewActive) {
                triggerProctorViolation("Screen sharing was stopped by the candidate", 1.0);
            }
        };

        // Close Permission Modal
        document.getElementById('permission-modal').classList.add('hidden');

        // Launch the room
        startInterviewRoom();

    } catch (err) {
        console.error("Permission error:", err);
        alert("Camera, Microphone, and Screen Sharing are all mandatory for proctoring verification. Please allow access to proceed: " + err.message);
    } finally {
        btn.innerHTML = originalText;
        btn.disabled = false;
    }
});

// Global debug flags for 1-second live logger
window._debugFaceDetected = false;
window._debugPhoneDetected = false;

// 1-Second Proctoring State Heartbeat Logger (Requested by User)
setInterval(() => {
    const isCocoLoaded = Boolean(cocoModel);
    const isFaceLoaded = Boolean(faceLandmarker);
    const isRunning = Boolean(isProctoringRunning);
    const videoState = videoEl ? `readyState=${videoEl.readyState}` : 'videoEl=null';
    const streamActive = cameraStream ? `streamActive=${cameraStream.active}` : 'no-stream';

    console.log(
        `[PROCTOR DEBUG 1s] ` +
        `Proctoring Running: ${isRunning ? 'YES' : 'NO'} | ` +
        `COCO Model Loaded: ${isCocoLoaded ? 'YES' : 'NO'} | ` +
        `Face Model Loaded: ${isFaceLoaded ? 'YES' : 'NO'} | ` +
        `Face Detected: ${window._debugFaceDetected ? 'YES' : 'NO'} | ` +
        `Phone Detected: ${window._debugPhoneDetected ? 'YES' : 'NO'} | ` +
        `(${videoState}, ${streamActive})`
    );
}, 1000);

async function startEdgeProctoring() {
    console.log("[PROCTOR DEBUG] startEdgeProctoring() called!");
    videoEl = document.getElementById('webcam-feed');
    canvasEl = document.getElementById('proctor-canvas');
    console.log("[PROCTOR DEBUG] videoEl:", videoEl, "| canvasEl:", canvasEl);
    if (!videoEl || !canvasEl) {
        console.error("[PROCTOR DEBUG] ERROR: videoEl or canvasEl not found in DOM!");
        return;
    }
    canvasCtx = canvasEl.getContext('2d');

    strikeCount = 0;
    updateStrikeIndicators();

    try {
        if (!cameraStream) {
            console.log("[PROCTOR DEBUG] No cameraStream, requesting getUserMedia...");
            cameraStream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480, facingMode: 'user' },
                audio: false
            });
        }
        console.log("[PROCTOR DEBUG] Setting videoEl.srcObject = cameraStream...");
        videoEl.srcObject = cameraStream;

        // Non-blocking metadata check: avoids hanging if metadata is already available
        if (videoEl.readyState < 1) {
            console.log("[PROCTOR DEBUG] Waiting for video onloadedmetadata...");
            await new Promise((res) => {
                videoEl.onloadedmetadata = () => res();
                setTimeout(res, 800); // 800ms safety timeout
            });
        }
        console.log("[PROCTOR DEBUG] Playing videoEl... readyState =", videoEl.readyState);
        try { await videoEl.play(); } catch (e) { console.warn("[PROCTOR DEBUG] videoEl.play() notice:", e); }

        canvasEl.width = videoEl.videoWidth || 640;
        canvasEl.height = videoEl.videoHeight || 480;

        isProctoringRunning = true;
        logProctorEvent("[CAMERA] Webcam active. Initializing AI vision models...");
        console.log("[PROCTOR DEBUG] isProctoringRunning set to TRUE.");

        // 2. Load TensorFlow.js COCO-SSD for Mobile Phone Detection
        console.log("[PROCTOR DEBUG] Checking window.cocoSsd:", typeof window.cocoSsd);
        if (window.cocoSsd && !cocoModel) {
            console.log("[PROCTOR DEBUG] Loading cocoSsd.load()...");
            cocoModel = await cocoSsd.load();
            console.log("[PROCTOR DEBUG] COCO-SSD Model Loaded successfully!");
            logProctorEvent("[COCO-SSD] Mobile phone & object detector loaded.");
        } else if (!window.cocoSsd) {
            console.error("[PROCTOR DEBUG] ERROR: window.cocoSsd is UNDEFINED! Check script tag in index.html.");
        }

        // 3. Technical Safeguard #3: Load MediaPipe Face Landmarker with Blendshapes
        if (!faceLandmarker) {
            console.log("[PROCTOR DEBUG] Initializing MediaPipe Face Landmarker...");
            await initMediaPipeFaceLandmarker();
        }

        // 4. Start Vision Loop
        console.log("[PROCTOR DEBUG] Starting proctoringLoop via requestAnimationFrame...");
        animationFrameId = requestAnimationFrame(proctoringLoop);

        // 5. Technical Safeguard #1: Strict Visibility Change Listener (Document Hidden)
        setupVisibilityMonitoring();

    } catch (err) {
        console.error("[PROCTOR DEBUG] Proctoring initialization error:", err);
        logProctorEvent(`[WARNING] Webcam or Edge AI setup notice: ${err.message}`);
    }
}

// Automatic Hardware & Stream Teardown on Interview End
function stopAllStreamsAndProctoring() {
    isProctoringRunning = false;
    if (animationFrameId) {
        cancelAnimationFrame(animationFrameId);
        animationFrameId = null;
    }

    // Stop and release camera tracks (Turns off camera green indicator immediately)
    if (cameraStream) {
        try {
            cameraStream.getTracks().forEach(track => {
                track.stop();
                track.enabled = false;
            });
        } catch (e) { }
        cameraStream = null;
    }

    // Stop and release screen share tracks (Dismisses Chrome screen share banner immediately)
    if (screenStream) {
        try {
            screenStream.getTracks().forEach(track => {
                track.onended = null;
                track.stop();
                track.enabled = false;
            });
        } catch (e) { }
        screenStream = null;
    }

    if (videoEl) {
        try {
            videoEl.pause();
            if (videoEl.srcObject && typeof videoEl.srcObject.getTracks === 'function') {
                videoEl.srcObject.getTracks().forEach(t => {
                    t.stop();
                    t.enabled = false;
                });
            }
            videoEl.srcObject = null;
        } catch (e) { }
    }

    if (canvasCtx && canvasEl) {
        try {
            canvasCtx.clearRect(0, 0, canvasEl.width, canvasEl.height);
        } catch (e) { }
    }

    gazeAvertedStartTime = null;
    logProctorEvent("[HARDWARE] Camera and screen share feeds automatically powered off.");
}
window.stopProctoringStreams = stopAllStreamsAndProctoring;
window.stopAllStreamsAndProctoring = stopAllStreamsAndProctoring;

// Master Teardown: Shuts down camera, microphone, screen share, and all sounds immediately
window.stopAllHardwareMedia = function () {
    console.log("[HARDWARE TEARDOWN] Call terminated: Stopping camera, screen share, microphone, and sound.");
    if (typeof appState !== 'undefined') {
        appState.isInterviewActive = false;
    }

    // 1. Stop video camera and screen share
    if (typeof window.stopProctoringStreams === 'function') {
        window.stopProctoringStreams();
    } else if (typeof stopAllStreamsAndProctoring === 'function') {
        stopAllStreamsAndProctoring();
    }

    // 2. Stop microphone, VAD, and AI sound/speech
    if (typeof window.stopInterviewAudioAndMic === 'function') {
        window.stopInterviewAudioAndMic();
    } else {
        if (typeof stopActiveMicrophoneRecording === 'function') stopActiveMicrophoneRecording();
        if (typeof stopAllAiSpeech === 'function') stopAllAiSpeech();
        if (typeof stopSilenceCountdown === 'function') stopSilenceCountdown();
    }

    // 3. Global DOM Sweep: Scan DOM for any active video or audio media tracks and terminate them
    try {
        document.querySelectorAll('video, audio').forEach(el => {
            if (el.srcObject && typeof el.srcObject.getTracks === 'function') {
                el.srcObject.getTracks().forEach(track => {
                    try {
                        track.stop();
                        track.enabled = false;
                    } catch (e) { }
                });
                el.srcObject = null;
            }
            try {
                el.pause();
                el.removeAttribute('src');
                el.load();
            } catch (e) { }
        });
    } catch (err) {
        console.warn("DOM media track sweep notice:", err);
    }

    // 4. Update UI labels
    const aiStatusLabel = document.getElementById('ai-status-label');
    if (aiStatusLabel) {
        aiStatusLabel.innerText = "Call Ended (All Feeds Disconnected)";
        aiStatusLabel.className = "text-xs font-mono-code font-bold uppercase tracking-widest text-slate-400";
    }
    const micLabel = document.getElementById('mic-instruction-label');
    if (micLabel) {
        micLabel.innerText = "Call ended";
    }
};

async function initMediaPipeFaceLandmarker() {
    try {
        console.log("[PROCTOR DEBUG] Initializing MediaPipe Face Landmarker...");
        let visionPkg = null;
        if (window.mediapipe && window.mediapipe.tasks && window.mediapipe.tasks.vision) {
            visionPkg = window.mediapipe.tasks.vision;
        } else {
            // Dynamic import fallback from CDN ES Module
            try {
                visionPkg = await import("https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3");
            } catch (impErr) {
                console.warn("[PROCTOR DEBUG] Dynamic import of MediaPipe failed:", impErr);
            }
        }

        if (visionPkg) {
            const { FaceLandmarker, FilesetResolver } = visionPkg;
            console.log("[PROCTOR DEBUG] Loading MediaPipe FilesetResolver wasm from CDN...");
            const filesetResolver = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
            );
            console.log("[PROCTOR DEBUG] Creating FaceLandmarker from options...");
            faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                    delegate: "GPU"
                },
                outputFaceBlendshapes: true,
                runningMode: "VIDEO",
                numFaces: 2
            });
            console.log("[PROCTOR DEBUG] FaceLandmarker initialized successfully!");
            logProctorEvent("[MEDIAPIPE] FaceLandmarker initialized with true eye blendshapes.");
        } else {
            console.warn("[PROCTOR DEBUG] MediaPipe vision library could not be loaded. Falling back to COCO-SSD person detection.");
        }
    } catch (e) {
        console.error("[PROCTOR DEBUG] MediaPipe setup exception:", e);
    }
}

let lastDetectionTime = 0;
async function proctoringLoop(timestamp) {
    if (!isProctoringRunning) return;

    // Run object & gaze detection every 400ms (2.5 FPS) to conserve client CPU
    if (timestamp - lastDetectionTime > 400) {
        lastDetectionTime = timestamp;
        canvasCtx.clearRect(0, 0, canvasEl.width, canvasEl.height);

        // A. Run COCO-SSD Object Detection
        let detectedPersonCount = 0;
        if (cocoModel && videoEl.readyState >= 2) {
            try {
                const predictions = await cocoModel.detect(videoEl);
                let phoneFound = false;

                for (let pred of predictions) {
                    // Draw bounding box if confidence >= 0.45
                    if (pred.score >= 0.45) {
                        const isPhone = pred.class === 'cell phone';
                        canvasCtx.strokeStyle = isPhone ? '#ef4444' : '#6366f1';
                        canvasCtx.lineWidth = 3;
                        canvasCtx.strokeRect(...pred.bbox);

                        canvasCtx.fillStyle = isPhone ? '#ef4444' : '#6366f1';
                        canvasCtx.font = "bold 13px sans-serif";
                        canvasCtx.fillText(`${pred.class.toUpperCase()} (${Math.round(pred.score * 100)}%)`, pred.bbox[0], pred.bbox[1] > 18 ? pred.bbox[1] - 5 : 15);
                    }

                    // Mobile phone detection threshold: 0.45 (lowered from 0.60 to capture angled/dark phones)
                    if (pred.class === 'cell phone' && pred.score >= 0.45) {
                        phoneFound = true;
                    }
                    if (pred.class === 'person' && pred.score >= 0.50) {
                        detectedPersonCount++;
                    }
                }
                window._debugPhoneDetected = phoneFound;

                // Update HUD element with correct ID: 'hud-phone-status'
                const phoneHud = document.getElementById('hud-phone-status') || document.getElementById('hud-object-status');
                if (phoneFound) {
                    if (phoneHud) {
                        phoneHud.innerText = "⚠ CELL PHONE DETECTED";
                        phoneHud.className = "text-rose-400 font-bold font-mono animate-pulse";
                    }
                    triggerProctorViolation("Mobile phone detected in camera frame", 0.85);
                } else {
                    if (phoneHud) {
                        phoneHud.innerText = "✓ Not Detected";
                        phoneHud.className = "text-emerald-400 font-bold font-mono";
                    }
                }

                if (detectedPersonCount > 1) {
                    triggerProctorViolation("Multiple persons detected in camera frame", 0.80);
                }
            } catch (err) {
                // Ignore transient frame errors
            }
        }

        // B. Run MediaPipe Face Landmarker & Gaze Blendshapes (with COCO-SSD fallback)
        if (faceLandmarker && videoEl.readyState >= 2) {
            try {
                const results = faceLandmarker.detectForVideo(videoEl, performance.now());
                const hasFace = Boolean(results.faceLandmarks && results.faceLandmarks.length > 0);
                window._debugFaceDetected = hasFace;
                const gazeHud = document.getElementById('hud-gaze-status');

                if (!hasFace) {
                    // Candidate left webcam frame
                    if (gazeHud) {
                        gazeHud.innerText = "⚠ No Face in Frame";
                        gazeHud.className = "text-rose-400 font-bold font-mono animate-pulse";
                    }
                    checkGazeAvertedDuration("Candidate face not visible in camera frame");
                } else {
                    // Check blendshapes for eye deviation
                    let eyeAverted = false;
                    if (results.faceBlendshapes && results.faceBlendshapes.length > 0) {
                        const shapes = results.faceBlendshapes[0].categories;
                        const lookLeft = shapes.find(s => s.categoryName === 'eyeLookOutLeft' || s.categoryName === 'eyeLookInRight')?.score || 0;
                        const lookRight = shapes.find(s => s.categoryName === 'eyeLookInLeft' || s.categoryName === 'eyeLookOutRight')?.score || 0;
                        const lookUp = shapes.find(s => s.categoryName === 'eyeLookUpLeft' || s.categoryName === 'eyeLookUpRight')?.score || 0;

                        if (lookLeft > 0.55 || lookRight > 0.55 || lookUp > 0.60) {
                            eyeAverted = true;
                        }
                    }

                    if (eyeAverted) {
                        if (gazeHud) {
                            gazeHud.innerText = "⚠ Eye Gaze Averted";
                            gazeHud.className = "text-amber-400 font-bold font-mono";
                        }
                        checkGazeAvertedDuration("Candidate eyes diverted away from screen");
                    } else {
                        if (gazeHud) {
                            gazeHud.innerText = "✓ Normal";
                            gazeHud.className = "text-emerald-400 font-bold font-mono";
                        }
                        gazeAvertedStartTime = null; // Reset averted timer
                    }
                }
            } catch (e) {
                // Frame skip
            }
        } else if (cocoModel && videoEl.readyState >= 2) {
            // Robust Fallback: If MediaPipe is loading, use COCO-SSD person detection
            const gazeHud = document.getElementById('hud-gaze-status');
            if (detectedPersonCount === 0) {
                window._debugFaceDetected = false;
                if (gazeHud) {
                    gazeHud.innerText = "⚠ No Person in Frame";
                    gazeHud.className = "text-rose-400 font-bold font-mono animate-pulse";
                }
                checkGazeAvertedDuration("Candidate face/body not visible in camera frame");
            } else {
                window._debugFaceDetected = true;
                if (gazeHud) {
                    gazeHud.innerText = "✓ Normal";
                    gazeHud.className = "text-emerald-400 font-bold font-mono";
                }
                gazeAvertedStartTime = null;
            }
        }
    }

    requestAnimationFrame(proctoringLoop);
}

function checkGazeAvertedDuration(reason) {
    const now = Date.now();
    if (!gazeAvertedStartTime) {
        gazeAvertedStartTime = now;
        return;
    }

    if (now - gazeAvertedStartTime >= GAZE_THRESHOLD_MS) {
        triggerProctorViolation(`${reason} for > 3 continuous seconds`, 0.90);
        gazeAvertedStartTime = null; // Reset once strike is queued
    }
}

// Technical Safeguard #1: Tab Visibility Change Listener
function setupVisibilityMonitoring() {
    document.addEventListener("visibilitychange", () => {
        if (!appState.isInterviewActive) return;

        // Strictly check document.hidden === true
        if (document.hidden) {
            triggerProctorViolation("Screen focus lost / Browser tab switched", 1.0);
        }
    });
}

// Technical Safeguard #2: Capture Compressed Webcam Visual Proof Snapshot
function captureVisualProofSnapshot() {
    if (!videoEl) return null;
    try {
        const snapCanvas = document.createElement('canvas');
        snapCanvas.width = 480;
        snapCanvas.height = 360;
        const ctx = snapCanvas.getContext('2d');
        
        // 1. Draw live webcam frame
        ctx.drawImage(videoEl, 0, 0, 480, 360);

        // 2. Overlay live AI detection canvas (bounding boxes & labels)
        const overlayCanvas = document.getElementById('proctor-canvas');
        if (overlayCanvas) {
            ctx.drawImage(overlayCanvas, 0, 0, 480, 360);
        }

        // 3. Watermark timestamp bar at bottom
        ctx.fillStyle = 'rgba(0, 0, 0, 0.75)';
        ctx.fillRect(0, 330, 480, 30);
        ctx.fillStyle = '#EF4444';
        ctx.font = 'bold 12px monospace';
        ctx.fillText(`EVIDENCE CAPTURED: ${new Date().toLocaleTimeString()}`, 12, 350);

        // Crisp JPEG at 0.6 quality (~20 KB)
        return snapCanvas.toDataURL('image/jpeg', 0.6);
    } catch (e) {
        console.warn("Could not capture webcam snapshot:", e);
        return null;
    }
}

// Trigger Violation with Technical Safeguard #1 (5s cooldown) and #2 (Visual Proof)
async function triggerProctorViolation(reason, confidence = 1.0) {
    if (!appState.isInterviewActive) return;

    const now = Date.now();
    // Enforce 5-second anti-chain-reaction cooldown
    if (now - lastViolationTime < VIOLATION_COOLDOWN_MS) {
        return;
    }
    lastViolationTime = now;
    strikeCount++;
    appState.strikes = strikeCount;

    const snapshotBase64 = captureVisualProofSnapshot();
    const timeStr = new Date().toLocaleTimeString();

    logProctorEvent(`[STRIKE ${strikeCount}/${maxStrikes}] ${reason}`);
    updateStrikeIndicators();

    // Show Apple-style 3-Strike Warning Toast Modal with Snapshot
    showStrikeModal(strikeCount, reason, snapshotBase64);

    // Speak real-time Voice Warning aloud via Edge-TTS
    if (typeof speakWarning === 'function') {
        const lowerReason = (reason || '').toLowerCase();
        if (lowerReason.includes('phone') || lowerReason.includes('device') || lowerReason.includes('cell')) {
            speakWarning('phone');
        } else {
            speakWarning('face');
        }
    }

    // Transmit violation and snapshot to SQLite backend
    try {
        await fetch('/api/proctoring/violation', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                session_id: appState.sessionId,
                strike_number: strikeCount,
                violation_type: reason,
                confidence: confidence,
                notes: `Incident logged at ${timeStr}`,
                snapshot_base64: snapshotBase64
            })
        });
    } catch (err) {
        console.error("Failed to log violation to server:", err);
    }

    // Critical Strike Termination (3/3 strikes reached)
    if (strikeCount >= maxStrikes) {
        logProctorEvent(`[CRITICAL] Maximum strikes reached (${strikeCount}/${maxStrikes}). Disqualifying candidate.`);
        if (typeof window.stopAllHardwareMedia === 'function') {
            window.stopAllHardwareMedia();
        }
        setTimeout(() => {
            alert(`Interview Terminated: Maximum violation strikes (3/3) reached.\nReason: ${reason}\n\nCamera, audio, and screen sharing have been disconnected.`);
            loadFinalReport();
        }, 800);
    }
}

function updateStrikeIndicators() {
    const s1 = document.getElementById('strike-1');
    const s2 = document.getElementById('strike-2');
    const s3 = document.getElementById('strike-3');
    const counter = document.getElementById('strike-counter-text');

    if (counter) counter.innerText = `${strikeCount} / ${maxStrikes}`;

    if (strikeCount >= 1 && s1) {
        s1.className = "strike-capsule strike-capsule-amber";
        if (counter) counter.className = "text-amber-400 font-bold";
    }
    if (strikeCount >= 2 && s2) {
        s2.className = "strike-capsule strike-capsule-amber";
        if (counter) counter.className = "text-amber-400 font-bold";
    }
    if (strikeCount >= 3 && s3) {
        s3.className = "strike-capsule strike-capsule-rose";
        if (counter) counter.className = "text-rose-500 font-bold";
    }
}

function showStrikeModal(currentStrike, reason, snapshotBase64) {
    const modal = document.getElementById('proctor-modal');
    const title = document.getElementById('proctor-modal-title');
    const msg = document.getElementById('proctor-modal-msg');
    const snapImg = document.getElementById('toast-snapshot-img');
    const snapContainer = document.getElementById('toast-snapshot-container');

    if (title) title.innerText = `Proctoring Warning (${currentStrike}/${maxStrikes})`;
    if (msg) msg.innerText = `${reason}. Please keep your eyes on the screen and do not use any secondary device.`;

    if (snapshotBase64 && snapImg) {
        snapImg.src = snapshotBase64;
        if (snapContainer) snapContainer.classList.remove('hidden');
    } else if (snapContainer) {
        snapContainer.classList.add('hidden');
    }

    if (modal) modal.classList.remove('hidden');
}

// Modal Dismiss Button
document.getElementById('btn-dismiss-modal').addEventListener('click', () => {
    document.getElementById('proctor-modal').classList.add('hidden');
    // Re-set cooldown anchor to avoid instant re-trigger upon closing
    lastViolationTime = Date.now();
});

function logProctorEvent(text) {
    const logBox = document.getElementById('proctor-events-log');
    if (!logBox) return;
    const entry = document.createElement('div');
    entry.className = "text-[11px] leading-relaxed";
    entry.innerText = text;
    logBox.appendChild(entry);
    logBox.scrollTop = logBox.scrollHeight;
}

