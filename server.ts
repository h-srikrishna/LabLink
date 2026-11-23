import 'dotenv/config';
import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import type { LabLinkStateSnapshot, UserRole } from './src/shared/types.js';
import { formatIsoDateOffset } from './src/server/data/seedData.js';
import { resetDemoStore } from './src/server/data/store.js';
import { getBookings } from './src/server/repositories/bookingRepository.js';
import { getEquipment } from './src/server/repositories/equipmentRepository.js';
import { getProjectRequests } from './src/server/repositories/projectRequestRepository.js';
import {
  clearAiConflictCache,
  resolveSchedulingConflict,
} from './src/server/services/aiConflictResolver.js';
import {
  AppServiceError,
  approveProjectRequest,
  cancelStudentBooking,
  checkSlotAvailability,
  createAdminEquipment,
  createStudentBooking,
  getProjectRequestDetails,
  listBookings,
  listProjectRequests,
  rejectProjectRequest,
  reviewProjectRequest,
  submitProjectRequest,
  updateAdminEquipment,
} from './src/server/services/bookingWorkflowService.js';
import { discoverEquipment } from './src/server/services/equipmentDiscoveryService.js';
import { calculateEquipmentUtilization } from './src/server/services/schedulingService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function buildStateSnapshot(): LabLinkStateSnapshot {
  const today = formatIsoDateOffset(0);
  const tomorrow = formatIsoDateOffset(1);
  const equipment = getEquipment();
  const bookings = getBookings();
  const projectRequests = listProjectRequests();
  const utilization = calculateEquipmentUtilization(equipment, bookings, projectRequests, [
    today,
    tomorrow,
  ]);

  return {
    today,
    tomorrow,
    equipment,
    bookings,
    projectRequests,
    utilization,
  };
}

function getRequestRole(req: Request): UserRole {
  const raw = req.header('x-lablink-role');
  if (raw === undefined) {
    return 'student';
  }
  const normalized = raw.trim().toLowerCase();
  if (normalized === 'faculty' || normalized === 'admin' || normalized === 'student') {
    return normalized;
  }
  throw new AppServiceError(
    403,
    'FORBIDDEN_ROLE',
    'Invalid demo role header. Allowed roles are student, faculty, or admin.',
  );
}

function validateDemoRoleHeader(req: Request, _res: Response, next: NextFunction) {
  try {
    getRequestRole(req);
    next();
  } catch (err) {
    next(err);
  }
}

