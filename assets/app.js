const schema = {
    owners: ['name', 'phone', 'email', 'address', 'username', 'password', 'status'],
    pets: ['name', 'ownerId', 'species', 'breed', 'sex', 'birthday', 'color', 'weight', 'status'],
    consultations: ['petId', 'date', 'appointmentTime', 'vet', 'symptoms', 'diagnosis', 'treatment', 'weight', 'temperature', 'cost'],
    medicines: ['petId', 'name', 'dosage', 'frequency', 'duration', 'instructions', 'cost'],
    grooming: ['petId', 'service', 'date', 'price'],
    users: ['name', 'username', 'password', 'role', 'status']
};
const labels = {
    owners: 'Pet Owners',
    pets: 'Pets',
    consultations: 'Consultations',
    medicines: 'Medicines',
    grooming: 'Grooming',
    users: 'User Management',
    profile: 'My Profile',
    settings: 'Clinic Settings'
};

let db = null;
let session = null;
let editing = null;
let search = '';
const page = document.body.dataset.page;
const content = document.getElementById('page-content');
let billingData = { outstanding: [], receipts: [] };
let billingOwnerId = '';
let notificationTimer;

async function api(url, options = {}) {
    let response;
    try {
        response = await fetch(url, {
            credentials: 'same-origin',
            ...options,
            headers: {
                ...(options.body ? { 'Content-Type': 'application/json' } : {}),
                ...options.headers
            }
        });
    } catch {
        throw new Error('PawWise API could not be reached. Start the Node server with "npm start" and open http://localhost:3000. Do not open the HTML file directly or use Live Server.');
    }
    if (response.status === 204) return null;
    const contentType = response.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
        throw new Error(
            `The PawWise API did not return JSON (${response.url}). Run the Node server with "npm start" and open http://localhost:3000. Do not open the HTML file directly or use Live Server.`
        );
    }
    const result = await response.json();
    if (!response.ok) {
        const error = new Error(result.error || 'The request could not be completed.');
        error.status = response.status;
        throw error;
    }
    return result;
}

function esc(value) {
    return String(value ?? '').replace(/[&<>"']/g, character => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
    })[character]);
}

function notify(message, type = 'error') {
    const isSuccess = type === 'success';
    let notification = document.getElementById('app-notification');
    if (!notification) {
        notification = document.createElement('div');
        notification.id = 'app-notification';
        document.body.append(notification);
    }
    notification.className = `message toast ${isSuccess ? 'success' : 'error'}`;
    notification.setAttribute('role', isSuccess ? 'status' : 'alert');
    notification.setAttribute('aria-live', isSuccess ? 'polite' : 'assertive');
    notification.textContent = message;
    notification.hidden = false;
    clearTimeout(notificationTimer);
    notificationTimer = setTimeout(() => {
        notification.hidden = true;
    }, 6000);
}

function find(tableName, id) {
    return db[tableName].find(item => item.id === id);
}

function recordName(tableName, id) {
    return find(tableName, id)?.name || id || '—';
}

function ownerPets() {
    return db.pets.filter(pet => pet.ownerId === session?.ownerId);
}

function ownFilter(tableName) {
    if (session.role !== 'Owner') return db[tableName] || [];
    if (tableName === 'pets') return ownerPets();
    return (db[tableName] || []).filter(item => ownerPets().some(pet => pet.id === item.petId));
}

function allowedPages() {
    if (session.role === 'Owner') return ['pets', 'consultations', 'medicines', 'grooming', 'profile'];
    return session.role === 'Admin'
        ? ['owners', 'pets', 'consultations', 'medicines', 'grooming', 'billing', 'users', 'settings']
        : [];
}

function landingPage() {
    return session?.role === 'Owner' ? 'pets.html' : 'owners.html';
}

function showLoginError(message) {
    const error = document.getElementById('login-error');
    if (error) {
        error.textContent = message;
        error.classList.remove('hidden');
    }
}

function login() {
    const form = document.getElementById('login-form');
    if (!form) return;
    form.addEventListener('submit', async event => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(form));
        try {
            const result = await api('/api/auth/login', {
                method: 'POST',
                body: JSON.stringify(values)
            });
            session = result.account;
            window.location.href = landingPage();
        } catch (error) {
            showLoginError(error.message);
        }
    });
}

