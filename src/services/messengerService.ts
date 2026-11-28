import { EventEmitter } from 'events';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { logger } from '@/utils/logger';

// Global Event Emitter and TTL caches anchored on globalThis so
// separate Next.js App Router route chunks share the exact same instances.
class MessengerEventEmitter extends EventEmitter {}

interface CachedUserEntry {
  value: UserSummary;
  expiresAt: number;
}

const USER_DETAILS_CACHE_TTL_MS = 5 * 60 * 1000; // 5 minutes
const USER_DETAILS_CACHE_MAX = 1000;
const PROGRAM_GC_SYNC_TTL_MS = 60 * 1000; // 60 seconds

const globalForMessenger = globalThis as typeof globalThis & {
  __bmdcMessengerEvents?: MessengerEventEmitter;
  __bmdcUserDetailsCache?: Map<string, CachedUserEntry>;
  __bmdcProgramGcSyncCache?: Map<string, number>;
  __bmdcProgramGcSyncInFlight?: Map<string, Promise<void>>;
};

export const messengerEvents =
  globalForMessenger.__bmdcMessengerEvents ??
  (globalForMessenger.__bmdcMessengerEvents = new MessengerEventEmitter());
messengerEvents.setMaxListeners(200);

const userDetailsCache =
  globalForMessenger.__bmdcUserDetailsCache ??
  (globalForMessenger.__bmdcUserDetailsCache = new Map<string, CachedUserEntry>());

const programGcSyncCache =
  globalForMessenger.__bmdcProgramGcSyncCache ??
  (globalForMessenger.__bmdcProgramGcSyncCache = new Map<string, number>());

const programGcSyncInFlight =
  globalForMessenger.__bmdcProgramGcSyncInFlight ??
  (globalForMessenger.__bmdcProgramGcSyncInFlight = new Map<string, Promise<void>>());

/**
 * Clear in-memory Messenger TTL caches (used by explicit ?sync=1 refreshes and tests).
 */
export function clearMessengerCaches(): void {
  userDetailsCache.clear();
  programGcSyncCache.clear();
  programGcSyncInFlight.clear();
}

export const DEFAULT_BMDC_TENANT_ID = '194876de-a68c-4d33-8f80-c0978e5d44b3';
const UUID_REGEX = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const STAFF_ROLES = [
  'local_admin',
  'staff_training_coordinator',
  'staff_inventory_manager',
] as const;

export const ALL_STAFF_AND_ADMIN_ROLES = [...STAFF_ROLES, 'super_admin'] as const;

export const ACTIVE_ENROLLMENT_STATUSES = [
  'enrolled',
  'approved',
  'active',
  'completed',
  'in_progress',
] as const;

export const APPROVED_REGISTRATION_STATUSES = ['completed', 'approved'] as const;

export class MessengerError extends Error {
  statusCode: number;

  constructor(message: string, statusCode: number = 400) {
    super(message);
    this.name = 'MessengerError';
    this.statusCode = statusCode;
  }
}

export function isValidUuid(value?: string | null): value is string {
  return Boolean(value && UUID_REGEX.test(value));
}

export function resolveTenantId(tenantId?: string | null): string {
  if (isValidUuid(tenantId)) {
    return tenantId;
  }
  return DEFAULT_BMDC_TENANT_ID;
}

function normalizeEmail(email?: string | null): string {
  return String(email || '').trim().toLowerCase();
}

function chunkArray<T>(items: T[], chunkSize: number = 200): T[][] {
  if (items.length === 0) return [];
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += chunkSize) {
    chunks.push(items.slice(i, i + chunkSize));
  }
  return chunks;
}

function setCachedUserSummary(id: string, summary: UserSummary): void {
  if (userDetailsCache.size >= USER_DETAILS_CACHE_MAX && !userDetailsCache.has(id)) {
    const oldestKey = userDetailsCache.keys().next().value;
    if (oldestKey !== undefined) {
      userDetailsCache.delete(oldestKey);
    }
  }
  userDetailsCache.set(id, {
    value: summary,
    expiresAt: Date.now() + USER_DETAILS_CACHE_TTL_MS,
  });
}

export interface MessageAttachment {
  url: string;
  type: 'image' | 'file';
  name: string;
}

export interface UserSummary {
  id: string;
  name: string;
  email: string;
  role: string;
  avatar?: string;
}

interface BasicUserRecord {
  id: string;
  email: string;
  username: string;
  role: string;
}

interface TraineeRecord {
  id: string;
  user_id?: string | null;
  first_name: string;
  last_name: string;
  email: string;
  photo_path?: string | null;
  thumbnail_path?: string | null;
  registration_status?: string | null;
  status?: string | null;
  deleted_at?: string | null;
  tenant_id?: string | null;
}

interface InstructorRecord {
  first_name: string;
  last_name: string;
  email: string;
  photo_path?: string | null;
}

function isActiveApprovedTrainee(trainee?: TraineeRecord | null): boolean {
  if (!trainee) return false;
  if (trainee.deleted_at) return false;
  if (
    trainee.registration_status &&
    !APPROVED_REGISTRATION_STATUSES.includes(
      trainee.registration_status as (typeof APPROVED_REGISTRATION_STATUSES)[number]
    )
  ) {
    return false;
  }
  return true;
}

function pickPreferredTrainee(current: TraineeRecord | undefined, candidate: TraineeRecord): TraineeRecord {
  if (!current) return candidate;
  const currentOk = isActiveApprovedTrainee(current);
  const candidateOk = isActiveApprovedTrainee(candidate);
  if (!currentOk && candidateOk) return candidate;
  return current;
}

/**
 * Resolves trainee records for a batch of trainee users across all 3 link paths:
 * 1. trainee_accounts (primary normalized link)
 * 2. trainees.user_id (legacy / post-approval column)
 * 3. case-insensitive trainees.email fallback
 */
