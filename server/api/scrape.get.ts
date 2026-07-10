import { chromium } from 'playwright';
import axios from 'axios';
import { defineEventHandler, getQuery, setResponseHeaders, createError } from 'h3';
import { validateUrl, generateUserAgent } from '../utils/scraperCore';
import { processStoreUrl } from '../utils/browserTasks';
import { setupDatabase } from '../utils/db';
import { Semaphore } from '../utils/semaphore';
import type { StoreResultEvent } from '../utils/types';

const DB_NAME = 'rice_scraper.db';
const MAX_CONCURRENT_TASKS = 3;
const STORE_LIST_GIST_URL =
    'https://gist.githubusercontent.com/Neko-Kuroi/6e29343a791f5b6006d93143c8eef90b/raw/34c6ea4a52feb11cc5231b5a2bbd500a5f3b52ed/aeon_netsuper_urls_list2.txt';

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
            const { data } = await axios.get(STORE_LIST_GIST_URL);
            rawUrls = String(data).split('\n').map((l: string) => l.trim()).filter(Boolean);
        } catch (e: any) {
            send('fatal_error', { message: `店舗リストの取得に失敗しました: ${e.message}` });
            res.end();
            return;
        }
    }

    const validUrls = rawUrls.map(validateUrl).filter((u): u is string => u !== null);
    validUrls.sort();

    if (validUrls.length === 0) {
        send('fatal_error', { message: '有効な店舗URLが見つかりませんでした' });
        res.end();
        return;
    }

    send('init', { total: validUrls.length, keyword });

    const db = await setupDatabase(DB_NAME);
    const semaphore = new Semaphore(MAX_CONCURRENT_TASKS);
    const browser = await chromium.launch({ headless: true });
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