function requireRole(allowed: UserRole[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    try {
      const role = getRequestRole(req);
      if (!allowed.includes(role)) {
        next(
          new AppServiceError(
            403,
            'FORBIDDEN_ROLE',
            `This action requires ${allowed.join(' or ')} permissions.`,
          ),
        );
        return;
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

function normalizeHostHeader(hostValue: string | undefined): string {
  if (!hostValue) return '';
  return hostValue.trim().toLowerCase().replace(/:(80|443)$/, '');
}

function isAllowedApiOrigin(originHeader: string, req: Request): boolean {
  let parsedOrigin: URL;
  try {
    parsedOrigin = new URL(originHeader);
  } catch {
    return false;
  }

  if (parsedOrigin.protocol !== 'http:' && parsedOrigin.protocol !== 'https:') {
    return false;
  }

  // Browsers forbid JS from spoofing Sec-Fetch-Site; same-origin is always trusted
  const fetchSite = req.header('sec-fetch-site')?.trim().toLowerCase();
  if (fetchSite === 'same-origin') {
    return true;
  }

  const originHost = normalizeHostHeader(parsedOrigin.host);
  const forwardedHost = normalizeHostHeader(req.header('x-forwarded-host')?.split(',')[0]);
  const requestHost = normalizeHostHeader(req.header('host'));
  if ((forwardedHost && originHost === forwardedHost) || (requestHost && originHost === requestHost)) {
    return true;
  }

  if (parsedOrigin.hostname === 'localhost' || parsedOrigin.hostname === '127.0.0.1') {
    return true;
  }

  const candidateEnvUrls = [process.env.APP_URL, process.env.SHARED_APP_URL];
  for (const rawEnvUrl of candidateEnvUrls) {
    const trimmed = rawEnvUrl?.trim();
    if (!trimmed) continue;
    try {
      const envUrl = new URL(trimmed);
      if (parsedOrigin.origin === envUrl.origin) {
        return true;
      }
      // Allow paired Cloud Run Shared App URL (ais-pre-*) and Dev URL (ais-dev-*) for this applet
      if (
        envUrl.hostname.startsWith('ais-dev-') ||
        envUrl.hostname.startsWith('ais-pre-')
      ) {
        const twinHost = envUrl.hostname.startsWith('ais-dev-')
          ? envUrl.hostname.replace(/^ais-dev-/, 'ais-pre-')
          : envUrl.hostname.replace(/^ais-pre-/, 'ais-dev-');
        if (parsedOrigin.hostname === twinHost && parsedOrigin.protocol === envUrl.protocol) {
          return true;
        }
      }
    } catch {
      // Ignore malformed env URL
    }
  }

  return false;
}

function assertPlainObjectBody(body: unknown): Record<string, unknown> {
  if (body === undefined) {
    return {};
  }
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    throw new AppServiceError(400, 'VALIDATION_ERROR', 'Request body must be a JSON object.');
  }
  return body as Record<string, unknown>;
}

function getOptionalStringField(
  obj: Record<string, unknown>,
  key: string,
  fieldName: string,
): string | undefined {
  const val = obj[key];
  if (val === undefined) return undefined;
  if (typeof val !== 'string') {
    throw new AppServiceError(400, 'VALIDATION_ERROR', `${fieldName} must be text.`);
  }
  return val;
}

export function createApp() {
  const app = express();
  app.disable('x-powered-by');

  app.use(express.json({ limit: '64kb' }));
  app.use((_req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    next();
  });

  app.use('/api', (req, res, next) => {
    const origin = req.header('origin');
    if (origin) {
      if (!isAllowedApiOrigin(origin, req)) {
        res.status(403).json({
          error: 'Cross-origin request blocked by LabLink API policy.',
          code: 'FORBIDDEN_ORIGIN',
        });
        return;
      }
      res.setHeader('Vary', 'Origin');
      res.setHeader('Access-Control-Allow-Origin', origin);
      res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, OPTIONS');
      res.setHeader('Access-Control-Allow-Headers', 'Content-Type, x-lablink-role');
    }

    if (req.method === 'OPTIONS') {
      res.status(204).end();
      return;
    }

    next();
  });

  app.use('/api', validateDemoRoleHeader);

  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      service: 'lablink',
      aiConfigured: Boolean(process.env.GEMINI_API_KEY?.trim()),
      persistence: 'ephemeral-in-memory-demo',
    });
  });

  app.get('/api/state', (_req, res) => {
    res.json(buildStateSnapshot());
  });

  app.post('/api/demo/reset', (_req, res) => {
    resetDemoStore();
    clearAiConflictCache();
    res.json(buildStateSnapshot());
  });

  app.get('/api/equipment', (req, res, next) => {
    try {
      const result = discoverEquipment({
        q: req.query.q,
        department: req.query.department,
        category: req.query.category,
        availability: req.query.availability,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/equipment', requireRole(['admin']), (req, res, next) => {
    try {
      const created = createAdminEquipment(req.body);
      res.status(201).json({ equipment: created, state: buildStateSnapshot() });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/equipment/:id', requireRole(['admin']), (req, res, next) => {
    try {
      const updated = updateAdminEquipment(req.params.id, req.body);
      res.json({ equipment: updated, state: buildStateSnapshot() });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/bookings', (req, res, next) => {
    try {
      const bookings = listBookings({
        equipmentId: req.query.equipmentId,
        date: req.query.date,
        status: req.query.status,
      });
      res.json({ bookings });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/bookings/availability', (req, res, next) => {
    try {
      const result = checkSlotAvailability({
        equipmentId: req.query.equipmentId,
        date: req.query.date,
        startHour: req.query.startHour,
        endHour: req.query.endHour,
      });
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/bookings', (req, res, next) => {
    try {
      const result = createStudentBooking(req.body);
      res.status(201).json({ ...result, state: buildStateSnapshot() });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/bookings/:id/cancel', (req, res, next) => {
    try {
      const booking = cancelStudentBooking(req.params.id);
      res.json({ booking, state: buildStateSnapshot() });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/project-requests', (req, res, next) => {
    try {
      const projectRequests = listProjectRequests({
        status: req.query.status,
        equipmentId: req.query.equipmentId,
      });
      res.json({ projectRequests });
    } catch (err) {
      next(err);
    }
  });

  app.get('/api/project-requests/:id', (req, res, next) => {
    try {
      const result = getProjectRequestDetails(req.params.id);
      res.json(result);
    } catch (err) {
      next(err);
    }
  });

  app.post('/api/project-requests', (req, res, next) => {
    try {
      const result = submitProjectRequest(req.body);
      res.status(201).json({ ...result, state: buildStateSnapshot() });
    } catch (err) {
      next(err);
    }
  });

  app.patch('/api/project-requests/:id/review', requireRole(['faculty']), (req, res, next) => {
    try {
      const body = assertPlainObjectBody(req.body);
      const decision = body.decision;
      if (decision !== 'approved' && decision !== 'rejected') {
        throw new AppServiceError(400, 'VALIDATION_ERROR', 'Decision must be "approved" or "rejected".');
      }
      const rawReviewer = getOptionalStringField(body, 'facultyReviewer', 'Faculty reviewer');
      const facultyReviewer = rawReviewer && rawReviewer.trim() ? rawReviewer : 'Dr. Aris Thorne';
      const decisionNote = getOptionalStringField(body, 'facultyDecisionNote', 'Faculty decision note');
      const reason = getOptionalStringField(body, 'reason', 'Rejection reason');
      const noteOrReason = decisionNote !== undefined ? decisionNote : reason;

      const result = reviewProjectRequest(
        req.params.id,
        decision,
        facultyReviewer,
        noteOrReason,
      );
      res.json({ ...result, state: buildStateSnapshot() });
    } catch (err) {
      next(err);
    }
  });

  const handleApproveRoute = (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = assertPlainObjectBody(req.body);
      const rawReviewer = getOptionalStringField(body, 'facultyReviewer', 'Faculty reviewer');
      const facultyReviewer = rawReviewer && rawReviewer.trim() ? rawReviewer : 'Dr. Aris Thorne';
      const decisionNote = getOptionalStringField(body, 'facultyDecisionNote', 'Faculty decision note');
      const fallbackNote = getOptionalStringField(body, 'note', 'Faculty note');
      const note = decisionNote !== undefined ? decisionNote : fallbackNote;

      const result = approveProjectRequest(req.params.id, facultyReviewer, note);
      res.json({ ...result, state: buildStateSnapshot() });
    } catch (err) {
      next(err);
    }
  };

  const handleRejectRoute = (req: Request, res: Response, next: NextFunction) => {
    try {
      const body = assertPlainObjectBody(req.body);
      const rawReviewer = getOptionalStringField(body, 'facultyReviewer', 'Faculty reviewer');
      const facultyReviewer = rawReviewer && rawReviewer.trim() ? rawReviewer : 'Dr. Aris Thorne';
      const rawReason = getOptionalStringField(body, 'reason', 'Rejection reason');
      const fallbackNote = getOptionalStringField(body, 'facultyDecisionNote', 'Rejection reason');
      const reason = rawReason !== undefined ? rawReason : (fallbackNote ?? '');

      const result = rejectProjectRequest(req.params.id, facultyReviewer, reason);
      res.json({ ...result, state: buildStateSnapshot() });
    } catch (err) {
      next(err);
    }
  };

  app.post('/api/project-requests/:id/approve', requireRole(['faculty']), handleApproveRoute);
  app.patch('/api/project-requests/:id/approve', requireRole(['faculty']), handleApproveRoute);
  app.post('/api/project-requests/:id/reject', requireRole(['faculty']), handleRejectRoute);
  app.patch('/api/project-requests/:id/reject', requireRole(['faculty']), handleRejectRoute);

  app.post('/api/ai/resolve-conflict', async (req, res, next) => {
    try {
      const resolution = await resolveSchedulingConflict(req.body);
      res.json(resolution);
    } catch (err) {
      next(err);
    }
  });

  // Ensure unknown /api/* endpoints return JSON 404 instead of SPA HTML
  app.use('/api', (_req, res) => {
    res.status(404).json({
      error: 'API endpoint not found.',
      code: 'NOT_FOUND',
    });
  });

  // Centralized sanitized API error handler (never leaks stack traces or env internals)
  app.use((err: unknown, req: Request, res: Response, next: NextFunction) => {
    if (!req.path.startsWith('/api/')) {
      next(err);
      return;
    }

    if (err instanceof AppServiceError) {
      res.status(err.statusCode).json({
        error: err.message,
        code: err.code,
        ...(err.details ? { details: err.details } : {}),
      });
      return;
    }

    const bodyParserErr = err as { type?: string; status?: number; statusCode?: number } | undefined;
    if (bodyParserErr?.type === 'entity.too.large' || bodyParserErr?.status === 413) {
      res.status(413).json({
        error: 'Request payload exceeds the 64 KB limit.',
        code: 'PAYLOAD_TOO_LARGE',
      });
      return;
    }

    if (
      bodyParserErr?.type === 'entity.parse.failed' ||
      (err instanceof SyntaxError && bodyParserErr?.status === 400)
    ) {
      res.status(400).json({
        error: 'Malformed JSON request body.',
        code: 'VALIDATION_ERROR',
      });
      return;
    }

    res.status(500).json({
      error: 'An unexpected server error occurred while processing the request.',
      code: 'INTERNAL_ERROR',
    });
  });

  return app;
}

async function startServer() {
  const app = createApp();
  const port = Number(process.env.PORT) || 3000;

  if (process.env.NODE_ENV !== 'production') {
    const { createServer: createViteServer } = await import('vite');
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distDir = path.resolve(__dirname, 'dist');
    app.use(express.static(distDir));
    app.get('*', (_req, res) => {
      res.sendFile(path.join(distDir, 'index.html'));
    });
  }

  app.listen(port, '0.0.0.0', () => {
    console.log(`LabLink server listening on http://0.0.0.0:${port}`);
  });
}

const isDirectRun =
  process.argv[1] && path.resolve(process.argv[1]) === path.resolve(__filename);
if (isDirectRun) {
  startServer().catch((err) => {
    const safeMessage = err instanceof Error ? err.message : 'Unexpected startup error';
    console.error(`Failed to start LabLink server: ${safeMessage}`);
    process.exit(1);
  });
}
