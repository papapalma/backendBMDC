/**
 * Attendance Window, Late Cutoff & Independent Half-Day Session Tests
 *
 * Verifies:
 * 1. Window stays open for the full [open, close) range (not prematurely closing at open + late_threshold).
 * 2. Check-ins within [open, open + late_threshold] are marked 'present';
 *    check-ins within (open + late_threshold, close) are marked 'late' with exact late_duration_minutes.
 * 3. Schedule metadata fields (morning_open, morning_close, etc.) are included in getCurrentWindowStatus.
 * 4. Afternoon sessions can be submitted independently when Morning was missed (marking morning_status = 'absent').
 */

import * as timezone from '@/lib/timezone';
import { supabaseAdmin } from '@/lib/supabase-admin';
import { attendanceService } from '@/services/attendanceService';

jest.mock('@/lib/timezone', () => ({
  getNowHHMMInPHT: jest.fn(),
  getPHTDateComponents: jest.fn(() => ({ year: 2026, month: 10, date: 24 })), // 2026-11-24
  calculateDateRangeInPHT: jest.fn(),
}));

jest.mock('@/lib/supabase-admin', () => ({
  supabaseAdmin: {
    from: jest.fn(),
  },
}));

const BASE_WINDOW = {
  schedule_id: '11111111-1111-1111-1111-111111111111',
  morning_open: '07:30',
  morning_close: '08:30',
  morning_late_threshold: 15,
  afternoon_open: '13:00',
  afternoon_close: '14:00',
  afternoon_late_threshold: 15,
};

