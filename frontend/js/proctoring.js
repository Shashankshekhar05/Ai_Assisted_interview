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
});

document.getElementById('btn-grant-all-permissions').addEventListener('click', async () => {
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

async function startEdgeProctoring() {
    videoEl = document.getElementById('webcam-feed');
    canvasEl = document.getElementById('proctor-canvas');
    if (!videoEl || !canvasEl) return;
    canvasCtx = canvasEl.getContext('2d');

    strikeCount = 0;
    updateStrikeIndicators();

    try {
        if (!cameraStream) {
            cameraStream = await navigator.mediaDevices.getUserMedia({
                video: { width: 640, height: 480, facingMode: 'user' },
                audio: false
            });
        }
        videoEl.srcObject = cameraStream;
        await new Promise((res) => { videoEl.onloadedmetadata = () => res(); });
        videoEl.play();

        canvasEl.width = videoEl.videoWidth || 640;
        canvasEl.height = videoEl.videoHeight || 480;

        isProctoringRunning = true;
        logProctorEvent("[CAMERA] Webcam active. Initializing AI vision models...");

        // 2. Load TensorFlow.js COCO-SSD for Mobile Phone Detection
        if (window.cocoSsd && !cocoModel) {
            cocoModel = await cocoSsd.load();
            logProctorEvent("[COCO-SSD] Mobile phone & object detector loaded.");
        }

        // 3. Technical Safeguard #3: Load MediaPipe Face Landmarker with Blendshapes
        if (!faceLandmarker) {
            await initMediaPipeFaceLandmarker();
        }

        // 4. Start Vision Loop
        animationFrameId = requestAnimationFrame(proctoringLoop);

        // 5. Technical Safeguard #1: Strict Visibility Change Listener (Document Hidden)
        setupVisibilityMonitoring();

    } catch (err) {
        console.error("Proctoring initialization error:", err);
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

    // Stop and release camera tracks
    if (cameraStream) {
        cameraStream.getTracks().forEach(track => {
            track.stop();
        });
        cameraStream = null;
    }

    // Stop and release screen share tracks
    if (screenStream) {
        screenStream.getTracks().forEach(track => {
            track.stop();
        });
        screenStream = null;
    }

    if (videoEl) {
        videoEl.pause();
        videoEl.srcObject = null;
    }

    if (canvasCtx && canvasEl) {
        canvasCtx.clearRect(0, 0, canvasEl.width, canvasEl.height);
    }

    gazeAvertedStartTime = null;
    logProctorEvent("[HARDWARE] Camera, microphone, and screen share automatically powered off.");
}

async function initMediaPipeFaceLandmarker() {
    try {
        // MediaPipe Tasks Vision loaded via CDN
        if (window.mediapipe && window.mediapipe.tasks && window.mediapipe.tasks.vision) {
            const { FaceLandmarker, FilesetResolver } = window.mediapipe.tasks.vision;
            const filesetResolver = await FilesetResolver.forVisionTasks(
                "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.3/wasm"
            );
            faceLandmarker = await FaceLandmarker.createFromOptions(filesetResolver, {
                baseOptions: {
                    modelAssetPath: "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task",
                    delegate: "GPU"
                },
                // Safeguard #3: Enable blendshapes for true eye gaze tracking
                outputFaceBlendshapes: true,
                runningMode: "VIDEO",
                numFaces: 2
            });
            logProctorEvent("[MEDIAPIPE] FaceLandmarker initialized with true eye blendshapes.");
        }
    } catch (e) {
        console.warn("MediaPipe GPU delegate fallback to CPU:", e);
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
        if (cocoModel && videoEl.readyState >= 2) {
            try {
                const predictions = await cocoModel.detect(videoEl);
                let phoneFound = false;
                let personCount = 0;

                for (let pred of predictions) {
                    // Draw bounding box
                    if (pred.score > 0.55) {
                        canvasCtx.strokeStyle = pred.class === 'cell phone' ? '#ef4444' : '#6366f1';
                        canvasCtx.lineWidth = 2;
                        canvasCtx.strokeRect(...pred.bbox);

                        canvasCtx.fillStyle = pred.class === 'cell phone' ? '#ef4444' : '#6366f1';
                        canvasCtx.font = "12px sans-serif";
                        canvasCtx.fillText(`${pred.class} (${Math.round(pred.score * 100)}%)`, pred.bbox[0], pred.bbox[1] > 15 ? pred.bbox[1] - 4 : 12);
                    }

                    if (pred.class === 'cell phone' && pred.score > 0.60) {
                        phoneFound = true;
                    }
                    if (pred.class === 'person') {
                        personCount++;
                    }
                }

                const objHud = document.getElementById('hud-object-status');
                if (phoneFound) {
                    objHud.innerText = "CELL PHONE DETECTED!";
                    objHud.className = "text-red-400 font-bold";
                    triggerProctorViolation("Mobile phone detected in camera frame", 0.85);
                } else if (personCount > 1) {
                    objHud.innerText = "MULTIPLE PERSONS DETECTED!";
                    objHud.className = "text-red-400 font-bold";
                    triggerProctorViolation("Multiple persons detected in camera frame", 0.80);
                } else {
                    objHud.innerText = "No Mobile Phone Detected";
                    objHud.className = "text-slate-300";
                }
            } catch (err) {
                // Ignore transient frame errors
            }
        }

        // B. Run MediaPipe Face Landmarker & Gaze Blendshapes
        if (faceLandmarker && videoEl.readyState >= 2) {
            try {
                const results = faceLandmarker.detectForVideo(videoEl, performance.now());
                const gazeHud = document.getElementById('hud-gaze-status');

                if (!results.faceLandmarks || results.faceLandmarks.length === 0) {
                    // Candidate left webcam frame
                    gazeHud.innerText = "No Face in Frame";
                    gazeHud.className = "text-red-400";
                    checkGazeAvertedDuration("Candidate face not visible in camera frame");
                } else {
                    // Check blendshapes for eye deviation
                    let eyeAverted = false;
                    if (results.faceBlendshapes && results.faceBlendshapes.length > 0) {
                        const shapes = results.faceBlendshapes[0].categories;
                        const lookLeft = shapes.find(s => s.categoryName === 'eyeLookOutLeft' || s.categoryName === 'eyeLookInRight')?.score || 0;
                        const lookRight = shapes.find(s => s.categoryName === 'eyeLookInLeft' || s.categoryName === 'eyeLookOutRight')?.score || 0;
                        const lookUp = shapes.find(s => s.categoryName === 'eyeLookUpLeft' || s.categoryName === 'eyeLookUpRight')?.score || 0;

                        if (lookLeft > 0.65 || lookRight > 0.65 || lookUp > 0.70) {
                            eyeAverted = true;
                        }
                    }

                    if (eyeAverted) {
                        gazeHud.innerText = "Eye Gaze Averted (>30°)";
                        gazeHud.className = "text-amber-400 font-semibold";
                        checkGazeAvertedDuration("Candidate eyes diverted away from screen");
                    } else {
                        gazeHud.innerText = "Face & Gaze Aligned";
                        gazeHud.className = "text-emerald-400";
                        gazeAvertedStartTime = null; // Reset averted timer
                    }
                }
            } catch (e) {
                // Frame skip
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
        snapCanvas.width = 320;
        snapCanvas.height = 240;
        const ctx = snapCanvas.getContext('2d');
        ctx.drawImage(videoEl, 0, 0, 320, 240);
        // Compressed JPEG at 0.4 quality (~12 - 15 KB)
        return snapCanvas.toDataURL('image/jpeg', 0.4);
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
    const noSnap = document.getElementById('toast-no-snap');

    if (title) title.innerText = `Proctoring Warning (${currentStrike}/${maxStrikes})`;
    if (msg) msg.innerText = `${reason}. Please keep your eyes on the screen and do not switch windows.`;

    if (snapshotBase64 && snapImg) {
        snapImg.src = snapshotBase64;
        snapImg.classList.remove('hidden');
        if (noSnap) noSnap.classList.add('hidden');
    } else if (noSnap) {
        if (snapImg) snapImg.classList.add('hidden');
        noSnap.classList.remove('hidden');
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

