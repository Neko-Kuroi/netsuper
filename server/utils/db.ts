import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import type { StoreInfo, ProductData } from './types';

/**
 * SQLiteデータベースをセットアップし、必要なテーブル・インデックスを作成する。
 */
export async function setupDatabase(dbPath: string): Promise<Database> {
    const db = await open({
        filename: dbPath,
        driver: sqlite3.Database
    });

    await db.exec(`
        CREATE TABLE IF NOT EXISTS products (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            keyword TEXT,
            store_name TEXT,
            address TEXT,
            sales_manager TEXT,
            liquor_manager TEXT,
            product_name TEXT,
            price_ex TEXT,
            price_in TEXT,
            product_url TEXT,
            scraped_at TEXT
        )
    `);

    await db.exec(`CREATE INDEX IF NOT EXISTS idx_keyword ON products(keyword)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_store_name ON products(store_name)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_scraped_at ON products(scraped_at)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_product_name ON products(product_name)`);

    console.log("✅ Database initialized with indexes.");
    return db;
}

/**
 * 商品レコードを1件データベースに保存する。
 */
export async function saveDataToDb(
    db: Database,
    keyword: string,
    storeInfo: StoreInfo,
    product: ProductData
): Promise<void> {
    const now = new Date().toISOString();
    try {
        await db.run(
            `INSERT INTO products (
                keyword, store_name, address, sales_manager, liquor_manager,
                product_name, price_ex, price_in, product_url, scraped_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            keyword,
            storeInfo.店舗名 || "店舗名不明",
            storeInfo.住所 || "不明",
            storeInfo.販売責任者 || "不明",
            storeInfo.酒類販売管理者 || "不明",
            product.product_name,
            product.price_ex,
            product.price_in,
            product.product_url,
            now
        );
    } catch (e: any) {
        console.error(`❌ [DB Save Failed] for ${storeInfo.店舗名}/${product.product_name}: ${e.message}`);
    }
}