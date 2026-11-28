// Mock supabaseAdmin with a lightweight in-memory relational table store
// so tests exercise the real query filters, joins, upserts, and deletes of MessengerService.
interface TableStore {
  users: any[];
  users_tenants: any[];
  tenants: any[];
  trainees: any[];
  trainee_accounts: any[];
  instructors: any[];
  programs: any[];
  enrollments: any[];
  conversations: any[];
  conversation_participants: any[];
  messages: any[];
}

let db: TableStore;
let idCounter = 1;
let queryLog: Array<{ table: string; op: string }> = [];

function nextUuid(): string {
  const hex = (idCounter++).toString(16).padStart(12, '0');
  return `00000000-0000-4000-8000-${hex}`;
}

function createQueryBuilder(table: keyof TableStore) {
  let op: 'select' | 'insert' | 'upsert' | 'update' | 'delete' = 'select';
  let selectClause = '*';
  let payload: any = null;
  let upsertOpts: { onConflict?: string; ignoreDuplicates?: boolean } = {};
  let headOnly = false;
  let wantCount = false;
  const filters: Array<(row: any) => boolean> = [];
  let orderBy: { col: string; ascending: boolean } | null = null;
  let limitCount: number | null = null;
  let expectSingle: 'single' | 'maybeSingle' | null = null;

  const projectRow = (row: any) => {
    const clone = { ...row };
    if (table === 'trainee_accounts' && selectClause.includes('trainees(')) {
      clone.trainees = db.trainees.find((t) => t.id === row.trainee_id) || null;
    }
    return clone;
  };

  const execute = async (): Promise<{ data: any; error: any; count?: number }> => {
    queryLog.push({ table, op });
    const rows = db[table];

    if (op === 'insert') {
      const items = (Array.isArray(payload) ? payload : [payload]).map((item) => ({
        id: item.id ?? nextUuid(),
        created_at: item.created_at ?? new Date().toISOString(),
        last_message_at: item.last_message_at ?? new Date().toISOString(),
        last_read_at: item.last_read_at ?? new Date().toISOString(),
        is_deleted: item.is_deleted ?? false,
        ...item,
      }));
      rows.push(...items);
      const out = items.map(projectRow);
      if (expectSingle) return { data: out[0] ?? null, error: null };
      return { data: out, error: null };
    }

    if (op === 'upsert') {
      const items = Array.isArray(payload) ? payload : [payload];
      const conflictCols = (upsertOpts.onConflict || 'id').split(',').map((s) => s.trim());
      const out: any[] = [];
      for (const item of items) {
        const existingIdx = rows.findIndex((r) =>
          conflictCols.every((c) => r[c] === item[c])
        );
        if (existingIdx >= 0) {
          if (!upsertOpts.ignoreDuplicates) {
            rows[existingIdx] = { ...rows[existingIdx], ...item };
          }
          out.push(projectRow(rows[existingIdx]));
        } else {
          const inserted = {
            last_read_at: new Date().toISOString(),
            joined_at: new Date().toISOString(),
            ...item,
          };
          rows.push(inserted);
          out.push(projectRow(inserted));
        }
      }
      return { data: expectSingle ? out[0] ?? null : out, error: null };
    }

    if (op === 'update') {
      const matched = rows.filter((r) => filters.every((f) => f(r)));
      for (const m of matched) {
        Object.assign(m, payload);
      }
      const out = matched.map(projectRow);
      return { data: expectSingle ? out[0] ?? null : out, error: null };
    }

    if (op === 'delete') {
      const kept: any[] = [];
      const removed: any[] = [];
      for (const r of rows) {
        if (filters.every((f) => f(r))) removed.push(r);
        else kept.push(r);
      }
      db[table] = kept;
      return { data: removed, error: null };
    }

    // select
    let matched = rows.filter((r) => filters.every((f) => f(r)));
    if (orderBy) {
      const { col, ascending } = orderBy;
      matched = [...matched].sort((a, b) => {
        const av = a[col] ?? '';
        const bv = b[col] ?? '';
        if (av === bv) return 0;
        return (av < bv ? -1 : 1) * (ascending ? 1 : -1);
      });
    }
    const totalCount = matched.length;
    if (limitCount !== null) {
      matched = matched.slice(0, limitCount);
    }

    if (headOnly) {
      return { data: null, error: null, count: wantCount ? totalCount : undefined };
    }

    const projected = matched.map(projectRow);
    if (expectSingle === 'single') {
      return projected[0]
        ? { data: projected[0], error: null }
        : { data: null, error: { code: 'PGRST116', message: 'No rows found' } };
    }
    if (expectSingle === 'maybeSingle') {
      return { data: projected[0] ?? null, error: null };
    }
    return { data: projected, error: null, count: wantCount ? totalCount : undefined };
  };

  const builder: any = {
    select(cols = '*', opts?: { count?: string; head?: boolean }) {
      selectClause = cols;
      if (opts?.head) headOnly = true;
      if (opts?.count) wantCount = true;
      return builder;
    },
    insert(data: any) {
      op = 'insert';
      payload = data;
      return builder;
    },
    upsert(data: any, opts?: { onConflict?: string; ignoreDuplicates?: boolean }) {
      op = 'upsert';
      payload = data;
      upsertOpts = opts || {};
      return builder;
    },
    update(data: any) {
      op = 'update';
      payload = data;
      return builder;
    },
    delete() {
      op = 'delete';
      return builder;
    },
    eq(col: string, val: any) {
      filters.push((r) => r[col] === val);
      return builder;
    },
    neq(col: string, val: any) {
      filters.push((r) => r[col] !== val);
      return builder;
    },
    in(col: string, vals: any[]) {
      const set = new Set(vals);
      filters.push((r) => set.has(r[col]));
      return builder;
    },
    ilike(col: string, val: string) {
      const needle = String(val).toLowerCase();
      filters.push((r) => String(r[col] ?? '').toLowerCase() === needle);
      return builder;
    },
    gt(col: string, val: any) {
      filters.push((r) => String(r[col] ?? '') > String(val));
      return builder;
    },
    order(col: string, opts?: { ascending?: boolean }) {
      orderBy = { col, ascending: opts?.ascending !== false };
      return builder;
    },
    limit(n: number) {
      limitCount = n;
      return builder;
    },
    single() {
      expectSingle = 'single';
      return execute();
    },
    maybeSingle() {
      expectSingle = 'maybeSingle';
      return execute();
    },
    then(resolve: any, reject: any) {
      return execute().then(resolve, reject);
    },
  };

  return builder;
}

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: (table: keyof TableStore) => createQueryBuilder(table),
  },
}));

