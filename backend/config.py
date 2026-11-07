import os
from pathlib import Path
from dotenv import load_dotenv

# Base directory of the project
BASE_DIR = Path(__file__).resolve().parent.parent

# Load .env from workspace root
ENV_PATH = BASE_DIR / ".env"
load_dotenv(dotenv_path=ENV_PATH)

class Settings:
    GROQ_API_KEY: str = os.getenv("GROQ_API_KEY", "")
    MATCH_THRESHOLD: int = int(os.getenv("MATCH_THRESHOLD", "70"))
    MAX_STRIKES: int = int(os.getenv("MAX_STRIKES", "3"))
    MAX_QUESTIONS: int = int(os.getenv("MAX_QUESTIONS", "10"))
    ANSWER_TIMEOUT_SECONDS: int = int(os.getenv("ANSWER_TIMEOUT_SECONDS", "50"))
    STRIKE_COOLDOWN_SECONDS: float = float(os.getenv("STRIKE_COOLDOWN_SECONDS", "5.0"))
    HOST: str = os.getenv("HOST", "127.0.0.1")
    PORT: int = int(os.getenv("PORT", "8000"))
    
    # Groq Model Configuration
    GROQ_MODEL: str = os.getenv("GROQ_MODEL", "qwen/qwen3.8-27b")
    GROQ_BASE_URL: str = os.getenv("GROQ_BASE_URL", "https://api.groq.com/openai/v1")
    DB_PATH: Path = BASE_DIR / "backend" / "proctor_interview.db"

    @property
    def has_groq_key(self) -> bool:
        return bool(self.GROQ_API_KEY and self.GROQ_API_KEY.strip() != "" and not self.GROQ_API_KEY.startswith("your_groq_api_key"))

settings = Settings()

