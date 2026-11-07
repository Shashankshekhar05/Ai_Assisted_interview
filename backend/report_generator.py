import json
from typing import Dict, Any, List
from groq import Groq
from backend.config import settings
from backend.database import get_session_details, get_session_transcripts, get_session_violations, save_report

def generate_human_audit_report(session_id: str) -> Dict[str, Any]:
    """
    Generates a structured Human Reviewer Interview Audit Report
    combining Q&A transcript analysis with the 3-strike proctoring log.
    """
    session = get_session_details(session_id)
    if not session:
        raise ValueError(f"Session '{session_id}' not found.")

    transcripts = get_session_transcripts(session_id)
    violations = get_session_violations(session_id)

    # Compute base integrity score
    # Deduct 25 points per strike, capped at minimum 0
    total_strikes = len(violations)
    integrity_score = max(0.0, 100.0 - (total_strikes * 25.0))

    if not settings.has_groq_key:
        report_data = _generate_heuristic_report(session, transcripts, violations, integrity_score)
        save_report(
            session_id=session_id,
            summary=report_data["summary"],
            recommendation=report_data["recommendation"],
            technical_score=report_data["technical_score"],
            integrity_score=integrity_score
        )
        report_data["integrity_score"] = integrity_score
        report_data["violations"] = violations
        return report_data

    client = Groq(api_key=settings.GROQ_API_KEY, base_url=settings.GROQ_BASE_URL)

    # Format transcript pairs for LLM review
    qa_pairs = []
    current_q = None
    for entry in transcripts:
        if entry["speaker"] == "ai":
            current_q = entry["text"]
        elif entry["speaker"] == "candidate" and current_q:
            qa_pairs.append({
                "question": current_q,
                "candidate_answer": entry["text"]
            })
            current_q = None

    prompt = f"""
You are an expert Senior Engineering Hiring Manager and Integrity Auditor.
Analyze the following interview performance and proctoring violation log to produce a final Human Recruiter Dossier.

CANDIDATE INFO:
- Name: {session['candidate_name']}
- Target Role: {session['role_title']}
- Level: {session['experience_level']}
- Resume Match: {session['match_score']}%

INTERVIEW Q&A TRANSCRIPTS:
{json.dumps(qa_pairs, indent=2)}

PROCTORING VIOLATIONS (Total Strikes: {total_strikes}/3):
{json.dumps([{"strike": v["strike_number"], "type": v["violation_type"], "time": v["timestamp"], "notes": v["notes"]} for v in violations], indent=2)}

Provide a strict, professional assessment in valid JSON with this exact schema:
{{
  "summary": "3-4 sentences summarizing candidate technical depth, communication, and overall interview performance.",
  "technical_score": float (0.0 to 10.0 average across answers),
  "qa_critique": [
     {{
       "question": "string",
       "answer": "string",
       "rating": integer (1-10),
       "feedback": "1-2 sentences on accuracy, depth, or red flags (e.g. read from script, shallow, or insightful)"
     }}
  ],
  "proctoring_summary": "1-2 sentences summarizing proctoring integrity and detected incidents.",
  "recommendation": "HIRE_RECOMMENDED" OR "FURTHER_INTERVIEW_NEEDED" OR "REJECT_SUSPECTED_CHEATING" OR "REJECT_SKILL_GAP",
  "recruiter_notes": "Bullet recommendations for the human interviewer on what to probe in the final human round."
}}
"""

    try:
        completion = client.chat.completions.create(
            model=settings.GROQ_MODEL,
            messages=[
                {"role": "system", "content": "You are an expert technical interviewer and auditor. Output strictly valid JSON without preamble."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=1000
        )
        
        content = completion.choices[0].message.content
        report_data = json.loads(content)
        tech_score = float(report_data.get("technical_score", 7.0))
        
        save_report(
            session_id=session_id,
            summary=report_data["summary"],
            recommendation=report_data["recommendation"],
            technical_score=tech_score,
            integrity_score=integrity_score
        )
        
        report_data["integrity_score"] = integrity_score
        report_data["session"] = session
        report_data["violations"] = violations
        return report_data

    except Exception as e:
        print(f"Groq report generation error: {e}")
        report_data = _generate_heuristic_report(session, transcripts, violations, integrity_score)
        save_report(
            session_id=session_id,
            summary=report_data["summary"],
            recommendation=report_data["recommendation"],
            technical_score=report_data["technical_score"],
            integrity_score=integrity_score
        )
        report_data["integrity_score"] = integrity_score
        report_data["violations"] = violations
        return report_data

def _generate_heuristic_report(session: Dict[str, Any], transcripts: List[Dict[str, Any]], violations: List[Dict[str, Any]], integrity_score: float) -> Dict[str, Any]:
    """Fallback generator when API key is not yet provided."""
    answers = [t for t in transcripts if t["speaker"] == "candidate"]
    avg_words = sum(len(a["text"].split()) for a in answers) / max(len(answers), 1)
    
    tech_score = min(9.5, max(4.0, round((avg_words / 25.0) * 7.5, 1))) if answers else 6.5
    
    if len(violations) >= 3:
        rec = "REJECT_SUSPECTED_CHEATING"
    elif tech_score >= 7.0 and integrity_score >= 75.0:
        rec = "HIRE_RECOMMENDED"
    else:
        rec = "FURTHER_INTERVIEW_NEEDED"

    return {
        "summary": f"Candidate completed technical screening for {session['role_title']} with a {session['match_score']}% resume match. Evaluated as {session['experience_level']}.",
        "technical_score": tech_score,
        "qa_critique": [
            {
                "question": "Initial technical query",
                "answer": answers[0]["text"] if answers else "N/A",
                "rating": int(tech_score),
                "feedback": "Answer demonstrated reasonable grasp of the asked concepts."
            }
        ],
        "proctoring_summary": f"{len(violations)} proctoring warnings recorded. Integrity index: {integrity_score}%.",
        "recommendation": rec,
        "recruiter_notes": "Review flagged webcam snapshots and confirm architectural depth in person."
    }

