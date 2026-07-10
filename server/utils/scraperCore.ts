import * as cheerio from 'cheerio';
import fakeUserAgent from 'fake-useragent';
import axios from 'axios';
import type { StoreDetails } from './types';

export const STORE_LIST_GIST_URL =
    'https://gist.githubusercontent.com/Neko-Kuroi/6e29343a791f5b6006d93143c8eef90b/raw/34c6ea4a52feb11cc5231b5a2bbd500a5f3b52ed/aeon_netsuper_urls_list2.txt';

// --- Regex patterns ---
export const URL_PATTERN = /^https:\/\/shop\.aeon\.com\/netsuper\/\d{14,15}$/;
export const ADDRESS_PATTERN = /〒\d{3}-\d{4}\s+.*/;
export const SALES_MANAGER_PATTERN = /販売責任者：(.*)/;
export const LIQUOR_MANAGER_PATTERN = /酒類販売管理者：(.*)/;
export const PRICE_CLEAN_PATTERN = /[¥￥,円]/g;

export function generateUserAgent(): string {
    let useragent: string = fakeUserAgent();
    if (/Firefox|iPhone|Android 10/.test(useragent)) {
        return 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36';
    }
    return useragent;
}

export function validateUrl(url: string): string | null {
    return URL_PATTERN.test(url) ? url : null;
}

export function parseStoreNameFromTitle(title: string): string {
    if (!title) return "店舗名不明";
    const parts = title.split("　");
    return parts.length > 1 ? parts[1].trim() : parts[0].trim();
}

export function safeRegexSearch(pattern: RegExp, text: string, groupIndex: number = 0, splitChar: string | null = null): string {
    const match = text.match(pattern);
    if (!match) return "不明";
    try {
        let result = match[groupIndex].trim();
        if (splitChar) {
            const parts = result.split(splitChar);
            return parts.length > 1 ? parts[1].trim() : result;
        }
        return result;
    } catch {
        return "不明";
    }
}

export function parseStoreDetailsFromHtml(htmlContent: string): StoreDetails {
    const $ = cheerio.load(htmlContent);
    const storeWidget = $('.widget__content--store, .widget__content:contains("イオン"), .widget__content:contains("マックス")').first();

    let details: StoreDetails = {
        "住所": "不明",
        "販売責任者": "不明",
        "酒類販売管理者": "不明"
    };

    if (!storeWidget.length) {
        console.warn("⚠️ [Cheerio] 店舗情報ウィジェットが見つかりませんでした。");
        return details;
    }

    const text = storeWidget.text();
    details["住所"] = safeRegexSearch(ADDRESS_PATTERN, text);
    details["販売責任者"] = safeRegexSearch(SALES_MANAGER_PATTERN, text, 1);
    details["酒類販売管理者"] = safeRegexSearch(LIQUOR_MANAGER_PATTERN, text, 1);

    return details;
}

export function cleanPrice(priceStr: string | null): string {
    if (!priceStr) return "N/A";
    return priceStr.replace(PRICE_CLEAN_PATTERN, "").trim();
}

export async function fetchAllStoreUrls(): Promise<string[]> {
    const { data } = await axios.get(STORE_LIST_GIST_URL);
    const rawUrls = String(data).split('\n').map((l: string) => l.trim()).filter(Boolean);
    const validUrls = rawUrls.map(validateUrl).filter((u): u is string => u !== null);
    const uniqueUrls = Array.from(new Set(validUrls));
    uniqueUrls.sort();
    return uniqueUrls;
}