async function setUpPage() {
    if (page === 'login') {
        try {
            const result = await api('/api/auth/me');
            session = result.account;
            window.location.replace(landingPage());
        } catch (error) {
            if (error.status === 401) login();
            else showLoginError(`Cannot connect to PawWise. Start the server and try again. ${error.message}`);
        }
        return;
    }

    try {
        const result = await api('/api/auth/me');
        session = result.account;
        if (!allowedPages().includes(page)) {
            window.location.replace(landingPage());
            return;
        }
        db = await api('/api/data');
        if (page === 'billing') {
            billingData = await api('/api/billing');
            billingOwnerId = db.owners[0]?.id || '';
        }
    } catch (error) {
        if (error.status === 401) {
            window.location.replace('index.html');
            return;
        }
        notify(`Cannot load PawWise data. Check the server and database connection. ${error.message}`);
        return;
    }

    const brandLink = document.querySelector('.sidebar .brand');
    if (brandLink) brandLink.href = landingPage();
    document.querySelectorAll('[data-page-link]').forEach(link => {
        const target = link.dataset.pageLink;
        link.hidden = !allowedPages().includes(target);
        link.classList.toggle('active', target === page);
    });
    document.querySelectorAll('[data-logout]').forEach(button => {
        button.addEventListener('click', async () => {
            try {
                await api('/api/auth/logout', { method: 'POST' });
                window.location.href = 'index.html';
            } catch (error) {
                notify(`Could not sign out: ${error.message}`);
            }
        });
    });

    const clinicName = document.getElementById('clinic-name');
    const userName = document.getElementById('user-name');
    const userRole = document.getElementById('user-role');
    if (clinicName) clinicName.textContent = db.settings.name;
    if (userName) userName.textContent = session.name;
    if (userRole) userRole.textContent = `${session.role} Portal`;

    renderContent();
    wire();
}

function renderContent() {
    if (page === 'profile') content.innerHTML = profile();
    else if (page === 'settings') content.innerHTML = settings();
    else if (page === 'billing') content.innerHTML = billing();
    else if (schema[page]) content.innerHTML = listing(page);
}

function money(value) {
    return `PHP ${Number(value || 0).toFixed(2)}`;
}

function billing() {
    const ownerOptions = db.owners.map(owner =>
        `<option value="${esc(owner.id)}" ${owner.id === billingOwnerId ? 'selected' : ''}>${esc(owner.name)}</option>`
    ).join('');
    const ownerCharges = billingData.outstanding.filter(item => item.ownerId === billingOwnerId);
    const chargeRows = ownerCharges.length
        ? `<div class="scroll"><table><thead><tr><th></th><th>Pet</th><th>Service</th><th>Date</th><th>Amount</th></tr></thead><tbody>
            ${ownerCharges.map(item => `<tr>
                <td><input type="checkbox" name="bill-items" data-source-type="${esc(item.sourceType)}"
                    data-source-id="${esc(item.sourceId)}" data-amount="${esc(item.amount)}" aria-label="Select ${esc(item.description)}"></td>
                <td>${esc(item.petName)}</td><td>${esc(item.description)}</td><td>${esc(item.date || '—')}</td>
                <td>${money(item.amount)}</td>
            </tr>`).join('')}
            </tbody></table></div>`
        : '<p class="muted">This owner has no outstanding charges.</p>';
    const receipts = billingData.receipts.length
        ? `<div class="scroll"><table><thead><tr><th>Receipt</th><th>Owner</th><th>Date</th><th>Method</th><th>Total</th><th></th></tr></thead><tbody>
            ${billingData.receipts.map(receipt => `<tr><td>${esc(receipt.id)}</td><td>${esc(receipt.ownerName)}</td>
                <td>${esc(receipt.settledAt)}</td><td>${esc(receipt.paymentMethod)}</td><td>${money(receipt.total)}</td>
                <td><button type="button" data-print-receipt="${esc(receipt.id)}">Print receipt</button></td></tr>`).join('')}
            </tbody></table></div>`
        : '<p class="muted">No settled bills yet.</p>';

    return `<div class="card billing-card">
        <h2>Settle a bill</h2>
        <div class="field"><label for="billing-owner">Pet owner</label>
            <select id="billing-owner"><option value="">Select an owner...</option>${ownerOptions}</select></div>
        ${billingOwnerId ? `<form id="settlement-form">${chargeRows}
            ${ownerCharges.length ? `<div class="billing-checkout">
                <div class="field"><label for="payment-method">Payment method</label>
                    <select id="payment-method" name="paymentMethod">
                        <option>Cash</option><option>Card</option><option>E-wallet</option>
                    </select></div>
                <p class="billing-total">Selected total: <strong id="billing-total">${money(0)}</strong></p>
                <button id="settle-button" type="submit" disabled>Record payment &amp; create receipt</button>
            </div>` : ''}</form>` : '<p class="muted">Add a pet owner before settling a bill.</p>'}
    </div>
    <div class="card"><h2>Settled bills</h2>${receipts}</div>`;
}

