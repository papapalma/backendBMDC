import { evaluateNeedsAttendance, formatHHMM12 } from './traineeAttendanceStatus';

describe('evaluateNeedsAttendance (high signal-to-noise gating)', () => {
  it('returns false when there is no session, day is excluded, or trainee is excused', () => {
    expect(
      evaluateNeedsAttendance({
        hasSession: false,
        isExcludedDay: false,
        isExcused: false,
        morningDone: false,
        afternoonDone: false,
        windowSessionLabel: 'morning',
        hasSchedule: true,
      })
    ).toEqual({ needsAttendance: false, pendingSessionLabel: null });

    expect(
      evaluateNeedsAttendance({
        hasSession: true,
        isExcludedDay: true,
        isExcused: false,
        morningDone: false,
        afternoonDone: false,
        windowSessionLabel: 'morning',
        hasSchedule: true,
      })
    ).toEqual({ needsAttendance: false, pendingSessionLabel: null });

    expect(
      evaluateNeedsAttendance({
        hasSession: true,
        isExcludedDay: false,
        isExcused: true,
        morningDone: false,
        afternoonDone: false,
        windowSessionLabel: 'afternoon',
        hasSchedule: true,
      })
    ).toEqual({ needsAttendance: false, pendingSessionLabel: null });
  });

  it('flags morning check-in when pending and clears immediately once morning is done', () => {
    expect(
      evaluateNeedsAttendance({
        hasSession: true,
        isExcludedDay: false,
        isExcused: false,
        morningDone: false,
        afternoonDone: false,
        windowSessionLabel: 'morning',
        hasSchedule: true,
      })
    ).toEqual({ needsAttendance: true, pendingSessionLabel: 'morning' });

    expect(
      evaluateNeedsAttendance({
        hasSession: true,
        isExcludedDay: false,
        isExcused: false,
        morningDone: true,
        afternoonDone: false,
        windowSessionLabel: 'morning',
        hasSchedule: true,
      })
    ).toEqual({ needsAttendance: false, pendingSessionLabel: null });
  });

  it('flags afternoon check-in when afternoon slot is active/next and clears once submitted', () => {
    expect(
      evaluateNeedsAttendance({
        hasSession: true,
        isExcludedDay: false,
        isExcused: false,
        morningDone: true,
        afternoonDone: false,
        windowSessionLabel: 'afternoon',
        hasSchedule: true,
      })
    ).toEqual({ needsAttendance: true, pendingSessionLabel: 'afternoon' });

    expect(
      evaluateNeedsAttendance({
        hasSession: true,
        isExcludedDay: false,
        isExcused: false,
        morningDone: true,
        afternoonDone: true,
        windowSessionLabel: 'afternoon',
        hasSchedule: true,
      })
    ).toEqual({ needsAttendance: false, pendingSessionLabel: null });
  });

  it('after both windows pass, stays quiet if trainee checked in and flags only if completely missed', () => {
    expect(
      evaluateNeedsAttendance({
        hasSession: true,
        isExcludedDay: false,
        isExcused: false,
        morningDone: true,
        afternoonDone: false,
        windowSessionLabel: null,
        hasSchedule: true,
      })
    ).toEqual({ needsAttendance: false, pendingSessionLabel: null });

    expect(
      evaluateNeedsAttendance({
        hasSession: true,
        isExcludedDay: false,
        isExcused: false,
        morningDone: false,
        afternoonDone: false,
        windowSessionLabel: null,
        hasSchedule: true,
      })
    ).toEqual({ needsAttendance: true, pendingSessionLabel: null });
  });

  it('formats 24-hour HH:MM strings to readable 12-hour labels', () => {
    expect(formatHHMM12('07:30:00')).toBe('7:30 AM');
    expect(formatHHMM12('16:00:00')).toBe('4:00 PM');
    expect(formatHHMM12('00:15')).toBe('12:15 AM');
  });
});
