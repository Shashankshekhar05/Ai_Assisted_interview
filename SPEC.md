# AI-Powered Automated Interview & Proctoring System
**Project Requirements Document (PRD) & Technical Architecture Guide**

---

## 1. Project Idea Evaluation & Portfolio Impact

### Portfolio Rating: **9.5 / 10**
This is a **standout, production-grade portfolio project**. Unlike basic chatbots or simple RAG wrappers, your idea combines four distinct, high-demand areas of software and AI engineering:
1. **Document Intelligence & Matching:** Semantic parsing of Job Descriptions (JDs) and Resumes.
2. **Real-Time Conversational AI:** Low-latency voice interaction (STT $\rightarrow$ LLM $\rightarrow$ TTS) that dynamically adapts to candidate seniority (Fresher vs. Experienced).
3. **Edge Computer Vision (Proctoring):** Real-time eye gaze tracking, object detection (mobile phones), and browser tab monitoring.
4. **Human-in-the-Loop (HITL) Reporting:** Automated aggregation of interview transcripts, evaluation rubrics, and proctoring logs for final human review.

### Why Recruiters Will Love This:
* **Cost-Engineering:** Building a complex multimodal system with a **$0 budget** proves you understand resource optimization, client-side inference, and API rate-limit management.
* **Business Value:** It solves a real HR bottleneck (screening hundreds of applicants while preventing remote cheating).

---

## 2. Zero-Cost ($0) Tech Stack & Tooling

To ensure you pay **$0** and avoid Hugging Face Serverless API rate limits/cold starts where possible, we will offload heavy vision and audio tasks directly to the user's browser and use Groq for ultra-fast LLM and STT tasks.

| Component | Recommended Free Tool / Technology | Why it is 100% Free & Optimal |
| :--- | :--- | :--- |
| **LLM (Brain & Evaluator)** | **Groq Cloud API** (`llama-3.3-70b-versatile` or `llama-3.1-8b-instant`) | Free developer tier with massive speed ($\sim 300+$ tokens/sec), essential for natural conversation flow. |
| **Speech-to-Text (STT)** | **Groq Whisper API** (`whisper-large-v3-turbo`) **OR** Browser `Web Speech API` | Groq includes Whisper in its free tier with instant transcription. Browser Web Speech API is an unlimited local fallback. |
| **Text-to-Speech (TTS)** | **Browser `window.speechSynthesis`** **OR** **`edge-tts`** (Python library) / **Kokoro-82M** (via HF Spaces) | `edge-tts` gives natural Microsoft neural voices in Python for $0 with no API key. `window.speechSynthesis` runs natively in the browser. |
| **Eye Gaze & Head Tracking** | **MediaPipe Face Landmarker** (Runs in Browser via JS) | Runs on the candidate's CPU/GPU in the browser. Zero server cost, zero latency. |
| **Mobile Phone Detection** | **TensorFlow.js (`coco-ssd`)** or **YOLOv8n (ONNX Web)** | Runs in the browser to detect the `"cell phone"` or `"book"` class in real time without sending video frames to a paid server. |
| **Screen/Tab Monitoring** | **HTML5 Page Visibility API** & `window.onblur` | Built into JavaScript to detect tab switching, minimizing, or clicking outside the interview window. |
| **Backend Framework** | **FastAPI (Python)** + `antigravity` (and standard Python libraries like `PyMuPDF`) | Fast asynchronous support for WebSockets; fun easter-egg integration with Python's `import antigravity` module! |
| **Frontend UI** | **React.js (Vite + Tailwind CSS)** or **Streamlit** | React is best for custom webcam overlays and 3-strike pop-ups. |
| **Database** | **SQLite** (Local) or **Supabase / MongoDB Atlas** (Free Cloud Tier) | Stores JDs, candidate resumes, strike logs, and final reports for free. |

---

## 3. End-to-End System Architecture & Workflow