function profile() {
    const owner = db.owners.find(item => item.id === session.ownerId);
    if (!owner) return '<div class="card"><p class="muted">Owner record not found.</p></div>';
    return `<div class="card"><h3>${esc(owner.name)}</h3><p>Email: ${esc(owner.email)}</p><p>Contact: ${esc(owner.phone)}</p>
        <p>Address: ${esc(owner.address)}</p><p>Username: ${esc(owner.username)}</p>
        <p>To change registration information, please contact the clinic.</p></div>`;
}

function settings() {
    const fields = ['name', 'address', 'phone', 'email'].map(key =>
        `<div class="field"><label for="setting-${key}">${esc(key)}</label>
            <input id="setting-${key}" name="${key}" value="${esc(db.settings[key])}" ${key === 'name' ? 'required' : ''}></div>`
    ).join('');
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const hours = days.map((day, weekday) => {
        const schedule = db.clinicHours.find(item => item.weekday === weekday);
        const isOpen = Boolean(schedule?.isOpen);
        const opensAt = String(schedule?.opensAt || '09:00').slice(0, 5);
        const closesAt = String(schedule?.closesAt || '17:00').slice(0, 5);
        return `<div class="clinic-day">
            <label class="clinic-day-toggle"><input type="checkbox" name="clinic-open-${weekday}" ${isOpen ? 'checked' : ''}>
                <span>${day}</span></label>
            <label>Opens <input type="time" name="clinic-opens-${weekday}" value="${opensAt}" ${isOpen ? '' : 'disabled'}></label>
            <label>Closes <input type="time" name="clinic-closes-${weekday}" value="${closesAt}" ${isOpen ? '' : 'disabled'}></label>
        </div>`;
    }).join('');
    return `<div class="card"><form id="settings-form"><div class="fields">${fields}</div>
        <h2>Weekly opening hours</h2>
        <p class="muted">Appointments can only be booked on open days and before the closing time.</p>
        <div class="clinic-hours">${hours}</div>
        <div class="actions"><button>Save Settings</button></div></form></div>`;
}

function options(tableName, selected) {
    const items = tableName === 'pets' && session.role === 'Owner' ? ownerPets() : db[tableName];
    return `<option value="">Select...</option>${items.map(item => `<option value="${esc(item.id)}" ${item.id === selected ? 'selected' : ''}>${esc(item.name)} (${esc(item.id)})</option>`).join('')}`;
}

function formField(tableName, key, value) {
    const display = {
        ownerId: 'Pet Owner',
        petId: 'Pet',
        date: tableName === 'consultations' ? 'Appointment date' : 'Date',
        appointmentTime: 'Appointment time'
    }[key] || key.replace(/([A-Z])/g, ' $1');
    if (key === 'ownerId' || key === 'petId') {
        const reference = key === 'ownerId' ? 'owners' : 'pets';
        return `<div class="field"><label>${esc(display)}</label><select name="${key}" ${key === 'petId' ? 'required' : ''}>${options(reference, value)}</select></div>`;
    }

    const selections = {
        status: tableName === 'grooming' ? ['Pending', 'In Progress', 'Completed'] : ['Active', 'Inactive'],
        role: ['Admin'],
        sex: ['Male', 'Female'],
        species: ['Dog', 'Cat', 'Other']
    };
    if (selections[key]) {
        return `<div class="field"><label>${esc(display)}</label><select name="${key}">${selections[key].map(item => `<option ${item === value ? 'selected' : ''}>${item}</option>`).join('')}</select></div>`;
    }

    const type = key === 'appointmentTime' ? 'time'
        : /password/.test(key) ? 'password'
        : /date|birthday/.test(key) ? 'date'
            : /cost|price|weight|temperature/.test(key) ? 'number' : 'text';
    const fieldValue = type === 'time' ? String(value || '').slice(0, 5) : value ?? '';
    const passwordHint = type === 'password' && value === undefined && editing !== 'new' ? ' placeholder="Leave blank to keep current password"' : '';
    return `<div class="field"><label>${esc(display)}</label><input type="${type}" ${type === 'number' ? 'step="any" min="0"' : ''}
        name="${key}" value="${esc(type === 'password' ? '' : fieldValue)}"${passwordHint}
        ${['name', 'username', 'appointmentTime'].includes(key) || tableName === 'consultations' && key === 'date' ? 'required' : ''}></div>`;
}

