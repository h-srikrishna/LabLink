# LabLink — Campus Laboratory Resource-Sharing & Intelligent Scheduling Platform

LabLink is a modern, full-stack campus laboratory resource-sharing platform that empowers students to discover specialised equipment across departments, book time slots, submit project-based access requests, receive faculty approvals, and resolve scheduling conflicts fairly with GenAI-assisted recommendations anchored by authoritative deterministic scheduling.

---

## 1. Problem Statement
College campuses house advanced laboratory equipment, dev kits, and specialized workstations across disparate departmental silos (Robotics, Bioengineering, Chemistry, Electrical Engineering, etc.). Students and researchers frequently encounter:
- **Opaque Discovery**: Inability to easily find specialised equipment or verify real-time availability across other departments.
- **Scheduling Conflicts**: Manual paper or email reservation sheets leading to accidental double-booking of high-demand hardware.
- **Opaque Access Policies**: Lack of structured project-based justification for extended or restricted hardware access.
- **Coordination Friction**: Delays in faculty review and conflict negotiation when multiple capstone projects require the same hardware around tight deadlines.

---

## 2. Solution
LabLink provides a unified campus platform bridging students, faculty, and lab administrators:
- **Cross-Department Discovery**: Search and multi-criteria filter lab hardware by department, category, capabilities, and live availability.
- **Intelligent Slot Booking**: Instant booking for open slots and deterministic conflict detection when slots are occupied.
- **Project-Based Access Requests**: Structured access requests connected to course projects, deadlines, and justification.
- **Faculty Review Queue**: Streamlined faculty workflow to review requests, verify scheduling feasibility, and approve or reject with mandatory reasons.
- **GenAI Conflict Resolution**: AI advisor that ranks real, server-verified feasible alternatives and explains fairness considerations (deadlines, workload, capability match) without ever bypassing deterministic hard constraints.

---

## 3. Key Features
- **Advanced Equipment Discovery**: Search by name, category, department, or capability (e.g. `ROS2 Control`, `HPLC`, `qPCR`) with live unit counts and next-available slot badges.
- **Intelligent Slot Booking & Conflict Detection**: Instant 1–4 hour slot selection with real-time overlap validation and instant server-verified alternative suggestions.
- **Project-Based Access Requests**: Structured student submissions with preferred dates, time windows, and project deadlines.
- **Faculty Approval Workflow**: Faculty review dashboard with urgency indicators, approval state transitions, and automatic provisional booking linkage.
- **GenAI Conflict-Resolution Advisor**: Fair allocation recommendations backed by deterministic scheduling guardrails.
- **Accessibility (a11y)**: Semantic HTML landmarks, keyboard navigation, focus trap modals (`useModalFocusTrap`), ARIA live regions, and screen-reader-friendly form labels.
- **Security Hardening**: CORS origin enforcement (`isAllowedApiOrigin`), strict role-header validation (`x-lablink-role`), payload size limits (64KB), input sanitization, and prompt-injection resistance.

---

## 4. How LabLink Works
1. **Discover**: A student opens LabLink in the `Student` view, searches for equipment (e.g. `UR5e Robotic Arm`), and inspects capabilities, lab location, and live unit availability.
2. **Book / Request**: Clicking **Inspect Details & Book** opens the interactive booking drawer. Selecting an open slot allows instant confirmation or submission for faculty approval.
3. **Conflict Resolution**: If the requested slot is occupied, the deterministic engine detects the conflict and queries the GenAI conflict resolver, which presents ranked, server-verified alternative slots.
4. **Project Access**: Students can also submit structured project access requests for extended window allocation.
5. **Review**: Switching the demo role header to **Faculty** reveals the review queue, where faculty members can inspect project details and approve or reject requests with audit notes.

---

