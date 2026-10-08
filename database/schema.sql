CREATE DATABASE IF NOT EXISTS pawwise
    CHARACTER SET utf8mb4
    COLLATE utf8mb4_unicode_ci;

USE pawwise;

CREATE TABLE IF NOT EXISTS users (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    username VARCHAR(80) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    role ENUM('Admin') NOT NULL DEFAULT 'Admin',
    status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS owners (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    phone VARCHAR(40),
    email VARCHAR(254),
    address VARCHAR(255),
    username VARCHAR(80) NOT NULL UNIQUE,
    password_hash VARCHAR(255) NOT NULL,
    status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS pets (
    id VARCHAR(32) PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    ownerId VARCHAR(32) NOT NULL,
    species VARCHAR(40),
    breed VARCHAR(100),
    sex VARCHAR(20),
    birthday DATE,
    color VARCHAR(80),
    weight DECIMAL(8,2),
    status ENUM('Active', 'Inactive') NOT NULL DEFAULT 'Active',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT pets_owner_fk FOREIGN KEY (ownerId) REFERENCES owners(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS consultations (
    id VARCHAR(32) PRIMARY KEY,
    petId VARCHAR(32) NOT NULL,
    vet VARCHAR(160),
    symptoms TEXT,
    diagnosis TEXT,
    treatment TEXT,
    weight DECIMAL(8,2),
    temperature DECIMAL(5,2),
    cost DECIMAL(10,2),
    date DATE,
    appointmentTime TIME,
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT consultations_pet_fk FOREIGN KEY (petId) REFERENCES pets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS medicines (
    id VARCHAR(32) PRIMARY KEY,
    petId VARCHAR(32) NOT NULL,
    name VARCHAR(160) NOT NULL,
    dosage VARCHAR(100),
    frequency VARCHAR(100),
    duration VARCHAR(100),
    instructions TEXT,
    cost DECIMAL(10,2),
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT medicines_pet_fk FOREIGN KEY (petId) REFERENCES pets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS grooming (
    id VARCHAR(32) PRIMARY KEY,
    petId VARCHAR(32) NOT NULL,
    service VARCHAR(160) NOT NULL,
    date DATE,
    price DECIMAL(10,2),
    status ENUM('Pending', 'In Progress', 'Completed', 'No-show') NOT NULL DEFAULT 'Pending',
    created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT grooming_pet_fk FOREIGN KEY (petId) REFERENCES pets(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS settings (
    id TINYINT PRIMARY KEY,
    name VARCHAR(160) NOT NULL,
    address VARCHAR(255),
    phone VARCHAR(40),
    email VARCHAR(254),
    hours VARCHAR(255)
);

CREATE TABLE IF NOT EXISTS clinic_hours (
    weekday TINYINT UNSIGNED PRIMARY KEY,
    is_open BOOLEAN NOT NULL DEFAULT FALSE,
    opens_at TIME NULL,
    closes_at TIME NULL,
    CONSTRAINT clinic_hours_weekday_check CHECK (weekday BETWEEN 0 AND 6)
);

INSERT IGNORE INTO clinic_hours (weekday, is_open, opens_at, closes_at) VALUES
    (0, FALSE, NULL, NULL),
    (1, TRUE, '09:00', '17:00'),
    (2, TRUE, '09:00', '17:00'),
    (3, TRUE, '09:00', '17:00'),
    (4, TRUE, '09:00', '17:00'),
    (5, TRUE, '09:00', '17:00'),
    (6, TRUE, '09:00', '17:00');

CREATE TABLE IF NOT EXISTS billing_receipts (
    id VARCHAR(32) PRIMARY KEY,
    owner_id VARCHAR(32) NOT NULL,
    owner_name VARCHAR(160) NOT NULL,
    payment_method ENUM('Cash', 'Card', 'E-wallet') NOT NULL,
    total DECIMAL(10,2) NOT NULL,
    settled_by VARCHAR(160) NOT NULL,
    settled_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS billing_receipt_items (
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
);
