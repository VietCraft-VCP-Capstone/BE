export const POD_REASON_CODES = ['R01', 'R01A', 'R02', 'R03', 'R04', 'R05', 'R06', 'R07', 'R08', 'R09', 'R13'] as const;
export type PodReasonCode = typeof POD_REASON_CODES[number];
export type ReturnPolicyId = 'P01' | 'P02' | 'P03' | 'P04' | 'P05' | 'P07' | 'P09' | 'P14' | 'P16' | 'P17' | 'R06_DELIVERED';
export type ReturnResolution = 'EXCHANGE' | 'REFUND';

const HOUR_MS = 60 * 60 * 1000;
export const R06_DELIVERED_WINDOW_HOURS = 168;
const DAY_MS = 24 * HOUR_MS;
const VN_TIME_ZONE = 'Asia/Ho_Chi_Minh';
const DAY_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: VN_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
});
const DATETIME_FORMATTER = new Intl.DateTimeFormat('en-CA', {
    timeZone: VN_TIME_ZONE,
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23',
});

export interface VerifiedDeliveredEvent {
    eventId: string;
    occurredAt: Date;
    verified: boolean;
}

export interface DeliveredEventSource {
    getVerifiedDeliveredEvent(orderId: string, orderItemId: string): Promise<VerifiedDeliveredEvent | null>;
}

export interface R06TrackingEvidence {
    status: 'IN_TRANSIT' | 'LOST' | 'RETURNED' | 'DELIVERED' | 'UNKNOWN';
    eventId: string;
    eventOccurredAt: Date;
    sourceAssigned: boolean;
    verified: boolean;
    latestEta?: Date | null;
    conflicting?: boolean;
}

export type PodEligibilityResult =
    | { kind: 'ELIGIBLE'; reasonCode: PodReasonCode; policyId: 'P01' | 'P02' | 'P07' | 'R06_DELIVERED'; deadline: Date | null; allowedResolutions: readonly ReturnResolution[]; adminReviewRequired: boolean }
    | { kind: 'EXPIRED'; reasonCode: PodReasonCode; policyId: 'P01' | 'P02' | 'R06_DELIVERED'; deadline: Date }
    | { kind: 'NOT_YET_ELIGIBLE'; reasonCode: 'R06'; policyId: 'P07'; eligibleAt: Date }
    | { kind: 'ADMIN_REVIEW'; reason: string }
    | { kind: 'FEATURE_DISABLED'; reason: 'NORMAL_DISABLED' }
    | { kind: 'INELIGIBLE'; reason: string };

export interface PodEligibilityInput {
    reasonCode: string | null | undefined;
    now: Date;
    deliveredEvent: VerifiedDeliveredEvent | null;
    r06Tracking?: R06TrackingEvidence;
    r06DeliveredWindowHours?: number;
    conflictingEvidence?: boolean;
}

const allowedResolutionByReason: Partial<Record<PodReasonCode, readonly ReturnResolution[]>> = {
    R01: ['EXCHANGE', 'REFUND'],
    R01A: ['REFUND'],
    R02: ['EXCHANGE', 'REFUND'],
    R03: ['EXCHANGE', 'REFUND'],
    R04: ['EXCHANGE', 'REFUND'],
    R05: ['EXCHANGE', 'REFUND'],
    R06: ['REFUND'],
    R07: ['REFUND'],
    R08: ['REFUND'],
    R09: ['REFUND'],
};

function validDate(value: unknown): value is Date {
    return value instanceof Date && Number.isFinite(value.getTime());
}

function isPodReasonCode(value: string): value is PodReasonCode {
    return (POD_REASON_CODES as readonly string[]).includes(value);
}

export function isDeadlineExpired(now: Date, deadline: Date): boolean {
    return now.getTime() > deadline.getTime();
}

export function calculateR06DeliveredDeadline(anchor: Date, configuredHours = 168): Date | null {
    if (!validDate(anchor) || !Number.isFinite(configuredHours) || configuredHours <= 0) return null;
    return new Date(anchor.getTime() + configuredHours * HOUR_MS);
}