function listing(tableName) {
    const editable = session.role === 'Admin';
    const items = ownFilter(tableName).filter(item => JSON.stringify(item).toLowerCase().includes(search.toLowerCase()));
    const form = editing !== null ? `<div class="card"><h2>${editing === 'new' ? 'Add' : 'Edit'} ${esc(labels[tableName])}</h2>
        <form id="record-form"><div class="fields">${schema[tableName]
            .map(key => formField(tableName, key, editing === 'new' ? '' : editing[key])).join('')}</div>
        <div class="actions"><button>Save Record</button><button type="button" class="secondary" id="cancel-edit">Cancel</button></div></form></div>` : '';
    const addButton = editable ? `<button id="add">Add ${esc(labels[tableName])}</button>` : '';
    return `<div class="card"><div class="toolbar"><input id="search" placeholder="Search records..." value="${esc(search)}">
        ${addButton}</div>${form}<div class="scroll">${table(tableName, items)}</div></div>`;
}

function display(tableName, key, value) {
    if (key === 'ownerId') return esc(recordName('owners', value));
    if (key === 'petId') return esc(recordName('pets', value));
    if (key === 'appointmentTime') return esc(String(value || '').slice(0, 5));
    if (key === 'password') return '••••••';
    if (key === 'status') return `<span class="pill">${esc(value)}</span>`;
    return esc(value);
}

function table(tableName, items) {
    const columns = {
        owners: ['name', 'phone', 'email', 'status'],
        pets: ['name', 'ownerId', 'species', 'breed', 'status'],
        consultations: ['petId', 'date', 'appointmentTime', 'diagnosis', 'cost'],
        medicines: ['petId', 'name', 'dosage', 'cost'],
        grooming: ['petId', 'service', 'date', 'status'],
        users: ['name', 'username', 'role', 'status']
    }[tableName];
    if (!items.length) return '<p class="muted">No records found.</p>';
    return `<table><thead><tr><th>ID</th>${columns.map(key => `<th>${esc(key)}</th>`).join('')}<th>Actions</th></tr></thead><tbody>
        ${items.map(item => `<tr><td>${esc(item.id)}</td>${columns.map(key => `<td>${display(tableName, key, item[key])}</td>`).join('')}<td>
            ${session.role === 'Owner'
                ? 'View only'
                : tableName === 'grooming'
                    ? groomingActions(item)
                    : `<button data-edit="${esc(item.id)}">Edit</button><button class="danger" data-delete="${esc(item.id)}">Delete</button>`}
        </td></tr>`).join('')}</tbody></table>`;
}

function groomingActions(item) {
    if (item.status === 'Completed' || item.status === 'No-show') return '<span class="muted">No actions</span>';
    if (item.status === 'Pending') {
        return `<button data-grooming-status="${esc(item.id)}" data-next-status="In Progress">In Progress</button>
            <button class="secondary" data-grooming-status="${esc(item.id)}" data-next-status="No-show">No-show</button>`;
    }
    return `<button data-grooming-status="${esc(item.id)}" data-next-status="Completed">Complete</button>`;
}

async function refreshData() {
    db = await api('/api/data');
    renderContent();
    wire();
}

function wire() {
    if (page === 'billing') {
        wireBilling();
        return;
    }
    const settingsForm = document.getElementById('settings-form');
    if (settingsForm) {
        settingsForm.querySelectorAll('[name^="clinic-open-"]').forEach(checkbox => {
            checkbox.addEventListener('change', () => {
                const weekday = checkbox.name.slice('clinic-open-'.length);
                settingsForm.elements[`clinic-opens-${weekday}`].disabled = !checkbox.checked;
                settingsForm.elements[`clinic-closes-${weekday}`].disabled = !checkbox.checked;
            });
        });
        settingsForm.addEventListener('submit', async event => {
            event.preventDefault();
            const values = Object.fromEntries(new FormData(settingsForm));
            values.clinicHours = Array.from({ length: 7 }, (_, weekday) => ({
                weekday,
                isOpen: settingsForm.elements[`clinic-open-${weekday}`].checked,
                opensAt: settingsForm.elements[`clinic-opens-${weekday}`].value,
                closesAt: settingsForm.elements[`clinic-closes-${weekday}`].value
            }));
            try {
                await api('/api/settings', {
                    method: 'PUT',
                    body: JSON.stringify(values)
                });
                await refreshData();
                notify('Clinic settings saved.', 'success');
            } catch (error) {
                notify(error.message);
            }
        });
    }

    if (schema[page]) wireRecords(page);
}

