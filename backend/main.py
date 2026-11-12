import uuid
import json
import re
from pathlib import Path
from typing import Optional, Dict
from fastapi import FastAPI, UploadFile, File, Form, HTTPException, Request
from fastapi.responses import JSONResponse, FileResponse
from fastapi.staticfiles import StaticFiles
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel

from backend.config import settings
from backend.database import (
    init_db,
    create_session,
    get_session_details,
    log_transcript_entry,
    log_violation_entry,
    get_session_transcripts,
    get_session_violations,
    update_decision
)
from backend.resume_matcher import extract_text_from_pdf, evaluate_resume_against_jd
from backend.interview_agent import transcribe_candidate_audio, generate_interview_question
from backend.tts_service import text_to_speech_base64
from backend.report_generator import generate_human_audit_report

app = FastAPI(
    title="AI-Powered Automated Interview & Proctoring System",
    description="Zero-cost, browser-edge proctoring and adaptive conversational AI interviewer.",
    version="1.0.0"
)

# CORS middleware for local frontend access
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Ensure database tables exist on startup
@app.on_event("startup")
def on_startup():
    init_db()

# --- Request / Response Models ---

class ViolationPayload(BaseModel):
    session_id: str
    strike_number: int
    violation_type: str
    confidence: Optional[float] = 1.0
    notes: Optional[str] = ""
    snapshot_base64: Optional[str] = None  # Technical Safeguard #2

class RecruiterDecisionPayload(BaseModel):
    decision: str  # APPROVED, AUDIT_REQUIRED, REJECTED

# --- API Endpoints ---

