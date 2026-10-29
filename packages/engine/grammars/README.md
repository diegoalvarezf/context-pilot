# Bundled grammars

Prebuilt WebAssembly grammars for languages whose npm packages don't ship a `.wasm`
compatible with `web-tree-sitter` 0.24 (language ABI 13–14).

| File | Grammar | License | Built by |
|------|---------|---------|----------|
| `tree-sitter-swift.wasm` | [alex-pinkus/tree-sitter-swift](https://github.com/alex-pinkus/tree-sitter-swift) 0.4 | MIT | [tree-sitter-wasms](https://github.com/Gregoor/tree-sitter-wasms) 0.1.13 (Unlicense) |
| `tree-sitter-c_sharp.wasm` | [tree-sitter/tree-sitter-c-sharp](https://github.com/tree-sitter/tree-sitter-c-sharp) 0.20 | MIT | [tree-sitter-wasms](https://github.com/Gregoor/tree-sitter-wasms) 0.1.13 (Unlicense) |

Replace them with the official packages' `.wasm` once `web-tree-sitter` is upgraded to a version that
reads ABI 15 (tree-sitter-c-sharp 0.23 ships ABI 15).