export async function resolveTraineesForUsers(
  users: Pick<BasicUserRecord, 'id' | 'email' | 'role'>[]
): Promise<Map<string, TraineeRecord>> {
  const traineeUsers = users.filter((u) => u.role === 'trainee');
  const traineeByUserId = new Map<string, TraineeRecord>();
  if (traineeUsers.length === 0) return traineeByUserId;

  const traineeSelect =
    'id, user_id, first_name, last_name, email, photo_path, thumbnail_path, registration_status, status, deleted_at, tenant_id';

  // Stage 1: trainee_accounts join
  const allTraineeUserIds = traineeUsers.map((u) => u.id);
  for (const idChunk of chunkArray(allTraineeUserIds)) {
    const { data: accountLinks } = await supabaseAdmin
      .from('trainee_accounts')
      .select(`user_id, trainee_id, trainees(${traineeSelect})`)
      .in('user_id', idChunk);

    for (const row of accountLinks || []) {
      const joined = Array.isArray((row as any).trainees)
        ? (row as any).trainees[0]
        : (row as any).trainees;
      if (joined && row.user_id) {
        traineeByUserId.set(
          row.user_id,
          pickPreferredTrainee(traineeByUserId.get(row.user_id), joined as TraineeRecord)
        );
      }
    }
  }

  // Stage 2: direct trainees.user_id fallback
  const unmappedAfterStage1 = traineeUsers.filter((u) => !traineeByUserId.has(u.id));
  if (unmappedAfterStage1.length > 0) {
    for (const idChunk of chunkArray(unmappedAfterStage1.map((u) => u.id))) {
      const { data: directTrainees } = await supabaseAdmin
        .from('trainees')
        .select(traineeSelect)
        .in('user_id', idChunk);

      for (const t of (directTrainees || []) as TraineeRecord[]) {
        if (t.user_id) {
          traineeByUserId.set(
            t.user_id,
            pickPreferredTrainee(traineeByUserId.get(t.user_id), t)
          );
        }
      }
    }
  }

  // Stage 3: case-insensitive email fallback
  const unmappedAfterStage2 = traineeUsers.filter(
    (u) => !traineeByUserId.has(u.id) && normalizeEmail(u.email)
  );
  if (unmappedAfterStage2.length > 0) {
    const emailCandidates = Array.from(
      new Set(
        unmappedAfterStage2.flatMap((u) => {
          const raw = String(u.email || '').trim();
          const lower = normalizeEmail(u.email);
          return raw && raw !== lower ? [raw, lower] : [lower];
        })
      )
    );

    const traineeByEmail = new Map<string, TraineeRecord>();
    for (const emailChunk of chunkArray(emailCandidates)) {
      const { data: emailTrainees } = await supabaseAdmin
        .from('trainees')
        .select(traineeSelect)
        .in('email', emailChunk);

      for (const t of (emailTrainees || []) as TraineeRecord[]) {
        const key = normalizeEmail(t.email);
        if (key) {
          traineeByEmail.set(key, pickPreferredTrainee(traineeByEmail.get(key), t));
        }
      }
    }

    for (const u of unmappedAfterStage2) {
      const targetEmail = normalizeEmail(u.email);
      let matched = traineeByEmail.get(targetEmail);
      if (!matched) {
        const { data: ilikeMatches } = await supabaseAdmin
          .from('trainees')
          .select(traineeSelect)
          .ilike('email', targetEmail);
        for (const t of (ilikeMatches || []) as TraineeRecord[]) {
          if (normalizeEmail(t.email) === targetEmail) {
            matched = pickPreferredTrainee(matched, t);
          }
        }
      }
      if (matched) {
        traineeByUserId.set(u.id, matched);
      }
    }
  }

  return traineeByUserId;
}

/**
 * Resolves display name and avatar for a given list of user IDs with a 5-minute TTL cache.
 */
export async function resolveUserDetails(
  userIds: string[],
  options?: { bypassCache?: boolean }
): Promise<Record<string, UserSummary>> {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueIds.length === 0) return {};

  const userMap: Record<string, UserSummary> = {};
  const missingIds: string[] = [];
  const now = Date.now();

  if (options?.bypassCache) {
    missingIds.push(...uniqueIds);
  } else {
    for (const id of uniqueIds) {
      const cached = userDetailsCache.get(id);
      if (cached && cached.expiresAt > now) {
        userMap[id] = cached.value;
      } else {
        if (cached) userDetailsCache.delete(id);
        missingIds.push(id);
      }
    }
  }

  if (missingIds.length === 0) {
    return userMap;
  }

  try {
    const users: BasicUserRecord[] = [];
    for (const idChunk of chunkArray(missingIds)) {
      const { data } = await supabaseAdmin
        .from('users')
        .select('id, email, username, role')
        .in('id', idChunk);
      if (data) users.push(...(data as BasicUserRecord[]));
    }

    if (users.length === 0) return userMap;

    const hasNonTraineeUsers = users.some((u) => u.role !== 'trainee' && u.email);
    const [traineeMap, instructorsResult] = await Promise.all([
      resolveTraineesForUsers(users),
      hasNonTraineeUsers
        ? supabaseAdmin.from('instructors').select('first_name, last_name, email, photo_path')
        : Promise.resolve({ data: [] as InstructorRecord[] }),
    ]);

    const instructorMap = new Map<string, InstructorRecord>();
    for (const inst of ((instructorsResult as any)?.data || []) as InstructorRecord[]) {
      const key = normalizeEmail(inst.email);
      if (key) instructorMap.set(key, inst);
    }

    for (const u of users) {
      let displayName = u.username || (u.email ? u.email.split('@')[0] : 'User');
      let avatar: string | undefined;

      const trainee = traineeMap.get(u.id);
      if (trainee && trainee.first_name) {
        displayName = `${trainee.first_name} ${trainee.last_name || ''}`.trim();
        avatar = trainee.thumbnail_path || trainee.photo_path || undefined;
      } else {
        const instructor = instructorMap.get(normalizeEmail(u.email));
        if (instructor && instructor.first_name) {
          displayName = `${instructor.first_name} ${instructor.last_name || ''}`.trim();
          avatar = instructor.photo_path || undefined;
        } else if (u.role === 'super_admin') {
          displayName = 'Super Admin';
        } else if (u.role === 'local_admin') {
          displayName = 'Local Admin';
        } else if (u.role === 'staff_training_coordinator') {
          displayName = u.username ? `${u.username} (Coordinator)` : 'Training Coordinator';
        } else if (u.role === 'staff_inventory_manager') {
          displayName = u.username?.startsWith('admin_user_')
            ? `Inventory Staff (#${u.username.slice(-4)})`
            : (u.username || 'Inventory Staff');
        }
      }

      const summary: UserSummary = {
        id: u.id,
        name: displayName || 'User',
        email: u.email,
        role: u.role,
        avatar,
      };
      userMap[u.id] = summary;
      setCachedUserSummary(u.id, summary);
    }
  } catch (error) {
    logger.error('Failed to resolve user details', { error });
  }

  return userMap;
}

async function fetchUsersByIds(userIds: string[]): Promise<BasicUserRecord[]> {
  const uniqueIds = Array.from(new Set(userIds.filter(Boolean)));
  if (uniqueIds.length === 0) return [];
  const rows: BasicUserRecord[] = [];
  for (const idChunk of chunkArray(uniqueIds)) {
    const { data, error } = await supabaseAdmin
      .from('users')
      .select('id, email, username, role')
      .in('id', idChunk);
    if (error) throw error;
    if (data) rows.push(...(data as BasicUserRecord[]));
  }
  return rows;
}

