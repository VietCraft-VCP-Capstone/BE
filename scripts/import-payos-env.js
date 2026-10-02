const fs = require('node:fs');
const path = require('node:path');

const sourcePath = path.resolve(__dirname, '../../refund-mvp/.env');
const targetPath = path.resolve(__dirname, '../.env');
const allowed = [
    'PAYOS_CLIENT_ID',
    'PAYOS_API_KEY',
    'PAYOS_CHECKSUM_KEY',
    'PAYOS_PAYOUT_CLIENT_ID',
    'PAYOS_PAYOUT_API_KEY',
    'PAYOS_PAYOUT_CHECKSUM_KEY',
    'PAYOS_BASE_URL',
    'PAYOS_PAYOUT_BASE_URL',
    'STUB_PAYOS',
];

function parse(text) {
    const values = new Map();
    for (const line of text.split(/\r?\n/)) {
        const match = line.match(/^([A-Za-z_][A-Za-z0-9_]*)=(.*)$/);
        if (match) values.set(match[1], match[2]);
    }
    return values;
}

if (!fs.existsSync(sourcePath)) throw new Error(`Không tìm thấy ${sourcePath}`);
const source = parse(fs.readFileSync(sourcePath, 'utf8'));
const targetText = fs.existsSync(targetPath) ? fs.readFileSync(targetPath, 'utf8') : '';
const lines = targetText.split(/\r?\n/);
const copied = [];

for (const key of allowed) {
    if (!source.has(key)) continue;
    const nextLine = `${key}=${source.get(key)}`;
    const index = lines.findIndex(line => line.startsWith(`${key}=`));
    if (index >= 0) lines[index] = nextLine;
    else lines.push(nextLine);
    copied.push(key);
}

if (!lines.some(line => line.startsWith('REFUND_MODE='))) lines.push('REFUND_MODE=PAYOUT');
if (!lines.some(line => line.startsWith('PAYOS_PAYOUT_TIMEOUT_SECONDS='))) {
    lines.push('PAYOS_PAYOUT_TIMEOUT_SECONDS=900');
}

fs.writeFileSync(targetPath, `${lines.join('\n').replace(/\n+$/, '')}\n`, { mode: 0o600 });
console.log(`Đã đồng bộ ${copied.length} biến PayOS: ${copied.join(', ')}`);
console.log('Không sao chép DB_PASSWORD, DB_URL, DB_USERNAME hoặc JWT_SECRET.');
