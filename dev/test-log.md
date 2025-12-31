# Test Log for speak v1.1 Changes

## Test Environment
- Date: 2025-12-31
- Directory: /Users/jay/Documents/speak

---

## TEST-01: Issue #001 - Output Path Handling

### Test Case 1.1: Output as file path (.wav extension)
**Command**: `speak "Hello world" --output /tmp/test-001/greeting.wav`
**Expected**: Creates `/tmp/test-001/greeting.wav` as a file (not directory)

### Test Case 1.2: Output as directory path
**Command**: `speak "Hello world" --output /tmp/test-001/audio/`
**Expected**: Creates `/tmp/test-001/audio/speak_YYYY-MM-DD_HHMMSS.wav`

### Test Case 1.3: Output with nested path
**Command**: `speak "Hello world" --output /tmp/test-001/a/b/c/output.wav`
**Expected**: Creates directories a/b/c and file output.wav

---

