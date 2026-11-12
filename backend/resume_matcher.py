import json
import fitz  # PyMuPDF
from typing import Dict, Any
from groq import Groq
from backend.config import settings

import json
import re
import fitz  # PyMuPDF
from typing import Dict, Any, List, Tuple
from groq import Groq
from backend.config import settings

# Comprehensive Technical Skills Taxonomy
KNOWN_TECH_SKILLS = [
    # Languages
    "python", "javascript", "typescript", "java", "c++", "c#", "golang", "go", "rust", "php", "ruby", "sql", "html", "css",
    # Frameworks & Libraries
    "fastapi", "django", "flask", "react", "next.js", "vue", "angular", "node.js", "nodejs", "express", "spring boot", "tailwind",
    # AI / LLM / Data
    "machine learning", "deep learning", "nlp", "llm", "ai/llm", "generative ai", "langchain", "pytorch", "tensorflow", "openai", "groq", "pandas", "numpy",
    # Databases
    "postgresql", "postgres", "mysql", "mongodb", "sqlite", "redis", "elasticsearch", "database design", "sql database", "nosql",
    # DevOps, Cloud & Architecture
    "docker", "kubernetes", "aws", "azure", "gcp", "ci/cd", "git", "github", "linux", "cloud deployments", "cloud deployment",
    # Concepts
    "rest api", "rest apis", "restful", "graphql", "microservices", "asyncio", "asynchronous programming", "system design", "automated testing", "unit testing", "data structures"
]

def extract_must_have_skills_from_jd(jd_text: str) -> List[str]:
    """
    Extracts must-have technical skills from the Job Description text.
    Uses exact keyword taxonomy plus comma/bullet pattern matching.
    """
    jd_lower = jd_text.lower()
    extracted = []
    
    # 1. Match against known tech taxonomy
    for skill in KNOWN_TECH_SKILLS:
        if re.search(r'\b' + re.escape(skill) + r'\b', jd_lower):
            clean_name = skill.title()
            if skill in ["sql", "aws", "gcp", "ci/cd", "nlp", "llm", "ai/llm", "api", "apis", "rest api", "rest apis"]:
                clean_name = skill.upper()
            elif skill == "fastapi":
                clean_name = "FastAPI"
            elif skill in ["node.js", "nodejs"]:
                clean_name = "Node.js"
            elif skill == "next.js":
                clean_name = "Next.js"
            extracted.append(clean_name)
    
    # Deduplicate while preserving order and removing redundant sub-phrases
    seen = set()
    raw_unique = []
    for s in extracted:
        lower_s = s.lower()
        if lower_s not in seen:
            seen.add(lower_s)
            raw_unique.append(s)
            
    # Filter out overlapping phrases (e.g., if 'SQL' is present, don't double count 'Sql Database')
    unique_skills = []
    all_lowers = [s.lower() for s in raw_unique]
    for s in raw_unique:
        s_low = s.lower()
        has_shorter_parent = any(other != s_low and other in s_low and len(other) >= 3 for other in all_lowers)
        if not has_shorter_parent:
            unique_skills.append(s)
            
    # Fallback if no known skills found
    if not unique_skills:
        words = re.findall(r'\b[A-Za-z0-9+#.]{3,}\b', jd_text)
        stopwords = {"with", "from", "that", "this", "have", "must", "plus", "will", "role", "team", "work", "looking", "candidate"}
        unique_skills = [w.capitalize() for w in words if w.lower() not in stopwords][:6]

    return unique_skills