export function inferDefaultFaultParty(
    reasonCode: string,
    evidence?: { dpiWarning?: boolean; r06Source?: 'CARRIER' | 'PRINTER' | null; sourceVerified?: boolean },
): 'BUYER' | 'SELLER' | 'PRINTER' | 'CARRIER' | 'PLATFORM' | null {
    const reason = reasonCode.trim().toUpperCase();
    if (!isPodReasonCode(reason)) return null;
    if (reason === 'R01A' || reason === 'R07') return null;
    if (reason === 'R06') return evidence?.sourceVerified === true ? evidence.r06Source ?? null : null;
    const reasonDefaults: Partial<Record<PodReasonCode, 'BUYER' | 'SELLER' | 'PRINTER' | 'CARRIER' | 'PLATFORM'>> = {
        R01: 'PRINTER', R02: 'PRINTER', R03: 'PRINTER', R04: 'PRINTER', R05: 'CARRIER',
        R08: 'SELLER', R09: 'PLATFORM', R13: 'BUYER',
    };
    return reasonDefaults[reason] ?? null;
}

export function calculateFixedDeadline(policyId: ReturnPolicyId, anchor: Date): Date | null {
    if (!validDate(anchor)) return null;
    const hours: Partial<Record<ReturnPolicyId, number>> = {
        P01: 72, P02: 168, P03: 48, P04: 72, P05: 72, P14: 72, P16: 24, P17: 14 * 24, R06_DELIVERED: 168,
    };
    const durationHours = hours[policyId];
    if (durationHours === undefined) return null;
    return new Date(anchor.getTime() + durationHours * HOUR_MS);
}

function vnParts(date: Date): { year: number; month: number; day: number; hour: number; minute: number; second: number; millisecond: number } | null {
    if (!validDate(date)) return null;
    const parts = Object.fromEntries(DATETIME_FORMATTER.formatToParts(date).map(part => [part.type, part.value]));
    const year = Number(parts.year), month = Number(parts.month), day = Number(parts.day);
    const hour = Number(parts.hour), minute = Number(parts.minute), second = Number(parts.second);
    if (![year, month, day, hour, minute, second].every(Number.isFinite)) return null;
    return { year, month, day, hour, minute, second, millisecond: date.getUTCMilliseconds() };
}

function localDayKey(year: number, month: number, day: number): string {
    return `${year.toString().padStart(4, '0')}-${month.toString().padStart(2, '0')}-${day.toString().padStart(2, '0')}`;
}

function vnOffsetMs(utcGuess: number): number | null {
    const parts = vnParts(new Date(utcGuess));
    if (!parts) return null;
    return Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond) - utcGuess;
}

function vnWallTimeToUtc(parts: ReturnType<typeof vnParts>): Date | null {
    if (!parts) return null;
    const wallAsUtc = Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second, parts.millisecond);
    const firstOffset = vnOffsetMs(wallAsUtc);
    if (firstOffset === null) return null;
    const candidate = wallAsUtc - firstOffset;
    const checkedOffset = vnOffsetMs(candidate);
    if (checkedOffset === null) return null;
    return new Date(wallAsUtc - checkedOffset);
}

function parseIsoDay(day: string): { year: number; month: number; date: number } | null {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(day);
    if (!match) return null;
    const year = Number(match[1]), month = Number(match[2]), date = Number(match[3]);
    const check = new Date(Date.UTC(year, month - 1, date));
    if (check.getUTCFullYear() !== year || check.getUTCMonth() !== month - 1 || check.getUTCDate() !== date) return null;
    return { year, month, date };
}

export interface P09HolidayCalendar {
    version: string;
    holidaysByYear: Readonly<Record<string, readonly string[]>>;
}

export type P09DeadlineResult =
    | { kind: 'DEADLINE'; deadline: Date; calendarVersion: string }
    | { kind: 'ADMIN_REVIEW'; reason: string };

