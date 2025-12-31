# speak v1.1 Issues & Feature Requests

Comprehensive issues and implementation plans based on real-world usage generating ~4.5 hours of audiobook content.

## Summary

| # | Title | Type | Severity | Status |
|---|-------|------|----------|--------|
| 001 | [Output path creates directory instead of file](001-output-path-creates-directory.md) | Bug | **High** | Planned |
| 002 | [No progress indicator for long files](002-no-progress-for-long-files.md) | Feature | Medium | Planned |
| 003 | [Silent timeout with no partial output](003-silent-timeout-no-partial-output.md) | Bug/Feature | **High** | Planned |
| 004 | [No built-in chunking for long documents](004-no-builtin-chunking.md) | Feature | Medium | Planned |
| 005 | [No way to resume failed generation](005-no-resume-capability.md) | Feature | Low-Medium | Planned |
| 006 | [Add batch processing mode](006-add-batch-mode.md) | Feature | Low | Planned |
| 007 | [Add built-in concatenation command](007-add-concat-command.md) | Feature | Low | Planned |
| 008 | [Add estimated duration before generation](008-add-duration-estimate.md) | Feature | Low | Planned |
| 009 | [Distinguish model loading vs generating](009-distinguish-model-loading-vs-generating.md) | Feature | Low | Planned |
| 010 | [Add --dry-run flag](010-add-dry-run-flag.md) | Feature | Low | Planned |

## Implementation Priority

### Phase 1: Must Fix (High Impact)

1. **#001 - Output path behavior** (~2 hours)
   - Root cause: `prepareOutputPath` treats all paths as directories
   - Fix: Detect `.wav` extension to determine file vs directory intent
   - Low risk, high user impact

2. **#003 - Silent timeouts** (~1 day)
   - Root cause: No checkpointing during generation
   - Fix: Progressive chunk saving, configurable timeout, abort handling
   - Foundation for other features

### Phase 2: Should Add (Medium Impact)

3. **#004 - Auto-chunking** (~1 day)
   - Depends on: #003 (partial output)
   - Approach: Sentence-boundary chunking, sox concatenation
   - Enables long document processing without manual work

4. **#002 - Progress indicators** (~0.5 day)
   - Approach: Extend protocol with progress events
   - Natural extension of #003 implementation

### Phase 3: Nice to Have (Low Impact)

5. **#005 - Resume capability** (~0.5 day)
   - Depends on: #003, #004
   - Approach: Manifest files with chunk state

6. **#008 - Duration estimates** (~0.5 day)
   - Standalone feature, simple formula-based estimation

7. **#009 - Status messages** (~0.5 day)
   - Extends #002, shows model loading separately

8. **#006 - Batch mode** (~0.5 day)
   - Standalone feature, wraps single-file processing

9. **#007 - Concat command** (~2 hours)
   - Reuses #004 concatenation code, exposes as subcommand

10. **#010 - Dry-run flag** (~0.5 day)
    - Depends on: #006, #008
    - Nice UX polish for planning

## Design Principles Applied

Each implementation plan follows the backend engineering principles from Sean Goedecke's system design philosophy:

1. **Simple and boring** — Use well-tested primitives (sox for concat, file presence for state)
2. **State is the problem** — Minimize in-memory state, persist early (progressive chunk saving)
3. **One owner, one writer** — Clear ownership of output paths and state
4. **Hot paths first** — Progress/status reporting must not slow generation
5. **Decide failure modes explicitly** — Each issue specifies fail-open vs fail-closed behavior
6. **Log the decisions** — All plans include structured logging at decision points
7. **Operations are part of design** — Clear manual recovery paths, cleanup strategies

## Estimated Total Effort

| Phase | Issues | Effort |
|-------|--------|--------|
| Phase 1 | #001, #003 | ~1.5 days |
| Phase 2 | #002, #004 | ~1.5 days |
| Phase 3 | #005-#010 | ~3 days |
| **Total** | All 10 | **~6 days** |

## Testing Context

These issues were discovered while generating audiobook content:
- 6 chapters of "Alpha Trader" by Brent Donnelly
- Total: ~4.5 hours of audio
- Voice: David Attenborough clone
- Largest chapter: 168KB text → 454MB audio (2h 45m)
- Multiple timeouts required manual chunking workaround

## File Structure

Each issue file contains:
- **Description**: User-facing problem statement
- **Investigation**: Root cause analysis, state inventory, design questions
- **Implementation Plan**: 
  - Design principles applied
  - Approach
  - Code changes (with actual code snippets)
  - Test cases
  - Error handling
  - Rollout plan
- **Priority Note**: Context for prioritization decisions
