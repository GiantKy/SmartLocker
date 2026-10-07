const fs = require("fs");
const path = require("path");
const mysql = require("mysql2/promise");
const { DB } = require("./env");

// Đường dẫn tới file schema.sql
const SCHEMA_FILE = path.resolve(__dirname, "../../database/schema.sql");

// Tạo Connection Pool kết nối tới MySQL Laragon
const pool = mysql.createPool({
    host: DB.host,
    port: DB.port,
    user: DB.user,
    password: DB.password,
    database: DB.database,
    waitForConnections: DB.waitForConnections,
    connectionLimit: DB.connectionLimit,
    queueLimit: DB.queueLimit,
    charset: DB.charset
});

/**
 * Kiểm tra xem lỗi có phải do database chưa tồn tại không
 * @param {Error} err 
 * @returns {boolean}
 */
function isUnknownDbError(err) {
    return Boolean(
        err &&
        (err.code === "ER_BAD_DB_ERROR" ||
         err.errno === 1049 ||
         (err.message && err.message.toLowerCase().includes("unknown database")))
    );
}

// Biến lưu promise khởi tạo database để tránh race condition khi gọi đồng thời
let initPromise = null;

/**
 * Tự động kết nối tới MySQL gốc để tạo database và nạp bảng dữ liệu ban đầu
 */
async function initDatabase() {
    let initConn = null;
    try {
        console.log(`[Database] Bắt đầu tự động khởi tạo database '${DB.database}' trên MySQL Laragon...`);

        // Kết nối MySQL mà không chọn database trước
        initConn = await mysql.createConnection({
            host: DB.host,
            port: DB.port,
            user: DB.user,
            password: DB.password,
            multipleStatements: true
        });

        // 1. Tạo database nếu chưa có
        await initConn.query(
            `CREATE DATABASE IF NOT EXISTS \`${DB.database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;`
        );
        console.log(`[Database] Đã tạo database '${DB.database}' thành công.`);

        // 2. Chọn database vừa tạo
        await initConn.query(`USE \`${DB.database}\`;`);

        // 3. Nạp cấu trúc bảng từ schema.sql
        if (fs.existsSync(SCHEMA_FILE)) {
            let schemaSql = fs.readFileSync(SCHEMA_FILE, "utf8");
            // Đồng bộ tên database trong file schema nếu khác với cấu hình DB.database
            if (DB.database !== "smart_locker_db") {
                schemaSql = schemaSql.replace(/smart_locker_db/g, DB.database);
            }
            await initConn.query(schemaSql);
            console.log(`[Database] Đã nạp thành công schema từ: ${SCHEMA_FILE}`);
        } else {
            console.warn(`[Database] Không tìm thấy schema.sql tại ${SCHEMA_FILE}, áp dụng cấu trúc mặc định.`);
            const defaultSql = `
                CREATE TABLE IF NOT EXISTS TU (
                    ID INT PRIMARY KEY,
                    TRONG BOOLEAN NOT NULL DEFAULT FALSE,
                    CONSTRAINT chk_tu_id CHECK (ID BETWEEN 1 AND 6)
                );

                CREATE TABLE IF NOT EXISTS DON_HANG (
                    ID INT AUTO_INCREMENT PRIMARY KEY,
                    TU INT NOT NULL,
                    MA_DON_HANG VARCHAR(50) NOT NULL UNIQUE,
                    TEN_NGUOI_GUI VARCHAR(100) NOT NULL,
                    SDT_NGUOI_GUI VARCHAR(15) NOT NULL,
                    TEN_NGUOI_NHAN VARCHAR(100) NOT NULL,
                    SDT_NGUOI_NHAN VARCHAR(15) NOT NULL,
                    TRANG_THAI INT NOT NULL DEFAULT 0,
                    LAST_UPDATE DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
                    CREATED_AT DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
                    CONSTRAINT fk_don_hang_tu FOREIGN KEY (TU) REFERENCES TU(ID),
                    CONSTRAINT chk_don_hang_trang_thai CHECK (TRANG_THAI BETWEEN 0 AND 3)
                );

                INSERT IGNORE INTO TU (ID, TRONG) VALUES
                (1, TRUE), (2, TRUE), (3, TRUE), (4, TRUE), (5, TRUE), (6, TRUE);
            `;
            await initConn.query(defaultSql);
        }

        console.log(`[Database] Khởi tạo dữ liệu ban đầu cho '${DB.database}' hoàn tất!`);
        return true;
    } catch (err) {
        console.error(`[Database] Lỗi khi tự động khởi tạo database:`, err.message);
        throw err;
    } finally {
        if (initConn) {
            await initConn.end().catch(() => {});
        }
    }
}

/**
 * Đảm bảo chỉ thực thi quá trình khởi tạo một lần tại một thời điểm
 */
function ensureDatabase() {
    if (!initPromise) {
        initPromise = initDatabase().finally(() => {
            initPromise = null;
        });
    }
    return initPromise;
}

/**
 * Kiểm tra kết nối tới cơ sở dữ liệu MySQL Laragon
 */
async function testConnection() {
    try {
        const connection = await pool.getConnection();
        console.log(`[Database] Đã kết nối thành công tới MySQL Laragon (${DB.host}:${DB.port}/${DB.database})`);
        connection.release();
        return true;
    } catch (error) {
        console.error(`[Database] Lỗi kết nối MySQL Laragon:`, error.message);

        // Nếu lỗi là do database chưa tồn tại thì tự động tạo mới
        if (isUnknownDbError(error)) {
            console.log(`[Database] Database '${DB.database}' chưa tồn tại. Tiến hành tự động khởi tạo...`);
            try {
                await ensureDatabase();
                const retryConnection = await pool.getConnection();
                console.log(`[Database] Đã kết nối thành công tới MySQL Laragon (${DB.host}:${DB.port}/${DB.database}) sau khi tự động khởi tạo!`);
                retryConnection.release();
                return true;
            } catch (initErr) {
                console.error(`[Database] Không thể tự động khởi tạo database:`, initErr.message);
                return false;
            }
        }

        console.error(`[Database] Vui lòng đảm bảo Laragon MySQL đang chạy và thông tin trong .env là chính xác.`);
        return false;
    }
}

/**
 * Thực hiện câu lệnh SQL thuận tiện
 * @param {string} sql 
 * @param {Array} params 
 * @returns {Promise<any>}
 */
async function query(sql, params = []) {
    try {
        const [results] = await pool.execute(sql, params);
        return results;
    } catch (error) {
        if (isUnknownDbError(error)) {
            console.log(`[Database] Database '${DB.database}' chưa tồn tại khi thực thi truy vấn. Đang tự động khởi tạo...`);
            await ensureDatabase();
            const [retryResults] = await pool.execute(sql, params);
            return retryResults;
        }
        throw error;
    }
}

module.exports = {
    pool,
    query,
    testConnection,
    initDatabase
};
