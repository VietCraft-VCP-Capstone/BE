import assert from 'node:assert/strict';
import test from 'node:test';
import { processExpiredReturnDeadlines, type ReturnDeadlineJobDependencies } from './return-deadline.job';

test('concurrent deadline workers remind once per deadline and can remind a new deadline', async () => {
    const claims = new Set<string>();
    let deadline = new Date('2026-10-01T00:00:00Z');
    let reminders = 0;
    const deps: ReturnDeadlineJobDependencies = {
        now: () => new Date('2026-10-07T00:00:00Z'),
        async listExpired() { return [{ id: 'r1', deadline }]; },
        async claim(id, at) { const key = `${id}:${at.toISOString()}`; if (claims.has(key)) return false; claims.add(key); return true; },
        async release(id, at) { claims.delete(`${id}:${at.toISOString()}`); },
        async remind() { reminders++; },
    };
    assert.equal((await Promise.all([processExpiredReturnDeadlines(deps), processExpiredReturnDeadlines(deps)])).reduce((sum, n) => sum + n), 1);
    assert.equal(reminders, 1);
    deadline = new Date('2026-10-03T00:00:00Z');
    assert.equal(await processExpiredReturnDeadlines(deps), 1);
    assert.equal(reminders, 2);
});

test('failed reminders release their claim so the next tick can retry', async () => {
    let claimed = false;
    let fail = true;
    const deps: ReturnDeadlineJobDependencies = {
        now: () => new Date(), async listExpired() { return [{ id: 'r1', deadline: new Date(0) }]; },
        async claim() { if (claimed) return false; claimed = true; return true; },
        async release() { claimed = false; }, async remind() { if (fail) throw new Error('notification unavailable'); },
    };
    await assert.rejects(() => processExpiredReturnDeadlines(deps), /notification unavailable/);
    assert.equal(claimed, false);
    fail = false;
    assert.equal(await processExpiredReturnDeadlines(deps), 1);
});
