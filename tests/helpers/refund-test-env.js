const fs = require('node:fs');
const net = require('node:net');
const os = require('node:os');
const path = require('node:path');
const { spawn, spawnSync } = require('node:child_process');

const DIST = path.resolve(__dirname, '../../dist');

/**
 * Cô lập test khỏi BE/.env. `config` gọi dotenv.config() theo cwd và dotenv không ghi đè biến
 * đã có, nên chuyển cwd sang thư mục tạm và đặt sẵn mọi biến refund cần TRƯỚC khi nạp dist.
 * Credential payout là giá trị giả: test luôn thay SDK bằng bản giả, không gọi payOS thật.
 */
function isolateEnv(overrides = {}) {
    const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'vc-refund-test-'));
    process.chdir(sandbox);
    process.once('exit', () => fs.rmSync(sandbox, { recursive: true, force: true }));
    Object.assign(process.env, {
        NODE_ENV: 'test',
        JWT_SECRET: 'refund-test-secret',
        MONGO_URI: '',
        DATABASE_URL: '',
        REDIS_URL: 'redis://127.0.0.1:1',
        REFUND_WINDOW_SECONDS: '300',
        REFUND_MAX_ATTEMPTS: '3',
        REFUND_MODE: 'PAYOUT',
        PAYOS_PAYOUT_TIMEOUT_SECONDS: '60',
        STUB_PAYOS: 'false',
        PAYOS_PAYOUT_CLIENT_ID: 'test-payout-client',
        PAYOS_PAYOUT_API_KEY: 'test-payout-key',
        PAYOS_PAYOUT_CHECKSUM_KEY: 'test-payout-checksum',
        PAYOS_PAYOUT_WEBHOOK_SECRET: '',
        MERCHANT_BANK_BIN: '970422',
        MERCHANT_ACCOUNT_NO: '9999999999',
        // Cổng discard: dispatch sang xưởng in (sau reject/cancel) lỗi ngay, không chờ timeout.
        PRINTER_API_URL: 'http://127.0.0.1:9',
    }, overrides);
    if (!process.env.REFUND_TEST_VERBOSE) {
        for (const method of ['log', 'info', 'warn', 'error']) console[method] = () => {};
    }
    return sandbox;
}

function dist(relativePath) {
    return require(path.join(DIST, relativePath));
}

function hasMongod() {
    const probe = spawnSync('mongod', ['--version'], { stdio: 'ignore' });
    return !probe.error && probe.status === 0;
}

function freePort() {
    return new Promise((resolve, reject) => {
        const server = net.createServer();
        server.once('error', reject);
        server.listen(0, '127.0.0.1', () => {
            const { port } = server.address();
            server.close(() => resolve(port));
        });
    });
}

function canConnect(port) {
    return new Promise(resolve => {
        const socket = net.connect(port, '127.0.0.1');
        socket.once('connect', () => { socket.destroy(); resolve(true); });
        socket.once('error', () => resolve(false));
    });
}

/** mongod riêng cho test, dữ liệu nằm trong sandbox và bị xoá khi stop(). */
async function startMongo(sandbox) {
    const port = await freePort();
    const dbpath = path.join(sandbox, 'db');
    fs.mkdirSync(dbpath);
    const proc = spawn('mongod', [
        '--dbpath', dbpath,
        '--port', String(port),
        '--bind_ip', '127.0.0.1',
        '--nounixsocket',
        '--quiet',
    ], { stdio: 'ignore' });

    const deadline = Date.now() + 30_000;
    while (!(await canConnect(port))) {
        if (proc.exitCode !== null) throw new Error(`mongod thoát sớm với mã ${proc.exitCode}`);
        if (Date.now() > deadline) {
            proc.kill('SIGKILL');
            throw new Error('mongod không sẵn sàng sau 30 giây');
        }
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    return {
        uri: `mongodb://127.0.0.1:${port}/vietcraft_refund_test`,
        async stop() {
            if (proc.exitCode === null) {
                const exited = new Promise(resolve => proc.once('exit', resolve));
                proc.kill('SIGTERM');
                await exited;
            }
            fs.rmSync(sandbox, { recursive: true, force: true });
        },
    };
}

module.exports = { dist, hasMongod, isolateEnv, startMongo };