async function fetchSuperAdminUsers(): Promise<BasicUserRecord[]> {
  const { data, error } = await supabaseAdmin
    .from('users')
    .select('id, email, username, role')
    .eq('role', 'super_admin');
  if (error) throw error;
  return (data || []) as BasicUserRecord[];
}

async function fetchTenantMemberUserIds(tenantId: string): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('users_tenants')
    .select('user_id')
    .eq('tenant_id', tenantId);
  if (error) throw error;
  return Array.from(new Set((data || []).map((r: any) => r.user_id).filter(Boolean)));
}

async function fetchActiveTenantIds(): Promise<string[]> {
  const { data, error } = await supabaseAdmin
    .from('tenants')
    .select('id')
    .eq('status', 'active');
  if (error) throw error;
  return (data || []).map((t: any) => t.id).filter(Boolean);
}

/**
 * Batch-resolve enrolled active/approved trainee user IDs for a set of programs in minimal queries.
 */
async function fetchEnrolledTraineeUserIdsByProgram(
  programs: Array<{ id: string; tenant_id: string }>
): Promise<Map<string, string[]>> {
  const result = new Map<string, string[]>();
  for (const prog of programs) {
    result.set(prog.id, []);
  }
  if (programs.length === 0) return result;

  const programIds = programs.map((p) => p.id);
  const programTenantMap = new Map(programs.map((p) => [p.id, resolveTenantId(p.tenant_id)]));

  // 1. Batch-fetch all non-dropped enrollments across target programs
  const enrollments: Array<{ program_id: string; trainee_id: string }> = [];
  for (const progChunk of chunkArray(programIds)) {
    const { data, error } = await supabaseAdmin
      .from('enrollments')
      .select('program_id, trainee_id')
      .in('program_id', progChunk)
      .in('status', [...ACTIVE_ENROLLMENT_STATUSES]);
    if (error) throw error;
    if (data) enrollments.push(...(data as Array<{ program_id: string; trainee_id: string }>));
  }

  const allTraineeIds = Array.from(
    new Set(enrollments.map((e) => e.trainee_id).filter(Boolean))
  );
  if (allTraineeIds.length === 0) return result;

  // 2. Batch-fetch trainees and trainee_accounts in parallel
  const [traineesList, accountLinks] = await Promise.all([
    (async () => {
      const list: TraineeRecord[] = [];
      for (const idChunk of chunkArray(allTraineeIds)) {
        const { data, error } = await supabaseAdmin
          .from('trainees')
          .select('id, user_id, first_name, last_name, email, registration_status, status, deleted_at, tenant_id')
          .in('id', idChunk);
        if (error) throw error;
        if (data) list.push(...(data as TraineeRecord[]));
      }
      return list;
    })(),
    (async () => {
      const list: Array<{ trainee_id: string; user_id: string }> = [];
      for (const idChunk of chunkArray(allTraineeIds)) {
        const { data, error } = await supabaseAdmin
          .from('trainee_accounts')
          .select('trainee_id, user_id')
          .in('trainee_id', idChunk);
        if (error) throw error;
        if (data) list.push(...(data as Array<{ trainee_id: string; user_id: string }>));
      }
      return list;
    })(),
  ]);

  const traineeById = new Map<string, TraineeRecord>();
  const activeTrainees: TraineeRecord[] = [];
  for (const t of traineesList) {
    if (isActiveApprovedTrainee(t)) {
      traineeById.set(t.id, t);
      activeTrainees.push(t);
    }
  }

  const userIdByTraineeId = new Map<string, string>();
  for (const link of accountLinks) {
    if (link.trainee_id && link.user_id) {
      userIdByTraineeId.set(link.trainee_id, link.user_id);
    }
  }

  const stillMissingEmailLookup: TraineeRecord[] = [];
  for (const t of activeTrainees) {
    if (userIdByTraineeId.has(t.id)) continue;
    if (t.user_id) {
      userIdByTraineeId.set(t.id, t.user_id);
    } else if (normalizeEmail(t.email)) {
      stillMissingEmailLookup.push(t);
    }
  }

  // Stage 3: case-insensitive email fallback for any remaining active trainees
  if (stillMissingEmailLookup.length > 0) {
    const candidateEmails = Array.from(
      new Set(
        stillMissingEmailLookup.flatMap((t) => {
          const raw = String(t.email || '').trim();
          const lower = normalizeEmail(t.email);
          return raw && raw !== lower ? [raw, lower] : [lower];
        })
      )
    );

    const userIdByEmail = new Map<string, string>();
    for (const emailChunk of chunkArray(candidateEmails)) {
      const { data: matchedUsers, error: userErr } = await supabaseAdmin
        .from('users')
        .select('id, email')
        .eq('role', 'trainee')
        .in('email', emailChunk);
      if (userErr) throw userErr;
      for (const u of matchedUsers || []) {
        const key = normalizeEmail(u.email);
        if (key && u.id) userIdByEmail.set(key, u.id);
      }
    }

    for (const t of stillMissingEmailLookup) {
      const matchedId = userIdByEmail.get(normalizeEmail(t.email));
      if (matchedId) {
        userIdByTraineeId.set(t.id, matchedId);
      }
    }
  }

  // Group resolved trainee user IDs per program (enforcing same tenant_id)
  const setsByProgram = new Map<string, Set<string>>();
  for (const enr of enrollments) {
    const trainee = traineeById.get(enr.trainee_id);
    if (!trainee) continue;
    const expectedTenant = programTenantMap.get(enr.program_id);
    if (expectedTenant && trainee.tenant_id && trainee.tenant_id !== expectedTenant) {
      continue;
    }
    const uid = userIdByTraineeId.get(trainee.id);
    if (!uid) continue;
    if (!setsByProgram.has(enr.program_id)) {
      setsByProgram.set(enr.program_id, new Set());
    }
    setsByProgram.get(enr.program_id)!.add(uid);
  }

  for (const [progId, uidSet] of setsByProgram.entries()) {
    result.set(progId, Array.from(uidSet));
  }
  return result;
}

