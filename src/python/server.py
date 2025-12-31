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
import select
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
IDLE_TIMEOUT_SECONDS = 60 * 60  # 1 hour - auto-shutdown if no TTS requests

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


def load_model(model_name: str, request_id: str = None, conn = None):
    """
    Load TTS model (lazy loading).
    
    If request_id and conn are provided, sends status events to client.
    """
    global _model, _model_name

    if _model is not None and _model_name == model_name:
        return _model, 0.0  # Already loaded, no load time

    # Send status: loading_model
    if request_id and conn:
        try:
            status_msg = {
                "id": request_id,
                "status": {
                    "phase": "loading_model",
                    "model": model_name,
                }
            }
            conn.send((json.dumps(status_msg) + "\n").encode("utf-8"))
        except:
            pass

    log("info", f"Loading model: {model_name}")
    start = time.time()

    from mlx_audio.tts.generate import load_model as mlx_load_model
    _model = mlx_load_model(Path(model_name), lazy=False)
    _model_name = model_name

    elapsed = time.time() - start
    log("info", f"Model loaded in {elapsed:.2f}s")

    # Send status: model_loaded
    if request_id and conn:
        try:
            status_msg = {
                "id": request_id,
                "status": {
                    "phase": "model_loaded",
                    "load_time_ms": int(elapsed * 1000),
                }
            }
            conn.send((json.dumps(status_msg) + "\n").encode("utf-8"))
        except:
            pass

    return _model, elapsed


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
    """
    Generate TTS audio (non-streaming) with progressive chunk saving.
    
    Chunks are saved to disk immediately after generation so partial
    output is preserved if generation is interrupted.
    """
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

        # Send status: check if model needs loading
        needs_model_load = _model_name != model_name
        if conn and needs_model_load:
            try:
                status_msg = {
                    "id": request_id,
                    "status": {
                        "phase": "loading_model",
                        "model": model_name,
                    }
                }
                conn.send((json.dumps(status_msg) + "\n").encode("utf-8"))
            except:
                pass

        # Split text into chunks to prevent model destabilization
        chunks = split_text_into_chunks(text)
        total_chunks = len(chunks)
        log("info", f"Generating TTS for {len(text)} chars in {total_chunks} chunks",
            model=model_name, temperature=temperature, speed=speed)

        start = time.time()
        timestamp = int(time.time() * 1000)

        # Capture stdout/stderr to suppress verbose output and prevent broken pipe errors
        import io
        from contextlib import redirect_stdout, redirect_stderr

        # Progressive saving: track saved chunk files instead of in-memory audio
        saved_chunk_files: list[str] = []
        sample_rate = None
        chunks_generated = 0

        chars_done = 0
        
        for i, chunk in enumerate(chunks):
            chunk_prefix = os.path.join(TEMP_DIR, f"speak_{timestamp}_chunk{i}")

            log("debug", f"Generating chunk {i+1}/{total_chunks}: {len(chunk)} chars")
            
            # Send progress event if connection available
            if conn:
                progress_msg = {
                    "id": request_id,
                    "progress": {
                        "chunk": i + 1,
                        "total_chunks": total_chunks,
                        "chars_done": chars_done,
                        "chars_total": len(text),
                    }
                }
                try:
                    conn.send((json.dumps(progress_msg) + "\n").encode("utf-8"))
                except:
                    pass  # Ignore progress send errors

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

            # Find and save the generated chunk file(s)
            chunk_files = sorted([
                f for f in os.listdir(TEMP_DIR)
                if f.startswith(f"speak_{timestamp}_chunk{i}") and f.endswith(".wav")
            ])

            for cf in chunk_files:
                chunk_path = os.path.join(TEMP_DIR, cf)
                # Read to get sample rate (needed for concatenation)
                sr, _ = wavfile.read(chunk_path)
                if sample_rate is None:
                    sample_rate = sr
                # Keep chunk file on disk for progressive saving
                saved_chunk_files.append(chunk_path)
                chunks_generated += 1
                chars_done += len(chunk)
                log("debug", f"Saved chunk {chunks_generated} to {chunk_path}")

        if not saved_chunk_files:
            return {"id": request_id, "error": {"code": 3, "message": "No audio generated"}}

        # Concatenate all saved chunks
        all_audio = []
        for chunk_path in saved_chunk_files:
            sr, audio_data = wavfile.read(chunk_path)
            all_audio.append(audio_data)

        combined_audio = np.concatenate(all_audio)
        duration = len(combined_audio) / sample_rate

        # Write combined audio
        output_path = os.path.join(TEMP_DIR, f"speak_{timestamp}.wav")
        wavfile.write(output_path, sample_rate, combined_audio)

        # Clean up individual chunk files
        for chunk_path in saved_chunk_files:
            try:
                os.remove(chunk_path)
            except:
                pass

        elapsed = time.time() - start
        rtf = elapsed / duration if duration > 0 else 0

        log("info", f"Generated {duration:.2f}s audio in {elapsed:.2f}s (RTF: {rtf:.2f}, {chunks_generated}/{total_chunks} chunks)")

        return {
            "id": request_id,
            "result": {
                "audio_path": output_path,
                "duration": duration,
                "rtf": rtf,
                "sample_rate": sample_rate,
                "complete": True,
                "chunks_generated": chunks_generated,
                "chunks_total": total_chunks,
            }
        }

    except Exception as e:
        log("error", f"Generation failed: {e}", traceback=traceback.format_exc())
        
        # Attempt to save partial output if any chunks were generated
        try:
            if saved_chunk_files:
                import numpy as np
                import scipy.io.wavfile as wavfile
                
                all_audio = []
                for chunk_path in saved_chunk_files:
                    if os.path.exists(chunk_path):
                        sr, audio_data = wavfile.read(chunk_path)
                        all_audio.append(audio_data)
                
                if all_audio:
                    combined_audio = np.concatenate(all_audio)
                    duration = len(combined_audio) / sample_rate if sample_rate else 0
                    
                    output_path = os.path.join(TEMP_DIR, f"speak_{timestamp}_partial.wav")
                    wavfile.write(output_path, sample_rate, combined_audio)
                    
                    # Clean up chunks
                    for chunk_path in saved_chunk_files:
                        try:
                            os.remove(chunk_path)
                        except:
                            pass
                    
                    elapsed = time.time() - start
                    rtf = elapsed / duration if duration > 0 else 0
                    
                    log("info", f"Saved partial output: {duration:.2f}s audio, {chunks_generated}/{total_chunks} chunks")
                    
                    return {
                        "id": request_id,
                        "result": {
                            "audio_path": output_path,
                            "duration": duration,
                            "rtf": rtf,
                            "sample_rate": sample_rate,
                            "complete": False,
                            "chunks_generated": chunks_generated,
                            "chunks_total": total_chunks,
                            "reason": str(e),
                        }
                    }
        except Exception as partial_error:
            log("error", f"Failed to save partial output: {partial_error}")
        
        return {
            "id": request_id,
            "error": {"code": 2, "message": str(e)}
        }


