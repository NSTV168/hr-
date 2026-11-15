-- ตารางบันทึกเวลาเข้า-ออกงาน และโอที
CREATE TABLE IF NOT EXISTS work_logs (
    id TEXT PRIMARY KEY,
    work_date TEXT NOT NULL,
    shift TEXT NOT NULL, -- 'morning' | 'night'
    time_in TEXT NOT NULL,
    time_out TEXT NOT NULL,
    regular_hours REAL NOT NULL DEFAULT 8,
    ot_hours REAL NOT NULL DEFAULT 0,
    is_holiday INTEGER NOT NULL DEFAULT 0,
    base_pay REAL NOT NULL DEFAULT 0,
    ot_pay REAL NOT NULL DEFAULT 0,
    shift_allowance REAL NOT NULL DEFAULT 0,
    total_pay REAL NOT NULL DEFAULT 0,
    note TEXT,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ตารางกำหนดกะงานล่วงหน้า (รอบ 2 สัปดาห์)
CREATE TABLE IF NOT EXISTS schedules (
    work_date TEXT PRIMARY KEY,
    shift_type TEXT NOT NULL, -- 'morning' | 'night' | 'off'
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);

-- ตารางเก็บข้อมูลรูปภาพตารางงานล่าสุด (ไฟล์รูปจริงเก็บใน R2)
CREATE TABLE IF NOT EXISTS schedule_meta (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    image_key TEXT,
    updated_at TEXT
);

INSERT OR IGNORE INTO schedule_meta (id, image_key, updated_at) VALUES (1, NULL, NULL);
