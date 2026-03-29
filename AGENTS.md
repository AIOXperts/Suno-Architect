# AGENTS.md — Suno-Architect

---

# Core Philosophy

The agent operates in **batch execution mode**:

PLAN → IMPLEMENT FULL SOLUTION → VALIDATE → FINALIZE

The agent should not operate in interactive incremental steps unless blocked by a defined hard stop.

Avoid partial implementations when full parity is achievable within the same session.

---

# Stack (Use These Assumptions)

- Runtime/package manager: bun (preferred)
- Frontend: Vite + React + TypeScript
- Styling: Tailwind CSS (v4 via @tailwindcss/vite)
- Drag/drop: @dnd-kit
- Offline storage: IndexedDB via idb
- Deploy target: Cloudflare Workers + static assets via Wrangler

---

# Commands (Bun First)

Install:
bun install

Dev:
bun run dev

Build:
bun run build

Preview:
bun run preview

Deployment:
bunx wrangler deploy

---

# Deployment Notes (Wrangler)

- wrangler.toml builds using Bun.
- Worker entrypoint: functions/_worker.ts
- Static assets served from: dist
- Treat Workers runtime constraints as real (no Node-only APIs unless polyfilled).

---

# Delivery Mode (CRITICAL)

## Default Behavior

The agent MUST:

- Create an execution plan internally before coding.
- Implement ALL planned steps in a single batch.
- Run validation once at end of batch.
- Deliver final result without asking “Proceed” or requesting incremental confirmation.

Avoid:

- milestone pausing
- incremental parity passes unless required by Hard Stop rules.

---

# Planning Requirements

Before implementation, define:

1. Objective
2. Architecture approach
3. Ordered task list
4. Risk areas
5. Validation strategy
6. Definition of Done

Planning does NOT need to be verbose in output — just internally guiding execution.

---

# Implementation Rules

## Native-first Architecture

When replacing legacy systems (e.g., iframe → native React):

- Native implementation becomes primary.
- Legacy systems should:
  - become lazy-loaded fallback
  - never remain primary runtime once parity exists.

Avoid maintaining dual primary paths.

---

## Type Safety

When modifying shared types/interfaces:

Update ALL of:

- defaults
- persistence layer (offlineDb / IndexedDB)
- UI controls
- worker/client boundary types
- serialization/deserialization
- object literals referencing the interface

Never introduce temporary missing fields.

---

## Refactoring Philosophy

Prefer:

- extending existing patterns/components
- integrating into existing architecture

Avoid:

- parallel abstractions
- duplicate pipelines
- temporary scaffolding unless necessary for compilation.

---

## State + Persistence Rules

If settings/state exist:

- Maintain backward compatibility.
- Use additive schema changes.
- Provide safe defaults for missing fields.
- Avoid destructive migrations without Hard Stop.

---

# Validation Rules

The agent MUST:

- Run bun run build once at end of batch.
- Fix build failures within same execution.
- Avoid repeated build runs after each small change.

If tests exist:

- run once at end.

---

# Hard Stops ("Do Not Pass Go")

Only stop execution and ask user when:

1. Architectural decision impacts product direction or UX paradigm.
2. Data migration risk (IndexedDB versioning, destructive schema change).
3. Security/privacy risk.
4. External API uncertainty preventing validation.
5. Public API removal without guaranteed compatibility mapping.

Otherwise proceed autonomously.

---

# Soft Assumptions (Proceed Without Asking)

- Match existing UI/UX patterns when unspecified.
- Prefer simplest working implementation.
- Assume backwards compatibility unless told otherwise.
- Choose native-first solutions over embedded or legacy bridges.

---

# Performance Guidance

Prefer:

- single-pass refactors
- minimizing runtime branching
- typed worker boundaries
- lazy loading only when justified.

Avoid:

- duplicated render loops
- unnecessary state churn
- parallel processing paths doing same work.

---

# Worker + DSP Pipeline Guidance

When working with audio or worker pipelines:

- Ensure structured typed message contracts.
- Avoid runtime dynamic schema assumptions.
- Maintain deterministic input/output flow.

---

# Definition of Done (Exit Criteria)

The agent should consider work complete when:

- Objective implemented end-to-end.
- Native path fully functional.
- Legacy fallback optional only (if still required).
- Build passes.
- No unresolved TODO parity gaps unless documented as Known Gaps.

Agent SHOULD NOT ask for confirmation once done.

---

# Expected Output Structure (Final Response)

1. Summary of changes
2. Files modified
3. Validation result (build status)
4. Manual verification steps
5. Known gaps (if any)

---

# AI Editing Guidance

- Prefer updating existing components over creating new architectural layers.
- If changing offline album/track features, verify:

src/services/offlineDb.ts
src/components/*

- Maintain consistent naming and typing conventions.

---

# Agent Execution Style

Operate like a senior engineer completing a full work order:

- anticipate next steps
- implement subsequent logical tasks automatically
- avoid incremental handholding loops
- avoid asking permission unless Hard Stop triggered.
