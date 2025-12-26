#!/usr/bin/env python3
"""
speak TTS server - Unix socket server for Chatterbox TTS generation

Protocol: JSON Lines over Unix socket
Socket path: ~/.chatter/speak.sock

Methods:
  - health: Check server status
  - generate: Generate TTS audio
  - list-models: List available models
  - shutdown: Stop server gracefully
"""

import json
import os
import signal
import socket
import sys
import tempfile
import time
import traceback
from pathlib import Path
from typing import Any, Dict, Optional

# Ignore SIGPIPE to prevent crashes when parent process exits
# This allows the daemon to survive after the spawning Node.js process terminates
signal.signal(signal.SIGPIPE, signal.SIG_IGN)

# Configuration
SOCKET_PATH = os.path.expanduser("~/.chatter/speak.sock")
TEMP_DIR = tempfile.gettempdir()

# Maximum characters per chunk to prevent model destabilization
# Chatterbox can destabilize on long sentences, so we split aggressively
MAX_CHUNK_CHARS = 250

# Lazy-loaded model
_model = None
_model_name = None


def split_text_into_chunks(text: str, max_chars: int = MAX_CHUNK_CHARS) -> list:
    """
    Split text into smaller chunks to prevent model destabilization.

    Splits on sentence boundaries (. ! ?) first, then further splits
    long sentences on clause boundaries (, ; :) if needed.
    """
    import re

    # Normalize whitespace
    text = ' '.join(text.split())

    if len(text) <= max_chars:
        return [text]

    chunks = []

    # First split on sentence endings
    # Keep the punctuation with the sentence
    sentences = re.split(r'(?<=[.!?])\s+', text)

    current_chunk = ""
    for sentence in sentences:
        sentence = sentence.strip()
        if not sentence:
            continue

        # If adding this sentence would exceed limit
        if len(current_chunk) + len(sentence) + 1 > max_chars:
            # Save current chunk if not empty
            if current_chunk:
                chunks.append(current_chunk.strip())
                current_chunk = ""

            # If single sentence is too long, split on clause boundaries
            if len(sentence) > max_chars:
                # Split on commas, semicolons, colons, or dashes
                clauses = re.split(r'(?<=[,;:\-])\s+', sentence)
                for clause in clauses:
                    clause = clause.strip()
                    if not clause:
                        continue
                    if len(current_chunk) + len(clause) + 1 > max_chars:
                        if current_chunk:
                            chunks.append(current_chunk.strip())
                        current_chunk = clause
                    else:
                        current_chunk = (current_chunk + " " + clause).strip() if current_chunk else clause
            else:
                current_chunk = sentence
        else:
            current_chunk = (current_chunk + " " + sentence).strip() if current_chunk else sentence

    # Don't forget the last chunk
    if current_chunk:
        chunks.append(current_chunk.strip())

    return chunks


def log(level: str, message: str, **data):
    """Simple logging to stderr"""
    entry = {"level": level, "message": message, "timestamp": time.time(), **data}
    try:
        print(json.dumps(entry), file=sys.stderr, flush=True)
    except BrokenPipeError:
        # Parent process exited, stderr pipe is closed - continue silently
        pass


def load_model(model_name: str):
    """Load TTS model (lazy loading)"""
    global _model, _model_name

    if _model is not None and _model_name == model_name:
        return _model

    log("info", f"Loading model: {model_name}")
    start = time.time()

    from mlx_audio.tts.generate import load_model as mlx_load_model
    _model = mlx_load_model(Path(model_name), lazy=False)
    _model_name = model_name

    elapsed = time.time() - start
    log("info", f"Model loaded in {elapsed:.2f}s")

    return _model


def handle_health(request_id: str, params: Dict) -> Dict:
    """Handle health check request"""
    from importlib.metadata import version
    return {
        "id": request_id,
        "result": {
            "status": "healthy",
            "mlx_audio_version": version("mlx-audio"),
            "model_loaded": _model_name,
        }
    }


def handle_list_models(request_id: str, params: Dict) -> Dict:
    """List available Chatterbox models"""
    models = [
        {"name": "mlx-community/chatterbox-turbo-8bit", "description": "8-bit quantized, fastest"},
        {"name": "mlx-community/chatterbox-turbo-fp16", "description": "Full precision"},
        {"name": "mlx-community/chatterbox-turbo-4bit", "description": "4-bit quantized, smallest"},
        {"name": "mlx-community/chatterbox-turbo-5bit", "description": "5-bit quantized"},
        {"name": "mlx-community/chatterbox-turbo-6bit", "description": "6-bit quantized"},
    ]
    return {
        "id": request_id,
        "result": {"models": models}
    }