def match_skills_in_resume(must_have_skills: List[str], resume_text: str) -> Tuple[List[str], List[str]]:
    """
    Performs exact keyword matching of must-have skills in candidate resume text.
    Returns (matched_skills, missing_skills).
    """
    resume_lower = resume_text.lower()
    matched = []
    missing = []

    for skill in must_have_skills:
        skill_lower = skill.lower()
        # Aliases & variants
        if skill_lower == "ai/llm":
            found = bool(re.search(r'\b(ai|llm|generative ai|artificial intelligence)\b', resume_lower))
        elif skill_lower in ["rest api", "rest apis"]:
            found = bool(re.search(r'\b(rest|restful|api|apis)\b', resume_lower))
        elif skill_lower in ["database design", "sql database"]:
            found = bool(re.search(r'\b(sql|database|db|postgres|mysql|sqlite|mongodb)\b', resume_lower))
        elif skill_lower in ["asynchronous programming", "asyncio"]:
            found = bool(re.search(r'\b(async|asyncio|asynchronous|concurrency)\b', resume_lower))
        elif skill_lower in ["automated testing", "unit testing"]:
            found = bool(re.search(r'\b(testing|pytest|unittest|test cases|automation)\b', resume_lower))
        elif skill_lower in ["cloud deployments", "cloud deployment"]:
            found = bool(re.search(r'\b(cloud|deployment|deploy|aws|gcp|azure|docker)\b', resume_lower))
        else:
            pattern = r'\b' + re.escape(skill_lower) + r'\b'
            found = bool(re.search(pattern, resume_lower))

        if found:
            matched.append(skill)
        else:
            missing.append(skill)

    return matched, missing

def calculate_hard_skill_score(matched_skills: List[str], must_have_skills: List[str]) -> Tuple[int, int]:
    """
    Deterministic scoring:
    Formula: raw_ratio = (matched_must_have_skills / total_must_have_skills) * 70
    Penalty: Per-skill penalty: deduct 5 points per missing skill (penalty = len(missing_skills) * 5).
    """
    total = max(len(must_have_skills), 1)
    matched_count = len(matched_skills)
    missing_count = total - matched_count
    
    # 70-point max allocation for hard skills
    base_score = (matched_count / total) * 70.0
    
    # Per-skill penalty: deduct 5 points per missing skill
    penalty = missing_count * 5.0
    adjusted_score = max(0.0, base_score - penalty)
        
    return round(adjusted_score), round((matched_count / total) * 100)

def extract_text_from_pdf(pdf_bytes: bytes) -> str:
    """Extract raw text from PDF bytes using PyMuPDF (fitz) in memory."""
    text_content = []
    try:
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
    Hybrid Deterministic + LLM Evaluation:
    1. Extract must-have skills from JD.
    2. Perform exact keyword matching in resume.
    3. Calculate hard skill score (0-70 max) with 20-point missing-skill deduction.
    4. Call Groq ONLY for qualitative depth & communication score (0-30 max).
    5. Final Score = Hard Skill Score + LLM Depth Score.
    """
    must_have_skills = extract_must_have_skills_from_jd(jd_text)
    matched_skills, missing_skills = match_skills_in_resume(must_have_skills, resume_text)
    hard_skill_score, raw_match_pct = calculate_hard_skill_score(matched_skills, must_have_skills)

    # Fallback if Groq API key is not configured
    if not settings.has_groq_key:
        return _mock_evaluation_fallback(jd_text, resume_text, threshold, must_have_skills, matched_skills, missing_skills, hard_skill_score)

    client = Groq(api_key=settings.GROQ_API_KEY, base_url=settings.GROQ_BASE_URL)

    prompt = f"""
You are an expert Technical Recruiter and Engineering Hiring Manager.
The candidate's hard skills have already been evaluated deterministically via keyword matching:
- Total Must-Have Skills Required: {len(must_have_skills)} ({', '.join(must_have_skills)})
- Matched Skills in Resume: {len(matched_skills)} ({', '.join(matched_skills) if matched_skills else 'None'})
- Missing Critical Skills: {len(missing_skills)} ({', '.join(missing_skills) if missing_skills else 'None'})
- Deterministic Hard Skill Score: {hard_skill_score}/70

YOUR TASK:
Do NOT calculate the total score. Evaluate ONLY the candidate's communication quality, project depth, and technical clarity based strictly on their resume text.
Award a fair, balanced "llm_depth_score" between 0 and 30:
- 0 to 5: Completely empty, gibberish, or 1-sentence placeholder with zero technical context.
- 6 to 10: Basic junior/student projects, calculator/todo apps, or simple scripting.
- 11 to 15: Solid practical projects (1-2 working web/API/DB projects, clear business logic and endpoints).
- 16 to 22: Strong full-stack/backend implementation, comprehensive database schemas, and microservice integration.
- 23 to 30: Senior/Lead production impact, high-throughput architectures, quantitative benchmarks, and cloud orchestration.

CRITICAL GUIDELINE:
Award a fair score matching their project maturity. For candidates with 1-2 practical working projects, award between 10 and 14 points. For senior candidates with high-impact systems, award 18 to 25 points.

