require('dotenv').config();

const path = require('node:path');
const crypto = require('node:crypto');
const express = require('express');
const session = require('express-session');
const MySQLStoreFactory = require('express-mysql-session');
const bcrypt = require('bcryptjs');
const mysql = require('mysql2');

const app = express();
const connection = mysql.createPool({
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'pawwise',
    waitForConnections: true,
    connectionLimit: 10,
    dateStrings: true
});
const pool = connection.promise();

const pageFiles = [
    'index.html',
    'owners.html',
    'pets.html',
    'consultations.html',
    'medicines.html',
    'grooming.html',
    'billing.html',
    'users.html',
    'settings.html',
    'profile.html'
];

const tables = {
    owners: {
        prefix: 'OWN',
        fields: ['name', 'phone', 'email', 'address', 'username', 'status'],
        secret: 'password',
        required: ['name', 'username']
    },
    pets: {
        prefix: 'PET',
        fields: ['name', 'ownerId', 'species', 'breed', 'sex', 'birthday', 'color', 'weight', 'status'],
        required: ['name', 'ownerId']
    },
    consultations: {
        prefix: 'CON',
        fields: ['petId', 'date', 'appointmentTime', 'vet', 'symptoms', 'diagnosis', 'treatment', 'weight', 'temperature', 'cost'],
        required: ['petId']
    },
    medicines: {
        prefix: 'MED',
        fields: ['petId', 'name', 'dosage', 'frequency', 'duration', 'instructions', 'cost'],
        required: ['petId', 'name']
    },
    grooming: {
        prefix: 'GRM',
        fields: ['petId', 'service', 'date', 'price', 'status'],
        required: ['petId', 'service']
    },
    users: {
        prefix: 'USR',
        fields: ['name', 'username', 'role', 'status'],
        secret: 'password',
        required: ['name', 'username']
    }
};

class HttpError extends Error {
    constructor(status, message) {
        super(message);
        this.status = status;
    }
}

function asyncRoute(handler) {
    return (request, response, next) => {
        Promise.resolve(handler(request, response, next)).catch(next);
    };
}

function requireSession(request, response, next) {
    if (!request.session.account) {
        next(new HttpError(401, 'Please sign in to continue.'));
        return;
    }
    next();
}

function requireAdmin(request, response, next) {
    if (request.session.account?.role !== 'Admin') {
        next(new HttpError(403, 'Administrator access is required.'));
        return;
    }
    next();
}

function makeId(prefix) {
    return `${prefix}-${crypto.randomBytes(6).toString('hex').toUpperCase()}`;
}

function cleanFormValue(value) {
    if (value === undefined || value === null || value === '') return null;
    return value;
}

function publicRecord(tableName, row) {
    if (tableName === 'owners') {
        const { password_hash, ...owner } = row;
        return owner;
    }
    if (tableName === 'users') {
        const { password_hash, ...user } = row;
        return user;
    }
    return row;
}

async function readTable(tableName, account) {
    const config = tables[tableName];
    const selectedFields = ['id', ...config.fields].map(field => `\`${field}\``).join(', ');
    let rows;

    if (tableName === 'owners' && account.role === 'Owner') {
        rows = await pool.query(`SELECT ${selectedFields}, password_hash FROM owners WHERE id = ?`, [account.ownerId]).then(([result]) => result);
    } else if (tableName === 'pets' && account.role === 'Owner') {
        rows = await pool.query(`SELECT ${selectedFields} FROM pets WHERE ownerId = ? ORDER BY created_at`, [account.ownerId]).then(([result]) => result);
    } else if (['consultations', 'medicines', 'grooming'].includes(tableName) && account.role === 'Owner') {
        rows = await pool.query(
            `SELECT t.${selectedFields.split(', ').join(', t.')} FROM \`${tableName}\` t
             INNER JOIN pets p ON p.id = t.petId
             WHERE p.ownerId = ? ORDER BY t.created_at`,
            [account.ownerId]
        ).then(([result]) => result);
    } else if (tableName === 'owners') {
        rows = await pool.query('SELECT id, name, phone, email, address, username, status, created_at FROM owners ORDER BY created_at').then(([result]) => result);
    } else if (tableName === 'users') {
        rows = await pool.query('SELECT id, name, username, role, status, created_at FROM users ORDER BY created_at').then(([result]) => result);
    } else {
        rows = await pool.query(`SELECT ${selectedFields}, created_at FROM \`${tableName}\` ORDER BY created_at`).then(([result]) => result);
    }
    return rows.map(row => publicRecord(tableName, row));
}