@app.post("/api/match-resume")
async def match_resume_endpoint(
    role_title: str = Form(...),
    jd_text: str = Form(...),
    threshold: int = Form(settings.MATCH_THRESHOLD),
    resume_file: UploadFile = File(...)
):
    """Parses resume PDF, performs Groq matching against JD, and creates interview session."""
    try:
        content = await resume_file.read()
        if not content:
            raise HTTPException(status_code=400, detail="Uploaded file is empty.")
        
        # 1. Extract text from PDF in-memory
        resume_text = extract_text_from_pdf(content)
        if not resume_text:
            raise HTTPException(status_code=400, detail="Could not extract text from resume. Ensure it is not an image-only scan.")
        
        # 2. Evaluate with Groq Llama 3.3
        eval_result = evaluate_resume_against_jd(jd_text, resume_text, threshold)
        
        # 3. Create Session in SQLite
        session_id = str(uuid.uuid4())
        candidate_name = eval_result.get("candidate_name", "Candidate")
        
        create_session(
            session_id=session_id,
            candidate_name=candidate_name,
            role_title=role_title,
            match_score=eval_result.get("match_percentage", 0),
            experience_level=eval_result.get("experience_level", "Fresher"),
            matched_skills=eval_result.get("key_strengths", []),
            missing_skills=eval_result.get("missing_skills", [])
        )
        
        eval_result["session_id"] = session_id
        return JSONResponse(status_code=200, content=eval_result)
        
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/interview/start")
async def start_interview_endpoint(session_id: str = Form(...)):
    """Initializes the interview session, generates Question #1, and creates neural TTS audio."""
    session = get_session_details(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")
    
    matched_skills = json.loads(session.get("matched_skills") or "[]")
    missing_skills = json.loads(session.get("missing_skills") or "[]")
    
    q_data = generate_interview_question(
        session_id=session_id,
        experience_level=session["experience_level"],
        role_title=session["role_title"],
        matched_skills=matched_skills,
        missing_skills=missing_skills,
        conversation_history=[],
        current_question_number=1,
        max_questions=settings.MAX_QUESTIONS
    )
    
    # Log AI question to database
    log_transcript_entry(session_id, speaker="ai", text=q_data["question"], question_number=1)
    
    # Generate in-memory neural voice
    audio_base64 = text_to_speech_base64(q_data["question"])
    q_data["audio_base64"] = audio_base64
    
    print(f"[START_INTERVIEW] Session: {session_id} | Q1: {q_data['question'][:60]}... | Has Audio: {bool(audio_base64)}")
    return JSONResponse(status_code=200, content=q_data)

# Repeat Intent Safety Configuration
TECHNICAL_CONTEXT_WORDS = {
    "function", "functions", "loop", "loops", "variable", "variables",
    "method", "methods", "class", "classes", "syntax", "code", "coding",
    "algorithm", "algorithms", "array", "arrays", "database", "query", "queries", "table",
    "script", "scripts", "component", "components", "regex", "api", "apis", "framework",
    "library", "module", "server", "docker", "pipeline", "git", "commit", "branch",
    "return", "yield", "async", "await", "promise", "interface", "struct", "pointer"
}

REPEAT_INTENT_PHRASES = [
    # Hindi / Hinglish phrases
    "repeat karo", "repeat kardo", "repeat kar do", "repeat kijiye", "repeat kijiyega", "repeat kare",
    "phir se bolo", "phir se boliye", "phir se batao", "phir se bataye", "phir se sunao",
    "fir se bolo", "fir se boliye", "fir se batao", "fir se bataye", "fir se sunao",
    "dobara bolo", "dobara boliye", "dobara batao", "dobara bataye", "dobara puchho",
    "samajh nahi aaya", "samajh nahi aayi", "samajh me nahi aaya", "samajh me nahi aayi",
    "samjh nahi aaya", "samjh nahi aayi", "samjh me nahi aaya",
    "ek baar aur", "ek bar aur", "wapas bolo", "wapas boliye",
    "sunai nahi diya", "sunai nahi diya tha", "kya bola aapne", "kya bole", "kya pucha",
    
    # English multi-word phrases
    "repeat karo please", "please repeat", "repeat please", "repeat that please",
    "can you repeat", "could you repeat", "would you repeat", "please repeat that",
    "repeat the question", "repeat that question", "repeat what you said", "repeat what you just said",
    "say that again", "say again", "once more", "one more time",
    "pardon me", "beg your pardon", "pardon please",
    "didn't catch that", "did not catch that", "didn't hear that", "didn't hear you",
    "come again please", "what was the question"
]

# Track repeat attempts per session and question: (session_id, question_number) -> int
session_repeat_counts: Dict[tuple, int] = {}

def check_repeat_intent(text: str) -> bool:
    """
    Evaluates candidate transcript for repeat intent with 2 Safety Guards:
    - Safety #2A: Rejects if text contains technical/programming terms (e.g., 'repeat function', 'repeat loop').
    - Safety #2B: Rejects bare single-word 'repeat'. Requires explicit multi-word request phrase.
    """
    if not text:
        return False
    
    cleaned = text.lower().strip()
    words = set(re.findall(r'\b[a-zA-Z]+\b', cleaned))
    
    # Safety Check: If technical programming vocabulary is present, treat as answer, NOT repeat intent
    if words.intersection(TECHNICAL_CONTEXT_WORDS):
        return False
        
    # Check for multi-word phrases with boundary padding
    normalized_phrase = " " + " ".join(re.findall(r'[a-zA-Z0-9]+', cleaned)) + " "
    for phrase in REPEAT_INTENT_PHRASES:
        if f" {phrase} " in normalized_phrase:
            return True
            
    return False

@app.post("/api/interview/answer")
async def answer_interview_endpoint(
    session_id: str = Form(...),
    question_number: int = Form(...),
    text_answer: Optional[str] = Form(None),
    audio_file: Optional[UploadFile] = File(None)
):
    """
    Receives candidate answer (speech audio or text), transcribes via Groq Whisper,
    and returns next dynamic question with neural TTS.
    Repeat Intent Safety:
    1. Max 2 repeats allowed per question.
    2. 3rd repeat skips question and marks 'No Answer'.
    3. False-positive resistant: rejects technical terms like 'repeat function'.
    """
    session = get_session_details(session_id)
    if not session:
        raise HTTPException(status_code=404, detail="Session not found.")

    # 1. Transcribe voice if audio blob was uploaded
    candidate_answer = text_answer or ""
    if audio_file:
        audio_bytes = await audio_file.read()
        if audio_bytes:
            transcribed = transcribe_candidate_audio(audio_bytes)
            if transcribed:
                candidate_answer = transcribed

    if not candidate_answer.strip():
        candidate_answer = "[No audible response detected]"

    # 2. Check for Repeat Intent with Safety Guards
    if check_repeat_intent(candidate_answer):
        count = session_repeat_counts.get((session_id, question_number), 0)
        
        # Max Repeat Limit: Max 2 repeats allowed per question
        if count < 2:
            session_repeat_counts[(session_id, question_number)] = count + 1
            print(f"[REPEAT_INTENT] Session: {session_id} | Q{question_number} Repeat count: {count + 1}/2 | Candidate: '{candidate_answer}'")
            return JSONResponse(status_code=200, content={
                "is_repeat_request": True,
                "repeat_count": count + 1,
                "max_repeats": 2,
                "candidate_transcript": candidate_answer,
                "question_number": question_number,
                "message": f"Repeating current question ({count + 1}/2)."
            })
        else:
            # 3rd repeat attempt -> Skip to next question and mark "No Answer"
            session_repeat_counts.pop((session_id, question_number), None)
            skipped_note = "[No Answer: Candidate requested repeat > 2 times. Skipped to next question]"
            print(f"[REPEAT_MAX_LIMIT_EXCEEDED] Session: {session_id} | Q{question_number} skipped. Candidate exceeded 2 repeats.")
            
            # Log candidate "No Answer" in database transcript for final audit
            log_transcript_entry(session_id, speaker="candidate", text=skipped_note, question_number=question_number)
            
            # Advance to next question
            history = get_session_transcripts(session_id)
            matched_skills = json.loads(session.get("matched_skills") or "[]")
            missing_skills = json.loads(session.get("missing_skills") or "[]")
            next_q_num = question_number + 1
            
            q_data = generate_interview_question(
                session_id=session_id,
                experience_level=session["experience_level"],
                role_title=session["role_title"],
                matched_skills=matched_skills,
                missing_skills=missing_skills,
                conversation_history=history,
                current_question_number=next_q_num,
                max_questions=settings.MAX_QUESTIONS
            )
            
            if not q_data.get("is_complete"):
                log_transcript_entry(session_id, speaker="ai", text=q_data["question"], question_number=next_q_num)
                audio_base64 = text_to_speech_base64(q_data["question"])
            else:
                audio_base64 = text_to_speech_base64(q_data["question"])
                
            q_data["audio_base64"] = audio_base64
            q_data["candidate_transcript"] = skipped_note
            q_data["skipped_due_to_repeat_limit"] = True
            
            return JSONResponse(status_code=200, content=q_data)

    # If it was a normal answer, clear repeat count for this question
    session_repeat_counts.pop((session_id, question_number), None)

    # 3. Log Candidate Answer to database for final audit
    log_transcript_entry(session_id, speaker="candidate", text=candidate_answer, question_number=question_number)

    # 4. Fetch running conversation history
    history = get_session_transcripts(session_id)
    matched_skills = json.loads(session.get("matched_skills") or "[]")
    missing_skills = json.loads(session.get("missing_skills") or "[]")

    next_q_num = question_number + 1

    # 5. Generate Next Question
    q_data = generate_interview_question(
        session_id=session_id,
        experience_level=session["experience_level"],
        role_title=session["role_title"],
        matched_skills=matched_skills,
        missing_skills=missing_skills,
        conversation_history=history,
        current_question_number=next_q_num,
        max_questions=settings.MAX_QUESTIONS
    )

    # Log AI next question
    if not q_data.get("is_complete"):
        log_transcript_entry(session_id, speaker="ai", text=q_data["question"], question_number=next_q_num)
        audio_base64 = text_to_speech_base64(q_data["question"])
    else:
        audio_base64 = text_to_speech_base64(q_data["question"])

    q_data["audio_base64"] = audio_base64
    q_data["candidate_transcript"] = candidate_answer

    return JSONResponse(status_code=200, content=q_data)

@app.post("/api/proctoring/violation")
async def log_violation_endpoint(payload: ViolationPayload):
    """
    Logs an integrity violation with Technical Safeguard #2: Visual Proof Snapshot.
    """
    row_id = log_violation_entry(
        session_id=payload.session_id,
        strike_number=payload.strike_number,
        violation_type=payload.violation_type,
        confidence=payload.confidence or 1.0,
        notes=payload.notes or "",
        snapshot_base64=payload.snapshot_base64
    )
    violations = get_session_violations(payload.session_id)
    
    return JSONResponse(status_code=200, content={
        "status": "VIOLATION_LOGGED",
        "violation_id": row_id,
        "current_strikes": len(violations),
        "max_strikes": settings.MAX_STRIKES,
        "is_critical": len(violations) >= settings.MAX_STRIKES
    })

@app.get("/api/interview/{session_id}/report")
async def get_interview_report_endpoint(session_id: str):
    """Generates and returns the complete post-interview Human Auditor dossier."""
    try:
        report = generate_human_audit_report(session_id)
        return JSONResponse(status_code=200, content=report)
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))