export function calculateP09Deadline(anchor: Date, calendar: P09HolidayCalendar | null | undefined): P09DeadlineResult {
    if (!validDate(anchor)) return { kind: 'ADMIN_REVIEW', reason: 'Mốc P09 không hợp lệ.' };
    if (!calendar || !calendar.version.trim() || !calendar.holidaysByYear) {
        return { kind: 'ADMIN_REVIEW', reason: 'Thiếu calendar P09 có version.' };
    }
    const local = vnParts(anchor);
    if (!local) return { kind: 'ADMIN_REVIEW', reason: 'Không đọc được giờ Asia/Ho_Chi_Minh.' };
    let cursor = Date.UTC(local.year, local.month - 1, local.day);
    let businessDaysAdded = 0;
    let daysVisited = 0;
    while (businessDaysAdded < 3 && daysVisited < 370) {
        cursor += DAY_MS;
        daysVisited += 1;
        const date = new Date(cursor);
        const year = date.getUTCFullYear();
        const yearKey = String(year);
        const holidays = calendar.holidaysByYear[yearKey];
        if (!Array.isArray(holidays)) {
            return { kind: 'ADMIN_REVIEW', reason: `Thiếu dữ liệu ngày lễ P09 cho năm ${yearKey}.` };
        }
        const parsedHolidays = holidays.map(parseIsoDay);
        if (parsedHolidays.some(item => item === null || item.year !== year)) {
            return { kind: 'ADMIN_REVIEW', reason: `Calendar P09 ${calendar.version} có ngày lễ không hợp lệ cho năm ${yearKey}.` };
        }
        const weekday = date.getUTCDay();
        const key = localDayKey(year, date.getUTCMonth() + 1, date.getUTCDate());
        if (weekday !== 0 && weekday !== 6 && !holidays.includes(key)) businessDaysAdded += 1;
    }
    if (businessDaysAdded !== 3) return { kind: 'ADMIN_REVIEW', reason: 'Không thể tính deadline P09 an toàn.' };
    const targetDate = new Date(cursor);
    const deadline = vnWallTimeToUtc({
        ...local,
        year: targetDate.getUTCFullYear(),
        month: targetDate.getUTCMonth() + 1,
        day: targetDate.getUTCDate(),
    });
    if (!deadline) return { kind: 'ADMIN_REVIEW', reason: 'Không thể chuyển giờ Asia/Ho_Chi_Minh sang UTC.' };
    return { kind: 'DEADLINE', deadline, calendarVersion: calendar.version };
}

function makeEligible(
    reasonCode: PodReasonCode,
    policyId: 'P01' | 'P02' | 'P07' | 'R06_DELIVERED',
    deadline: Date | null,
): PodEligibilityResult {
    return {
        kind: 'ELIGIBLE', reasonCode, policyId, deadline,
        allowedResolutions: allowedResolutionByReason[reasonCode] ?? [],
        adminReviewRequired: reasonCode === 'R08',
    };
}

