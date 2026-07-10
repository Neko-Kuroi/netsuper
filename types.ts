export interface StoreDetails {
    "住所": string;
    "販売責任者": string;
    "酒類販売管理者": string;
}

export interface StoreInfo {
    店舗名: string;
    "住所": string;
    "販売責任者": string;
    "酒類販売管理者": string;
}

export interface ProductData {
    product_name: string;
    price_ex: string;
    price_in: string;
    product_url: string;
    is_out_of_stock: boolean;
}

export interface PageState {
    title: string | null;
    content: string | null;
}

export type StoreStatus = 'success' | 'no_results' | 'error';

export interface StoreResult {
    storeUrl: string;
    storeInfo: StoreInfo | null;
    products: ProductData[];
    status: StoreStatus;
    message?: string;
}

// SSEで送るstore_resultイベントのペイロード（進捗カウント込み）
export interface StoreResultEvent extends StoreResult {
    completed: number;
    total: number;
}