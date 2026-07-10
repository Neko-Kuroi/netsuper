import type { Browser, BrowserContext, Page, ElementHandle } from 'playwright';
import retry from 'async-retry';
import type { Database } from 'sqlite';
import { parseStoreNameFromTitle, parseStoreDetailsFromHtml, cleanPrice } from './scraperCore';
import { saveDataToDb } from './db';
import { Semaphore } from './semaphore';
import type { PageState, ProductData, StoreInfo, StoreResult } from './types';

const RETRY_OPTIONS = {
    retries: 3,
    minTimeout: 2000,
    maxTimeout: 8000,
    factor: 2
};

/**
 * リトライ付きでURLに遷移し、ページのタイトル・HTMLを取得する。
 */
export async function navigateAndGetPageState(page: Page, url: string): Promise<PageState> {
    try {
        await retry(async () => {
            await page.goto(url, { timeout: 60000, waitUntil: 'domcontentloaded' });
        }, RETRY_OPTIONS);

        const title = await page.title();
        const content = await page.content();
        return { title, content };
    } catch (e: any) {
        console.error(`❌ [Navigation Failed] for ${url}: ${e.message}`);
        return { title: null, content: null };
    }
}

/**
 * ページ内で指定キーワードの検索を実行する（リトライ付き）。
 */
export async function searchOnPage(page: Page, searchTerm: string): Promise<boolean> {
    try {
        const searchBox = await retry(async () => {
            const box = await page.$('#search');
            if (!box) throw new Error("Search box not found");
            return box;
        }, RETRY_OPTIONS);

        console.log(`✅ [Search] #search box found on ${page.url()}`); 

        await searchBox.fill(searchTerm);

        await retry(async () => {
            const nav = page.waitForNavigation({ timeout: 60000, waitUntil: 'networkidle' });
            await page.click('#cx-search-button');
            await nav;
        }, RETRY_OPTIONS);

        await retry(async () => {
            await page.waitForSelector('.product-item', { timeout: 60000 });
        }, RETRY_OPTIONS);

        return true;
    } catch (e: any) {
        console.error(`❌ [Search Failed] on ${page.url()} for '${searchTerm}': ${e.message}`);
        return false;
    }
}

/**
 * 検索結果ページから商品要素の一覧を取得する。
 */
export async function getProductElements(page: Page): Promise<ElementHandle[]> {
    try {
        await retry(async () => {
            await page.waitForSelector('.product-item', { timeout: 60000 });
        }, RETRY_OPTIONS);

        return await page.$$('.product-item');
    } catch (e: any) {
        console.error(`❌ [Product Fetch Failed] on ${page.url()}: ${e.message}`);
        return [];
    }
}

/**
 * 商品要素1件からデータをパースする。
 */
export async function parseProductData(productElement: ElementHandle): Promise<ProductData | null> {
    const nameEl = await productElement.$('.product-item-link');
    if (!nameEl) return null;

    const name = (await nameEl.innerText()).trim();
    const nameLink = (await nameEl.getAttribute('href')) || "";

    const outOfStockEl = await productElement.$('.stock-status.out-of-stock');
    const isOutOfStock = !!outOfStockEl;

    let priceExStr: string | null = null;
    let priceInStr: string | null = null;
    if (!isOutOfStock) {
        const priceExEl = await productElement.$('.floor-price');
        const priceInEl = await productElement.$('.floor-tax');
        if (priceExEl) priceExStr = await priceExEl.innerText();
        if (priceInEl) priceInStr = await priceInEl.innerText();
    }

    return {
        product_name: name,
        price_ex: cleanPrice(priceExStr),
        price_in: cleanPrice(priceInStr),
        product_url: nameLink,
        is_out_of_stock: isOutOfStock
    };
}

/**
 * 店舗1件分の処理を行う：遷移 → 店舗情報取得 → キーワード検索 → 商品パース → DB保存。
 * 結果はSSE送信用にStoreResultとして返す（voidにせず、呼び出し側で進捗イベントを送れるようにする）。
 */
export async function processStoreUrl(
    browser: Browser,
    userAgent: string,
    db: Database,
    storeUrl: string,
    keyword: string,
    semaphore: Semaphore
): Promise<StoreResult> {
    let context: BrowserContext | null = null;
    let page: Page | null = null;
    let storeInfo: StoreInfo | null = null;

    try {
        await semaphore.acquire();

        context = await browser.newContext({ userAgent });
        page = await context.newPage();

        // Stage 1: Navigation
        const { title, content } = await navigateAndGetPageState(page, storeUrl);
        if (!content) {
            return { storeUrl, storeInfo: null, products: [], status: 'error', message: 'ページ取得に失敗しました' };
        }

        const storeName = parseStoreNameFromTitle(title || "");
        const storeDetails = parseStoreDetailsFromHtml(content);
        storeInfo = { 店舗名: storeName, ...storeDetails };

        console.log(`[${new Date().toLocaleTimeString()}] ℹ️ Processing store: ${storeName} (keyword: ${keyword})`);

        // Stage 2: Search（キーワードはユーザー入力）
        const searchSuccessful = await searchOnPage(page, keyword);
        if (!searchSuccessful) {
            return { storeUrl, storeInfo, products: [], status: 'error', message: '検索に失敗しました' };
        }

        // Stage 3: Product Extraction
        const productElements = await getProductElements(page);
        if (productElements.length === 0) {
            return { storeUrl, storeInfo, products: [], status: 'no_results' };
        }

        // Stage 4: Parsing（在庫切れは除外。5kg専用フィルタは撤廃 — 検索キーワード自体が絞り込み条件）
        const allProductsData = await Promise.all(productElements.map(el => parseProductData(el)));
        const validProducts = allProductsData.filter((p): p is ProductData => p !== null);
        const inStockProducts = validProducts.filter(p => !p.is_out_of_stock);

        if (inStockProducts.length === 0) {
            return { storeUrl, storeInfo, products: [], status: 'no_results' };
        }

        // Stage 5: Save to DB
        await Promise.all(inStockProducts.map(p => saveDataToDb(db, keyword, storeInfo!, p)));

        console.log(`✅ ${storeName}: Saved ${inStockProducts.length} product(s).`);
        return { storeUrl, storeInfo, products: inStockProducts, status: 'success' };

    } catch (e: any) {
        console.error(`❌ [Stage Unknown: Critical Error] Processing ${storeInfo?.店舗名 || storeUrl}: ${e.message}`);
        return { storeUrl, storeInfo, products: [], status: 'error', message: e.message };
    } finally {
        if (page) {
            try { await page.close(); } catch (e: any) { console.warn(`⚠️ Error closing page for ${storeUrl}: ${e.message}`); }
        }
        if (context) {
            try { await context.close(); } catch (e: any) { console.warn(`⚠️ Error closing context for ${storeUrl}: ${e.message}`); }
        }
        // @ts-ignore
        if (global.gc) global.gc();
        await new Promise(resolve => setTimeout(resolve, 3000));
        semaphore.release();
    }
}