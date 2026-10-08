import assert from 'node:assert/strict';
import test from 'node:test';
import express from 'express';
import { config } from '../../../../app/config';
import { verifyMockPrinterRefund, verifyPrinterRefundPartner } from './verify-printer-refund.middleware';

test('production partner credentials identify the assigned workshop; mock remains disabled', async () => {
    const previous = { key: config.printerRefundApiKey, mode: config.nodeEnv, printerId: process.env.PRINTER_REFUND_PRINTER_ID, mock: process.env.REFUND_PRINTER_MOCK_SECRET };
    config.printerRefundApiKey = 'test-partner-secret';
    config.nodeEnv = 'production';
    process.env.PRINTER_REFUND_PRINTER_ID = 'workshop-1';
    process.env.REFUND_PRINTER_MOCK_SECRET = 'test-mock-secret';
    const app = express();
    app.get('/partner', verifyPrinterRefundPartner, (req: any, res) => res.json({ printerId: req.printerActorId }));
    app.get('/mock', verifyMockPrinterRefund, (_req, res) => res.json({ ok: true }));
    const server = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', resolve));
    const address = server.address(); if (!address || typeof address === 'string') throw new Error('Missing test address');
    const get = (path: string, headers: Record<string, string> = {}) => fetch(`http://127.0.0.1:${address.port}${path}`, { headers });
    try {
        assert.equal((await get('/partner')).status, 401);
        assert.equal((await get('/partner', { 'x-vietcraft-refund-key': 'test-partner-secret', 'x-printer-id': 'another-workshop' })).status, 401);
        assert.equal((await get('/partner', { 'x-vietcraft-refund-key': 'wrong', 'x-printer-id': 'workshop-1' })).status, 401);
        const success = await get('/partner', { 'x-vietcraft-refund-key': 'test-partner-secret', 'x-printer-id': 'workshop-1' });
        assert.equal(success.status, 200);
        assert.deepEqual(await success.json(), { printerId: 'workshop-1' });
        assert.equal((await get('/mock', { 'x-refund-printer-secret': 'test-mock-secret' })).status, 404);
        delete process.env.PRINTER_REFUND_PRINTER_ID;
        assert.equal((await get('/partner', { 'x-vietcraft-refund-key': 'test-partner-secret', 'x-printer-id': 'workshop-1' })).status, 503);
    } finally {
        await new Promise<void>(resolve => server.close(() => resolve()));
        config.printerRefundApiKey = previous.key; config.nodeEnv = previous.mode;
        if (previous.printerId === undefined) delete process.env.PRINTER_REFUND_PRINTER_ID; else process.env.PRINTER_REFUND_PRINTER_ID = previous.printerId;
        if (previous.mock === undefined) delete process.env.REFUND_PRINTER_MOCK_SECRET; else process.env.REFUND_PRINTER_MOCK_SECRET = previous.mock;
    }
});