async function readAllData(account) {
    const [owners, pets, consultations, medicines, grooming, users, settingsRows, clinicHours] = await Promise.all([
        readTable('owners', account),
        readTable('pets', account),
        readTable('consultations', account),
        readTable('medicines', account),
        readTable('grooming', account),
        account.role === 'Admin' ? readTable('users', account) : Promise.resolve([]),
        pool.query('SELECT name, address, phone, email, hours FROM settings WHERE id = 1').then(([rows]) => rows),
        pool.query('SELECT weekday, is_open AS isOpen, opens_at AS opensAt, closes_at AS closesAt FROM clinic_hours ORDER BY weekday').then(([rows]) => rows)
    ]);

    return {
        owners,
        pets,
        consultations,
        medicines,
        grooming,
        users,
        settings: settingsRows[0] || {},
        clinicHours
    };
}

async function findAccount(username) {
    const [users] = await pool.query(
        "SELECT id, name, username, password_hash, role, status FROM users WHERE username = ? AND role = 'Admin' LIMIT 1",
        [username]
    );
    if (users[0]) return { ...users[0], accountType: 'Admin' };

    const [owners] = await pool.query(
        'SELECT id, name, username, password_hash, status FROM owners WHERE username = ? LIMIT 1',
        [username]
    );
    return owners[0] ? { ...owners[0], role: 'Owner', accountType: 'Owner' } : null;
}

async function ensureSeedData() {
    const [users] = await pool.query('SELECT COUNT(*) AS count FROM users');
    if (Number(users[0].count) === 0) {
        const passwordHash = await bcrypt.hash('admin123', 12);
        await pool.query(
            'INSERT INTO users (id, name, username, password_hash, role, status) VALUES (?, ?, ?, ?, ?, ?)',
            ['USR-1', 'Clinic Administrator', 'admin', passwordHash, 'Admin', 'Active']
        );
    }

    const [owners] = await pool.query('SELECT COUNT(*) AS count FROM owners');
    if (Number(owners[0].count) === 0) {
        const passwordHash = await bcrypt.hash('owner123', 12);
        await pool.query(
            'INSERT INTO owners (id, name, phone, email, address, username, password_hash, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            ['OWN-1', 'Maria Santos', '09171234567', 'maria@example.com', 'Pasig City', 'owner', passwordHash, 'Active']
        );
        await pool.query(
            'INSERT INTO pets (id, name, ownerId, species, breed, sex, birthday, color, weight, status) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
            ['PET-1', 'Mochi', 'OWN-1', 'Dog', 'Shih Tzu', 'Female', '2022-05-12', 'White', 5, 'Active']
        );
    }

    await pool.query(
        `INSERT INTO settings (id, name, address, phone, email, hours)
         VALUES (1, 'PawWise Pet Clinic', 'Pasig City', '', '', 'Monday–Saturday, 9:00 AM–5:00 PM')
         ON DUPLICATE KEY UPDATE id = VALUES(id)`
    );
}

async function ensureBillingTables() {
    await pool.query(`CREATE TABLE IF NOT EXISTS billing_receipts (
        id VARCHAR(32) PRIMARY KEY,
        owner_id VARCHAR(32) NOT NULL,
        owner_name VARCHAR(160) NOT NULL,
        payment_method ENUM('Cash', 'Card', 'E-wallet') NOT NULL,
        total DECIMAL(10,2) NOT NULL,
        settled_by VARCHAR(160) NOT NULL,
        settled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`);
    await pool.query(`CREATE TABLE IF NOT EXISTS billing_receipt_items (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
        receipt_id VARCHAR(32) NOT NULL,
        source_type ENUM('consultations', 'medicines', 'grooming') NOT NULL,
        source_id VARCHAR(32) NOT NULL,
        pet_name VARCHAR(160) NOT NULL,
        description VARCHAR(255) NOT NULL,
        amount DECIMAL(10,2) NOT NULL,
        UNIQUE KEY billing_source_unique (source_type, source_id),
        CONSTRAINT billing_receipt_items_receipt_fk FOREIGN KEY (receipt_id)
            REFERENCES billing_receipts(id) ON DELETE CASCADE
    )`);
}

