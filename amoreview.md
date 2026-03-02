## Build Instructions

### Requirements

- **OS:** Any Unix-like system (Linux, macOS) or Windows with bash (e.g. Git Bash, WSL)
- **curl:** Any version (used to download PDF.js if not already present)
- **zip:** Any version (used to package the .xpi)

No Node.js, npm, or other build tools are required.

### Steps to reproduce the .xpi

```bash
./build.sh
```

This will:
1. Automatically download the third-party PDF.js library if not already present (via `setup.sh`)
2. Package all files into `nonstop-vimium-c-<version>.xpi`

No compilation, transpilation, or minification is performed.

## Source Code Notes

All source files are plain, hand-written JavaScript, CSS, and HTML. None are transpiled, concatenated, minified, or machine-generated.

The only minified files are the two third-party PDF.js library files in `pdf/lib/`. These are unmodified copies from the official [pdfjs-dist](https://www.npmjs.com/package/pdfjs-dist/v/3.11.174) npm package (v3.11.174, Mozilla Public License 2.0). They are downloaded by `setup.sh` from:
- `https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.min.js`
- `https://unpkg.com/pdfjs-dist@3.11.174/build/pdf.worker.min.js`