```
+-------------------------------------------------------------------------+
|                           1. RECRUITER PORTAL                           |
|  [Upload JD] ---> [Set Match Threshold (e.g., 70%)] ---> [Save to DB]   |
+-------------------------------------------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|                      2. CANDIDATE SCREENING ENGINE                      |
|  [Upload Resume (PDF)] ---> [PyMuPDF Text Extraction]                   |
|         |                                                               |
|         v                                                               |
|  [Groq LLM: Compare JD vs Resume]                                       |
|    |-- Evaluates Skills Match Score (0 - 100%)                          |
|    |-- Extracts Candidate Level: [FRESHER] vs [EXPERIENCED]             |
|         |                                                               |
|         +---> If Score < Threshold: Reject Polite Notice                |
|         +---> If Score >= Threshold: IMMEDIATELY LAUNCH INTERVIEW ROOM  |
+-------------------------------------------------------------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|                   3. LIVE AI INTERVIEW & PROCTORING ROOM                |
|                                                                         |
|  +---------------------------------+  +------------------------------+  |
|  |   CONVERSATIONAL AI LOOP        |  |   CLIENT-SIDE AI PROCTORING  |  |
|  |                                 |  |                              |  |
|  | 1. AI asks question (TTS)       |  | - MediaPipe: Eye Gaze/Head   |  |
|  |    (Tailored to Fresher/Exp)    |  | - TF.js COCO-SSD: Cell Phone |  |
|  | 2. Candidate speaks into Mic    |  | - JS Visibility: Tab Switch  |  |
|  | 3. Groq Whisper (STT)           |  |              |               |  |
|  | 4. Groq LLM evaluates &         |  |              v               |  |
|  |    generates next follow-up     |  |   [VIOLATION DETECTED!]      |  |
|  +---------------------------------+  |   -> Trigger Warning Pop-up  |  |
|                   |                   |   -> Log Strike (1/3, 2/3,   |  |
|                   |                   |      3/3) with Timestamp     |  |
|                   |                   +------------------------------+  |
+-------------------+----------------------------------+------------------+
                                     |
                                     v
+-------------------------------------------------------------------------+
|                  4. HUMAN REVIEW & AUDIT REPORT GENERATOR               |
|  [Groq LLM Summarizer] combines:                                        |
|   1. Q&A Transcript + AI assessment of each answer                      |
|   2. Proctoring Log (Exact timestamps of phone usage, eye gaze, strikes)|
|   3. Final Recommendation for the Human Recruiter                       |
+-------------------------------------------------------------------------+
```

---

## 4. Detailed Functional Modules (How Each Part Works)

### Module 1: JD & Resume Matcher + Experience Classifier
1. **Input:** Recruiter's Job Description (text/PDF) and Candidate's Resume (PDF).
2. **Text Extraction:** Use `PyMuPDF` (`fitz`) in Python to extract raw text from the PDF.
3. **LLM Evaluation Prompt (Groq):** Send both texts to Groq (`llama-3.3-70b-versatile`) with `response_format={"type": "json_object"}`.
   * **Output JSON Schema:**
     ```json
     {
       "match_score": 82,
       "is_eligible": true,
       "experience_level": "Fresher",
       "years_of_experience": 0.5,
       "matched_skills": ["Python", "FastAPI", "SQL"],
       "missing_skills": ["Docker"],
       "initial_question_topics": ["Python basics", "Academic project on FastAPI", "SQL Joins"]
     }
     ```
4. **Trigger:** If `is_eligible == true`, the UI immediately transitions to the **Webcam & Mic Permission Screen** and launches the live AI Interview.

---

### Module 2: Adaptive AI Interviewer (Fresher vs. Experienced Logic)
The system prompt injected into the Groq Interview Agent changes dynamically based on `experience_level`:

* **If `Fresher` (0–1 Years):**
  * **Focus:** Core computer science fundamentals (OOPs, DBMS, OS, Data Structures), academic/personal projects listed on the resume, problem-solving approach, and learning agility.
  * **Tone:** Encouraging, probing conceptual understanding rather than production scale.
* **If `Experienced` (2+ Years):**
  * **Focus:** System architecture, production edge-cases, scaling bottlenecks, trade-offs in past work listed on the resume, debugging real-world scenarios, and deep JD-specific tooling.
  * **Tone:** Peer-to-peer technical deep dive; asks *"Why did you choose X over Y in your project at Company Z?"*

**The Conversation Loop (5 to 8 Questions):**
1. Agent generates Question $N$ $\rightarrow$ Converted to Audio via `edge-tts` or Browser TTS $\rightarrow$ Played to candidate.
2. Candidate answers via Microphone $\rightarrow$ Recorded via `MediaRecorder` API $\rightarrow$ Sent to Groq `whisper-large-v3-turbo`.
3. Transcribed text is appended to chat history $\rightarrow$ Groq generates Question $N+1$ (either a follow-up if the answer was vague, or moves to the next JD skill).

---

### Module 3: AI Screen & Webcam Proctoring (The 3-Strike System)
To keep this 100% free and fast, run the vision models inside the candidate's browser at 2–5 frames per second (FPS):