async function ensureSchedulingTables() {
    await pool.query(`CREATE TABLE IF NOT EXISTS clinic_hours (
        weekday TINYINT UNSIGNED PRIMARY KEY,
        is_open BOOLEAN NOT NULL DEFAULT FALSE,
        opens_at TIME NULL,
        closes_at TIME NULL,
        CONSTRAINT clinic_hours_weekday_check CHECK (weekday BETWEEN 0 AND 6)
    )`);

    const [columns] = await pool.query(
        `SELECT COLUMN_NAME FROM information_schema.COLUMNS
         WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'consultations' AND COLUMN_NAME = 'appointmentTime'`
    );
    if (!columns.length) {
        await pool.query('ALTER TABLE consultations ADD COLUMN appointmentTime TIME NULL AFTER date');
    }

    for (let weekday = 0; weekday < 7; weekday += 1) {
        const isOpen = weekday >= 1 && weekday <= 6;
        await pool.query(
            `INSERT IGNORE INTO clinic_hours (weekday, is_open, opens_at, closes_at)
             VALUES (?, ?, ?, ?)`,
            [weekday, isOpen, isOpen ? '09:00' : null, isOpen ? '17:00' : null]
        );
    }
}

async function ensureGroomingStatuses() {
    await pool.query(
        `ALTER TABLE grooming MODIFY status
         ENUM('Pending', 'In Progress', 'Completed', 'No-show') NOT NULL DEFAULT 'Pending'`
    );
}

const weekdayNames = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

