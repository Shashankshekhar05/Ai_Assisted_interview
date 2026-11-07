import sqlite3
import json
from datetime import datetime
from typing import Optional, List, Dict, Any
from backend.config import settings

def get_db_connection() -> sqlite3.Connection:
    conn = sqlite3.connect(settings.DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def init_db() -> None:
    """Initialize database tables with the visual proof snapshot support."""
    with get_db_connection() as conn:
        cursor = conn.cursor()
        
        # 1. Sessions table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS sessions (
                id TEXT PRIMARY KEY,
                candidate_name TEXT NOT NULL,
                role_title TEXT NOT NULL,
                match_score INTEGER DEFAULT 0,
                experience_level TEXT DEFAULT 'Fresher',
                status TEXT DEFAULT 'IN_PROGRESS',
                matched_skills TEXT,
                missing_skills TEXT,
                created_at TEXT NOT NULL
            )
        """)
        
        # 2. Transcripts table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS transcripts (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                speaker TEXT NOT NULL,
                text TEXT NOT NULL,
                question_number INTEGER DEFAULT 0,
                score INTEGER DEFAULT NULL,
                timestamp TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            )
        """)
        
        # 3. Violations table (Includes Technical Safeguard #2: snapshot_base64)
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS violations (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT NOT NULL,
                strike_number INTEGER NOT NULL,
                violation_type TEXT NOT NULL,
                confidence REAL DEFAULT 1.0,
                notes TEXT,
                snapshot_base64 TEXT,
                timestamp TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            )
        """)
        
        # 4. Reports table
        cursor.execute("""
            CREATE TABLE IF NOT EXISTS reports (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                session_id TEXT UNIQUE NOT NULL,
                summary TEXT NOT NULL,
                recommendation TEXT NOT NULL,
                technical_score REAL DEFAULT 0.0,
                integrity_score REAL DEFAULT 100.0,
                final_decision TEXT DEFAULT 'PENDING',
                created_at TEXT NOT NULL,
                FOREIGN KEY (session_id) REFERENCES sessions(id)
            )
        """)
        conn.commit()

# --- Helper CRUD Operations ---

def create_session(session_id: str, candidate_name: str, role_title: str,
                   match_score: int, experience_level: str, matched_skills: List[str], missing_skills: List[str]) -> None:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO sessions (id, candidate_name, role_title, match_score, experience_level, matched_skills, missing_skills, created_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            session_id,
            candidate_name,
            role_title,
            match_score,
            experience_level,
            json.dumps(matched_skills),
            json.dumps(missing_skills),
            datetime.now().isoformat()
        ))
        conn.commit()

def log_transcript_entry(session_id: str, speaker: str, text: str, question_number: int = 0, score: Optional[int] = None) -> None:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO transcripts (session_id, speaker, text, question_number, score, timestamp)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            session_id, speaker, text, question_number, score, datetime.now().isoformat()
        ))
        conn.commit()

def log_violation_entry(session_id: str, strike_number: int, violation_type: str,
                       confidence: float = 1.0, notes: str = "", snapshot_base64: Optional[str] = None) -> int:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT INTO violations (session_id, strike_number, violation_type, confidence, notes, snapshot_base64, timestamp)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (
            session_id, strike_number, violation_type, confidence, notes, snapshot_base64, datetime.now().isoformat()
        ))
        conn.commit()
        return cursor.lastrowid

def get_session_details(session_id: str) -> Optional[Dict[str, Any]]:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM sessions WHERE id = ?", (session_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

def get_session_transcripts(session_id: str) -> List[Dict[str, Any]]:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM transcripts WHERE session_id = ? ORDER BY id ASC", (session_id,))
        return [dict(row) for row in cursor.fetchall()]

def get_session_violations(session_id: str) -> List[Dict[str, Any]]:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM violations WHERE session_id = ? ORDER BY id ASC", (session_id,))
        return [dict(row) for row in cursor.fetchall()]

def save_report(session_id: str, summary: str, recommendation: str, technical_score: float, integrity_score: float) -> None:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO reports (session_id, summary, recommendation, technical_score, integrity_score, created_at)
            VALUES (?, ?, ?, ?, ?, ?)
        """, (
            session_id, summary, recommendation, technical_score, integrity_score, datetime.now().isoformat()
        ))
        conn.commit()

def get_report(session_id: str) -> Optional[Dict[str, Any]]:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("SELECT * FROM reports WHERE session_id = ?", (session_id,))
        row = cursor.fetchone()
        return dict(row) if row else None

def update_decision(session_id: str, decision: str) -> None:
    with get_db_connection() as conn:
        cursor = conn.cursor()
        cursor.execute("UPDATE reports SET final_decision = ? WHERE session_id = ?", (decision, session_id))
        cursor.execute("UPDATE sessions SET status = ? WHERE id = ?", (decision, session_id))
        conn.commit()