@app.post("/api/interview/{session_id}/decision")
async def set_recruiter_decision_endpoint(session_id: str, payload: RecruiterDecisionPayload):
    """Records final recruiter hiring verdict in database."""
    update_decision(session_id, payload.decision)
    return JSONResponse(status_code=200, content={"status": "DECISION_UPDATED", "decision": payload.decision})

# In-memory cache for audio warnings
_TTS_WARNING_CACHE = {}

@app.get("/api/tts")
async def get_tts_audio_endpoint(text: str):
    """Generates neural Edge-TTS audio on demand for voice alerts and proctoring warnings."""
    clean_text = text.strip()
    if not clean_text:
        return JSONResponse(status_code=400, content={"error": "Text cannot be empty"})
    if clean_text not in _TTS_WARNING_CACHE:
        _TTS_WARNING_CACHE[clean_text] = text_to_speech_base64(clean_text)
    return JSONResponse(status_code=200, content={"audio_base64": _TTS_WARNING_CACHE[clean_text], "text": clean_text})

# --- Mount Frontend Static Files ---
FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"
app.mount("/static", StaticFiles(directory=FRONTEND_DIR), name="static")

@app.get("/")
async def serve_index():
    """Serves the single-page application entry point."""
    index_file = FRONTEND_DIR / "index.html"
    return FileResponse(index_file)