function wireBilling() {
    document.getElementById('billing-owner')?.addEventListener('change', event => {
        billingOwnerId = event.target.value;
        renderContent();
        wireBilling();
    });
    document.querySelectorAll('[name="bill-items"]').forEach(checkbox => {
        checkbox.addEventListener('change', updateBillingTotal);
    });
    document.getElementById('settlement-form')?.addEventListener('submit', async event => {
        event.preventDefault();
        const selectedItems = [...document.querySelectorAll('[name="bill-items"]:checked')].map(item => ({
            sourceType: item.dataset.sourceType,
            sourceId: item.dataset.sourceId
        }));
        if (!selectedItems.length) return;

        const button = document.getElementById('settle-button');
        button.disabled = true;
        let receiptId;
        try {
            ({ receiptId } = await api('/api/receipts', {
                method: 'POST',
                body: JSON.stringify({
                    ownerId: billingOwnerId,
                    paymentMethod: document.getElementById('payment-method').value,
                    items: selectedItems
                })
            }));
        } catch (error) {
            button.disabled = false;
            notify(error.message);
            return;
        }

        try {
            billingData = await api('/api/billing');
        } catch (error) {
            notify(`Payment was recorded as ${receiptId}, but billing could not be refreshed. Reload the page to view the receipt. ${error.message}`);
            return;
        }
        renderContent();
        wireBilling();
        notify(`Payment recorded as receipt ${receiptId}.`, 'success');
    });
    document.querySelectorAll('[data-print-receipt]').forEach(button => {
        button.addEventListener('click', () => {
            const receipt = billingData.receipts.find(item => item.id === button.dataset.printReceipt);
            if (receipt) printReceipt(receipt);
        });
    });
}

function updateBillingTotal() {
    const selected = [...document.querySelectorAll('[name="bill-items"]:checked')];
    const total = selected.reduce((sum, item) => sum + Number(item.dataset.amount), 0);
    const totalElement = document.getElementById('billing-total');
    const settleButton = document.getElementById('settle-button');
    if (totalElement) totalElement.textContent = money(total);
    if (settleButton) settleButton.disabled = selected.length === 0;
}

function printReceipt(receipt) {
    const printWindow = window.open('', '_blank', 'width=760,height=800');
    if (!printWindow) {
        notify('Allow pop-ups to print the receipt.');
        return;
    }
    const settings = db.settings;
    const rows = receipt.items.map(item => `<tr>
        <td>${esc(item.petName)}</td><td>${esc(item.description)}</td>
        <td>${esc(labels[item.sourceType] || item.sourceType)}</td><td>${money(item.amount)}</td>
    </tr>`).join('');
    printWindow.document.write(`<!doctype html><html lang="en"><head><meta charset="utf-8">
        <title>Receipt ${esc(receipt.id)}</title><style>
        body{font:15px Arial,sans-serif;color:#183129;max-width:760px;margin:36px auto;padding:0 24px}
        h1,h2,p{text-align:center;margin:8px 0}h1{color:#145442}.meta{margin:28px 0}
        table{width:100%;border-collapse:collapse;margin:20px 0}
        th,td{text-align:left;border-bottom:1px solid #ccdcd2;padding:10px}
        .total{text-align:right;font-size:20px;font-weight:bold}.thanks{text-align:center;margin-top:32px}
        @media print{body{margin:0 auto}}
        </style></head><body>
        <h1>${esc(settings.name || 'PawWise Pet Clinic')}</h1>
        <p>${esc(settings.address || '')}</p><p>${esc(settings.phone || '')}</p>
        <h2>Payment Receipt</h2>
        <div class="meta"><p>Receipt: ${esc(receipt.id)}</p><p>Date: ${esc(receipt.settledAt)}</p>
            <p>Pet owner: ${esc(receipt.ownerName)}</p><p>Payment method: ${esc(receipt.paymentMethod)}</p>
            <p>Received by: ${esc(receipt.settledBy)}</p></div>
        <table><thead><tr><th>Pet</th><th>Description</th><th>Type</th><th>Amount</th></tr></thead>
            <tbody>${rows}</tbody></table>
        <p class="total">Total paid: ${money(receipt.total)}</p>
        <p class="thanks">Thank you for choosing ${esc(settings.name || 'PawWise Pet Clinic')}.</p>
        </body></html>`);
    printWindow.document.close();
    printWindow.addEventListener('load', () => {
        printWindow.focus();
        printWindow.print();
    }, { once: true });
}

