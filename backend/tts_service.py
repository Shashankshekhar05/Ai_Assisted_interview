import io
import base64
import asyncio
from typing import Optional
import edge_tts

DEFAULT_VOICE = "en-US-JennyNeural"  # Professional, natural neural AI interviewer voice

async def synthesize_speech_in_memory(text: str, voice: str = DEFAULT_VOICE) -> bytes:
    """
    Synthesize natural neural speech using edge-tts entirely in memory.
    Technical Safeguard #5: Zero disk files created; prevents Windows file locking and disk bloat.
    """
    clean_text = text.strip()
    if not clean_text:
        return b""

    try:
        communicate = edge_tts.Communicate(clean_text, voice)
        audio_stream = io.BytesIO()
        
        async for chunk in communicate.stream():
            if chunk["type"] == "audio":
                audio_stream.write(chunk["data"])
                
        audio_stream.seek(0)
        return audio_stream.read()
    except Exception as e:
        print(f"edge-tts synthesis warning: {e}. Client can fallback to browser SpeechSynthesis.")
        return b""

def text_to_speech_base64(text: str, voice: str = DEFAULT_VOICE) -> Optional[str]:
    """
    Synchronous wrapper returning a data URI string (data:audio/mp3;base64,...)
    for direct inline playback in the frontend <audio> element.
    """
    try:
        # Check if an event loop is already running
        try:
            loop = asyncio.get_running_loop()
        except RuntimeError:
            loop = None

        if loop and loop.is_running():
            # If called inside an active async loop, create a task
            import concurrent.futures
            with concurrent.futures.ThreadPoolExecutor() as executor:
                raw_bytes = executor.submit(lambda: asyncio.run(synthesize_speech_in_memory(text, voice))).result()
        else:
            raw_bytes = asyncio.run(synthesize_speech_in_memory(text, voice))

        if raw_bytes:
            b64_audio = base64.b64encode(raw_bytes).decode("utf-8")
            return f"data:audio/mpeg;base64,{b64_audio}"
        return None
    except Exception as e:
        print(f"Failed to generate base64 TTS: {e}")
        return None