export class MessengerService {
  /**
   * Automatically ensure Program Group Chats exist, contain all valid tenant staff,
   * super admins, and active non-dropped enrolled trainees, and prune stale/orphaned
   * participants from program_group chats.
   * Coalesced in-flight and throttled by a 60s TTL per (tenantId, userId, role).
   */
  static async syncProgramGroupChatsForUser(
    userId: string,
    tenantId: string,
    role: string,
    options?: { force?: boolean }
  ): Promise<void> {
    const resolvedTenantId = resolveTenantId(tenantId);
    const cacheKey = `${resolvedTenantId}:${userId}:${role}`;

    if (!options?.force) {
      const lastSynced = programGcSyncCache.get(cacheKey);
      if (lastSynced && Date.now() - lastSynced < PROGRAM_GC_SYNC_TTL_MS) {
        return;
      }

      const inFlight = programGcSyncInFlight.get(cacheKey);
      if (inFlight) {
        return inFlight;
      }
    }

    const syncPromise = (async () => {
      try {
        let targetPrograms: Array<{ id: string; name: string; tenant_id: string }> = [];

        if (role === 'trainee') {
          const { data: userRow } = await supabaseAdmin
            .from('users')
            .select('id, email, username, role')
            .eq('id', userId)
            .maybeSingle();

          const traineeMap = userRow
            ? await resolveTraineesForUsers([userRow as BasicUserRecord])
            : new Map<string, TraineeRecord>();
          const trainee = traineeMap.get(userId);

          if (trainee && isActiveApprovedTrainee(trainee)) {
            const { data: enrollments } = await supabaseAdmin
              .from('enrollments')
              .select('program_id')
              .eq('trainee_id', trainee.id)
              .in('status', [...ACTIVE_ENROLLMENT_STATUSES]);

            const programIds = Array.from(
              new Set((enrollments || []).map((e: any) => e.program_id).filter(Boolean))
            );

            if (programIds.length > 0) {
              const progBatches = await Promise.all(
                chunkArray(programIds).map(async (progChunk) => {
                  const { data: programs } = await supabaseAdmin
                    .from('programs')
                    .select('id, name, tenant_id')
                    .in('id', progChunk);
                  return (programs || []) as Array<{ id: string; name: string; tenant_id: string }>;
                })
              );
              targetPrograms = progBatches.flat();
            }
          }
        } else if (role === 'super_admin') {
          const activeTenantIds = await fetchActiveTenantIds();
          if (activeTenantIds.length > 0) {
            const { data: programs } = await supabaseAdmin
              .from('programs')
              .select('id, name, tenant_id')
              .in('tenant_id', activeTenantIds);
            targetPrograms = (programs || []) as Array<{ id: string; name: string; tenant_id: string }>;
          }
        } else {
          const { data: programs } = await supabaseAdmin
            .from('programs')
            .select('id, name, tenant_id')
            .eq('tenant_id', resolvedTenantId);
          targetPrograms = (programs || []) as Array<{ id: string; name: string; tenant_id: string }>;
        }

        if (targetPrograms.length === 0) {
          programGcSyncCache.set(cacheKey, Date.now());
          return;
        }

        const uniqueTenantIds = Array.from(
          new Set(targetPrograms.map((p) => resolveTenantId(p.tenant_id)))
        );
        const programIds = targetPrograms.map((p) => p.id);

        // Batch-load super admins, tenant staff per unique tenant, existing GCs, and enrolled trainees in parallel
        const [superAdmins, staffEntries, existingGcsResult, enrolledByProgram] = await Promise.all([
          fetchSuperAdminUsers(),
          Promise.all(
            uniqueTenantIds.map(async (tid) => {
              const memberIds = await fetchTenantMemberUserIds(tid);
              const memberUsers = await fetchUsersByIds(memberIds);
              const staffIds = memberUsers
                .filter((u) => STAFF_ROLES.includes(u.role as (typeof STAFF_ROLES)[number]))
                .map((u) => u.id);
              return [tid, staffIds] as const;
            })
          ),
          Promise.all(
            chunkArray(programIds).map(async (progChunk) => {
              const { data } = await supabaseAdmin
                .from('conversations')
                .select('id, program_id, tenant_id, title')
                .eq('type', 'program_group')
                .in('program_id', progChunk);
              return data || [];
            })
          ).then((batches) => ({ data: batches.flat() })),
          fetchEnrolledTraineeUserIdsByProgram(targetPrograms),
        ]);

        const superAdminIds = superAdmins.map((u) => u.id);
        const staffIdsByTenant = new Map<string, string[]>(staffEntries);

        const convByProgramKey = new Map<string, { id: string; title: string }>();
        for (const c of (existingGcsResult.data || []) as Array<{
          id: string;
          program_id: string;
          tenant_id: string;
          title: string;
        }>) {
          if (c.program_id) {
            convByProgramKey.set(`${resolveTenantId(c.tenant_id)}:${c.program_id}`, {
              id: c.id,
              title: c.title,
            });
          }
        }

        // Create any missing Program GC rows in parallel
        const missingPrograms = targetPrograms.filter(
          (prog) => !convByProgramKey.has(`${resolveTenantId(prog.tenant_id)}:${prog.id}`)
        );
        if (missingPrograms.length > 0) {
          await Promise.all(
            missingPrograms.map(async (prog) => {
              const progTenantId = resolveTenantId(prog.tenant_id);
              const title = prog.name ? `${prog.name} (Program GC)` : 'Program Group Chat';
              const { data: newConv, error: insertConvErr } = await supabaseAdmin
                .from('conversations')
                .insert({
                  tenant_id: progTenantId,
                  type: 'program_group',
                  program_id: prog.id,
                  title,
                })
                .select('id, title')
                .single();

              if (insertConvErr) {
                const { data: existingConv } = await supabaseAdmin
                  .from('conversations')
                  .select('id, title')
                  .eq('tenant_id', progTenantId)
                  .eq('program_id', prog.id)
                  .eq('type', 'program_group')
                  .maybeSingle();
                if (existingConv) {
                  convByProgramKey.set(`${progTenantId}:${prog.id}`, existingConv);
                }
              } else if (newConv) {
                convByProgramKey.set(`${progTenantId}:${prog.id}`, newConv);
              }
            })
          );
        }

        const resolvedConvs: Array<{
          convId: string;
          progId: string;
          progTenantId: string;
        }> = [];
        for (const prog of targetPrograms) {
          const progTenantId = resolveTenantId(prog.tenant_id);
          const conv = convByProgramKey.get(`${progTenantId}:${prog.id}`);
          if (conv) {
            resolvedConvs.push({ convId: conv.id, progId: prog.id, progTenantId });
          }
        }

        if (resolvedConvs.length === 0) {
          programGcSyncCache.set(cacheKey, Date.now());
          return;
        }

        // Batch-fetch existing participants across all resolved Program GCs in chunked queries
        const allConvIds = resolvedConvs.map((c) => c.convId);
        let existingPartsErr: any = null;
        const existingPartBatches = await Promise.all(
          chunkArray(allConvIds).map(async (convChunk) => {
            const { data, error } = await supabaseAdmin
              .from('conversation_participants')
              .select('conversation_id, user_id')
              .in('conversation_id', convChunk);
            if (error) existingPartsErr = error;
            return (data || []) as Array<{ conversation_id: string; user_id: string }>;
          })
        );

        if (existingPartsErr) return;
        const allExistingParts = existingPartBatches.flat();

        const existingByConv = new Map<string, Set<string>>();
        for (const p of (allExistingParts || []) as Array<{ conversation_id: string; user_id: string }>) {
          if (!existingByConv.has(p.conversation_id)) {
            existingByConv.set(p.conversation_id, new Set());
          }
          existingByConv.get(p.conversation_id)!.add(p.user_id);
        }

        // Diff, upsert missing members, and prune stale/orphaned members concurrently
        await Promise.all(
          resolvedConvs.map(async ({ convId, progId, progTenantId }) => {
            const tenantStaffIds = staffIdsByTenant.get(progTenantId) || [];
            const enrolledTraineeUserIds = enrolledByProgram.get(progId) || [];
            const validMemberSet = new Set<string>([
              ...tenantStaffIds,
              ...superAdminIds,
              ...enrolledTraineeUserIds,
            ]);

            const existingSet = existingByConv.get(convId) || new Set<string>();
            const missingIds = Array.from(validMemberSet).filter((id) => !existingSet.has(id));
            const staleIds = Array.from(existingSet).filter((id) => !validMemberSet.has(id));

            const ops: Promise<any>[] = [];

            if (missingIds.length > 0) {
              for (const idChunk of chunkArray(missingIds)) {
                ops.push(
                  Promise.resolve(
                    supabaseAdmin.from('conversation_participants').upsert(
                      idChunk.map((uid) => ({ conversation_id: convId, user_id: uid })),
                      { onConflict: 'conversation_id,user_id', ignoreDuplicates: true }
                    )
                  )
                );
              }
            }

            if (staleIds.length > 0) {
              for (const idChunk of chunkArray(staleIds)) {
                ops.push(
                  Promise.resolve(
                    supabaseAdmin
                      .from('conversation_participants')
                      .delete()
                      .eq('conversation_id', convId)
                      .in('user_id', idChunk)
                  )
                );
              }
            }

            if (ops.length > 0) {
              await Promise.all(ops);
            }
          })
        );

        programGcSyncCache.set(cacheKey, Date.now());
      } catch (error) {
        logger.error('Error syncing program group chats', { error, userId });
      } finally {
        programGcSyncInFlight.delete(cacheKey);
      }
    })();

    programGcSyncInFlight.set(cacheKey, syncPromise);
    return syncPromise;
  }