## 5. GenAI Architecture
LabLink uses the official `@google/genai` TypeScript SDK (model: `gemini-4-hydrogen`) to provide fair allocation recommendations:
- **Deterministic Pre-Validation**: The deterministic scheduling engine (`schedulingService.ts`) runs first. If a slot is conflict-free, **Gemini is never called** (`aiStatus: 'not_needed'`).
- **Feasible Alternative Generation**: When a conflict occurs, deterministic code generates the *only* valid conflict-free candidate slots across operational equipment (`feasibleAlternatives`).
- **AI Ranking & Fairness**: Gemini receives only non-sensitive scheduling data (deadlines, capability requirements, and verified alternatives) and outputs a ranked recommendation explaining fairness factors (deadline urgency, disruption minimization).
- **Post-Validation Guardrail (`validateAiAlternativeSelection`)**: The server validates that the AI's chosen alternative exists in the server-generated list and re-verifies hard constraints against live database state. If Gemini hallucinates an occupied slot or outputs unsafe patterns (XSS, script tags, keys), the server rejects the recommendation and falls back safely to deterministic alternatives (`aiStatus: 'unavailable'`).
- **Prompt Injection Defense**: Untrusted user text is stripped of angle brackets and control characters and isolated within `<untrusted_project_context>` XML tags, preventing instruction overrides or data exfiltration.

---

## 6. System Architecture
LabLink is built on a clean, layered full-stack architecture:
- **Frontend**: React 19 SPA powered by Vite, styled with Tailwind CSS v4 and Lucide React icons.
- **Backend**: Express 4 REST API (`server.ts`) with security middleware, CORS policy, and error handlers.
- **Business Logic Services**: Modular services (`bookingWorkflowService.ts`, `schedulingService.ts`, `aiConflictResolver.ts`, `equipmentDiscoveryService.ts`) enforcing business rules and AI guardrails.
- **Repository Data Layer**: Pure data-access modules (`bookingRepository.ts`, `equipmentRepository.ts`, `projectRequestRepository.ts`) using defensive cloning without direct network or SQL sinks.
- **Store**: In-memory ephemeral demo store (`store.ts`) seeded with realistic campus laboratory fixtures.

---

## 7. User Roles
LabLink features a zero-login MVP demo experience using the `x-lablink-role` request header (`student`, `faculty`, `admin`) to simulate multi-role workflows:
- **Student**: Discover equipment, search catalog, check slot availability, book slots, submit project access requests, and track request statuses.
- **Faculty**: Review student project access requests, inspect project justifications and deadline urgency, and approve or reject with mandatory audit reasons.
- **Admin**: Monitor campus-wide 48-hour utilization metrics, toggle equipment operational status (available, maintenance, restricted), adjust faculty approval policies, and register new lab equipment.

---

## 8. Security
LabLink implements robust security measures:
- **Role Enforcement**: `x-lablink-role` headers are strictly validated; unauthorized attempts to perform admin or faculty actions return `403 FORBIDDEN_ROLE`.
- **Input Validation**: Strict type checking, whole-hour time parsing, ISO date validation (`YYYY-MM-DD`), and string length caps prevent injection and malformed payloads.
- **Payload & Error Protection**: JSON body parsing is capped at 64KB (`413 PAYLOAD_TOO_LARGE`), and error handlers suppress internal stack traces (`500 INTERNAL_ERROR`).
- **CORS Policy**: Restricts cross-origin API calls to same-origin, local loopback, and paired Cloud Run preview hosts (`ais-dev-*` / `ais-pre-*`).
- **Intentional MVP Limitation**: The `x-lablink-role` demo header is an intentional no-login MVP mechanism for hackathon evaluation and does not constitute production authentication.

---

## 9. Accessibility (a11y)
- **Semantic Structure**: Proper HTML5 landmarks (`<main>`, `<nav>`, `<header>`, `<articles>`) and explicit heading hierarchy (`<h1>` to `<h3>`).
- **Keyboard Navigation & Focus Traps**: Full keyboard accessibility with `useModalFocusTrap` managing focus inside drawers and modals, supporting `Escape` to close and `Tab` wrapping.
- **ARIA & Labels**: All form inputs, selects, and textareas are explicitly associated with `<label>` elements or `aria-label`/`aria-labelledby` attributes. Status elements use `role="status"` and `aria-live="polite"`.
- **Non-Color Indicators**: Status badges combine descriptive text labels with symbols (`●`, `▲`, `✖`) to ensure clarity for users with color vision deficiencies.

---