async function assertClinicOpen(dateValue, timeValue) {
    if (typeof dateValue !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
        throw new HttpError(400, 'Choose a valid appointment date.');
    }
    const date = new Date(`${dateValue}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateValue) {
        throw new HttpError(400, 'Choose a valid appointment date.');
    }
    if (typeof timeValue !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(timeValue)) {
        throw new HttpError(400, 'Choose a valid appointment time.');
    }

    const weekday = date.getUTCDay();
    const [rows] = await pool.query(
        'SELECT is_open AS isOpen, opens_at AS opensAt, closes_at AS closesAt FROM clinic_hours WHERE weekday = ?',
        [weekday]
    );
    const hours = rows[0];
    if (!hours || !hours.isOpen) {
        throw new HttpError(400, `The clinic is closed on ${weekdayNames[weekday]}. Choose an open day.`);
    }
    const opensAt = String(hours.opensAt).slice(0, 5);
    const closesAt = String(hours.closesAt).slice(0, 5);
    if (timeValue < opensAt || timeValue >= closesAt) {
        throw new HttpError(400, `Choose an appointment time during clinic hours (${opensAt}–${closesAt}).`);
    }
}

function validateClinicHours(hours) {
    if (!Array.isArray(hours) || hours.length !== 7) {
        throw new HttpError(400, 'Provide clinic hours for all seven days.');
    }
    const weekdays = new Set();
    for (const day of hours) {
        if (!day || !Number.isInteger(day.weekday) || day.weekday < 0 || day.weekday > 6 || weekdays.has(day.weekday)) {
            throw new HttpError(400, 'Clinic hours contain an invalid or duplicate day.');
        }
        weekdays.add(day.weekday);
        if (typeof day.isOpen !== 'boolean') throw new HttpError(400, 'Choose whether each day is open or closed.');
        if (!day.isOpen) continue;
        if (typeof day.opensAt !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(day.opensAt)
            || typeof day.closesAt !== 'string' || !/^([01]\d|2[0-3]):[0-5]\d$/.test(day.closesAt)
            || day.opensAt >= day.closesAt) {
            throw new HttpError(400, `Set a valid opening and closing time for ${weekdayNames[day.weekday]}.`);
        }
    }
}

app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));
const MySQLStore = MySQLStoreFactory(session);
const sessionStore = new MySQLStore({
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    expiration: 4 * 60 * 60 * 1000
}, connection);
app.use(session({
    name: 'pawwise.sid',
    secret: process.env.SESSION_SECRET || 'local-presentation-session-secret-change-me',
    store: sessionStore,
    resave: false,
    saveUninitialized: false,
    cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: process.env.NODE_ENV === 'production',
        maxAge: 4 * 60 * 60 * 1000
    }
}));

app.get('/api/health', asyncRoute(async (request, response) => {
    await pool.query('SELECT 1');
    response.json({ status: 'ok' });
}));

app.post('/api/auth/login', asyncRoute(async (request, response) => {
    const username = String(request.body.username || '').trim();
    const password = String(request.body.password || '');
    if (!username || !password) throw new HttpError(400, 'Enter your username and password.');

    const account = await findAccount(username);
    if (!account || account.status !== 'Active' || !(await bcrypt.compare(password, account.password_hash))) {
        throw new HttpError(401, 'Invalid username or password.');
    }

    await new Promise((resolve, reject) => request.session.regenerate(error => error ? reject(error) : resolve()));
    request.session.account = account.accountType === 'Admin'
        ? { id: account.id, role: 'Admin', name: account.name }
        : { id: account.id, ownerId: account.id, role: 'Owner', name: account.name };
    response.json({ account: request.session.account });
}));

app.get('/api/auth/me', requireSession, (request, response) => {
    response.json({ account: request.session.account });
});

app.post('/api/auth/logout', requireSession, (request, response, next) => {
    request.session.destroy(error => {
        if (error) {
            next(error);
            return;
        }
        response.clearCookie('pawwise.sid');
        response.status(204).end();
    });
});

app.get('/api/data', requireSession, asyncRoute(async (request, response) => {
    response.json(await readAllData(request.session.account));
}));

app.get('/api/billing', requireSession, requireAdmin, asyncRoute(async (request, response) => {
    const outstandingQueries = [
        `SELECT c.id AS sourceId, 'consultations' AS sourceType, c.petId, p.name AS petName,
            p.ownerId, o.name AS ownerName, COALESCE(NULLIF(TRIM(c.diagnosis), ''), 'Consultation') AS description,
            c.date, c.cost AS amount
         FROM consultations c
         INNER JOIN pets p ON p.id = c.petId
         INNER JOIN owners o ON o.id = p.ownerId
         LEFT JOIN billing_receipt_items ri ON ri.source_type = 'consultations' AND ri.source_id = c.id
         WHERE c.cost > 0 AND ri.id IS NULL`,
        `SELECT m.id AS sourceId, 'medicines' AS sourceType, m.petId, p.name AS petName,
            p.ownerId, o.name AS ownerName, m.name AS description, NULL AS date, m.cost AS amount
         FROM medicines m
         INNER JOIN pets p ON p.id = m.petId
         INNER JOIN owners o ON o.id = p.ownerId
         LEFT JOIN billing_receipt_items ri ON ri.source_type = 'medicines' AND ri.source_id = m.id
         WHERE m.cost > 0 AND ri.id IS NULL`,
        `SELECT g.id AS sourceId, 'grooming' AS sourceType, g.petId, p.name AS petName,
            p.ownerId, o.name AS ownerName, g.service AS description, g.date, g.price AS amount
         FROM grooming g
         INNER JOIN pets p ON p.id = g.petId
         INNER JOIN owners o ON o.id = p.ownerId
         LEFT JOIN billing_receipt_items ri ON ri.source_type = 'grooming' AND ri.source_id = g.id
         WHERE g.price > 0 AND g.status = 'Completed' AND ri.id IS NULL`
    ];
    const outstanding = [];
    for (const query of outstandingQueries) {
        const [rows] = await pool.query(query);
        outstanding.push(...rows);
    }

    const [receipts] = await pool.query(
        `SELECT id, owner_id AS ownerId, owner_name AS ownerName, payment_method AS paymentMethod,
            total, settled_by AS settledBy, settled_at AS settledAt
         FROM billing_receipts ORDER BY settled_at DESC`
    );
    if (receipts.length) {
        const [items] = await pool.query(
            `SELECT receipt_id AS receiptId, source_type AS sourceType, source_id AS sourceId,
                pet_name AS petName, description, amount
             FROM billing_receipt_items WHERE receipt_id IN (?) ORDER BY id`,
            [receipts.map(receipt => receipt.id)]
        );
        for (const receipt of receipts) {
            receipt.items = items.filter(item => item.receiptId === receipt.id);
        }
    }
    response.json({ outstanding, receipts });
}));

app.post('/api/receipts', requireSession, requireAdmin, asyncRoute(async (request, response) => {
    const { ownerId, paymentMethod, items } = request.body;
    if (typeof ownerId !== 'string' || !ownerId || !Array.isArray(items) || !items.length || items.length > 200) {
        throw new HttpError(400, 'Choose an owner and at least one billable item.');
    }
    if (!['Cash', 'Card', 'E-wallet'].includes(paymentMethod)) {
        throw new HttpError(400, 'Choose a valid payment method.');
    }

    const sourceTables = {
        consultations: { table: 'consultations', amount: 'cost', description: "COALESCE(NULLIF(TRIM(s.diagnosis), ''), 'Consultation')", date: 's.date' },
        medicines: { table: 'medicines', amount: 'cost', description: 's.name', date: 'NULL' },
        grooming: { table: 'grooming', amount: 'price', description: 's.service', date: 's.date' }
    };
    const requestedItems = new Map();
    for (const item of items) {
        if (!item || !sourceTables[item.sourceType] || typeof item.sourceId !== 'string' || !item.sourceId) {
            throw new HttpError(400, 'One or more billable items are invalid.');
        }
        const key = `${item.sourceType}:${item.sourceId}`;
        if (requestedItems.has(key)) throw new HttpError(400, 'A billable item was selected more than once.');
        requestedItems.set(key, item);
    }

    const transaction = await pool.getConnection();
    try {
        await transaction.beginTransaction();
        const [owners] = await transaction.query('SELECT name FROM owners WHERE id = ? FOR UPDATE', [ownerId]);
        if (!owners.length) throw new HttpError(404, 'Pet owner not found.');

        const selectedItems = [];
        for (const [sourceType, config] of Object.entries(sourceTables)) {
            const sourceIds = [...requestedItems.values()]
                .filter(item => item.sourceType === sourceType)
                .map(item => item.sourceId);
            if (!sourceIds.length) continue;

            const [rows] = await transaction.query(
                `SELECT s.id AS sourceId, p.name AS petName, ${config.description} AS description,
                    ${config.date} AS date, s.\`${config.amount}\` AS amount
                 FROM \`${config.table}\` s
                 INNER JOIN pets p ON p.id = s.petId
                 LEFT JOIN billing_receipt_items ri ON ri.source_type = ? AND ri.source_id = s.id
                 WHERE s.id IN (?) AND p.ownerId = ? AND s.\`${config.amount}\` > 0 AND ri.id IS NULL
                 FOR UPDATE`,
                [sourceType, sourceIds, ownerId]
            );
            selectedItems.push(...rows.map(row => ({ ...row, sourceType })));
        }

        if (selectedItems.length !== requestedItems.size) {
            throw new HttpError(409, 'Some selected charges are no longer outstanding. Refresh and try again.');
        }

        const totalCents = selectedItems.reduce((sum, item) => sum + Math.round(Number(item.amount) * 100), 0);
        if (totalCents > 9999999999) throw new HttpError(400, 'The selected charges exceed the maximum receipt total.');
        const total = totalCents / 100;
        const receiptId = makeId('RCT');
        await transaction.query(
            `INSERT INTO billing_receipts (id, owner_id, owner_name, payment_method, total, settled_by)
             VALUES (?, ?, ?, ?, ?, ?)`,
            [receiptId, ownerId, owners[0].name, paymentMethod, total, request.session.account.name]
        );
        for (const item of selectedItems) {
            await transaction.query(
                `INSERT INTO billing_receipt_items
                    (receipt_id, source_type, source_id, pet_name, description, amount)
                 VALUES (?, ?, ?, ?, ?, ?)`,
                [receiptId, item.sourceType, item.sourceId, item.petName, item.description, item.amount]
            );
        }
        await transaction.commit();
        response.status(201).json({ receiptId });
    } catch (error) {
        await transaction.rollback();
        if (error.code === 'ER_DUP_ENTRY') {
            throw new HttpError(409, 'A selected charge has already been settled. Refresh and try again.');
        }
        throw error;
    } finally {
        transaction.release();
    }
}));

