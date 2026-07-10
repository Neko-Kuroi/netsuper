<script setup lang="ts">
import { ref, computed, watch, onBeforeUnmount } from 'vue'

interface ProductData {
    product_name: string
    price_ex: string
    price_in: string
    product_url: string
    is_out_of_stock: boolean
}
interface StoreInfo {
    店舗名: string
    住所: string
    販売責任者: string
    酒類販売管理者: string
}
type StoreStatus = 'success' | 'no_results' | 'error'
interface StoreResultEvent {
    storeUrl: string
    storeInfo: StoreInfo | null
    products: ProductData[]
    status: StoreStatus
    message?: string
    completed: number
    total: number
}

const keyword = ref('')
const mode = ref<'all' | 'custom' | 'select'>('all')
const customUrls = ref('')
const isRunning = ref(false)
const progress = ref({ completed: 0, total: 0 })
const results = ref<StoreResultEvent[]>([])
const errorMessage = ref('')
let es: EventSource | null = null

// --- 店舗選択モード用 ---
const storeList = ref<string[]>([])
const selectedStores = ref<Set<string>>(new Set())
const isLoadingStores = ref(false)
const storeListError = ref('')

async function loadStoreList() {
    if (storeList.value.length > 0 || isLoadingStores.value) return
    isLoadingStores.value = true
    storeListError.value = ''
    try {
        const data = await $fetch<{ stores: string[]; total: number }>('/api/stores')
        storeList.value = data.stores
    } catch (e: any) {
        storeListError.value = e?.data?.statusMessage || e?.message || '店舗リストの取得に失敗しました'
    } finally {
        isLoadingStores.value = false
    }
}

function toggleStore(url: string) {
    if (selectedStores.value.has(url)) {
        selectedStores.value.delete(url)
    } else {
        selectedStores.value.add(url)
    }
    // Setはreactivityが効きにくいので新しいインスタンスに差し替えて確実に再描画させる
    selectedStores.value = new Set(selectedStores.value)
}

function selectAllStores() {
    selectedStores.value = new Set(storeList.value)
}

function clearStoreSelection() {
    selectedStores.value = new Set()
}

watch(mode, (m) => {
    if (m === 'select') loadStoreList()
})

const allProducts = computed(() =>
    results.value.flatMap(r =>
        r.products.map(p => ({ ...p, storeName: r.storeInfo?.店舗名 || r.storeUrl }))
    )
)

function startSearch() {
    if (!keyword.value.trim()) {
        errorMessage.value = 'キーワードを入力してください'
        return
    }
    if (mode.value === 'custom' && !customUrls.value.trim()) {
        errorMessage.value = '店舗URLを1件以上入力してください'
        return
    }
    if (mode.value === 'select' && selectedStores.value.size === 0) {
        errorMessage.value = '店舗を1件以上選択してください'
        return
    }

    errorMessage.value = ''
    results.value = []
    progress.value = { completed: 0, total: 0 }
    isRunning.value = true

    // 「店舗を選択」モードはgist取得済みのリストから選んだURLをcustomモードとしてAPIに渡す
    const apiMode = mode.value === 'select' ? 'custom' : mode.value
    const urlsForApi = mode.value === 'select'
        ? Array.from(selectedStores.value).join('\n')
        : customUrls.value

    const params = new URLSearchParams({ keyword: keyword.value.trim(), mode: apiMode })
    if (apiMode === 'custom') params.set('urls', urlsForApi)

    es = new EventSource(`/api/scrape?${params.toString()}`)

    es.addEventListener('init', (e: MessageEvent) => {
        const data = JSON.parse(e.data)
        progress.value.total = data.total
    })

    es.addEventListener('store_result', (e: MessageEvent) => {
        const data: StoreResultEvent = JSON.parse(e.data)
        results.value.push(data)
        progress.value.completed = data.completed
        progress.value.total = data.total
    })

    es.addEventListener('fatal_error', (e: MessageEvent) => {
        const data = JSON.parse(e.data)
        errorMessage.value = data.message
        stopSearch()
    })

    es.addEventListener('done', () => {
        stopSearch()
    })

    es.onerror = () => {
        if (isRunning.value) {
            errorMessage.value = '通信エラーが発生しました（サーバーログを確認してください）'
        }
        stopSearch()
    }
}

function stopSearch() {
    isRunning.value = false
    es?.close()
    es = null
}

onBeforeUnmount(() => stopSearch())
</script>