## 10. Automated Testing
LabLink includes an extensive automated test suite (`78 tests across 8 test suites`) covering equipment discovery, deterministic scheduling, slot booking, project requests, faculty approval workflows, GenAI guardrails, security hardening, and accessibility.

Run tests with:
```bash
npm test
```

---

## 11. Setup & Local Development

### Prerequisites
- Node.js (v18+)
- npm or bun

### Installation & Commands
1. **Install dependencies**:
   ```bash
   npm install
   ```

2. **Run development server** (Express API + Vite middleware on port 3000):
   ```bash
   npm run dev
   ```

3. **Run automated tests**:
   ```bash
   npm test
   ```

4. **Type-check code**:
   ```bash
   npm run lint
   ```

5. **Build for production**:
   ```bash
   npm run build
   ```

---

## 12. Environment Variables
- `GEMINI_API_KEY`: Server-side API key for Google GenAI calls. Automatically injected by AI Studio at runtime from user secrets.
- `APP_URL` / `SHARED_APP_URL`: Hosting URLs used by the server for self-referential links and CORS origin verification.

---

## 13. API Overview
- `GET /api/health` — Check service health and AI configuration status.
- `GET /api/state` — Retrieve full application state snapshot (equipment, bookings, project requests, utilization).
- `POST /api/demo/reset` — Reset ephemeral demo store to initial seed state.
- `GET /api/equipment` — Discover equipment with query, department, category, and availability filters.
- `POST /api/equipment` — Register new equipment (Admin role).
- `PATCH /api/equipment/:id` — Update equipment status or approval policy (Admin role).
- `GET /api/bookings` — List bookings with optional equipment, date, and status filters.
- `GET /api/bookings/availability` — Check time slot availability and obtain alternative slots.
- `POST /api/bookings` — Create a student booking.
- `PATCH /api/bookings/:id/cancel` — Cancel an active booking.
- `GET /api/project-requests` — List project access requests.
- `GET /api/project-requests/:id` — Retrieve project request details and linked booking.
- `POST /api/project-requests` — Submit a project-based access request.
- `POST /api/project-requests/:id/approve` — Approve project request (Faculty role).
- `POST /api/project-requests/:id/reject` — Reject project request with reason (Faculty role).
- `POST /api/ai/resolve-conflict` — GenAI scheduling conflict resolution and alternative slot ranking.

---

## 14. Data and Persistence
LabLink uses an in-memory ephemeral demo store (`store.ts`) seeded with campus resources for rapid hackathon evaluation. Data does not persist across server container restarts. A dedicated reset endpoint (`POST /api/demo/reset`) restores initial seed state. The repository pattern allows swapping in a persistent database (e.g. PostgreSQL/Cloud SQL) without modifying business logic or UI components.

---

## 15. Project Structure
```text
├── server.ts                  # Express server entry point & API route handlers
├── src/
│   ├── App.tsx                # Root React component & demo role state
│   ├── client/
│   │   ├── api.ts             # Typed API client
│   │   └── useModalFocusTrap.ts # Accessible modal focus management hook
│   ├── components/
│   │   ├── AdminConsoleView.tsx # Admin resource & utilization console
│   │   ├── BookingDrawer.tsx    # Interactive booking & AI conflict resolver drawer
│   │   ├── EquipmentCatalog.tsx # Equipment discovery, search & filter view
│   │   ├── EquipmentImage.tsx   # Safe equipment image renderer
│   │   ├── FacultyReviewView.tsx# Faculty project request review queue
│   │   ├── StudentScheduleView.tsx# Student bookings & access request management
│   │   └── TopBar.tsx           # Navigation bar & demo role switcher
│   ├── shared/
│   │   ├── equipmentFilter.ts # Shared equipment search/filter utilities
│   │   └── types.ts           # Shared TypeScript interfaces
│   └── server/
│       ├── data/
│       │   ├── seedData.ts    # Initial demo fixtures
│       │   └── store.ts       # Ephemeral in-memory store
│       ├── repositories/      # Pure data-access modules
│       ├── services/          # Business logic, scheduling & AI resolvers
│       └── __tests__/         # Automated test suites (78 tests)
```