app.post('/api/records/:table', requireSession, requireAdmin, asyncRoute(async (request, response) => {
    const tableName = request.params.table;
    const config = tables[tableName];
    if (!config || tableName === 'users' && request.body.role !== 'Admin') {
        throw new HttpError(400, 'That record type is not supported.');
    }
    for (const field of config.required) {
        if (!String(request.body[field] || '').trim()) throw new HttpError(400, `${field} is required.`);
    }
    if (tableName === 'consultations') {
        await assertClinicOpen(request.body.date, request.body.appointmentTime);
    }

    const values = {};
    for (const field of config.fields) {
        if (Object.hasOwn(request.body, field)) values[field] = cleanFormValue(request.body[field]);
    }
    if (tableName === 'grooming') values.status = 'Pending';

    if (config.secret) {
        const password = String(request.body.password || '');
        if (!password) throw new HttpError(400, 'A password is required.');
        values.password_hash = await bcrypt.hash(password, 12);
    }

    if (tableName === 'users') values.role = 'Admin';
    const username = values.username;
    if (username && await usernameExists(username, tableName)) throw new HttpError(409, 'Username already exists.');

    const id = makeId(config.prefix);
    const columns = ['id', ...Object.keys(values)];
    const parameters = [id, ...Object.values(values)];
    await pool.query(
        `INSERT INTO \`${tableName}\` (${columns.map(column => `\`${column}\``).join(', ')})
         VALUES (${columns.map(() => '?').join(', ')})`,
        parameters
    );
    response.status(201).json({ id });
}));

app.patch('/api/records/grooming/:id/status', requireSession, requireAdmin, asyncRoute(async (request, response) => {
    const transitions = {
        'In Progress': { expected: 'Pending' },
        'No-show': { expected: 'Pending' },
        Completed: { expected: 'In Progress' }
    };
    const transition = transitions[request.body.status];
    if (!transition) throw new HttpError(400, 'Choose a valid grooming status transition.');

    const [result] = await pool.query(
        'UPDATE grooming SET status = ? WHERE id = ? AND status = ?',
        [request.body.status, request.params.id, transition.expected]
    );
    if (!result.affectedRows) {
        const [rows] = await pool.query('SELECT status FROM grooming WHERE id = ?', [request.params.id]);
        if (!rows.length) throw new HttpError(404, 'Grooming record not found.');
        throw new HttpError(409, 'This grooming record has already changed. Refresh and try again.');
    }
    response.json({ status: request.body.status });
}));

app.put('/api/records/:table/:id', requireSession, requireAdmin, asyncRoute(async (request, response) => {
    const tableName = request.params.table;
    const config = tables[tableName];
    if (!config || tableName === 'users' && request.body.role !== 'Admin') {
        throw new HttpError(400, 'That record type is not supported.');
    }
    if (tableName === 'grooming' && Object.hasOwn(request.body, 'status')) {
        throw new HttpError(400, 'Use the grooming actions to change its status.');
    }

    for (const field of config.required) {
        if (!String(request.body[field] || '').trim()) throw new HttpError(400, `${field} is required.`);
    }
    if (tableName === 'consultations' && (request.body.date || request.body.appointmentTime)) {
        await assertClinicOpen(request.body.date, request.body.appointmentTime);
    }

    const values = {};
    for (const field of config.fields) {
        if (Object.hasOwn(request.body, field)) values[field] = cleanFormValue(request.body[field]);
    }
    if (tableName === 'consultations' && !request.body.date && !request.body.appointmentTime) {
        delete values.date;
        delete values.appointmentTime;
    }
    if (config.secret && request.body.password) values.password_hash = await bcrypt.hash(String(request.body.password), 12);
    if (tableName === 'users') values.role = 'Admin';
    if (values.username && await usernameExists(values.username, tableName, request.params.id)) {
        throw new HttpError(409, 'Username already exists.');
    }

    const columns = Object.keys(values);
    if (!columns.length) throw new HttpError(400, 'No changes were provided.');
    const [result] = await pool.query(
        `UPDATE \`${tableName}\` SET ${columns.map(column => `\`${column}\` = ?`).join(', ')} WHERE id = ?`,
        [...Object.values(values), request.params.id]
    );
    if (!result.affectedRows) throw new HttpError(404, 'Record not found.');
    response.json({ updated: true });
}));

app.delete('/api/records/:table/:id', requireSession, requireAdmin, asyncRoute(async (request, response) => {
    const tableName = request.params.table;
    if (!tables[tableName]) throw new HttpError(400, 'That record type is not supported.');
    if (tableName === 'users' && request.params.id === request.session.account.id) {
        throw new HttpError(400, 'You cannot delete the administrator account currently in use.');
    }
    if (tableName === 'grooming') throw new HttpError(400, 'Grooming records cannot be deleted. Mark pending appointments as No-show instead.');
    const [result] = await pool.query(`DELETE FROM \`${tableName}\` WHERE id = ?`, [request.params.id]);
    if (!result.affectedRows) throw new HttpError(404, 'Record not found.');
    response.status(204).end();
}));