def handle_generate(request_id: str, params: Dict, conn=None) -> Dict:
    """Generate TTS audio (non-streaming)"""
    text = params.get("text", "")
    if not text:
        return {"id": request_id, "error": {"code": 1, "message": "No text provided"}}

    model_name = params.get("model", "mlx-community/chatterbox-turbo-8bit")
    temperature = params.get("temperature", 0.5)
    speed = params.get("speed", 1.0)
    voice = params.get("voice")  # Path to reference audio for voice cloning
    stream = params.get("stream", False)

    # If streaming requested and we have a connection, use streaming handler
    if stream and conn:
        return handle_generate_stream(request_id, params, conn)

    try:
        from mlx_audio.tts.generate import generate_audio
        import numpy as np
        import scipy.io.wavfile as wavfile

        # Split text into chunks to prevent model destabilization
        chunks = split_text_into_chunks(text)
        log("info", f"Generating TTS for {len(text)} chars in {len(chunks)} chunks",
            model=model_name, temperature=temperature, speed=speed)

        start = time.time()
        timestamp = int(time.time() * 1000)

        # Capture stdout/stderr to suppress verbose output and prevent broken pipe errors
        import io
        from contextlib import redirect_stdout, redirect_stderr

        all_audio = []
        sample_rate = None

        for i, chunk in enumerate(chunks):
            chunk_prefix = os.path.join(TEMP_DIR, f"speak_{timestamp}_chunk{i}")

            log("debug", f"Generating chunk {i+1}/{len(chunks)}: {len(chunk)} chars")

            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                generate_audio(
                    text=chunk,
                    model=model_name,
                    ref_audio=voice if voice and os.path.exists(voice) else None,
                    temperature=temperature,
                    speed=speed,
                    file_prefix=chunk_prefix,
                    audio_format="wav",
                    play=False,
                    verbose=False,
                    stream=False,
                    max_tokens=2400,
                )

            # Find and read the generated chunk file(s)
            chunk_files = sorted([
                f for f in os.listdir(TEMP_DIR)
                if f.startswith(f"speak_{timestamp}_chunk{i}") and f.endswith(".wav")
            ])

            for cf in chunk_files:
                chunk_path = os.path.join(TEMP_DIR, cf)
                sr, audio_data = wavfile.read(chunk_path)
                if sample_rate is None:
                    sample_rate = sr
                all_audio.append(audio_data)
                # Clean up chunk file
                os.remove(chunk_path)

        if not all_audio:
            return {"id": request_id, "error": {"code": 3, "message": "No audio generated"}}

        # Concatenate all audio chunks
        combined_audio = np.concatenate(all_audio)
        duration = len(combined_audio) / sample_rate

        # Write combined audio
        output_path = os.path.join(TEMP_DIR, f"speak_{timestamp}.wav")
        wavfile.write(output_path, sample_rate, combined_audio)

        elapsed = time.time() - start
        rtf = elapsed / duration if duration > 0 else 0

        log("info", f"Generated {duration:.2f}s audio in {elapsed:.2f}s (RTF: {rtf:.2f}, {len(chunks)} chunks)")

        return {
            "id": request_id,
            "result": {
                "audio_path": output_path,
                "duration": duration,
                "rtf": rtf,
                "sample_rate": sample_rate,
            }
        }

    except Exception as e:
        log("error", f"Generation failed: {e}", traceback=traceback.format_exc())
        return {
            "id": request_id,
            "error": {"code": 2, "message": str(e)}
        }