<template>
    <div class="container">
        <h1>店舗商品価格検索</h1>

        <div class="form">
            <label class="field">
                検索キーワード
                <input v-model="keyword" placeholder="例: 米 5Kg" :disabled="isRunning" />
            </label>

            <div class="mode-select">
                <label><input type="radio" value="all" v-model="mode" :disabled="isRunning" /> 全店舗を検索</label>
                <label><input type="radio" value="custom" v-model="mode" :disabled="isRunning" /> 店舗URLを指定</label>
                <label><input type="radio" value="select" v-model="mode" :disabled="isRunning" /> 店舗を選択</label>
            </div>

            <label v-if="mode === 'custom'" class="field">
                店舗URL（1行に1件）
                <textarea
                    v-model="customUrls"
                    placeholder="https://shop.aeon.com/netsuper/xxxxxxxxxxxxxxx"
                    :disabled="isRunning"
                ></textarea>
            </label>

            <div v-if="mode === 'select'" class="field">
                <p v-if="isLoadingStores">店舗リストを取得中...</p>
                <p v-else-if="storeListError" class="error">
                    {{ storeListError }}
                    <button type="button" class="secondary" @click="loadStoreList">再試行</button>
                </p>
                <template v-else>
                    <div class="store-select-header">
                        <span>{{ selectedStores.size }} / {{ storeList.length }} 店舗選択中</span>
                        <button type="button" class="secondary" @click="selectAllStores" :disabled="isRunning">全選択</button>
                        <button type="button" class="secondary" @click="clearStoreSelection" :disabled="isRunning">全解除</button>
                    </div>
                    <div class="store-checklist">
                        <label v-for="url in storeList" :key="url" class="store-checkbox">
                            <input
                                type="checkbox"
                                :checked="selectedStores.has(url)"
                                :disabled="isRunning"
                                @change="toggleStore(url)"
                            />
                            {{ url }}
                        </label>
                    </div>
                </template>
            </div>

            <div class="actions">
                <button @click="startSearch" :disabled="isRunning">
                    {{ isRunning ? '検索中...' : '検索開始' }}
                </button>
                <button v-if="isRunning" class="secondary" @click="stopSearch">中断</button>
            </div>
        </div>

        <p v-if="errorMessage" class="error">{{ errorMessage }}</p>

        <p v-if="progress.total > 0" class="progress">
            進捗: {{ progress.completed }} / {{ progress.total }} 店舗完了
            （ヒット商品 {{ allProducts.length }} 件）
        </p>

        <table v-if="allProducts.length > 0">
            <thead>
                <tr>
                    <th>店舗名</th>
                    <th>商品名</th>
                    <th>税抜価格</th>
                    <th>税込価格</th>
                    <th>リンク</th>
                </tr>
            </thead>
            <tbody>
                <tr v-for="(p, i) in allProducts" :key="i">
                    <td>{{ p.storeName }}</td>
                    <td>{{ p.product_name }}</td>
                    <td>{{ p.price_ex }}</td>
                    <td>{{ p.price_in }}</td>
                    <td><a :href="p.product_url" target="_blank" rel="noopener">開く</a></td>
                </tr>
            </tbody>
        </table>

        <details v-if="results.length > 0" class="store-log">
            <summary>店舗別処理ログ（{{ results.length }}件）</summary>
            <ul>
                <li v-for="(r, i) in results" :key="i" :class="r.status">
                    {{ r.storeInfo?.店舗名 || r.storeUrl }} — {{ r.status }}
                    <span v-if="r.message">（{{ r.message }}）</span>
                    <span v-else>（{{ r.products.length }}件ヒット）</span>
                </li>
            </ul>
        </details>
    </div>
</template>

<style scoped>
.container { max-width: 960px; margin: 0 auto; padding: 2rem; font-family: system-ui, sans-serif; }
.form { display: flex; flex-direction: column; gap: 0.75rem; margin-bottom: 1.5rem; }
.field { display: flex; flex-direction: column; gap: 0.3rem; font-size: 0.9rem; color: #333; }
input, textarea, button { padding: 0.5rem; font-size: 1rem; font-family: inherit; }
textarea { min-height: 100px; resize: vertical; }
.mode-select { display: flex; gap: 1.5rem; font-size: 0.95rem; }
.actions { display: flex; gap: 0.5rem; }
button { cursor: pointer; }
button.secondary { background: #eee; }
.error { color: #c00; }
.progress { color: #333; font-weight: 600; }
table { width: 100%; border-collapse: collapse; margin-bottom: 1.5rem; }
th, td { border: 1px solid #ddd; padding: 0.5rem; text-align: left; font-size: 0.9rem; }
th { background: #f5f5f5; }
.store-log { font-size: 0.85rem; color: #666; }
.store-log li.error { color: #c00; }
.store-log li.no_results { color: #999; }
</style>