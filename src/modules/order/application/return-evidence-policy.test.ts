import assert from 'node:assert/strict';
import test from 'node:test';
import { validateReturnEvidence, type ReturnEvidenceItem } from './return-evidence-policy';

const image = (id: string): ReturnEvidenceItem => ({ id, kind: 'IMAGE', uri: `/uploads/returns/${id}.jpg` });
const video = (id: string): ReturnEvidenceItem => ({ id, kind: 'VIDEO', uri: `/uploads/returns/${id}.mp4` });

test('requires a reason code and written description', () => {
    assert.equal(validateReturnEvidence({ reasonCode: '', description: 'damage', evidence: [image('a')] }).kind, 'INVALID');
    assert.equal(validateReturnEvidence({ reasonCode: 'R02', description: '  ', evidence: [image('a')] }).kind, 'INVALID');
});

test('allows a phase-1 POD reason that has a P01 policy anchor', () => {
    assert.equal(validateReturnEvidence({ reasonCode: 'R13', description: 'visible preview defect', evidence: [image('a')] }).kind, 'VALID');
});

test('requires at least one image or video', () => {
    assert.equal(validateReturnEvidence({ reasonCode: 'R02', description: 'damage', evidence: [] }).kind, 'INVALID');
});

test('accepts any combination with one to three images and at most one video', () => {
    assert.equal(validateReturnEvidence({ reasonCode: 'R02', description: 'damage', evidence: [image('a')] }).kind, 'VALID');
    assert.equal(validateReturnEvidence({ reasonCode: 'R02', description: 'damage', evidence: [video('v')] }).kind, 'VALID');
    assert.equal(validateReturnEvidence({ reasonCode: 'R02', description: 'damage', evidence: [image('a'), image('b'), image('c'), video('v')] }).kind, 'VALID');
});

test('rejects more than three images or more than one video', () => {
    assert.equal(validateReturnEvidence({ reasonCode: 'R02', description: 'damage', evidence: [image('a'), image('b'), image('c'), image('d')] }).kind, 'INVALID');
    assert.equal(validateReturnEvidence({ reasonCode: 'R02', description: 'damage', evidence: [video('a'), video('b')] }).kind, 'INVALID');
});

test('rejects invalid evidence types, duplicate IDs and missing storage references', () => {
    assert.equal(validateReturnEvidence({ reasonCode: 'R02', description: 'damage', evidence: [{ id: 'x', kind: 'PDF' as 'IMAGE', uri: '/e.pdf' }] }).kind, 'INVALID');
    assert.equal(validateReturnEvidence({ reasonCode: 'R02', description: 'damage', evidence: [image('a'), image('a')] }).kind, 'INVALID');
    assert.equal(validateReturnEvidence({ reasonCode: 'R02', description: 'damage', evidence: [{ id: 'a', kind: 'IMAGE', uri: ' ' }] }).kind, 'INVALID');
});