export function evaluatePodEligibility(input: PodEligibilityInput): PodEligibilityResult {
    if (!validDate(input.now)) return { kind: 'ADMIN_REVIEW', reason: 'Thời điểm kiểm tra không hợp lệ.' };
    if (input.conflictingEvidence) return { kind: 'ADMIN_REVIEW', reason: 'Dữ liệu đơn hàng hoặc sự kiện đang mâu thuẫn.' };
    const rawReason = input.reasonCode?.trim().toUpperCase();
    if (!rawReason) return { kind: 'ADMIN_REVIEW', reason: 'Thiếu mã lý do; cần Admin review.' };
    if (rawReason === 'R99') return { kind: 'ADMIN_REVIEW', reason: 'R99 cần Admin phân loại; không tự gán fault/deadline.' };
    if (rawReason === 'R10' || rawReason === 'R11') return { kind: 'FEATURE_DISABLED', reason: 'NORMAL_DISABLED' };
    if (!isPodReasonCode(rawReason)) return { kind: 'INELIGIBLE', reason: 'Lý do không được hỗ trợ cho yêu cầu POD.' };
    if (rawReason === 'R08') return { kind: 'ADMIN_REVIEW', reason: 'R08 được chuyển trực tiếp Admin review.' };

    if (rawReason === 'R06') {
        if (input.deliveredEvent) {
            const event = input.deliveredEvent;
            if (!event.verified || !event.eventId.trim() || !validDate(event.occurredAt) || event.occurredAt.getTime() > input.now.getTime()) {
                return { kind: 'ADMIN_REVIEW', reason: 'Sự kiện Delivered thiếu xác thực hoặc timestamp hợp lệ.' };
            }
            const configuredHours = input.r06DeliveredWindowHours ?? R06_DELIVERED_WINDOW_HOURS;
            const deadline = calculateR06DeliveredDeadline(event.occurredAt, configuredHours);
            if (!deadline) return { kind: 'ADMIN_REVIEW', reason: 'Cấu hình deadline riêng của R06 không hợp lệ.' };
            if (isDeadlineExpired(input.now, deadline)) return { kind: 'EXPIRED', reasonCode: 'R06', policyId: 'R06_DELIVERED', deadline };
            return makeEligible('R06', 'R06_DELIVERED', deadline);
        }
        const tracking = input.r06Tracking;
        if (!tracking || tracking.conflicting || tracking.status === 'UNKNOWN') {
            return { kind: 'ADMIN_REVIEW', reason: 'Thiếu hoặc xung đột tracking cho R06.' };
        }
        if (!tracking.eventId?.trim() || !tracking.sourceAssigned || !tracking.verified || !validDate(tracking.eventOccurredAt) || tracking.eventOccurredAt.getTime() > input.now.getTime()) {
            return { kind: 'ADMIN_REVIEW', reason: 'Tracking R06 thiếu event được gán/xác thực hoặc có timestamp tương lai.' };
        }
        if (tracking.status === 'LOST' || tracking.status === 'RETURNED') return makeEligible('R06', 'P07', null);
        if (tracking.status === 'DELIVERED') {
            const deadline=calculateR06DeliveredDeadline(tracking.eventOccurredAt,input.r06DeliveredWindowHours ?? R06_DELIVERED_WINDOW_HOURS);
            if(!deadline) return {kind:'ADMIN_REVIEW',reason:'Cấu hình deadline riêng của R06 không hợp lệ.'};
            if(isDeadlineExpired(input.now,deadline)) return {kind:'EXPIRED',reasonCode:'R06',policyId:'R06_DELIVERED',deadline};
            return makeEligible('R06','R06_DELIVERED',deadline);
        }
        if (!validDate(tracking.latestEta)) return { kind: 'ADMIN_REVIEW', reason: 'Thiếu ETA hợp lệ cho R06 đang vận chuyển.' };
        if (tracking.latestEta.getTime() < tracking.eventOccurredAt.getTime()) {
            return { kind: 'ADMIN_REVIEW', reason: 'ETA tracking R06 cũ hơn event đã xác thực.' };
        }
        const eligibleAt = new Date(tracking.latestEta.getTime() + 7 * DAY_MS);
        if (input.now.getTime() < eligibleAt.getTime()) return { kind: 'NOT_YET_ELIGIBLE', reasonCode: 'R06', policyId: 'P07', eligibleAt };
        return makeEligible('R06', 'P07', null);
    }

    if (!input.deliveredEvent || !input.deliveredEvent.verified || !input.deliveredEvent.eventId.trim() || !validDate(input.deliveredEvent.occurredAt) || input.deliveredEvent.occurredAt.getTime() > input.now.getTime()) {
        return { kind: 'ADMIN_REVIEW', reason: 'Thiếu sự kiện Delivered đã xác thực; không thể tự suy deadline.' };
    }
    const deadline = calculateFixedDeadline('P01', input.deliveredEvent.occurredAt);
    if (!deadline) return { kind: 'ADMIN_REVIEW', reason: 'Không thể tính deadline P01.' };
    const normalized = rawReason as PodReasonCode;
    if (isDeadlineExpired(input.now, deadline)) return { kind: 'EXPIRED', reasonCode: normalized, policyId: 'P01', deadline };
    return makeEligible(normalized, 'P01', deadline);
}