def handle_generate_stream(request_id: str, params: Dict, conn) -> Dict:
    """
    Generate TTS audio with streaming - sends chunks as they're generated.

    Uses text chunking to prevent model destabilization on long inputs.
    Each text chunk is generated separately and sent to the client immediately,
    providing streaming behavior while maintaining audio quality.
    """
    text = params.get("text", "")
    model_name = params.get("model", "mlx-community/chatterbox-turbo-8bit")
    temperature = params.get("temperature", 0.5)
    speed = params.get("speed", 1.0)
    voice = params.get("voice")

    try:
        from mlx_audio.tts.generate import generate_audio
        import scipy.io.wavfile as wavfile
        import io
        from contextlib import redirect_stdout, redirect_stderr

        # Split text into chunks to prevent model destabilization
        chunks = split_text_into_chunks(text)

        log("info", f"Streaming TTS for {len(text)} chars in {len(chunks)} text chunks",
            model=model_name, temperature=temperature, speed=speed)
        start = time.time()

        timestamp = int(time.time() * 1000)
        total_duration = 0.0
        chunk_num = 0
        sample_rate = None

        # Generate each text chunk and send immediately
        for i, text_chunk in enumerate(chunks):
            chunk_prefix = os.path.join(TEMP_DIR, f"speak_stream_{timestamp}_chunk{i}")

            log("debug", f"Generating text chunk {i+1}/{len(chunks)}: {len(text_chunk)} chars")

            # Generate this chunk (non-streaming to avoid destabilization)
            with redirect_stdout(io.StringIO()), redirect_stderr(io.StringIO()):
                generate_audio(
                    text=text_chunk,
                    model=model_name,
                    ref_audio=voice if voice and os.path.exists(voice) else None,
                    temperature=temperature,
                    speed=speed,
                    file_prefix=chunk_prefix,
                    audio_format="wav",
                    play=False,
                    verbose=False,
                    stream=False,
                    max_tokens=2400,
                )

            # Find generated file(s) for this chunk
            chunk_files = sorted([
                f for f in os.listdir(TEMP_DIR)
                if f.startswith(f"speak_stream_{timestamp}_chunk{i}") and f.endswith(".wav")
            ])

            # Send each generated audio file as a stream chunk
            for cf in chunk_files:
                chunk_path = os.path.join(TEMP_DIR, cf)
                try:
                    sr, audio_data = wavfile.read(chunk_path)
                    if sample_rate is None:
                        sample_rate = sr

                    chunk_duration = len(audio_data) / sr
                    total_duration += chunk_duration
                    chunk_num += 1

                    # Send chunk response immediately
                    chunk_response = {
                        "id": request_id,
                        "chunk": chunk_num,
                        "audio_path": chunk_path,
                        "duration": chunk_duration,
                        "sample_rate": sr,
                    }
                    conn.send((json.dumps(chunk_response) + "\n").encode("utf-8"))
                    log("debug", f"Sent chunk {chunk_num}: {chunk_duration:.2f}s")

                except Exception as e:
                    log("warn", f"Failed to process chunk file {chunk_path}: {e}")

        elapsed = time.time() - start
        rtf = elapsed / total_duration if total_duration > 0 else 0

        log("info", f"Streamed {chunk_num} chunks ({len(chunks)} text chunks), "
            f"{total_duration:.2f}s in {elapsed:.2f}s (RTF: {rtf:.2f})")

        # Send completion message
        return {
            "id": request_id,
            "complete": True,
            "total_chunks": chunk_num,
            "total_duration": total_duration,
            "rtf": rtf,
        }

    except Exception as e:
        log("error", f"Streaming failed: {e}", traceback=traceback.format_exc())
        return {
            "id": request_id,
            "error": {"code": 2, "message": str(e)}
        }


def handle_request(request: Dict, conn=None) -> Dict:
    """Route request to appropriate handler"""
    request_id = request.get("id", "unknown")
    method = request.get("method", "")
    params = request.get("params", {})

    if method == "generate":
        return handle_generate(request_id, params, conn)
    elif method == "health":
        return handle_health(request_id, params)
    elif method == "list-models":
        return handle_list_models(request_id, params)
    else:
        return {
            "id": request_id,
            "error": {"code": -1, "message": f"Unknown method: {method}"}
        }


def run_server():
    """Run the Unix socket server"""
    # Remove existing socket
    if os.path.exists(SOCKET_PATH):
        os.remove(SOCKET_PATH)

    # Create socket
    server = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
    server.bind(SOCKET_PATH)
    server.listen(1)

    log("info", f"Server listening on {SOCKET_PATH}")
    try:
        print(json.dumps({"status": "ready", "socket": SOCKET_PATH}), flush=True)
    except BrokenPipeError:
        # Parent may have exited before reading ready signal - continue anyway
        pass

    try:
        while True:
            conn, addr = server.accept()
            log("debug", "Client connected")

            try:
                # Read request line by line
                buffer = b""
                while True:
                    data = conn.recv(4096)
                    if not data:
                        break

                    buffer += data

                    # Process complete lines
                    while b"\n" in buffer:
                        line, buffer = buffer.split(b"\n", 1)
                        line = line.strip()
                        if not line:
                            continue

                        try:
                            request = json.loads(line.decode("utf-8"))

                            # Handle shutdown
                            if request.get("method") == "shutdown":
                                log("info", "Shutdown requested")
                                response = {"id": request.get("id"), "result": {"status": "shutting_down"}}
                                conn.send((json.dumps(response) + "\n").encode("utf-8"))
                                conn.close()
                                return

                            # Handle other requests
                            response = handle_request(request, conn)
                            conn.send((json.dumps(response) + "\n").encode("utf-8"))

                        except json.JSONDecodeError as e:
                            error_response = {"error": {"code": -32700, "message": f"Parse error: {e}"}}
                            conn.send((json.dumps(error_response) + "\n").encode("utf-8"))

            except Exception as e:
                log("error", f"Connection error: {e}")
            finally:
                conn.close()
                log("debug", "Client disconnected")

    except KeyboardInterrupt:
        log("info", "Server interrupted")
    finally:
        server.close()
        if os.path.exists(SOCKET_PATH):
            os.remove(SOCKET_PATH)
        log("info", "Server stopped")


if __name__ == "__main__":
    run_server()