import {
  MessengerService,
  MessengerError,
  messengerEvents,
  resolveUserDetails,
  clearMessengerCaches,
} from '@/services/messengerService';

const TENANT_A = '194876de-a68c-4d33-8f80-c0978e5d44b3';
const TENANT_B = '294876de-a68c-4d33-8f80-c0978e5d44b4';

const SUPER_ADMIN_ID = '11111111-1111-4111-8111-111111111101';
const LOCAL_ADMIN_A_ID = '11111111-1111-4111-8111-111111111102';
const STAFF_COORD_A_ID = '11111111-1111-4111-8111-111111111103';
const ORPHAN_STAFF_ID = '11111111-1111-4111-8111-111111111104';
const TRAINEE_TA_ONLY_ID = '11111111-1111-4111-8111-111111111105'; // trainees.user_id is NULL (admin-created)
const TRAINEE_USERCOL_ID = '11111111-1111-4111-8111-111111111106'; // linked via trainees.user_id
const TRAINEE_EMAIL_ONLY_ID = '11111111-1111-4111-8111-111111111107'; // matched via email fallback
const TRAINEE_DELETED_ID = '11111111-1111-4111-8111-111111111108';
const TRAINEE_PENDING_ID = '11111111-1111-4111-8111-111111111109';
const TRAINEE_DROPPED_ID = '11111111-1111-4111-8111-111111111110';
const TENANT_B_ADMIN_ID = '11111111-1111-4111-8111-111111111111';