1. **Eye Gaze & Head Rotation Detection (MediaPipe Face Mesh):**
   * Track key facial landmarks: Nose tip (`landmark[1]`), Left/Right eye corners, and Iris centers (`landmarks[468-477]`).
   * Calculate **Yaw** (looking left/right) and **Pitch** (looking up/down).
   * **Rule:** If the candidate looks away from the screen ($> 30^\circ$ angle) continuously for **more than 3 seconds**, trigger a violation: `"Candidate looked away from screen"`.

2. **Mobile Phone & Cheat Material Detection (TensorFlow.js `coco-ssd`):**
   * Run `coco-ssd` object detection on the webcam `<video>` element every 500ms.
   * Check detected classes for `"cell phone"`, `"book"`, or more than 1 `"person"`.
   * **Rule:** If `"cell phone"` is detected with confidence $> 0.60$, immediately trigger a violation: `"Mobile phone detected in camera frame"`.

3. **Screen / Tab Switch Monitoring (JavaScript Browser Events):**
   * Listen to `document.addEventListener("visibilitychange")` and `window.addEventListener("blur")`.
   * **Rule:** If the user switches tabs, opens another app, or exits full-screen mode, trigger a violation: `"Screen focus lost / Tab switched"`.

4. **The 3-Pop-Up Restriction Mechanism:**
   * Maintain a state counter: `strikeCount = 0` and an array `violationLogs = []`.
   * **Strike 1:** Display **Pop-up Modal #1 (Yellow Warning)** — *"Warning 1/3: Suspicious activity detected ([Reason]). Please keep your eyes on the screen and do not use external devices. This incident has been logged."*
   * **Strike 2:** Display **Pop-up Modal #2 (Orange Warning)** — *"Warning 2/3: Second violation detected ([Reason]). One more violation will flag or terminate your interview for human review."*
   * **Strike 3:** Display **Pop-up Modal #3 (Red Final Restriction)** — *"Restriction 3/3: Maximum proctoring warnings reached ([Reason]). Your session has been flagged for strict human audit."* (You can either auto-submit the interview here or allow completion with a `CRITICAL_FLAG` status).

---

### Module 4: Post-Interview Summary & Human Reviewer Dashboard
Once the interview concludes, the backend sends the full Q&A transcript + `violationLogs` to Groq to generate a structured **Human Evaluation Dossier**:

* **Section A: Candidate Overview & JD Match Score** (e.g., 82% Match | Role Level: Fresher).
* **Section B: Question-by-Question Audit:**
  * *Question Asked by AI*
  * *Candidate's Exact Answer (Transcript)*
  * *AI Critique & Accuracy Score (1-10):* Highlights whether the answer was strong, shallow, or potentially read from a script.
* **Section C: Proctoring & Integrity Report (Red Flag Summary):**
  * Total Strikes: `X / 3`
  * Detailed Timeline:
    * `[14:02:15] Strike 1: Mobile phone detected in frame (Confidence: 84%) during Question 2.`
    * `[14:05:40] Strike 2: Eye gaze averted (looked up/right for 4.2s) during Question 4.`
    * `[14:08:11] Strike 3: Browser tab switched / window lost focus.`
* **Section D: Human Reviewer Action Panel:**
  * Buttons for the human recruiter: **`[Approve for Final Round]`**, **`[Watch/Review Flagged Clips]`**, **`[Reject Candidate]`**.

---

## 5. Step-by-Step Implementation Guide (How to Build It)

### Step 1: Project Folder Structure
```text
ai-interview-agent/
├── backend/
│   ├── main.py                 # FastAPI Server & WebSocket endpoints
│   ├── resume_matcher.py       # PyMuPDF + Groq JD vs Resume comparison
│   ├── interview_agent.py      # Dynamic Fresher/Experienced prompt & Groq STT/LLM
│   ├── tts_service.py          # Free edge-tts audio generator
│   ├── report_generator.py     # Final summary + proctoring log compiler
│   └── requirements.txt        # fastapi, uvicorn, groq, pymupdf, edge-tts
└── frontend/
    ├── index.html              # Single-page UI or React app
    ├── proctoring.js           # MediaPipe FaceMesh + TF.js COCO-SSD + 3-Pop-up logic
    └── interview.js            # Mic recording, audio playback, WebSocket client
```

### Step 2: Key Backend Prompts & Code Blueprint (Python + Groq)