def handle_stream_binary(request_id: str, params: Dict, conn) -> None:
    """
    Handle streaming TTS with binary protocol.
    No file paths sent over wire - samples go directly to socket.
    
    Protocol: After receiving JSON request, server switches to binary protocol
    for response. Uses SPKR binary format for audio chunks.
    """
    from binary_protocol import write_chunk, write_end, write_error
    
    text = params.get("text", "")
    if not text:
        write_error(conn, "No text provided")
        return
    
    model_name = params.get("model", "mlx-community/chatterbox-turbo-8bit")
    temperature = params.get("temperature", 0.5)
    speed = params.get("speed", 1.0)
    voice = params.get("voice")
    
    try:
        from mlx_audio.tts.generate import generate_audio
        import scipy.io.wavfile as wavfile
        import numpy as np
        import io
        from contextlib import redirect_stdout, redirect_stderr

        # Split text into chunks to prevent model destabilization
        chunks = split_text_into_chunks(text)
        
        log("info", f"Binary streaming TTS for {len(text)} chars in {len(chunks)} text chunks",
            model=model_name, temperature=temperature, speed=speed)
        start = time.time()
        
        timestamp = int(time.time() * 1000)
        total_samples = 0
        chunk_id = 0
        sample_rate = 24000  # Default, will be updated from actual audio
        
        for i, text_chunk in enumerate(chunks):
            chunk_prefix = os.path.join(TEMP_DIR, f"speak_bin_{timestamp}_chunk{i}")
            
            log("debug", f"Generating text chunk {i+1}/{len(chunks)}: {len(text_chunk)} chars")
            
            # Generate audio (still needs file I/O internally, but we read and send bytes)
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
            
            # Find generated file(s)
            chunk_files = sorted([
                f for f in os.listdir(TEMP_DIR)
                if f.startswith(f"speak_bin_{timestamp}_chunk{i}") and f.endswith(".wav")
            ])
            
            for cf in chunk_files:
                chunk_path = os.path.join(TEMP_DIR, cf)
                try:
                    # Read audio as numpy array
                    sr, audio_data = wavfile.read(chunk_path)
                    sample_rate = sr
                    
                    # Convert to float32 normalized [-1, 1]
                    if audio_data.dtype == np.int16:
                        samples = audio_data.astype(np.float32) / 32768.0
                    elif audio_data.dtype == np.int32:
                        samples = audio_data.astype(np.float32) / 2147483648.0
                    else:
                        samples = audio_data.astype(np.float32)
                    
                    # Send via binary protocol
                    write_chunk(conn, chunk_id, samples, sample_rate)
                    
                    total_samples += len(samples)
                    log("debug", f"Sent binary chunk {chunk_id}: {len(samples)} samples, {len(samples)/sr:.2f}s")
                    chunk_id += 1
                    
                finally:
                    # Clean up temp file immediately
                    if os.path.exists(chunk_path):
                        os.remove(chunk_path)
        
        # Send end marker
        write_end(conn, chunk_id)
        
        elapsed = time.time() - start
        duration = total_samples / sample_rate if sample_rate > 0 else 0
        rtf = elapsed / duration if duration > 0 else 0
        
        log("info", f"Binary stream complete: {chunk_id} chunks, {total_samples} samples, "
            f"{duration:.2f}s in {elapsed:.2f}s (RTF: {rtf:.2f})")
        
    except Exception as e:
        log("error", f"Binary streaming failed: {e}", traceback=traceback.format_exc())
        try:
            write_error(conn, str(e))
        except:
            pass  # Connection may already be broken


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


