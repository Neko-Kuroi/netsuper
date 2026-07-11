import { defineEventHandler, setResponseHeaders, sendStream, createError } from 'h3';
import { createReadStream, existsSync, statSync } from 'node:fs';
import { resolve } from 'node:path';
import { DB_NAME } from '../utils/config';

/**
 * 蓄積されたSQLite DBファイルをそのままダウンロードさせる。
 * setupDatabase()はプロセスのカレントディレクトリ相対でファイルを開いているため、
 * 同じ解決方法でパスを組み立てる。
 */
export default defineEventHandler(async (event) => {
    const dbPath = resolve(process.cwd(), DB_NAME);

    if (!existsSync(dbPath)) {
        throw createError({
            statusCode: 404,
            statusMessage: 'DBファイルがまだ存在しません（一度も検索を実行していない可能性があります）'
        });
    }

    const { size } = statSync(dbPath);

    setResponseHeaders(event, {
        'Content-Type': 'application/vnd.sqlite3',
        'Content-Disposition': `attachment; filename="${DB_NAME}"`,
        'Content-Length': String(size)
    });

    return sendStream(event, createReadStream(dbPath));
});