const PROG_A_ID = '22222222-2222-4222-8222-222222222201';
const PROG_B_ID = '22222222-2222-4222-8222-222222222202';

function seedBaseStore() {
  idCounter = 1;
  db = {
    tenants: [
      { id: TENANT_A, name: 'BMDC Tenant A', status: 'active' },
      { id: TENANT_B, name: 'Other Tenant B', status: 'active' },
    ],
    users: [
      { id: SUPER_ADMIN_ID, email: 'super@platform.ph', username: 'superadmin', role: 'super_admin' },
      { id: LOCAL_ADMIN_A_ID, email: 'admin@bmdc.ph', username: 'bmdcadmin', role: 'local_admin' },
      { id: STAFF_COORD_A_ID, email: 'coord@bmdc.ph', username: 'maria_coord', role: 'staff_training_coordinator' },
      { id: ORPHAN_STAFF_ID, email: 'orphan@test.local', username: 'admin_user_9999', role: 'staff_inventory_manager' },
      { id: TRAINEE_TA_ONLY_ID, email: 'juan@trainee.ph', username: 'juandelacruz1234', role: 'trainee' },
      { id: TRAINEE_USERCOL_ID, email: 'ana@trainee.ph', username: 'anareyes5678', role: 'trainee' },
      { id: TRAINEE_EMAIL_ONLY_ID, email: 'CARLO@TRAINEE.PH', username: 'carlo9999', role: 'trainee' },
      { id: TRAINEE_DELETED_ID, email: 'deleted@trainee.ph', username: 'deleted1', role: 'trainee' },
      { id: TRAINEE_PENDING_ID, email: 'pending@trainee.ph', username: 'pending1', role: 'trainee' },
      { id: TRAINEE_DROPPED_ID, email: 'dropped@trainee.ph', username: 'dropped1', role: 'trainee' },
      { id: TENANT_B_ADMIN_ID, email: 'admin@other.ph', username: 'otheradmin', role: 'local_admin' },
    ],
    users_tenants: [
      { user_id: LOCAL_ADMIN_A_ID, tenant_id: TENANT_A, is_primary: true },
      { user_id: STAFF_COORD_A_ID, tenant_id: TENANT_A, is_primary: true },
      // ORPHAN_STAFF_ID intentionally NOT in users_tenants
      { user_id: TRAINEE_TA_ONLY_ID, tenant_id: TENANT_A, is_primary: true },
      { user_id: TRAINEE_USERCOL_ID, tenant_id: TENANT_A, is_primary: true },
      { user_id: TRAINEE_EMAIL_ONLY_ID, tenant_id: TENANT_A, is_primary: true },
      { user_id: TRAINEE_DELETED_ID, tenant_id: TENANT_A, is_primary: true },
      { user_id: TRAINEE_PENDING_ID, tenant_id: TENANT_A, is_primary: true },
      { user_id: TRAINEE_DROPPED_ID, tenant_id: TENANT_A, is_primary: true },
      { user_id: TENANT_B_ADMIN_ID, tenant_id: TENANT_B, is_primary: true },
    ],
    trainees: [
      {
        id: 't-ta-only',
        tenant_id: TENANT_A,
        user_id: null, // Admin-created trainee: user_id column is NULL, linked only via trainee_accounts
        first_name: 'Juan',
        last_name: 'Dela Cruz',
        email: 'juan@trainee.ph',
        photo_path: `/uploads/${TENANT_A}/images/trainees/juan.jpg`,
        thumbnail_path: `/uploads/${TENANT_A}/images/trainees/thumbnails/juan.webp`,
        registration_status: 'completed',
        status: 'active',
        deleted_at: null,
      },
      {
        id: 't-usercol',
        tenant_id: TENANT_A,
        user_id: TRAINEE_USERCOL_ID,
        first_name: 'Ana',
        last_name: 'Reyes',
        email: 'ana@trainee.ph',
        photo_path: null,
        thumbnail_path: null,
        registration_status: 'approved',
        status: 'active',
        deleted_at: null,
      },
      {
        id: 't-email-only',
        tenant_id: TENANT_A,
        user_id: null,
        first_name: 'Carlo',
        last_name: 'Santos',
        email: 'carlo@trainee.ph',
        photo_path: null,
        thumbnail_path: null,
        registration_status: 'completed',
        status: 'active',
        deleted_at: null,
      },
      {
        id: 't-deleted',
        tenant_id: TENANT_A,
        user_id: TRAINEE_DELETED_ID,
        first_name: 'Deleted',
        last_name: 'Trainee',
        email: 'deleted@trainee.ph',
        registration_status: 'completed',
        status: 'inactive',
        deleted_at: '2026-01-01T00:00:00Z',
      },
      {
        id: 't-pending',
        tenant_id: TENANT_A,
        user_id: TRAINEE_PENDING_ID,
        first_name: 'Pending',
        last_name: 'Applicant',
        email: 'pending@trainee.ph',
        registration_status: 'pending',
        status: 'active',
        deleted_at: null,
      },
      {
        id: 't-dropped',
        tenant_id: TENANT_A,
        user_id: TRAINEE_DROPPED_ID,
        first_name: 'Dropped',
        last_name: 'Student',
        email: 'dropped@trainee.ph',
        registration_status: 'completed',
        status: 'active',
        deleted_at: null,
      },
    ],
    trainee_accounts: [
      { id: 'ta-1', trainee_id: 't-ta-only', user_id: TRAINEE_TA_ONLY_ID, tenant_id: TENANT_A },
      { id: 'ta-2', trainee_id: 't-dropped', user_id: TRAINEE_DROPPED_ID, tenant_id: TENANT_A },
    ],
    instructors: [
      { first_name: 'Maria', last_name: 'Clara', email: 'COORD@BMDC.PH', photo_path: '/uploads/inst.jpg' },
    ],
    programs: [
      { id: PROG_A_ID, name: 'Backhoe Loader NC II', tenant_id: TENANT_A },
      { id: PROG_B_ID, name: 'Tenant B Welding', tenant_id: TENANT_B },
    ],
    enrollments: [
      { id: 'enr-1', program_id: PROG_A_ID, trainee_id: 't-ta-only', status: 'enrolled' },
      { id: 'enr-2', program_id: PROG_A_ID, trainee_id: 't-usercol', status: 'completed' },
      { id: 'enr-3', program_id: PROG_A_ID, trainee_id: 't-dropped', status: 'dropped' },
      { id: 'enr-4', program_id: PROG_A_ID, trainee_id: 't-deleted', status: 'enrolled' },
    ],
    conversations: [],
    conversation_participants: [],
    messages: [],
  };
}