def handle_request(request: Dict, conn=None) -> tuple:
    """Route request to appropriate handler.
    
    Returns:
        (response, is_tts_request) - response may be None for binary streaming
    """
    request_id = request.get("id", "unknown")
    method = request.get("method", "")
    params = request.get("params", {})

    if method == "generate":
        return handle_generate(request_id, params, conn), True
    elif method == "stream-binary":
        # Binary streaming - no JSON response, switches to binary protocol
        handle_stream_binary(request_id, params, conn)
        return None, True  # Signal no JSON response needed
    elif method == "health":
        return handle_health(request_id, params), False
    elif method == "list-models":
        return handle_list_models(request_id, params), False
    else:
        return {
            "id": request_id,
            "error": {"code": -1, "message": f"Unknown method: {method}"}
        }, False


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

    # Track last TTS inference time for idle shutdown
    last_tts_time = time.time()

    try:
        while True:
            # Check for idle timeout (1 hour since last TTS)
            idle_seconds = time.time() - last_tts_time
            if idle_seconds > IDLE_TIMEOUT_SECONDS:
                log("info", f"Idle timeout ({IDLE_TIMEOUT_SECONDS}s) - shutting down")
                break

            # Use select to wait for connection with timeout (check idle every 60s)
            ready, _, _ = select.select([server], [], [], 60)
            if not ready:
                # Timeout - loop back to check idle timeout
                continue

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
                            response, is_tts = handle_request(request, conn)
                            
                            # Update idle timer on TTS requests
                            if is_tts:
                                last_tts_time = time.time()
                            
                            # Only send JSON response if handler returned one
                            # (binary streaming handlers return None)
                            if response is not None:
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
