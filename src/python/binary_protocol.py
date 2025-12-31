"""
Binary streaming protocol for speak TTS.

Protocol specification:
- All integers are little-endian
- Magic: "SPKR" (4 bytes)

CHUNK MESSAGE:
  [magic:4][id:4][count:4][rate:4][samples:float32[]]

END MESSAGE:
  [magic:4][0xFFFFFFFF:4][totalChunks:4][0:4]

ERROR MESSAGE:
  [magic:4][0xFFFFFFFE:4][msgLen:4][0:4][message:utf8]
"""

import struct
import numpy as np
from typing import BinaryIO, Union
import socket

MAGIC = b'SPKR'
END_MARKER = 0xFFFFFFFF
ERROR_MARKER = 0xFFFFFFFE


def write_chunk(
    stream: Union[BinaryIO, socket.socket],
    chunk_id: int,
    samples: np.ndarray,
    sample_rate: int = 24000
) -> None:
    """
    Write an audio chunk to the stream.
    
    Args:
        stream: Socket or file-like object
        chunk_id: Sequential chunk identifier
        samples: Audio samples as numpy array
        sample_rate: Sample rate in Hz
    """
    # Ensure float32
    samples_f32 = samples.astype(np.float32)
    
    # Build header: magic(4) + id(4) + count(4) + rate(4) = 16 bytes
    header = struct.pack('<4sIII', MAGIC, chunk_id, len(samples_f32), sample_rate)
    
    # Get sample bytes
    sample_bytes = samples_f32.tobytes()
    
    # Write atomically if possible
    if hasattr(stream, 'sendall'):
        stream.sendall(header + sample_bytes)
    else:
        stream.write(header)
        stream.write(sample_bytes)
        stream.flush()


def write_end(
    stream: Union[BinaryIO, socket.socket],
    total_chunks: int
) -> None:
    """
    Write end-of-stream marker.
    
    Args:
        stream: Socket or file-like object
        total_chunks: Total number of chunks sent
    """
    header = struct.pack('<4sIII', MAGIC, END_MARKER, total_chunks, 0)
    
    if hasattr(stream, 'sendall'):
        stream.sendall(header)
    else:
        stream.write(header)
        stream.flush()


def write_error(
    stream: Union[BinaryIO, socket.socket],
    message: str
) -> None:
    """
    Write error message.
    
    Args:
        stream: Socket or file-like object
        message: Error description
    """
    msg_bytes = message.encode('utf-8')
    header = struct.pack('<4sIII', MAGIC, ERROR_MARKER, len(msg_bytes), 0)
    
    if hasattr(stream, 'sendall'):
        stream.sendall(header + msg_bytes)
    else:
        stream.write(header)
        stream.write(msg_bytes)
        stream.flush()


def read_chunk(stream: Union[BinaryIO, socket.socket]) -> dict:
    """
    Read a single message from the stream.
    
    Returns:
        dict with 'type' key:
        - type='chunk': id, samples (numpy), sample_rate
        - type='end': total_chunks
        - type='error': message
    """
    # Read header
    if hasattr(stream, 'recv'):
        header = b''
        while len(header) < 16:
            header += stream.recv(16 - len(header))
    else:
        header = stream.read(16)
    
    if len(header) < 16:
        raise IOError("Incomplete header")
    
    magic, id_or_marker, count, rate = struct.unpack('<4sIII', header)
    
    if magic != MAGIC:
        raise ValueError(f"Invalid magic: {magic}")
    
    # End marker
    if id_or_marker == END_MARKER:
        return {'type': 'end', 'total_chunks': count}
    
    # Error marker
    if id_or_marker == ERROR_MARKER:
        if hasattr(stream, 'recv'):
            msg_bytes = b''
            while len(msg_bytes) < count:
                msg_bytes += stream.recv(count - len(msg_bytes))
        else:
            msg_bytes = stream.read(count)
        return {'type': 'error', 'message': msg_bytes.decode('utf-8')}
    
    # Audio chunk
    sample_bytes_len = count * 4
    if hasattr(stream, 'recv'):
        sample_bytes = b''
        while len(sample_bytes) < sample_bytes_len:
            sample_bytes += stream.recv(sample_bytes_len - len(sample_bytes))
    else:
        sample_bytes = stream.read(sample_bytes_len)
    
    samples = np.frombuffer(sample_bytes, dtype=np.float32)
    
    return {
        'type': 'chunk',
        'id': id_or_marker,
        'samples': samples,
        'sample_rate': rate
    }
