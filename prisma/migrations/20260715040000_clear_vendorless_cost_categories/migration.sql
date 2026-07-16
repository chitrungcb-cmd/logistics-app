-- Các khoản này nộp trực tiếp cho cơ quan/chức năng nhà nước, không theo dõi như nhà cung cấp.
UPDATE "ShipmentCost"
SET "vendorId" = NULL
WHERE "category" IN ('HAI_QUAN', 'BIEN_PHONG', 'KIEM_DICH', 'HA_TANG');

UPDATE "CostPreset"
SET "vendorId" = NULL
WHERE "category" IN ('HAI_QUAN', 'BIEN_PHONG', 'KIEM_DICH', 'HA_TANG');