#### A. JD vs. Resume Matcher (`resume_matcher.py`)
```python
import json
from groq import Groq

client = Groq(api_key="YOUR_FREE_GROQ_API_KEY")

def evaluate_resume_against_jd(jd_text: str, resume_text: str, threshold: int = 70):
    prompt = f"""
    You are an expert Technical Recruiter AI. Compare the Job Description (JD) and Candidate Resume.
    
    JOB DESCRIPTION:
    {jd_text}
    
    CANDIDATE RESUME:
    {resume_text}
    
    Return ONLY a valid JSON object with:
    - "match_percentage": integer (0-100)
    - "experience_level": "Fresher" (if < 1.5 years experience) or "Experienced"
    - "key_strengths": list of matched skills
    - "missing_skills": list of missing skills from JD
    - "recommended_questions": list of 5 tailored interview questions based on their level, resume projects, and the JD.
    """
    
    completion = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        response_format={"type": "json_object"},
        temperature=0.2
    )
    
    result = json.loads(completion.choices[0].message.content)
    result["start_interview"] = result["match_percentage"] >= threshold
    return result
```

#### B. Speech-to-Text with Free Groq Whisper (`interview_agent.py`)
```python
def transcribe_candidate_audio(audio_file_path: str) -> str:
    with open(audio_file_path, "rb") as file:
        transcription = client.audio.transcriptions.create(
            file=(audio_file_path, file.read()),
            model="whisper-large-v3-turbo",
            language="en"
        )
    return transcription.text
```

#### C. Post-Interview Summary Generator (`report_generator.py`)
```python
def generate_human_review_report(jd_text, resume_info, qa_transcript, proctoring_logs):
    prompt = f"""
    Generate a comprehensive Human Reviewer Interview Audit Report.
    
    Candidate Level: {resume_info['experience_level']}
    Resume Match Score: {resume_info['match_percentage']}%
    
    INTERVIEW Q&A TRANSCRIPT:
    {json.dumps(qa_transcript, indent=2)}
    
    PROCTORING & CHEATING LOGS (3-Strike System):
    {json.dumps(proctoring_logs, indent=2)}
    
    Provide a structured evaluation with:
    1. Executive Summary
    2. Question-by-Question Analysis (What was asked, what the candidate answered, and technical accuracy rating /10)
    3. Proctoring & Cheating Audit (Summarize phone detections, eye gaze movements, and restriction pop-ups triggered)
    4. Final Hiring Recommendation for the Human Reviewer.
    """
    completion = client.chat.completions.create(
        model="llama-3.3-70b-versatile",
        messages=[{"role": "user", "content": prompt}],
        temperature=0.3
    )
    return completion.choices[0].message.content
```

---

### Step 3: Client-Side Proctoring Logic (`proctoring.js` Concept)
Using TensorFlow.js (`coco-ssd`) and Page Visibility in the browser ensures zero server GPU cost:

```javascript
let strikeCount = 0;
const maxStrikes = 3;
const proctoringLogs = [];

function triggerViolation(reason) {
    strikeCount++;
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = { strike: strikeCount, time: timestamp, reason: reason };
    proctoringLogs.push(logEntry);

    if (strikeCount <= maxStrikes) {
        showRestrictionPopup(
            `Restriction Warning (${strikeCount}/${maxStrikes})`,
            `Alert: ${reason}. This activity has been recorded and sent to the human reviewer.`
        );
    }
    // Send real-time log to backend
    sendProctoringLogToBackend(logEntry);
}

// 1. Detect Tab Switching / Minimizing
document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
        triggerViolation("Candidate switched tabs or minimized the interview screen.");
    }
});

// 2. Detect Mobile Phone via TensorFlow.js COCO-SSD
async function detectPhoneFrame(videoElement, model) {
    const predictions = await model.detect(videoElement);
    for (let pred of predictions) {
        if (pred.class === "cell phone" && pred.score > 0.60) {
            triggerViolation("Mobile phone detected in webcam feed.");
            break;
        }
    }
}
```

---

## 6. Note on Using "Antigravity" to Build This System
* **If you mean Google's Project IDX / AI-Assisted Coding Environments (or Python's `import antigravity`):** You can copy this exact PRD and architecture document directly into your AI IDE workspace as a `SPEC.md` file. The modular breakdown above allows an AI coding assistant to generate each file (`main.py`, `proctoring.js`, `index.html`) cleanly in one go.
* **Pro-Tip for Free Deployment:**
  * Host the Frontend for free on **Vercel** or **Netlify**.
  * Host the FastAPI Backend for free on **Render.com** or **Hugging Face Spaces (Docker SDK)** (Hugging Face Spaces gives you 2 vCPU and 16GB RAM completely free!).