async function usernameExists(username, tableName, exceptId) {
    const otherTable = tableName === 'users' ? 'owners' : 'users';
    const [current] = await pool.query(
        `SELECT id FROM \`${tableName}\` WHERE username = ? AND id <> ? LIMIT 1`,
        [username, exceptId || '']
    );
    if (current.length) return true;
    const [other] = await pool.query(`SELECT id FROM \`${otherTable}\` WHERE username = ? LIMIT 1`, [username]);
    return other.length > 0;
}

app.put('/api/settings', requireSession, requireAdmin, asyncRoute(async (request, response) => {
    const fields = ['name', 'address', 'phone', 'email'];
    if (!String(request.body.name || '').trim()) throw new HttpError(400, 'Clinic name is required.');
    validateClinicHours(request.body.clinicHours);
    const values = fields.map(field => cleanFormValue(request.body[field]));
    const hoursSummary = request.body.clinicHours
        .filter(day => day.isOpen)
        .map(day => `${weekdayNames[day.weekday].slice(0, 3)} ${day.opensAt}-${day.closesAt}`)
        .join(', ') || 'Closed every day';
    const transaction = await pool.getConnection();
    try {
        await transaction.beginTransaction();
        await transaction.query(
            'UPDATE settings SET name = ?, address = ?, phone = ?, email = ?, hours = ? WHERE id = 1',
            [...values, hoursSummary]
        );
        for (const day of request.body.clinicHours) {
            await transaction.query(
                'UPDATE clinic_hours SET is_open = ?, opens_at = ?, closes_at = ? WHERE weekday = ?',
                [day.isOpen, day.isOpen ? day.opensAt : null, day.isOpen ? day.closesAt : null, day.weekday]
            );
        }
        await transaction.commit();
    } catch (error) {
        await transaction.rollback();
        throw error;
    } finally {
        transaction.release();
    }
    response.json({ updated: true });
}));