function wireRecords(tableName) {
    const searchInput = document.getElementById('search');
    if (searchInput) {
        searchInput.oninput = event => {
            search = event.target.value;
            const cursor = event.target.selectionStart;
            renderContent();
            const input = document.getElementById('search');
            input.focus();
            input.setSelectionRange(cursor, cursor);
            wireRecords(tableName);
        };
    }

    document.getElementById('add')?.addEventListener('click', () => {
        editing = 'new';
        renderContent();
        wireRecords(tableName);
    });
    document.querySelectorAll('[data-edit]').forEach(button => button.addEventListener('click', () => {
        editing = find(tableName, button.dataset.edit);
        renderContent();
        wireRecords(tableName);
    }));
    document.querySelectorAll('[data-grooming-status]').forEach(button => button.addEventListener('click', async () => {
        const grooming = find('grooming', button.dataset.groomingStatus);
        const nextStatus = button.dataset.nextStatus;
        if (!grooming || !nextStatus) return;
        button.disabled = true;
        try {
            await api(`/api/records/grooming/${encodeURIComponent(grooming.id)}/status`, {
                method: 'PATCH',
                body: JSON.stringify({ status: nextStatus })
            });
            await refreshData();
            notify(`Grooming marked ${nextStatus.toLowerCase()}.`, 'success');
        } catch (error) {
            button.disabled = false;
            notify(error.message);
        }
    }));
    document.querySelectorAll('[data-delete]').forEach(button => button.addEventListener('click', async () => {
        if (!confirm('Delete this record?')) return;
        try {
            await api(`/api/records/${tableName}/${encodeURIComponent(button.dataset.delete)}`, { method: 'DELETE' });
            editing = null;
            await refreshData();
            notify(`${labels[tableName]} record deleted.`, 'success');
        } catch (error) {
            notify(error.message);
        }
    }));
    document.getElementById('cancel-edit')?.addEventListener('click', () => {
        editing = null;
        renderContent();
        wireRecords(tableName);
    });
    document.getElementById('record-form')?.addEventListener('submit', async event => {
        event.preventDefault();
        const values = Object.fromEntries(new FormData(event.currentTarget));
        if (tableName === 'consultations') {
            const scheduleError = appointmentScheduleError(values.date, values.appointmentTime);
            if (scheduleError) {
                notify(scheduleError);
                return;
            }
        }
        if (tableName === 'pets' && session.role === 'Owner') values.ownerId = session.ownerId;
        if (tableName === 'pets' && !values.ownerId) {
            notify('Select an owner.');
            return;
        }

        const action = editing === 'new' ? 'added' : 'updated';
        try {
            if (editing === 'new') {
                await api(`/api/records/${tableName}`, { method: 'POST', body: JSON.stringify(values) });
            } else {
                await api(`/api/records/${tableName}/${encodeURIComponent(editing.id)}`, { method: 'PUT', body: JSON.stringify(values) });
            }
            editing = null;
            await refreshData();
            notify(`${labels[tableName]} record ${action}.`, 'success');
        } catch (error) {
            notify(error.message);
        }
    });
}

function appointmentScheduleError(dateValue, timeValue) {
    if (!dateValue || !timeValue) return 'Choose an appointment date and time.';
    const date = new Date(`${dateValue}T00:00:00Z`);
    if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== dateValue) {
        return 'Choose a valid appointment date.';
    }
    const weekday = date.getUTCDay();
    const hours = db.clinicHours.find(item => item.weekday === weekday);
    const days = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    if (!hours?.isOpen) return `The clinic is closed on ${days[weekday]}. Choose an open day.`;
    const opensAt = String(hours.opensAt).slice(0, 5);
    const closesAt = String(hours.closesAt).slice(0, 5);
    if (timeValue < opensAt || timeValue >= closesAt) {
        return `Choose an appointment time during clinic hours (${opensAt}–${closesAt}).`;
    }
    return '';
}

setUpPage();