  /**
   * List all conversations for the authenticated user
   */
  static async listUserConversations(
    userId: string,
    tenantId: string,
    role: string,
    options?: { forceSync?: boolean }
  ) {
    const resolvedTenantId = resolveTenantId(tenantId);

    if (options?.forceSync) {
      userDetailsCache.clear();
    }

    // Run throttled/coalesced Program GC sync first
    await this.syncProgramGroupChatsForUser(userId, resolvedTenantId, role, {
      force: options?.forceSync,
    });

    // Fetch conversations where user is a participant
    const { data: participations, error: partError } = await supabaseAdmin
      .from('conversation_participants')
      .select('conversation_id, last_read_at')
      .eq('user_id', userId);

    if (partError || !participations || participations.length === 0) {
      return [];
    }

    const conversationIds = participations.map((p) => p.conversation_id);
    const readMap = new Map(participations.map((p) => [p.conversation_id, p.last_read_at]));

    // Fetch conversation metadata and all participants in parallel (chunked to avoid URL overflow)
    const convChunks = chunkArray(conversationIds);
    const [convBatches, allPartBatches] = await Promise.all([
      Promise.all(
        convChunks.map(async (convChunk) => {
          const { data, error } = await supabaseAdmin
            .from('conversations')
            .select(`
              id,
              type,
              program_id,
              title,
              last_message_at,
              created_at
            `)
            .in('id', convChunk)
            .order('last_message_at', { ascending: false });
          return { data: data || [], error };
        })
      ),
      Promise.all(
        convChunks.map(async (convChunk) => {
          const { data } = await supabaseAdmin
            .from('conversation_participants')
            .select('conversation_id, user_id')
            .in('conversation_id', convChunk);
          return data || [];
        })
      ),
    ]);

    if (convBatches.some((b) => b.error)) {
      return [];
    }

    const conversations = convBatches
      .flatMap((b) => b.data)
      .sort((a: any, b: any) => {
        const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
        const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
        return bTime - aTime;
      });
    const allParticipants = allPartBatches.flat();
    const allUserIds = Array.from<string>(new Set(allParticipants.map((p: any) => p.user_id)));
    const userDetailsMap = await resolveUserDetails(allUserIds, {
      bypassCache: options?.forceSync,
    });

    // Fetch latest message & unread count for each conversation concurrently
    const result = await Promise.all(
      conversations.map(async (conv) => {
        const lastReadAt = readMap.get(conv.id) || new Date(0).toISOString();

        const [latestMsgRes, unreadRes] = await Promise.all([
          supabaseAdmin
            .from('messages')
            .select('id, sender_id, content, attachment_type, is_deleted, created_at')
            .eq('conversation_id', conv.id)
            .order('created_at', { ascending: false })
            .limit(1),
          supabaseAdmin
            .from('messages')
            .select('id', { count: 'exact', head: true })
            .eq('conversation_id', conv.id)
            .gt('created_at', lastReadAt)
            .neq('sender_id', userId)
            .eq('is_deleted', false),
        ]);

        const latestMsgs = latestMsgRes.data;
        const latestMsg = latestMsgs && latestMsgs.length > 0 ? latestMsgs[0] : null;
        const unreadCount = unreadRes.count || 0;

        const convParts = allParticipants
          .filter((p) => p.conversation_id === conv.id)
          .map((p) => userDetailsMap[p.user_id])
          .filter(Boolean);

        let displayTitle = conv.title;
        let otherUser: UserSummary | undefined;
        if (conv.type === 'direct') {
          otherUser = convParts.find((p) => p.id !== userId);
          if (otherUser) {
            displayTitle = otherUser.name;
          }
        }

        return {
          id: conv.id,
          type: conv.type,
          title: displayTitle || 'Chat',
          programId: conv.program_id,
          lastMessageAt: conv.last_message_at,
          unreadCount,
          latestMessage: latestMsg
            ? {
                id: latestMsg.id,
                senderId: latestMsg.sender_id,
                senderName: userDetailsMap[latestMsg.sender_id]?.name || 'User',
                content: latestMsg.is_deleted ? 'This message was unsent' : latestMsg.content,
                attachmentType: latestMsg.attachment_type,
                createdAt: latestMsg.created_at,
              }
            : null,
          participants: convParts,
          otherUser,
        };
      })
    );

    return result;
  }