export async function evaluatePodEligibilityFromSource(
    input: Omit<PodEligibilityInput, 'deliveredEvent'> & { orderId: string; orderItemId: string },
    source: DeliveredEventSource,
): Promise<PodEligibilityResult> {
    try {
        const deliveredEvent = await source.getVerifiedDeliveredEvent(input.orderId, input.orderItemId);
        return evaluatePodEligibility({ ...input, deliveredEvent });
    } catch {
        return { kind: 'ADMIN_REVIEW', reason: 'Không truy xuất được sự kiện Delivered đã xác thực.' };
    }
}

export interface TimerPauseInterval {
    reason: 'P16' | 'STOCK_WAIT';
    startedAt: Date;
    endedAt: Date | null;
}

export type ActiveTimerResult =
    | { kind: 'RUNNING'; deadline: Date; remainingMs: number }
    | { kind: 'PAUSED'; deadline: null; remainingMs: number }
    | { kind: 'EXPIRED'; deadline: Date; remainingMs: 0 }
    | { kind: 'ADMIN_REVIEW'; reason: string };

export function calculateActiveTimer(
    anchor: Date,
    durationMs: number,
    pauses: readonly TimerPauseInterval[],
    now: Date,
): ActiveTimerResult {
    if (!validDate(anchor) || !validDate(now) || !Number.isFinite(durationMs) || durationMs <= 0 || now.getTime() < anchor.getTime()) {
        return { kind: 'ADMIN_REVIEW', reason: 'Mốc hoặc duration của timer không hợp lệ.' };
    }
    let previousEnd = anchor.getTime();
    let pausedDuration = 0;
    let openPause = false;
    const pauseCounts = { P16: 0, STOCK_WAIT: 0 };
    const pauseCaps = { P16: 24 * HOUR_MS, STOCK_WAIT: 14 * DAY_MS };
    for (const pause of pauses) {
        if (!pause || (pause.reason !== 'P16' && pause.reason !== 'STOCK_WAIT')) {
            return { kind: 'ADMIN_REVIEW', reason: 'Lý do pause P03 không hợp lệ.' };
        }
        pauseCounts[pause.reason] += 1;
        if (pauseCounts[pause.reason] > 1) return { kind: 'ADMIN_REVIEW', reason: `Pause ${pause.reason} chỉ được dùng một lần.` };
        if (!validDate(pause.startedAt) || pause.startedAt.getTime() < previousEnd || pause.startedAt.getTime() > now.getTime()) {
            return { kind: 'ADMIN_REVIEW', reason: 'Khoảng pause P03 không hợp lệ hoặc bị chồng lấn.' };
        }
        const activeElapsedAtPause = pause.startedAt.getTime() - anchor.getTime() - pausedDuration;
        if (activeElapsedAtPause > durationMs) {
            return { kind: 'ADMIN_REVIEW', reason: 'Pause P03 bắt đầu sau khi thời hạn hoạt động đã hết.' };
        }
        if (pause.endedAt === null) {
            if (openPause || pause !== pauses[pauses.length - 1]) return { kind: 'ADMIN_REVIEW', reason: 'Chỉ pause cuối cùng mới được mở.' };
            const elapsed = now.getTime() - pause.startedAt.getTime();
            if (elapsed > pauseCaps[pause.reason]) return { kind: 'ADMIN_REVIEW', reason: `Pause ${pause.reason} đã vượt hạn tối đa.` };
            openPause = true;
            const remainingMs = Math.max(0, durationMs - (pause.startedAt.getTime() - anchor.getTime() - pausedDuration));
            return { kind: 'PAUSED', deadline: null, remainingMs };
        }
        if (!validDate(pause.endedAt) || pause.endedAt.getTime() < pause.startedAt.getTime() || pause.endedAt.getTime() > now.getTime()) {
            return { kind: 'ADMIN_REVIEW', reason: 'Thời điểm kết thúc pause P03 không hợp lệ.' };
        }
        const pauseDuration = pause.endedAt.getTime() - pause.startedAt.getTime();
        if (pauseDuration > pauseCaps[pause.reason]) return { kind: 'ADMIN_REVIEW', reason: `Pause ${pause.reason} đã vượt hạn tối đa.` };
        pausedDuration += pauseDuration;
        previousEnd = pause.endedAt.getTime();
    }
    if (openPause) return { kind: 'ADMIN_REVIEW', reason: 'Không thể tính trạng thái pause P03.' };
    const deadline = new Date(anchor.getTime() + durationMs + pausedDuration);
    const remainingMs = deadline.getTime() - now.getTime();
    if (remainingMs < 0) return { kind: 'EXPIRED', deadline, remainingMs: 0 };
    return { kind: 'RUNNING', deadline, remainingMs };
}

