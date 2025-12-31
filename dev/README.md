# Development Artifacts

This directory contains intermediate artifacts from the agentic development process used to build speak v1.0 and v1.1.

These files document the AI-assisted engineering workflow, including implementation plans, bug reports, fix logs, and issue tracking. They are preserved for reference but are not part of the tool's documentation.

## Contents

### Planning
- `Implementation_plan.md` - Comprehensive v1.0 architecture plan (streaming, state machine, binary protocol)
- `v1.1-plan.md` - Summary of v1.1 streaming fixes and improvements

### Bug Reports & Fixes
- `bug-report.md` - Initial streaming issues identified
- `bug-report-audio-cutoff.md` - Audio truncation bug analysis
- `bug-report-streaming-hang.md` - Long content hang bug analysis
- `fix-streaming-log.md` - Execution log for streaming state machine fix
- `fix-audio-cutoff-log.md` - Execution log for audio cutoff fix
- `fix-streaming-audio-log.md` - Execution log for buffer corruption fix

### Implementation Logs
- `log.md` - Main execution log for v1.1 feature implementation (10 issues)
- `test-log.md` - Testing log for v1.1 features

### Issue Tracking
- `issues/` - Individual issue files for v1.1 features (001-010)

### Reference
- `all-docs.txt` - Concatenated codebase snapshot used during planning

## About the Process

These artifacts were created using an agentic engineering approach where an AI assistant:
1. Analyzed the existing codebase
2. Created detailed implementation plans
3. Executed changes following a structured logging protocol
4. Tracked decisions and blockers in append-only logs
5. Documented bug investigations and fixes

This process ensures traceability and enables resumption of work across sessions.
