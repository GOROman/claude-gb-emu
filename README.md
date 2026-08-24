# claude-gb-emu

ブラウザで動く Game Boy / Game Boy Color エミュレータ。コアは C++ で書かれ、Emscripten で WebAssembly にコンパイルされています。

A Game Boy / Game Boy Color emulator that runs in the browser. The core is written in C++ and compiled to WebAssembly with Emscripten.

**▶ Play: https://goroman.github.io/claude-gb-emu/**

「ROMを開く」から .gb / .gbc ファイルを開くか、画面にドロップしてください。「URL」ボタンで ROM の URL を直接指定することもできます(`?rom=<URL>` パラメータにも対応、CORS 許可が必要)。

## Features

### エミュレーションコア (C++ / WASM)
- **SM83 (LR35902) CPU** — 全命令実装。blargg の cpu_instrs 全11項目・instr_timing をパス
- **PPU** — スキャンラインレンダラ。CGB のパレット RAM / VRAM バンク / BG 属性 / OBJ 優先度、DMG の OBJ X 座標優先度に対応。dmg-acid2 / cgb-acid2 をパス
- **APU** — パルス×2 + 波形 + ノイズの4ch。スイープ・エンベロープ・長さカウンタ対応。AudioWorklet 出力(非 HTTPS では ScriptProcessor にフォールバック)
- **MBC** — なし / MBC1 / MBC2 / MBC3(+RTC) / MBC5
- **CGB 機能** — 倍速モード (KEY1)、HDMA(汎用 / HBlank)、WRAM/VRAM バンク切り替え
- バッテリーバックアップ SRAM は localStorage に自動保存

### フロントエンド
- キーボード: 十字キー=矢印 / A=X / B=Z / START=Enter / SELECT=Shift / R=リセット / F=フルスクリーン
- USB ゲームパッド対応 (Gamepad API)
- タッチデバイスでは画面上にタッチパッドを表示
- URL パラメータ `?rom=<URL>` で ROM を直接ロード(CORS 許可が必要)

## Build

```sh
./build.sh   # 要 emscripten。web/gbc.js + web/gbc.wasm を生成
```

ローカル実行はWebサーバー経由で:

```sh
cd web && python3 -m http.server 8080
# → http://localhost:8080/
```

## Deploy (GitHub Pages)

`gh-pages` ブランチに `web/` の内容を置いて配信しています。更新は:

```sh
./build.sh
git subtree split --prefix web -b gh-pages-tmp
git push -f origin gh-pages-tmp:gh-pages
git branch -D gh-pages-tmp
```

## Structure

```
core/gb.h          共通定義
core/cpu.cpp       SM83 CPU
core/ppu.cpp       PPU (DMG + CGB)
core/apu.cpp       APU
core/cartridge.cpp MBC / カートリッジ
core/gb.cpp        バス・タイマー・DMA・WASM API
web/               フロントエンド (index.html / main.js / audio-worklet.js)
```

## License

MIT
