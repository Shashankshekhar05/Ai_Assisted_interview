import json
from typing import List, Dict, Any, Optional
from groq import Groq
from backend.config import settings

def transcribe_candidate_audio(audio_bytes: bytes) -> str:
    """
    Transcribes candidate voice audio using Groq Whisper Large v3 Turbo.
    Includes Technical Safeguard #4: Explicit filename & MIME tuple to prevent HTTP 400 errors.
    """
    if not settings.has_groq_key:
        return "Candidate voice response recorded (Demo mode active: please configure GROQ_API_KEY for live Whisper transcription)."

    try:
        client = Groq(api_key=settings.GROQ_API_KEY, base_url=settings.GROQ_BASE_URL)
        
        # Technical Safeguard #4: Pass explicit tuple: (filename, bytes, content_type)
        transcription = client.audio.transcriptions.create(
            file=("audio.webm", audio_bytes, "audio/webm"),
            model="whisper-large-v3-turbo",
            language="en",
            temperature=0.0
        )
        return transcription.text.strip()
    except Exception as e:
        print(f"Groq Whisper STT error: {e}")
        return f"[Audio transcription error: {str(e)}]"

def generate_interview_question(
    session_id: str,
    experience_level: str,
    role_title: str,
    matched_skills: List[str],
    missing_skills: List[str],
    conversation_history: List[Dict[str, Any]],
    current_question_number: int,
    max_questions: int = 10
) -> Dict[str, Any]:
    """
    Generates the next adaptive interview question across a 10-question sequence.
    Blends candidate resume projects with missing JD requirements and real-world scenarios.
    """
    if current_question_number > max_questions:
        return {
            "is_complete": True,
            "question": "Thank you for completing the 10-question technical interview! Our AI evaluation engine and the human recruiter will review your technical transcript and proctoring audit shortly.",
            "question_number": current_question_number,
            "focus_area": "Conclusion"
        }

    # Structured 10-question roadmap
    if current_question_number == 1:
        question_stage_prompt = f"""
STAGE: QUESTION 1 (Warm Greeting & Candidate Technical Introduction)
- Welcome the candidate warmly to their technical interview for the {role_title} position.
- Introduce yourself briefly as their AI Technical Interviewer.
- Ask the candidate to introduce themselves: their background, core technical skills, and a brief highlight of what they have been building or working on recently.
- Keep the introduction friendly, natural, and within 2-3 sentences so it is engaging when spoken aloud.
"""
    elif current_question_number == 2:
        question_stage_prompt = f"""
STAGE: QUESTION 2 (Follow-Up on Candidate's Introduction & Resume Projects)
- Acknowledge their introduction and any specific tools, projects, or questions they brought up.
- Dive deeper into candidate's past projects and tools listed on their resume ({', '.join(matched_skills)}).
- Ask about architectural decisions, roles, or technical challenges in their specific past work.
"""
    elif current_question_number <= 5:
        question_stage_prompt = f"""
STAGE: QUESTIONS 3-5 (Core Technical & Algorithmic Competencies)
- Test technical depth on core skills required by both the JD and Resume ({', '.join(matched_skills)}).
- Freshers: Test CS fundamentals, OOP, data structure choices, SQL joins.
- Experienced: Test concurrency, database indexing, caching strategies, and API performance.
"""
    elif current_question_number <= 8:
        question_stage_prompt = f"""
STAGE: QUESTIONS 6-8 (Probing Missing JD Requirements & System Scale)
- Probe skills listed in the JD that are missing or less prominent on the candidate's resume: {', '.join(missing_skills) if missing_skills else 'system scalability, Docker, automated CI/CD'}.
- See how quickly they reason about tools or architectures they may not have used heavily in the past.
"""
    else:
        question_stage_prompt = """
STAGE: QUESTIONS 9-10 (Production Edge Cases & Real-World Problem Solving)
- Present a real-world production incident, breaking change, latency spike, or security constraint.
- Challenge candidate on trade-offs, debugging methodology, and recovery procedures.
"""

    if experience_level.lower() == "fresher":
        persona_instructions = f"""
You are conducting a Technical Screening for an ENTRY-LEVEL / FRESHER candidate.
- TONE: Encouraging, structured, focused on conceptual clarity and project reasoning.
{question_stage_prompt}
"""
    else:
        persona_instructions = f"""
You are conducting a Technical Deep Dive for an EXPERIENCED engineer.
- TONE: Peer-to-peer technical interviewer, questioning trade-offs and production constraints.
{question_stage_prompt}
"""

    if not settings.has_groq_key:
        return _mock_question_fallback(experience_level, current_question_number, role_title)

    client = Groq(api_key=settings.GROQ_API_KEY, base_url=settings.GROQ_BASE_URL)

    # Extract Candidate's Initial Self-Introduction (Anchor Context to remember throughout interview)
    candidate_intro = None
    for entry in conversation_history:
        if entry.get("question_number") == 1 and entry.get("speaker") == "candidate":
            candidate_intro = entry.get("text", "").strip()
            break

    intro_context_block = f"\nCandidate's Stated Introduction (Remember & Anchor Context):\n\"{candidate_intro}\"\n" if candidate_intro else ""

    system_prompt = f"""
{persona_instructions}

Role Title: {role_title}
Candidate Level: {experience_level}
Key Skills on Resume: {', '.join(matched_skills)}
Skills in JD to Probe: {', '.join(missing_skills)}{intro_context_block}
Current Question Index: {current_question_number} of {max_questions}

MANDATORY INTERACTION GUIDELINES:
1. CANDIDATE QUESTIONS & QUERIES:
   - Carefully inspect the candidate's latest response.
   - If the candidate asked a technical question, asked for clarification, or asked about the company/tech-stack:
     YOU MUST FIRST ANSWER their question accurately, concisely, and professionally in 1-2 sentences.
     THEN, smoothly transition into the next interview question! Never ignore candidate questions.

2. INTRODUCTION RETENTION:
   - Always remember and anchor the candidate's stated experience, favorite tools, and projects mentioned in their introduction.
   - Reference their background naturally in your questions.

3. ADAPTIVE QUESTIONING:
   - If the candidate's last answer was vague or incomplete, ask a brief 1-sentence technical follow-up to clarify.
   - Otherwise, advance to the designated stage outlined in your instructions.

4. CONVERSATIONAL TONE:
   - Keep your response conversational, concise, and natural (under 3-4 sentences total) so it sounds natural when spoken aloud via Text-To-Speech.

5. JSON FORMAT:
   - Return strictly a valid JSON object matching the schema below.

JSON Schema:
{{
  "question": "string (the exact text to speak aloud, including your answer to any candidate question followed by your next question)",
  "focus_area": "string (e.g., Introduction, Data Structures, System Scalability, Database Optimization)",
  "expected_key_points": ["2-3 key technical concepts candidate should mention"]
}}
"""

    messages = [{"role": "system", "content": system_prompt}]
    
    # Append recent conversation history
    for entry in conversation_history[-6:]:
        role = "assistant" if entry.get("speaker") == "ai" else "user"
        messages.append({"role": role, "content": entry.get("text", "")})

    # If first question and history is empty
    if not conversation_history:
        messages.append({"role": "user", "content": f"Hello! I am ready to begin the interview for the {role_title} position."})

    try:
        completion = client.chat.completions.create(
            model=settings.GROQ_MODEL,
            messages=messages,
            response_format={"type": "json_object"},
            temperature=0.3,
            max_tokens=600
        )
        
        result = json.loads(completion.choices[0].message.content)
        result["is_complete"] = False
        result["question_number"] = current_question_number
        return result

    except Exception as e:
        print(f"Error calling Groq for question: {e}")
        return _mock_question_fallback(experience_level, current_question_number, role_title)

