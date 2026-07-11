import { chromium } from 'playwright';
import { defineEventHandler, getQuery, setResponseHeaders, createError } from 'h3';
import { validateUrl, generateUserAgent, fetchAllStoreUrls } from '../utils/scraperCore';
import { processStoreUrl } from '../utils/browserTasks';
import { setupDatabase } from '../utils/db';
import { Semaphore } from '../utils/semaphore';
import { DB_NAME } from '../utils/config';
import type { StoreResultEvent } from '../utils/types';

const MAX_CONCURRENT_TASKS = 3;

export default defineEventHandler(async (event) => {
    const query = getQuery(event);
    const keyword = String(query.keyword || '').trim();
    const mode = query.mode === 'custom' ? 'custom' : 'all';
    const customUrlsRaw = String(query.urls || '');

    if (!keyword) {
        throw createError({ statusCode: 400, statusMessage: 'keyword は必須です' });
    }

    setResponseHeaders(event, {
        'Content-Type': 'text/event-stream; charset=utf-8',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no'
    });

    const res = event.node.res;
    const send = (type: string, data: unknown) => {
        res.write(`event: ${type}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    // --- 対象URLの決定（全店舗 or カスタム指定） ---
    let rawUrls: string[] = [];
    if (mode === 'custom') {
        rawUrls = customUrlsRaw.split('\n').map(u => u.trim()).filter(Boolean);
        if (rawUrls.length === 0) {
            send('fatal_error', { message: '店舗URLが指定されていません' });
            res.end();
            return;
        }
    } else {
        try {
            rawUrls = await fetchAllStoreUrls();
        } catch (e: any) {
            send('fatal_error', { message: `店舗リストの取得に失敗しました: ${e.message}` });
            res.end();
            return;
        }
    }

    // customモードのURLはfetchAllStoreUrls内で未検証のため、ここで改めて検証・ソートする
    // （allモードはfetchAllStoreUrlsが既に検証・ソート済みだが、二重適用しても結果は変わらない）
    const validUrls = rawUrls.map(validateUrl).filter((u): u is string => u !== null);
    validUrls.sort();

    if (validUrls.length === 0) {
        send('fatal_error', { message: '有効な店舗URLが見つかりませんでした' });
        res.end();
        return;
    }

    send('init', { total: validUrls.length, keyword });

    let db;
    let browser;
    try {
        db = await setupDatabase(DB_NAME);
        // headless:trueのみだとroot権限やDocker/Colab等サンドボックス未対応環境で
        // launch()がエラーも出さずハングすることがあるため、回避フラグを付与。
        browser = await chromium.launch({
            headless: true,
            args: ['--no-sandbox', '--disable-setuid-sandbox', '--disable-dev-shm-usage']
        });
    } catch (e: any) {
        console.error(`❌ [Startup Failed] DB初期化またはブラウザ起動に失敗: ${e.message}`);
        send('fatal_error', { message: `起動処理に失敗しました: ${e.message}` });
        res.end();
        return;
    }

    const semaphore = new Semaphore(MAX_CONCURRENT_TASKS);
    const userAgent = generateUserAgent();

    let completed = 0;
    let totalProducts = 0;

    // クライアント切断時にブラウザ/DBを確実にクローズする
    let aborted = false;
    event.node.req.on('close', () => { aborted = true; });

    try {
        await Promise.all(validUrls.map(async (url) => {
            if (aborted) return;
            const result = await processStoreUrl(browser, userAgent, db, url, keyword, semaphore);
            completed++;
            totalProducts += result.products.length;
            if (!aborted) {
                const payload: StoreResultEvent = { ...result, completed, total: validUrls.length };
                send('store_result', payload);
            }
        }));
    } catch (e: any) {
        if (!aborted) send('fatal_error', { message: e.message });
    } finally {
        try { await browser.close(); } catch { /* noop */ }
        try { await db.close(); } catch { /* noop */ }
        if (!aborted) {
            send('done', { totalStores: validUrls.length, totalProducts, completed });
        }
        res.end();
    }
});