  /**
   * Verify user is a participant and return the conversation's tenant_id UUID.
   */
  static async getAuthorizedConversationTenantId(conversationId: string, userId: string): Promise<string> {
    if (!isValidUuid(conversationId)) {
      throw new MessengerError('Invalid conversationId', 400);
    }

    const { data: part } = await supabaseAdmin
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!part) {
      throw new MessengerError('Access denied: You are not a participant in this conversation', 403);
    }

    const { data: conv, error } = await supabaseAdmin
      .from('conversations')
      .select('tenant_id')
      .eq('id', conversationId)
      .single();

    if (error || !conv) {
      throw new MessengerError('Conversation not found', 404);
    }

    return resolveTenantId(conv.tenant_id);
  }

  /**
   * Combined fast-path fetch for GET /api/messages/[conversationId]:
   * verifies membership once, fetches conversation + newest messages in parallel,
   * resolves all user details via cache in one pass, and marks read non-blocking.
   */
  static async getConversationWithMessages(
    conversationId: string,
    userId: string,
    limit: number = 60
  ) {
    const { data: participants, error: partErr } = await supabaseAdmin
      .from('conversation_participants')
      .select('user_id, joined_at, last_read_at')
      .eq('conversation_id', conversationId);

    if (partErr) throw partErr;

    const participantRows = (participants || []) as Array<{
      user_id: string;
      joined_at?: string;
      last_read_at?: string;
    }>;

    if (!participantRows.some((p) => p.user_id === userId)) {
      throw new MessengerError('Access denied: You are not a participant in this conversation', 403);
    }

    const [convResult, messagesResult] = await Promise.all([
      supabaseAdmin.from('conversations').select('*').eq('id', conversationId).single(),
      supabaseAdmin
        .from('messages')
        .select('*')
        .eq('conversation_id', conversationId)
        .order('created_at', { ascending: false })
        .limit(limit),
    ]);

    if (convResult.error || !convResult.data) {
      throw new MessengerError('Conversation not found', 404);
    }
    if (messagesResult.error) {
      throw messagesResult.error;
    }

    const conv = convResult.data;
    const rawMessages = [...(messagesResult.data || [])].reverse();

    // Non-blocking read receipt update
    void this.markAsRead(conversationId, userId).catch((err) => {
      logger.warn('Background markAsRead failed in getConversationWithMessages', {
        conversationId,
        userId,
        err,
      });
    });

    const allUserIds = Array.from<string>(
      new Set([
        ...participantRows.map((p) => p.user_id),
        ...rawMessages.map((m: any) => m.sender_id),
      ])
    );
    const userDetailsMap = await resolveUserDetails(allUserIds);

    const mappedParticipants = participantRows
      .map((p) => {
        const details = userDetailsMap[p.user_id];
        if (!details) return null;
        return {
          ...details,
          joinedAt: p.joined_at,
          lastReadAt: p.last_read_at,
        };
      })
      .filter(Boolean);

    let displayTitle = conv.title;
    let otherUser: UserSummary | undefined;
    if (conv.type === 'direct') {
      otherUser = mappedParticipants.find((p: any) => p.id !== userId) as UserSummary | undefined;
      if (otherUser) {
        displayTitle = otherUser.name;
      }
    }

    const messages = rawMessages.map((m: any) => ({
      id: m.id,
      conversationId: m.conversation_id,
      senderId: m.sender_id,
      senderName: userDetailsMap[m.sender_id]?.name || 'User',
      senderRole: userDetailsMap[m.sender_id]?.role || 'user',
      senderAvatar: userDetailsMap[m.sender_id]?.avatar,
      content: m.is_deleted ? 'This message was unsent' : m.content,
      attachmentUrl: m.is_deleted ? null : m.attachment_url,
      attachmentType: m.is_deleted ? null : m.attachment_type,
      attachmentName: m.is_deleted ? null : m.attachment_name,
      isDeleted: m.is_deleted,
      createdAt: m.created_at,
    }));

    return {
      conversation: {
        ...conv,
        title: displayTitle,
        otherUser,
        participants: mappedParticipants,
      },
      messages,
    };
  }

  /**
   * Get single conversation details with participants
   */
  static async getConversationDetails(conversationId: string, userId: string) {
    const { data: participants, error: partErr } = await supabaseAdmin
      .from('conversation_participants')
      .select('user_id, joined_at, last_read_at')
      .eq('conversation_id', conversationId);

    if (partErr) throw partErr;
    const participantRows = (participants || []) as Array<{
      user_id: string;
      joined_at?: string;
      last_read_at?: string;
    }>;

    if (!participantRows.some((p) => p.user_id === userId)) {
      throw new MessengerError('Access denied: You are not a participant in this conversation', 403);
    }

    const userIds = participantRows.map((p) => p.user_id);
    const [convResult, userDetailsMap] = await Promise.all([
      supabaseAdmin.from('conversations').select('*').eq('id', conversationId).single(),
      resolveUserDetails(userIds),
    ]);

    if (convResult.error || !convResult.data) {
      throw new MessengerError('Conversation not found', 404);
    }
    const conv = convResult.data;

    const mappedParticipants = participantRows
      .map((p) => {
        const details = userDetailsMap[p.user_id];
        if (!details) return null;
        return {
          ...details,
          joinedAt: p.joined_at,
          lastReadAt: p.last_read_at,
        };
      })
      .filter(Boolean);

    let displayTitle = conv.title;
    let otherUser: UserSummary | undefined;
    if (conv.type === 'direct') {
      otherUser = mappedParticipants.find((p: any) => p.id !== userId) as UserSummary | undefined;
      if (otherUser) {
        displayTitle = otherUser.name;
      }
    }

    return {
      ...conv,
      title: displayTitle,
      otherUser,
      participants: mappedParticipants,
    };
  }

  /**
   * Fetch the most recent `limit` messages for a conversation in chronological order and mark as read
   */
  static async getMessages(conversationId: string, userId: string, limit: number = 60) {
    const { data: part } = await supabaseAdmin
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', conversationId)
      .eq('user_id', userId)
      .maybeSingle();

    if (!part) {
      throw new MessengerError('Access denied: Not a participant', 403);
    }

    // Query newest `limit` messages descending, then reverse to chronological ascending
    const { data: rawMessages, error } = await supabaseAdmin
      .from('messages')
      .select('*')
      .eq('conversation_id', conversationId)
      .order('created_at', { ascending: false })
      .limit(limit);

    if (error) {
      throw error;
    }

    const messages = [...(rawMessages || [])].reverse();

    void this.markAsRead(conversationId, userId).catch((err) => {
      logger.warn('Background markAsRead failed in getMessages', { conversationId, userId, err });
    });

    const senderIds = Array.from<string>(new Set(messages.map((m: any) => m.sender_id)));
    const userDetailsMap = await resolveUserDetails(senderIds);

    return messages.map((m) => ({
      id: m.id,
      conversationId: m.conversation_id,
      senderId: m.sender_id,
      senderName: userDetailsMap[m.sender_id]?.name || 'User',
      senderRole: userDetailsMap[m.sender_id]?.role || 'user',
      senderAvatar: userDetailsMap[m.sender_id]?.avatar,
      content: m.is_deleted ? 'This message was unsent' : m.content,
      attachmentUrl: m.is_deleted ? null : m.attachment_url,
      attachmentType: m.is_deleted ? null : m.attachment_type,
      attachmentName: m.is_deleted ? null : m.attachment_name,
      isDeleted: m.is_deleted,
      createdAt: m.created_at,
    }));
  }

  /**
   * Fast-path sendMessage:
   * 1. Single participant query verifies sender membership AND fetches SSE recipients.
   * 2. Message insert runs concurrently with cached resolveUserDetails (0 DB queries when warm).
   * 3. markAsRead runs non-blocking in the background so HTTP response returns immediately.
   */
  static async sendMessage(
    conversationId: string,
    senderId: string,
    content: string,
    attachment?: MessageAttachment
  ) {
    const { data: participants, error: partErr } = await supabaseAdmin
      .from('conversation_participants')
      .select('user_id')
      .eq('conversation_id', conversationId);

    if (partErr) throw partErr;

    const recipientUserIds = (participants || []).map((p: any) => p.user_id).filter(Boolean);
    if (!recipientUserIds.includes(senderId)) {
      throw new MessengerError('Access denied: Sender is not a participant', 403);
    }

    const [insertResult, userDetailsMap] = await Promise.all([
      supabaseAdmin
        .from('messages')
        .insert({
          conversation_id: conversationId,
          sender_id: senderId,
          content: content.trim(),
          attachment_url: attachment?.url || null,
          attachment_type: attachment?.type || null,
          attachment_name: attachment?.name || null,
        })
        .select('*')
        .single(),
      resolveUserDetails([senderId]),
    ]);

    const { data: message, error } = insertResult;
    if (error || !message) {
      throw error || new Error('Failed to create message');
    }

    // Fire-and-forget read update so we don't block the send response
    void this.markAsRead(conversationId, senderId).catch((err) => {
      logger.warn('Background markAsRead failed after sendMessage', {
        conversationId,
        senderId,
        err,
      });
    });

    const sender = userDetailsMap[senderId];

    const messagePayload = {
      id: message.id,
      conversationId: message.conversation_id,
      senderId: message.sender_id,
      senderName: sender?.name || 'User',
      senderRole: sender?.role || 'user',
      senderAvatar: sender?.avatar,
      content: message.content,
      attachmentUrl: message.attachment_url,
      attachmentType: message.attachment_type,
      attachmentName: message.attachment_name,
      isDeleted: false,
      createdAt: message.created_at,
    };

    messengerEvents.emit('new_message', {
      conversationId,
      message: messagePayload,
      recipients: recipientUserIds,
    });

    return messagePayload;
  }

  /**
   * Soft-unsend a message within 15 minutes
   */
  static async unsendMessage(conversationId: string, messageId: string, userId: string) {
    const { data: message } = await supabaseAdmin
      .from('messages')
      .select('id, sender_id, created_at, is_deleted')
      .eq('id', messageId)
      .eq('conversation_id', conversationId)
      .single();

    if (!message) {
      throw new MessengerError('Message not found', 404);
    }

    if (message.sender_id !== userId) {
      throw new MessengerError('Only the sender can unsend this message', 403);
    }

    if (message.is_deleted) {
      return { success: true, messageId };
    }

    const ageMs = Date.now() - new Date(message.created_at).getTime();
    const fifteenMinutesMs = 15 * 60 * 1000;
    if (ageMs > fifteenMinutesMs) {
      throw new MessengerError('Messages can only be unsent within 15 minutes of sending', 400);
    }

    const [, participantsResult] = await Promise.all([
      supabaseAdmin
        .from('messages')
        .update({
          is_deleted: true,
          deleted_at: new Date().toISOString(),
          content: 'This message was unsent',
          attachment_url: null,
        })
        .eq('id', messageId),
      supabaseAdmin
        .from('conversation_participants')
        .select('user_id')
        .eq('conversation_id', conversationId),
    ]);

    const recipientUserIds = (participantsResult.data || []).map((p: any) => p.user_id);

    messengerEvents.emit('message_unsend', {
      conversationId,
      messageId,
      recipients: recipientUserIds,
    });

    return { success: true, messageId };
  }

  /**
   * Mark conversation as read for this user
   */
  static async markAsRead(conversationId: string, userId: string) {
    await supabaseAdmin
      .from('conversation_participants')
      .update({ last_read_at: new Date().toISOString() })
      .eq('conversation_id', conversationId)
      .eq('user_id', userId);
  }

  /**
   * Find or create a 1-on-1 direct conversation between two users
   * enforcing tenant isolation and role messaging policy.
   */
  static async getOrCreateDirectConversation(
    userAId: string,
    userBId: string,
    tenantId: string,
    actorRole?: string
  ) {
    if (!isValidUuid(userBId)) {
      throw new MessengerError('Invalid recipientId', 400);
    }

    if (userAId === userBId) {
      throw new MessengerError('Cannot start a direct conversation with yourself', 400);
    }

    const { data: recipient, error: recipientErr } = await supabaseAdmin
      .from('users')
      .select('id, email, username, role')
      .eq('id', userBId)
      .maybeSingle();

    if (recipientErr) throw recipientErr;
    if (!recipient) {
      throw new MessengerError('Recipient not found', 404);
    }

    let effectiveActorRole = actorRole;
    if (!effectiveActorRole) {
      const { data: actor } = await supabaseAdmin
        .from('users')
        .select('role')
        .eq('id', userAId)
        .maybeSingle();
      effectiveActorRole = actor?.role;
    }

    // Role policy: trainees may only DM staff & administrators
    if (effectiveActorRole === 'trainee' && recipient.role === 'trainee') {
      throw new MessengerError(
        'Trainees can only send direct messages to staff and administrators',
        403
      );
    }

    const isActorSuperAdmin = effectiveActorRole === 'super_admin';
    const isRecipientSuperAdmin = recipient.role === 'super_admin';
    const resolvedActorTenantId = resolveTenantId(tenantId);

    // Fetch recipient tenant associations and existing userA conversations in parallel
    const [recipientTenantsRes, convsARes] = await Promise.all([
      supabaseAdmin
        .from('users_tenants')
        .select('tenant_id, is_primary')
        .eq('user_id', userBId),
      supabaseAdmin
        .from('conversation_participants')
        .select('conversation_id')
        .eq('user_id', userAId),
    ]);

    const recipientTenantList = (recipientTenantsRes.data || []) as Array<{
      tenant_id: string;
      is_primary?: boolean;
    }>;

    if (!isActorSuperAdmin && !isRecipientSuperAdmin) {
      const inSameTenant = recipientTenantList.some(
        (t) => t.tenant_id?.toLowerCase() === resolvedActorTenantId.toLowerCase()
      );
      if (!inSameTenant) {
        throw new MessengerError('Cannot start a conversation with a user outside your organization', 403);
      }
    }

    // If recipient is a trainee, verify active & approved trainee status
    if (recipient.role === 'trainee') {
      const traineeMap = await resolveTraineesForUsers([recipient as BasicUserRecord]);
      const recipientTrainee = traineeMap.get(recipient.id);
      if (!isActiveApprovedTrainee(recipientTrainee)) {
        throw new MessengerError('This trainee account is not active for messaging', 403);
      }
    }

    // Check ALL shared conversations for an existing 'direct' conversation (chunked for 500+ thread safety)
    const convsA = convsARes.data;
    if (convsA && convsA.length > 0) {
      const convIdsA = convsA.map((c) => c.conversation_id);
      const commonPartBatches = await Promise.all(
        chunkArray(convIdsA).map(async (convChunk) => {
          const { data } = await supabaseAdmin
            .from('conversation_participants')
            .select('conversation_id')
            .eq('user_id', userBId)
            .in('conversation_id', convChunk);
          return data || [];
        })
      );
      const commonParts = commonPartBatches.flat();

      if (commonParts.length > 0) {
        const commonConvIds = commonParts.map((p) => p.conversation_id);
        const existingConvBatches = await Promise.all(
          chunkArray(commonConvIds).map(async (convChunk) => {
            const { data } = await supabaseAdmin
              .from('conversations')
              .select('id, last_message_at')
              .in('id', convChunk)
              .eq('type', 'direct')
              .order('last_message_at', { ascending: false })
              .limit(1);
            return data || [];
          })
        );
        const existingConv = existingConvBatches
          .flat()
          .sort((a: any, b: any) => {
            const aTime = a.last_message_at ? new Date(a.last_message_at).getTime() : 0;
            const bTime = b.last_message_at ? new Date(b.last_message_at).getTime() : 0;
            return bTime - aTime;
          })[0];

        if (existingConv) {
          return existingConv.id;
        }
      }
    }

    // Determine valid UUID tenant_id for the new direct conversation
    let conversationTenantId = resolvedActorTenantId;
    if (isActorSuperAdmin) {
      const primaryRecipientTenant =
        recipientTenantList.find((t) => t.is_primary) || recipientTenantList[0];
      conversationTenantId = resolveTenantId(primaryRecipientTenant?.tenant_id);
    }

    const { data: newConv, error } = await supabaseAdmin
      .from('conversations')
      .insert({
        tenant_id: conversationTenantId,
        type: 'direct',
      })
      .select('id')
      .single();

    if (error || !newConv) {
      throw error || new Error('Failed to create direct conversation');
    }

    const { error: partInsertErr } = await supabaseAdmin.from('conversation_participants').insert([
      { conversation_id: newConv.id, user_id: userAId },
      { conversation_id: newConv.id, user_id: userBId },
    ]);

    if (partInsertErr) {
      // Roll back orphaned conversation row
      await supabaseAdmin.from('conversations').delete().eq('id', newConv.id);
      throw partInsertErr;
    }

    return newConv.id;
  }

  /**
   * Get list of contacts user is authorized to DM:
   * - Trainees: tenant staff + super admins (no other trainees)
   * - Tenant Staff / Local Admin: tenant staff + super admins + active approved tenant trainees
   * - Super Admin: active users across all active tenants + other super admins (excluding orphans/deleted)
   */
  static async getAvailableContacts(userId: string, tenantId: string, role: string) {
    const isSuperAdmin = role === 'super_admin';
    const resolvedTenantId = resolveTenantId(tenantId);

    let tenantMemberIds: string[] = [];
    if (isSuperAdmin) {
      const activeTenantIds = await fetchActiveTenantIds();
      if (activeTenantIds.length > 0) {
        const { data: allMembers, error } = await supabaseAdmin
          .from('users_tenants')
          .select('user_id')
          .in('tenant_id', activeTenantIds);
        if (error) throw error;
        tenantMemberIds = Array.from(
          new Set((allMembers || []).map((r: any) => r.user_id).filter(Boolean))
        );
      }
    } else {
      tenantMemberIds = await fetchTenantMemberUserIds(resolvedTenantId);
    }

    const [tenantUsers, superAdminUsers] = await Promise.all([
      fetchUsersByIds(tenantMemberIds),
      fetchSuperAdminUsers(),
    ]);

    // Merge unique candidates excluding self
    const candidateMap = new Map<string, BasicUserRecord>();
    for (const u of [...tenantUsers, ...superAdminUsers]) {
      if (u.id && u.id !== userId) {
        candidateMap.set(u.id, u);
      }
    }

    const candidates = Array.from(candidateMap.values());
    let allowedUsers: BasicUserRecord[] = [];

    if (role === 'trainee') {
      allowedUsers = candidates.filter((u) =>
        ALL_STAFF_AND_ADMIN_ROLES.includes(u.role as (typeof ALL_STAFF_AND_ADMIN_ROLES)[number])
      );
    } else {
      const traineeMap = await resolveTraineesForUsers(candidates);
      allowedUsers = candidates.filter((u) => {
        if (u.role === 'trainee') {
          return isActiveApprovedTrainee(traineeMap.get(u.id));
        }
        return ALL_STAFF_AND_ADMIN_ROLES.includes(
          u.role as (typeof ALL_STAFF_AND_ADMIN_ROLES)[number]
        );
      });
    }

    const userIds = allowedUsers.map((u) => u.id);
    const details = await resolveUserDetails(userIds);
    const contactList = Object.values(details);

    // Sort contacts: staff & admins first, then alphabetical by display name
    return contactList.sort((a, b) => {
      const aIsStaff = a.role !== 'trainee';
      const bIsStaff = b.role !== 'trainee';
      if (aIsStaff && !bIsStaff) return -1;
      if (!aIsStaff && bIsStaff) return 1;
      return (a.name || '').localeCompare(b.name || '');
    });
  }
}