describe('AttendanceService Window & Late Cutoff Logic', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    jest.clearAllMocks();
  });

  it('keeps morning window OPEN past the 15-min late threshold up until morning_close', async () => {
    jest.spyOn(attendanceService, 'getActiveSchedule').mockResolvedValue(BASE_WINDOW);

    // 07:35 -> open (on-time part of window)
    (timezone.getNowHHMMInPHT as jest.Mock).mockReturnValue('07:35');
    const onTimeStatus = await attendanceService.getCurrentWindowStatus('prog-1', 'tenant-1');
    expect(onTimeStatus.isOpen).toBe(true);
    expect(onTimeStatus.session_label).toBe('morning');
    expect(onTimeStatus.morning_open).toBe('07:30');
    expect(onTimeStatus.morning_close).toBe('08:30');

    // 07:50 -> STILL OPEN (15-min threshold passed at 07:45, but window closes at 08:30)
    (timezone.getNowHHMMInPHT as jest.Mock).mockReturnValue('07:50');
    const lateWindowStatus = await attendanceService.getCurrentWindowStatus('prog-1', 'tenant-1');
    expect(lateWindowStatus.isOpen).toBe(true);
    expect(lateWindowStatus.session_label).toBe('morning');
    expect(lateWindowStatus.seconds_until_close).toBe(40 * 60);

    // 08:30 -> CLOSED, counting down to afternoon_open (13:00)
    (timezone.getNowHHMMInPHT as jest.Mock).mockReturnValue('08:30');
    const betweenStatus = await attendanceService.getCurrentWindowStatus('prog-1', 'tenant-1');
    expect(betweenStatus.isOpen).toBe(false);
    expect(betweenStatus.session_label).toBe('afternoon');
    expect(betweenStatus.window_open).toBe('13:00');
  });

  it('marks check-in as late with exact late_duration_minutes when submitted after open + threshold', async () => {
    jest.spyOn(attendanceService, 'getActiveSchedule').mockResolvedValue(BASE_WINDOW);
    // 07:52 is 7 minutes past 07:45 (07:30 + 15m)
    (timezone.getNowHHMMInPHT as jest.Mock).mockReturnValue('07:52');

    let capturedUpsertPayload: Record<string, unknown> | null = null;

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'program_sessions') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { program_id: 'prog-1', session_date: '2026-11-24' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'attendance') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
          upsert: (payload: Record<string, unknown>) => {
            capturedUpsertPayload = payload;
            return {
              select: () => ({
                single: async () => ({
                  data: { id: 'att-1', ...payload, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                  error: null,
                }),
              }),
            };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await attendanceService.submitTraineeAttendance({
      trainee_id: 'trainee-1',
      session_id: 'sess-1',
      session_label: 'morning',
      selfie_path: '/uploads/t1/images/attendance/selfie.jpg',
      tenant_id: 'tenant-1',
    });

    expect(result.status).toBe('late');
    expect(capturedUpsertPayload).toMatchObject({
      morning_status: 'late',
      status: 'late',
      late_duration_minutes: 7,
    });
  });

  it('allows independent afternoon submission when morning was missed and marks morning_status absent', async () => {
    jest.spyOn(attendanceService, 'getActiveSchedule').mockResolvedValue(BASE_WINDOW);
    // 13:05 -> on-time afternoon, morning (08:30) already closed
    (timezone.getNowHHMMInPHT as jest.Mock).mockReturnValue('13:05');

    let capturedUpsertPayload: Record<string, unknown> | null = null;

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'program_sessions') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { program_id: 'prog-1', session_date: '2026-11-24' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'attendance') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({ data: null, error: null }),
              }),
            }),
          }),
          upsert: (payload: Record<string, unknown>) => {
            capturedUpsertPayload = payload;
            return {
              select: () => ({
                single: async () => ({
                  data: { id: 'att-2', ...payload, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                  error: null,
                }),
              }),
            };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    const result = await attendanceService.submitTraineeAttendance({
      trainee_id: 'trainee-1',
      session_id: 'sess-1',
      session_label: 'afternoon',
      selfie_path: '/uploads/t1/images/attendance/selfie_pm.jpg',
      tenant_id: 'tenant-1',
    });

    expect(result.status).toBe('present');
    expect(capturedUpsertPayload).toMatchObject({
      morning_status: 'absent',
      afternoon_status: 'present',
      status: 'present',
      late_duration_minutes: 0,
    });
  });

  it('preserves existing morning GPS coordinates when an afternoon upsert omits GPS', async () => {
    jest.spyOn(attendanceService, 'getActiveSchedule').mockResolvedValue(BASE_WINDOW);
    (timezone.getNowHHMMInPHT as jest.Mock).mockReturnValue('13:05');

    let capturedUpsertPayload: Record<string, unknown> | null = null;

    (supabaseAdmin.from as jest.Mock).mockImplementation((table: string) => {
      if (table === 'program_sessions') {
        return {
          select: () => ({
            eq: () => ({
              single: async () => ({ data: { program_id: 'prog-1', session_date: '2026-11-24' }, error: null }),
            }),
          }),
        };
      }
      if (table === 'attendance') {
        return {
          select: () => ({
            eq: () => ({
              eq: () => ({
                maybeSingle: async () => ({
                  data: {
                    id: 'att-existing',
                    attempt_number: 1,
                    morning_status: 'present',
                    afternoon_status: null,
                    late_duration_minutes: 0,
                    gps_lat: 12.7481,
                    gps_lng: 121.4868,
                    gps_accuracy: 18.5,
                    gps_address: 'Poblacion, Bongabong, Oriental Mindoro',
                  },
                  error: null,
                }),
              }),
            }),
          }),
          upsert: (payload: Record<string, unknown>) => {
            capturedUpsertPayload = payload;
            return {
              select: () => ({
                single: async () => ({
                  data: { id: 'att-existing', ...payload, created_at: new Date().toISOString(), updated_at: new Date().toISOString() },
                  error: null,
                }),
              }),
            };
          },
        };
      }
      throw new Error(`Unexpected table ${table}`);
    });

    await attendanceService.submitTraineeAttendance({
      trainee_id: 'trainee-1',
      session_id: 'sess-1',
      session_label: 'afternoon',
      selfie_path: '/uploads/t1/images/attendance/selfie_pm.jpg',
      tenant_id: 'tenant-1',
    });

    expect(capturedUpsertPayload).toMatchObject({
      gps_lat: 12.7481,
      gps_lng: 121.4868,
      gps_accuracy: 18.5,
      gps_address: 'Poblacion, Bongabong, Oriental Mindoro',
    });
  });
});
