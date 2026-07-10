import { defineEventHandler, createError } from 'h3';
import { fetchAllStoreUrls } from '../utils/scraperCore';

export default defineEventHandler(async (event) => {
    try {
        const stores = await fetchAllStoreUrls();
        return { stores, total: stores.length };
    } catch (e: any) {
        throw createError({
            statusCode: 502,
            statusMessage: `店舗リストの取得に失敗しました: ${e.message}`
        });
    }
});