app.use('/assets', express.static(path.join(__dirname, 'assets'), { index: false }));
app.get(['/', ...pageFiles.map(file => `/${file}`)], (request, response) => {
    const file = request.path === '/' ? 'index.html' : path.basename(request.path);
    response.sendFile(path.join(__dirname, file));
});

app.use((request, response) => {
    response.status(404).json({ error: 'The requested resource was not found.' });
});

app.use((error, request, response, next) => {
    if (response.headersSent) {
        next(error);
        return;
    }
    if (error.code === 'ER_DUP_ENTRY') {
        response.status(409).json({ error: 'That username is already in use.' });
        return;
    }
    if (error.code === 'ER_NO_REFERENCED_ROW_2') {
        response.status(400).json({ error: 'Choose a valid related record.' });
        return;
    }
    if (error.code === 'ER_BAD_NULL_ERROR' || error.code === 'ER_TRUNCATED_WRONG_VALUE') {
        response.status(400).json({ error: 'One or more values are invalid.' });
        return;
    }
    if (error instanceof HttpError) {
        response.status(error.status).json({ error: error.message });
        return;
    }
    console.error('PawWise request failed:', error);
    response.status(500).json({ error: 'The request could not be completed. Check the server logs.' });
});

async function start() {
    if (!process.env.SESSION_SECRET || process.env.SESSION_SECRET.length < 32) {
        throw new Error('Set SESSION_SECRET to a random value with at least 32 characters in .env.');
    }
    await pool.query('SELECT 1');
    await ensureBillingTables();
    await ensureSeedData();
    await ensureSchedulingTables();
    await ensureGroomingStatuses();
    const port = Number(process.env.PORT || 3000);
    app.listen(port, '127.0.0.1', () => {
        console.log(`PawWise is available at http://localhost:${port}`);
    });
}

start().catch(error => {
    console.error('Unable to start PawWise:', error.message);
    process.exitCode = 1;
});
