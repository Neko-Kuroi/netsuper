export default defineNuxtConfig({
  compatibilityDate: '2026-01-01',
  devtools: { enabled: true },
  nitro: {
    // Playwrightやsqlite3などのnativeモジュールはバンドルせず、
    // node_modulesから直接require/importさせる
    externals: {
      external: [
        'playwright',
        'sqlite3',
        'sqlite',
        'cheerio',
        'fake-useragent',
        'async-retry'
      ]
    }
  }
})