export type AnchoredWindowPolicy = 'P04' | 'P05' | 'P14' | 'P17';
export type AnchoredWindowResult =
    | { kind: 'OPEN'; policyId: AnchoredWindowPolicy; deadline: Date }
    | { kind: 'EXPIRED'; policyId: AnchoredWindowPolicy; deadline: Date }
    | { kind: 'ADMIN_REVIEW'; reason: string };

export function evaluateAnchoredWindow(policyId: AnchoredWindowPolicy, anchor: Date, now: Date): AnchoredWindowResult {
    if (!validDate(anchor) || !validDate(now) || now.getTime() < anchor.getTime()) {
        return { kind: 'ADMIN_REVIEW', reason: `Mốc thời gian ${policyId} không hợp lệ.` };
    }
    const durationHours: Record<AnchoredWindowPolicy, number> = { P04: 72, P05: 72, P14: 72, P17: 14 * 24 };
    const deadline = new Date(anchor.getTime() + durationHours[policyId] * HOUR_MS);
    return isDeadlineExpired(now, deadline)
        ? { kind: 'EXPIRED', policyId, deadline }
        : { kind: 'OPEN', policyId, deadline };
}

export function calculateP03Timer(anchor: Date, pauses: readonly TimerPauseInterval[], now: Date): ActiveTimerResult {
    return calculateActiveTimer(anchor, 48 * HOUR_MS, pauses, now);
}

export type P16EvidenceWindowResult =
    | { kind: 'ALLOWED'; deadline: Date }
    | { kind: 'ALREADY_USED' }
    | { kind: 'EXPIRED'; deadline: Date }
    | { kind: 'ADMIN_REVIEW'; reason: string };

export function evaluateP16EvidenceWindow(input: {
    requestedAt: Date;
    requestsAlreadyUsed: number;
    now: Date;
}): P16EvidenceWindowResult {
    if (!validDate(input.requestedAt) || !validDate(input.now) || input.now.getTime() < input.requestedAt.getTime() || !Number.isInteger(input.requestsAlreadyUsed) || input.requestsAlreadyUsed < 0) {
        return { kind: 'ADMIN_REVIEW', reason: 'Dữ liệu yêu cầu bổ sung evidence P16 không hợp lệ.' };
    }
    if (input.requestsAlreadyUsed >= 1) return { kind: 'ALREADY_USED' };
    const deadline = calculateFixedDeadline('P16', input.requestedAt);
    if (!deadline) return { kind: 'ADMIN_REVIEW', reason: 'Không thể tính deadline P16.' };
    if (isDeadlineExpired(input.now, deadline)) return { kind: 'EXPIRED', deadline };
    return { kind: 'ALLOWED', deadline };
}
