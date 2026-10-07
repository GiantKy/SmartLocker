CREATE DATABASE IF NOT EXISTS smart_locker_db
CHARACTER SET utf8mb4
COLLATE utf8mb4_unicode_ci;

USE smart_locker_db;


-- =========================================
-- BẢNG TỦ
-- =========================================

CREATE TABLE IF NOT EXISTS TU (
    ID INT PRIMARY KEY,
    TRONG BOOLEAN NOT NULL DEFAULT FALSE,

    CONSTRAINT chk_tu_id
        CHECK (ID BETWEEN 1 AND 6)
);


-- =========================================
-- BẢNG ĐƠN HÀNG
-- =========================================

CREATE TABLE IF NOT EXISTS DON_HANG (
    ID INT AUTO_INCREMENT PRIMARY KEY,

    TU INT NOT NULL,

    MA_DON_HANG VARCHAR(50) NOT NULL UNIQUE,

    TEN_NGUOI_GUI VARCHAR(100) NOT NULL,
    SDT_NGUOI_GUI VARCHAR(15) NOT NULL,

    TEN_NGUOI_NHAN VARCHAR(100) NOT NULL,
    SDT_NGUOI_NHAN VARCHAR(15) NOT NULL,

    TRANG_THAI INT NOT NULL DEFAULT 0,

    LAST_UPDATE DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
        ON UPDATE CURRENT_TIMESTAMP,

    CREATED_AT DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,

    -- TU phải tồn tại trong bảng TU
    CONSTRAINT fk_don_hang_tu
        FOREIGN KEY (TU)
        REFERENCES TU(ID),

    -- Chỉ cho phép trạng thái 0 -> 3
    CONSTRAINT chk_don_hang_trang_thai
        CHECK (TRANG_THAI BETWEEN 0 AND 3)
);


-- =========================================
-- KHỞI TẠO DỮ LIỆU BAN ĐẦU CHO 6 TỦ
-- =========================================

INSERT IGNORE INTO TU (ID, TRONG) VALUES
(1, TRUE),
(2, TRUE),
(3, TRUE),
(4, TRUE),
(5, TRUE),
(6, TRUE);

