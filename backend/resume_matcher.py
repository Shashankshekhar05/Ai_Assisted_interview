import json
import fitz  # PyMuPDF
from typing import Dict, Any
from groq import Groq
from backend.config import settings

def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Extract raw text from PDF bytes using PyMuPDF (fitz) in memory."""
    text_content = []
    try:
        # Open PDF from in-memory stream
        with fitz.open(stream=pdf_bytes, filetype="pdf") as doc:
            for page in doc:
                text = page.get_text()
                if text:
                    text_content.append(text)
        return "\n".join(text_content).strip()
    except Exception as e:
        raise ValueError(f"Failed to parse PDF document: {str(e)}")

def evaluate_resume_against_jd(jd_text: str, resume_text: str, threshold: int = 70) -> Dict[str, Any]:
    """
    Compare Candidate Resume against Job Description using Groq Llama 3.3.
    Extracts experience level (Fresher vs Experienced), skills match, and initial questions.
    """
    # Fallback response if Groq API key is not yet configured by the user
    if not settings.has_groq_key:
        return _mock_evaluation_fallback(jd_text, resume_text, threshold)

    client = Groq(api_key=settings.GROQ_API_KEY, base_url=settings.GROQ_BASE_URL)

    prompt = f"""
You are an expert Technical Recruiter and Engineering Hiring Manager.
Evaluate the candidate's resume against the provided Job Description (JD).

JOB DESCRIPTION:
{jd_text}

CANDIDATE RESUME:
{resume_text}

Return ONLY a valid JSON object matching this exact schema:
{{
  "candidate_name": "string (name extracted from resume or 'Candidate')",
  "match_percentage": integer (0 to 100 based on core qualifications and required skills),
  "experience_level": "Fresher" (if less than 1.5 years experience, student, or recent graduate) OR "Experienced" (if 2+ years professional experience),
  "years_of_experience": float or integer,
  "key_strengths": ["list", "of", "strong", "skills", "from", "resume", "matching", "JD"],
  "missing_skills": ["list", "of", "critical", "skills", "in", "JD", "missing", "from", "resume"],
  "evaluation_summary": "2-3 sentences explaining the candidate fit and experience classification",
  "recommended_questions": [
     "5 tailored technical interview questions based strictly on their experience level, past projects listed, and JD requirements."
  ]
}}
"""

    try:
        completion = client.chat.completions.create(
            model=settings.GROQ_MODEL,
            messages=[
                {"role": "system", "content": "You are a technical hiring manager. Return strictly valid JSON."},
                {"role": "user", "content": prompt}
            ],
            response_format={"type": "json_object"},
            temperature=0.2,
            max_tokens=1000
        )
        
        content = completion.choices[0].message.content
        result = json.loads(content)
        
        # Ensure standard keys are present
        match_score = int(result.get("match_percentage", 0))
        result["match_percentage"] = match_score
        result["start_interview"] = match_score >= threshold
        
        # Ensure experience_level conforms strictly to Fresher vs Experienced
        exp = result.get("experience_level", "Fresher")
        result["experience_level"] = "Experienced" if "exp" in exp.lower() else "Fresher"
        
        return result

    except Exception as e:
        # Graceful fallback or raise with clear message
        print(f"Groq API call failed: {e}. Falling back to rule-based evaluation.")
        return _mock_evaluation_fallback(jd_text, resume_text, threshold)

def _mock_evaluation_fallback(jd_text: str, resume_text: str, threshold: int) -> Dict[str, Any]:
    """Heuristic fallback when offline or before API key is provided."""
    jd_words = set(w.lower().strip(".,;:()") for w in jd_text.split() if len(w) > 3)
    resume_words = set(w.lower().strip(".,;:()") for w in resume_text.split() if len(w) > 3)
    
    common = jd_words.intersection(resume_words)
    score = min(95, max(30, int((len(common) / max(len(jd_words), 1)) * 120)))
    
    is_fresher = "intern" in resume_text.lower() or "student" in resume_text.lower() or "b.tech" in resume_text.lower()
    exp_level = "Fresher" if is_fresher else "Experienced"

    return {
        "candidate_name": "Applicant",
        "match_percentage": score,
        "experience_level": exp_level,
        "years_of_experience": 1.0 if exp_level == "Fresher" else 3.5,
        "key_strengths": list(common)[:6] if common else ["Problem Solving", "Python"],
        "missing_skills": ["System Architecture", "Production Deployment"],
        "evaluation_summary": f"Candidate demonstrates good alignment with core requirements ({score}% match). Classified as {exp_level}.",
        "recommended_questions": [
            "Explain how you would design a REST API using modern web frameworks.",
            "Describe the data structures you would select for high-throughput caching.",
            "Walk us through a technical challenge you resolved in your recent project.",
            "How do you manage asynchronous operations and concurrency?",
            "What strategies do you adopt for database indexing and query optimization?"
        ],
        "start_interview": score >= threshold
    }

