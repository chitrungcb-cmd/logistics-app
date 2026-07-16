ALTER TABLE "User"
ADD COLUMN "modulePermissions" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Giữ nguyên phạm vi truy cập hợp lệ theo vai trò cho các tài khoản đang tồn tại.
UPDATE "User"
SET "modulePermissions" = ARRAY[
  'CUSTOMERS', 'SHIPMENTS', 'TASKS', 'MESSAGES', 'COSTS', 'DEBTS',
  'DOCUMENTS', 'REPORTS', 'PARTNERS', 'SETTINGS', 'USERS'
]::TEXT[]
WHERE "role" = 'ADMIN';

UPDATE "User"
SET "modulePermissions" = ARRAY[
  'CUSTOMERS', 'SHIPMENTS', 'TASKS', 'MESSAGES', 'DEBTS',
  'DOCUMENTS', 'REPORTS', 'PARTNERS'
]::TEXT[]
WHERE "role" = 'ACCOUNTANT';

UPDATE "User"
SET "modulePermissions" = ARRAY[
  'CUSTOMERS', 'SHIPMENTS', 'TASKS', 'MESSAGES', 'DOCUMENTS', 'REPORTS'
]::TEXT[]
WHERE "role" = 'FIELD_STAFF';