describe('MessengerService', () => {
  beforeEach(() => {
    seedBaseStore();
    clearMessengerCaches();
    queryLog = [];
  });

  it('anchors messengerEvents on globalThis so Next.js route chunks share one bus', () => {
    const g = globalThis as typeof globalThis & { __bmdcMessengerEvents?: unknown };
    expect(g.__bmdcMessengerEvents).toBe(messengerEvents);
  });

  it('resolves trainee names and avatars across trainee_accounts, trainees.user_id, and email fallback', async () => {
    const details = await resolveUserDetails([
      TRAINEE_TA_ONLY_ID,
      TRAINEE_USERCOL_ID,
      TRAINEE_EMAIL_ONLY_ID,
      STAFF_COORD_A_ID,
    ]);

    expect(details[TRAINEE_TA_ONLY_ID]).toMatchObject({
      name: 'Juan Dela Cruz',
      role: 'trainee',
      avatar: `/uploads/${TENANT_A}/images/trainees/thumbnails/juan.webp`,
    });
    expect(details[TRAINEE_USERCOL_ID].name).toBe('Ana Reyes');
    expect(details[TRAINEE_EMAIL_ONLY_ID].name).toBe('Carlo Santos');
    expect(details[STAFF_COORD_A_ID]).toMatchObject({
      name: 'Maria Clara',
      avatar: '/uploads/inst.jpg',
    });
  });

  describe('getAvailableContacts (tenant & role scoping)', () => {
    it('lets local_admin/staff see tenant staff, super admins, and active approved trainees only', async () => {
      const contacts = await MessengerService.getAvailableContacts(
        LOCAL_ADMIN_A_ID,
        TENANT_A,
        'local_admin'
      );
      const ids = contacts.map((c) => c.id);

      expect(ids).toContain(SUPER_ADMIN_ID);
      expect(ids).toContain(STAFF_COORD_A_ID);
      expect(ids).toContain(TRAINEE_TA_ONLY_ID);
      expect(ids).toContain(TRAINEE_USERCOL_ID);
      expect(ids).toContain(TRAINEE_EMAIL_ONLY_ID);

      // Excluded: self, orphaned non-tenant staff, cross-tenant admin, soft-deleted, pending
      expect(ids).not.toContain(LOCAL_ADMIN_A_ID);
      expect(ids).not.toContain(ORPHAN_STAFF_ID);
      expect(ids).not.toContain(TENANT_B_ADMIN_ID);
      expect(ids).not.toContain(TRAINEE_DELETED_ID);
      expect(ids).not.toContain(TRAINEE_PENDING_ID);

      // Staff appear before trainees
      const firstTraineeIdx = contacts.findIndex((c) => c.role === 'trainee');
      const lastStaffIdx = contacts.map((c) => c.role !== 'trainee').lastIndexOf(true);
      expect(lastStaffIdx).toBeLessThan(firstTraineeIdx);
    });

    it('restricts trainees to tenant staff and super admins (zero other trainees)', async () => {
      const contacts = await MessengerService.getAvailableContacts(
        TRAINEE_TA_ONLY_ID,
        TENANT_A,
        'trainee'
      );
      const ids = contacts.map((c) => c.id);

      expect(ids).toContain(LOCAL_ADMIN_A_ID);
      expect(ids).toContain(STAFF_COORD_A_ID);
      expect(ids).toContain(SUPER_ADMIN_ID);
      expect(contacts.every((c) => c.role !== 'trainee')).toBe(true);
      expect(ids).not.toContain(ORPHAN_STAFF_ID);
      expect(ids).not.toContain(TENANT_B_ADMIN_ID);
    });

    it('lets super_admin see active users across all active tenants without orphans', async () => {
      const contacts = await MessengerService.getAvailableContacts(
        SUPER_ADMIN_ID,
        'platform',
        'super_admin'
      );
      const ids = contacts.map((c) => c.id);

      expect(ids).toContain(LOCAL_ADMIN_A_ID);
      expect(ids).toContain(TENANT_B_ADMIN_ID);
      expect(ids).toContain(TRAINEE_TA_ONLY_ID);
      expect(ids).not.toContain(ORPHAN_STAFF_ID);
      expect(ids).not.toContain(TRAINEE_DELETED_ID);
      expect(ids).not.toContain(TRAINEE_PENDING_ID);
    });
  });

  describe('getOrCreateDirectConversation', () => {
    it('reuses existing direct conversation even when users also share a program_group chat first', async () => {
      const gcId = '33333333-3333-4333-8333-333333333301';
      const dmId = '33333333-3333-4333-8333-333333333302';
      db.conversations.push(
        { id: gcId, tenant_id: TENANT_A, type: 'program_group', program_id: PROG_A_ID, title: 'GC' },
        { id: dmId, tenant_id: TENANT_A, type: 'direct', program_id: null, title: null }
      );
      // Put program_group BEFORE direct in conversation_participants (reproduces commonPart[0] bug)
      db.conversation_participants.push(
        { conversation_id: gcId, user_id: LOCAL_ADMIN_A_ID },
        { conversation_id: gcId, user_id: TRAINEE_TA_ONLY_ID },
        { conversation_id: dmId, user_id: LOCAL_ADMIN_A_ID },
        { conversation_id: dmId, user_id: TRAINEE_TA_ONLY_ID }
      );

      const resolvedId = await MessengerService.getOrCreateDirectConversation(
        LOCAL_ADMIN_A_ID,
        TRAINEE_TA_ONLY_ID,
        TENANT_A,
        'local_admin'
      );

      expect(resolvedId).toBe(dmId);
      expect(db.conversations.filter((c) => c.type === 'direct')).toHaveLength(1);
    });

    it('blocks trainee-to-trainee DMs with 403 MessengerError', async () => {
      await expect(
        MessengerService.getOrCreateDirectConversation(
          TRAINEE_TA_ONLY_ID,
          TRAINEE_USERCOL_ID,
          TENANT_A,
          'trainee'
        )
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('blocks cross-tenant DMs for non-super-admin users with 403', async () => {
      await expect(
        MessengerService.getOrCreateDirectConversation(
          LOCAL_ADMIN_A_ID,
          TENANT_B_ADMIN_ID,
          TENANT_A,
          'local_admin'
        )
      ).rejects.toMatchObject({ statusCode: 403 });
    });

    it('allows super_admin to DM a tenant trainee using the trainee tenant UUID', async () => {
      const convId = await MessengerService.getOrCreateDirectConversation(
        SUPER_ADMIN_ID,
        TRAINEE_TA_ONLY_ID,
        'platform',
        'super_admin'
      );
      const created = db.conversations.find((c) => c.id === convId);
      expect(created).toBeDefined();
      expect(created.tenant_id).toBe(TENANT_A);
      expect(created.type).toBe('direct');
    });
  });

  describe('syncProgramGroupChatsForUser', () => {
    it('syncs tenant staff, super admins, and active non-dropped trainees while pruning orphaned participants', async () => {
      const existingGcId = '44444444-4444-4444-8444-444444444401';
      db.conversations.push({
        id: existingGcId,
        tenant_id: TENANT_A,
        type: 'program_group',
        program_id: PROG_A_ID,
        title: 'Backhoe Loader NC II (Program GC)',
      });
      // Seed stale orphaned staff + dropped trainee in the existing GC
      db.conversation_participants.push(
        { conversation_id: existingGcId, user_id: LOCAL_ADMIN_A_ID },
        { conversation_id: existingGcId, user_id: ORPHAN_STAFF_ID },
        { conversation_id: existingGcId, user_id: TRAINEE_DROPPED_ID }
      );

      await MessengerService.syncProgramGroupChatsForUser(
        LOCAL_ADMIN_A_ID,
        TENANT_A,
        'local_admin'
      );

      const members = db.conversation_participants
        .filter((p) => p.conversation_id === existingGcId)
        .map((p) => p.user_id);

      // Valid members present (including admin-created trainee via trainee_accounts!)
      expect(members).toEqual(
        expect.arrayContaining([
          LOCAL_ADMIN_A_ID,
          STAFF_COORD_A_ID,
          SUPER_ADMIN_ID,
          TRAINEE_TA_ONLY_ID,
          TRAINEE_USERCOL_ID,
        ])
      );

      // Orphaned staff, dropped trainee, soft-deleted trainee, and other-tenant admin pruned/excluded
      expect(members).not.toContain(ORPHAN_STAFF_ID);
      expect(members).not.toContain(TRAINEE_DROPPED_ID);
      expect(members).not.toContain(TRAINEE_DELETED_ID);
      expect(members).not.toContain(TENANT_B_ADMIN_ID);
    });
  });

  describe('getMessages & unsendMessage', () => {
    it('returns the newest limit messages in ascending chronological order', async () => {
      const convId = '55555555-5555-4555-8555-555555555501';
      db.conversations.push({ id: convId, tenant_id: TENANT_A, type: 'direct' });
      db.conversation_participants.push(
        { conversation_id: convId, user_id: LOCAL_ADMIN_A_ID },
        { conversation_id: convId, user_id: TRAINEE_TA_ONLY_ID }
      );
      for (let i = 1; i <= 5; i++) {
        db.messages.push({
          id: `msg-${i}`,
          conversation_id: convId,
          sender_id: LOCAL_ADMIN_A_ID,
          content: `Message ${i}`,
          is_deleted: false,
          created_at: `2026-11-22T10:0${i}:00.000Z`,
        });
      }

      const recent = await MessengerService.getMessages(convId, LOCAL_ADMIN_A_ID, 2);
      expect(recent.map((m) => m.content)).toEqual(['Message 4', 'Message 5']);
    });

    it('emits scoped recipients on message_unsend and enforces 15-minute window', async () => {
      const convId = '66666666-6666-4666-8666-666666666601';
      db.conversations.push({ id: convId, tenant_id: TENANT_A, type: 'direct' });
      db.conversation_participants.push(
        { conversation_id: convId, user_id: LOCAL_ADMIN_A_ID },
        { conversation_id: convId, user_id: TRAINEE_TA_ONLY_ID }
      );
      db.messages.push(
        {
          id: 'msg-fresh',
          conversation_id: convId,
          sender_id: LOCAL_ADMIN_A_ID,
          content: 'Typo',
          is_deleted: false,
          created_at: new Date(Date.now() - 2 * 60 * 1000).toISOString(),
        },
        {
          id: 'msg-old',
          conversation_id: convId,
          sender_id: LOCAL_ADMIN_A_ID,
          content: 'Too old',
          is_deleted: false,
          created_at: new Date(Date.now() - 20 * 60 * 1000).toISOString(),
        }
      );

      let emitted: any = null;
      const listener = (data: any) => {
        emitted = data;
      };
      messengerEvents.on('message_unsend', listener);

      try {
        await MessengerService.unsendMessage(convId, 'msg-fresh', LOCAL_ADMIN_A_ID);
        expect(emitted).toEqual({
          conversationId: convId,
          messageId: 'msg-fresh',
          recipients: [LOCAL_ADMIN_A_ID, TRAINEE_TA_ONLY_ID],
        });

        await expect(
          MessengerService.unsendMessage(convId, 'msg-old', LOCAL_ADMIN_A_ID)
        ).rejects.toThrow(MessengerError);
      } finally {
        messengerEvents.off('message_unsend', listener);
      }
    });
  });

  describe('Speed Pipeline & TTL Caching', () => {
    it('executes sendMessage in <=2 foreground queries on warm profile cache (0 user/trainee/instructor queries)', async () => {
      const convId = '77777777-7777-4777-8777-777777777701';
      db.conversations.push({ id: convId, tenant_id: TENANT_A, type: 'direct' });
      db.conversation_participants.push(
        { conversation_id: convId, user_id: LOCAL_ADMIN_A_ID },
        { conversation_id: convId, user_id: TRAINEE_TA_ONLY_ID }
      );

      // Warm user profile cache
      await resolveUserDetails([LOCAL_ADMIN_A_ID]);
      queryLog = [];

      let emitted: any = null;
      const onMsg = (data: any) => {
        emitted = data;
      };
      messengerEvents.on('new_message', onMsg);

      try {
        const saved = await MessengerService.sendMessage(convId, LOCAL_ADMIN_A_ID, 'Instant hello');
        expect(saved.senderName).toBe('Local Admin');
        expect(saved.content).toBe('Instant hello');
        expect(emitted?.recipients).toEqual([LOCAL_ADMIN_A_ID, TRAINEE_TA_ONLY_ID]);

        const participantSelects = queryLog.filter(
          (q) => q.table === 'conversation_participants' && q.op === 'select'
        );
        const messageInserts = queryLog.filter((q) => q.table === 'messages' && q.op === 'insert');
        const profileReads = queryLog.filter((q) =>
          ['users', 'trainees', 'trainee_accounts', 'instructors'].includes(q.table)
        );

        expect(participantSelects).toHaveLength(1);
        expect(messageInserts).toHaveLength(1);
        expect(profileReads).toHaveLength(0);
      } finally {
        messengerEvents.off('new_message', onMsg);
      }
    });

    it('fetches conversation + messages in a single participant membership pass via getConversationWithMessages', async () => {
      const convId = '88888888-8888-4888-8888-888888888801';
      db.conversations.push({ id: convId, tenant_id: TENANT_A, type: 'direct' });
      db.conversation_participants.push(
        { conversation_id: convId, user_id: LOCAL_ADMIN_A_ID },
        { conversation_id: convId, user_id: TRAINEE_TA_ONLY_ID }
      );
      db.messages.push(
        {
          id: 'm1',
          conversation_id: convId,
          sender_id: LOCAL_ADMIN_A_ID,
          content: 'First',
          is_deleted: false,
          created_at: '2026-11-23T10:00:00.000Z',
        },
        {
          id: 'm2',
          conversation_id: convId,
          sender_id: TRAINEE_TA_ONLY_ID,
          content: 'Second',
          is_deleted: false,
          created_at: '2026-11-23T10:01:00.000Z',
        }
      );

      await resolveUserDetails([LOCAL_ADMIN_A_ID, TRAINEE_TA_ONLY_ID]);
      queryLog = [];

      const { conversation, messages } = await MessengerService.getConversationWithMessages(
        convId,
        LOCAL_ADMIN_A_ID
      );

      expect(conversation.title).toBe('Juan Dela Cruz');
      expect(messages.map((m) => m.content)).toEqual(['First', 'Second']);
      expect(
        queryLog.filter((q) => q.table === 'conversation_participants' && q.op === 'select')
      ).toHaveLength(1);
      expect(queryLog.filter((q) => q.table === 'users')).toHaveLength(0);
    });

    it('caches resolveUserDetails for 5 minutes and skips redundant Program GC sync within 60s unless forceSync=true', async () => {
      // 1. User profile TTL cache hit
      await resolveUserDetails([TRAINEE_TA_ONLY_ID]);
      queryLog = [];
      const cachedDetails = await resolveUserDetails([TRAINEE_TA_ONLY_ID]);
      expect(cachedDetails[TRAINEE_TA_ONLY_ID].name).toBe('Juan Dela Cruz');
      expect(queryLog).toHaveLength(0);

      // 2. Program GC sync TTL hit on second listUserConversations call
      await MessengerService.listUserConversations(LOCAL_ADMIN_A_ID, TENANT_A, 'local_admin');
      queryLog = [];
      await MessengerService.listUserConversations(LOCAL_ADMIN_A_ID, TENANT_A, 'local_admin');
      expect(queryLog.filter((q) => q.table === 'programs' || q.table === 'enrollments')).toHaveLength(0);

      // 3. forceSync=true bypasses TTL cleanly
      queryLog = [];
      await MessengerService.listUserConversations(LOCAL_ADMIN_A_ID, TENANT_A, 'local_admin', {
        forceSync: true,
      });
      expect(queryLog.filter((q) => q.table === 'programs').length).toBeGreaterThan(0);
    });
  });
});