def _mock_question_fallback(experience_level: str, question_num: int, role_title: str) -> Dict[str, Any]:
    """10-question fallback roadmap blending resume and JD topics."""
    fresher_bank = [
        "Hello and welcome! To get started with your technical interview, could you briefly introduce yourself, your technical background, and what projects you have been working on recently?",
        "In that project, what was the most difficult bug or technical obstacle you encountered, and how did you resolve it?",
        "Could you explain the core differences between a Process and a Thread in modern operating systems?",
        "How would you explain the difference between an SQL INNER JOIN and a LEFT JOIN with a simple example?",
        "In object-oriented programming, how do Polymorphism and Encapsulation help keep code maintainable?",
        "Looking at the job requirements, how familiar are you with writing asynchronous functions or handling concurrent API requests?",
        "What strategies do you adopt for input validation and securing API endpoints against common injection attacks?",
        "Have you used containerization like Docker before? How would you explain what a Docker container is to a junior peer?",
        "If an API endpoint suddenly starts responding with 504 Gateway Timeout errors, what steps would you take to debug it?",
        "Finally, what is a recent technical skill or tool you learned completely on your own, and what motivated you to learn it?"
    ]
    
    experienced_bank = [
        f"Hello and welcome to your technical interview for the {role_title} role! To begin, could you introduce yourself, your engineering background, and key areas of technical expertise?",
        "In your past production systems, how did you balance database consistency versus availability during network partitions or high load?",
        "How do you approach database connection pooling and avoiding connection starvation under sudden traffic surges?",
        "Describe a critical production incident, memory leak, or deadlock you diagnosed. What profiling tools and mitigation steps did you use?",
        "When designing microservice communication, how do you evaluate synchronous REST/gRPC vs. asynchronous event-driven messaging like Kafka?",
        "Looking at our JD requirements, how would you architect a zero-downtime database migration for a high-throughput table with breaking changes?",
        "What caching strategies (e.g. Cache-Aside, Write-Through) have you implemented in production, and how did you handle cache stampedes?",
        "How do you enforce automated testing, CI/CD pipelines, and canary deployments to ensure code quality across a multi-developer team?",
        "If your service experiences a sudden 10x traffic spike causing CPU saturation at 99%, what immediate and architectural remedies do you apply?",
        "Finally, describe a technical decision where you disagreed with standard convention or team consensus. What was the trade-off and outcome?"
    ]
    
    bank = experienced_bank if experience_level.lower() == "experienced" else fresher_bank
    idx = min(question_num - 1, len(bank) - 1)
    
    return {
        "is_complete": False,
        "question": bank[idx],
        "question_number": question_num,
        "focus_area": "Technical Core",
        "expected_key_points": ["Conceptual clarity", "Structured explanation", "Trade-off analysis"]
    }