JOB DESCRIPTION:
{jd_text}

CANDIDATE RESUME:
{resume_text}

Return ONLY a valid JSON object with this exact schema:
{{
  "candidate_name": "string (name extracted from resume or 'Candidate')",
  "llm_depth_score": integer (0 to 30),
  "depth_reasoning": "1-2 sentences justifying the 0-30 depth score",
  "experience_level": "Fresher" (if student, intern, or <2 yrs) OR "Experienced" (if 2+ yrs full-time),
  "years_of_experience": float or integer,
  "evaluation_summary": "2-3 sentences summarizing technical fit and hard skills vs depth alignment",
  "recommended_questions": [
     "5 tailored technical interview questions targeting their resume projects and missing skills."
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
        
        # Extract depth score (0-30)
        llm_depth = int(result.get("llm_depth_score", 15))
        llm_depth = max(0, min(30, llm_depth))
        
        # Calculate Final Composite Score
        final_score = min(100, max(0, hard_skill_score + llm_depth))
        
        result["match_percentage"] = final_score
        result["hard_skill_score"] = hard_skill_score
        result["llm_depth_score"] = llm_depth
        result["key_strengths"] = matched_skills if matched_skills else ["Problem Solving"]
        result["missing_skills"] = missing_skills
        result["start_interview"] = final_score >= threshold
        
        exp = result.get("experience_level", "Fresher")
        result["experience_level"] = "Experienced" if "exp" in exp.lower() else "Fresher"
        
        return result

    except Exception as e:
        print(f"Groq API call failed: {e}. Falling back to deterministic scoring.")
        return _mock_evaluation_fallback(jd_text, resume_text, threshold, must_have_skills, matched_skills, missing_skills, hard_skill_score)

def _mock_evaluation_fallback(jd_text: str, resume_text: str, threshold: int,
                              must_have_skills: List[str] = None, matched_skills: List[str] = None,
                              missing_skills: List[str] = None, hard_skill_score: int = None) -> Dict[str, Any]:
    """Fallback when Groq is unreachable; uses pure deterministic keyword matching."""
    if must_have_skills is None:
        must_have_skills = extract_must_have_skills_from_jd(jd_text)
        matched_skills, missing_skills = match_skills_in_resume(must_have_skills, resume_text)
        hard_skill_score, _ = calculate_hard_skill_score(matched_skills, must_have_skills)

    # Heuristic depth score based on resume substance (0-30)
    word_count = len(resume_text.split())
    if word_count > 250:
        depth_score = 22
    elif word_count > 60:
        depth_score = 16
    elif word_count > 15:
        depth_score = 12
    else:
        depth_score = 6

    final_score = min(100, max(0, hard_skill_score + depth_score))
    
    is_fresher = "intern" in resume_text.lower() or "student" in resume_text.lower() or "b.tech" in resume_text.lower()
    exp_level = "Fresher" if is_fresher else "Experienced"

    # Extract name heuristic
    lines = [line.strip() for line in resume_text.split("\n") if line.strip()]
    candidate_name = lines[0][:30] if lines else "Candidate"

    return {
        "candidate_name": candidate_name,
        "match_percentage": final_score,
        "hard_skill_score": hard_skill_score,
        "llm_depth_score": depth_score,
        "experience_level": exp_level,
        "years_of_experience": 1.0 if exp_level == "Fresher" else 3.5,
        "key_strengths": matched_skills if matched_skills else ["Problem Solving", "Python"],
        "missing_skills": missing_skills if missing_skills else ["Cloud Architecture"],
        "evaluation_summary": f"Candidate matched {len(matched_skills)}/{len(must_have_skills)} core JD skills. Hard skill score: {hard_skill_score}/70, Depth: {depth_score}/30.",
        "recommended_questions": [
            f"Explain your hands-on experience with {matched_skills[0]}." if matched_skills else "Explain your core development background.",
            f"How would you approach learning or implementing {missing_skills[0]} on the job?" if missing_skills else "How do you handle production deployments?",
            "Describe the architecture of a recent backend project you completed.",
            "How do you design REST APIs for reliability and performance?",
            "What strategies do you adopt for database indexing and query optimization?"
        ],
        "start_interview": final_score >= threshold
    }


