#!/bin/bash
# Build the C++ Game Boy Color core to WebAssembly (output: web/gbc.js + web/gbc.wasm)
set -e
cd "$(dirname "$0")"

# Homebrew emscripten needs these on this machine (system python is 3.9, config points at wrong LLVM)
if [ -x /opt/homebrew/bin/python3.14 ]; then
  export EMSDK_PYTHON=/opt/homebrew/bin/python3.14
fi
if [ -d /opt/homebrew/opt/emscripten/libexec/llvm/bin ]; then
  export EM_LLVM_ROOT=/opt/homebrew/opt/emscripten/libexec/llvm/bin
  export EM_BINARYEN_ROOT=/opt/homebrew/opt/emscripten/libexec/binaryen
fi

emcc -O3 -std=c++17 \
  core/cpu.cpp core/ppu.cpp core/apu.cpp core/cartridge.cpp core/gb.cpp \
  -o web/gbc.js \
  -sMODULARIZE=1 \
  -sEXPORT_NAME=createGbModule \
  -sALLOW_MEMORY_GROWTH=1 \
  -sEXPORTED_RUNTIME_METHODS=HEAPU8,HEAPU32,HEAPF32 \
  -sENVIRONMENT=web \
  --no-entry

# stamp a fresh version into index.html so browsers never serve stale JS/WASM
VER=$(date +%s)
sed -i '' -E "s/(\\?v=|GB_VER=')[0-9a-zA-Z]+/\\1${VER}/g" web/index.html

echo "Build OK: web/gbc.js web/gbc.wasm (v=${VER})"
