# Monorepo Blueprint

Instructions to reproduce (or reorganise) a TypeScript monorepo with this project's
layout, build tooling, and conventions. Use this file as a reference when scaffolding
a new repo or aligning an existing one.

---

## 1. Monorepo structure

```
<root>/
├── packages/
│   ├── dev/              # Library packages (TypeScript source)
│   │   ├── <pkg-a>/      # Leaf package — no internal deps
│   │   ├── <pkg-b>/      # May reference pkg-a
│   │   ├── <pkg-c>/      # May reference pkg-a + pkg-b
│   │   ├── <adapter-x>/  # Engine adapter — references core + behaviors
│   │   └── <server>/     # Node.js server — separate module system
│   └── host/
│       └── www/           # Static dev harness (HTML, deployed bundles)
│           ├── bundle/    # ← deploy target for UMD bundles
│           └── samples/
├── scripts/               # Build/deploy helper scripts (ESM, .mjs)
├── docs/
├── package.json           # Root workspace config
├── tsconfig.json          # Solution file (project references)
├── tsconfig.build.json    # Shared compiler options
├── .eslintrc.json
├── .prettierrc
└── .gitignore
```

---

## 2. Root `package.json`

```jsonc
{
  "name": "@<scope>/root",
  "version": "0.1.0",
  "private": true,
  "type": "module",
  "workspaces": ["packages/**/*"],
  "engines": {
    "node": ">=20.11.0 <23.0.0",
    "npm": ">=8.0.0"
  },
  "scripts": {
    // --- TypeScript ---
    "build:dev":       "tsc -b",
    "build:watch":     "tsc -b --watch",

    // --- Lint & Format ---
    "lint:check":      "eslint packages/**/src/**/*.{ts,tsx,js,json}",
    "lint:fix":        "eslint --fix packages/**/src/**/*.ts",
    "format:check":    "prettier --check packages/**/src/**/*.{ts,tsx,js,json,scss,css}",
    "format:fix":      "prettier --write packages/**/src/**/*.{ts,tsx,js,json,scss,css}",

    // --- Webpack UMD bundles ---
    //     One --workspace flag per bundled package.
    "bundle":          "npm run bundle --workspace=@dev/core --workspace=@dev/filters --workspace=@dev/babylon --workspace=@dev/cesium",
    "bundle:dev":      "npm run bundle:dev --workspace=@dev/core --workspace=@dev/filters --workspace=@dev/babylon --workspace=@dev/cesium",

    // --- Deploy bundles to dev harness ---
    "deploy:bundles":  "node scripts/deploy-bundles.mjs",

    // --- Convenience pipelines ---
    "build:all":       "npm run build:dev && npm run bundle     && npm run deploy:bundles",
    "build:all:dev":   "npm run build:dev && npm run bundle:dev && npm run deploy:bundles",

    // --- Server ---
    "server:build":    "npm run build --workspace=@dev/tunnel",
    "server:start":    "npm run server:build && npm run start --workspace=@dev/tunnel",
    "server:start:http":  "cross-env MCP_TUNNEL_PROTOCOL=http npm run server:start",
    "server:start:https": "cross-env MCP_TUNNEL_PROTOCOL=https MCP_TUNNEL_TLS_CERT=certs/cert.pem MCP_TUNNEL_TLS_KEY=certs/key.pem npm run server:start"
  },
  "dependencies": {
    "tslib": "^2.8.1"
  },
  "devDependencies": {
    "typescript":                     "^5.4.0",
    "@typescript-eslint/parser":      "^7.0.0",
    "@typescript-eslint/eslint-plugin": "^7.0.0",
    "eslint":                         "^8.57.0",
    "eslint-config-prettier":         "^9.1.0",
    "eslint-plugin-prettier":         "^5.1.0",
    "prettier":                       "^3.2.0",
    "lint-staged":                    "^15.0.0",
    "rimraf":                         "~6.0.1",
    "cross-env":                      "^7.0.3"
  },
  "lint-staged": {
    "*.ts": ["eslint --fix", "prettier --write"]
  }
}
```

**Key points:**
- `"type": "module"` at root for ESM scripts.
- `"workspaces": ["packages/**/*"]` — npm discovers all nested package.json.
- Packages are `"private": true` (not published to npm).
- `tslib` is a root dependency shared by all packages via `importHelpers`.

---

## 3. TypeScript configuration

### 3a. `tsconfig.json` — Solution file

Pure project-reference driver; no compiler options here.

```json
{
  "files": [],
  "references": [
    { "path": "packages/dev/core/tsconfig.build.json" },
    { "path": "packages/dev/filters/tsconfig.build.json" },
    { "path": "packages/dev/geodesy/tsconfig.build.json" },
    { "path": "packages/dev/behaviors/tsconfig.build.json" },
    { "path": "packages/dev/babylon/tsconfig.build.json" },
    { "path": "packages/dev/cesium/tsconfig.build.json" },
    { "path": "packages/dev/tunnel/tsconfig.build.json" }
  ]
}
```

Order does not matter for `tsc -b` (it resolves the DAG), but listing them
in dependency order improves readability.

### 3b. `tsconfig.build.json` — Shared compiler options

Every package extends this file.

```jsonc
{
  "compilerOptions": {
    "ignoreDeprecations": "5.0",

    // --- Module & target ---
    "module":           "ES2020",
    "target":           "es2021",
    "moduleResolution": "node",
    "baseUrl":          "packages",

    // --- Output ---
    "declaration":        true,
    "sourceMap":          true,
    "inlineSources":      true,
    "removeComments":     false,
    "preserveConstEnums": true,
    "importHelpers":      true,          // → tslib

    // --- Strictness ---
    "noImplicitAny":       true,
    "noImplicitOverride":  true,
    "noImplicitReturns":   true,
    "noImplicitThis":      true,
    "noUnusedLocals":      true,
    "strictNullChecks":    true,
    "strictFunctionTypes": true,
    "skipLibCheck":        true,

    // --- JSX (optional) ---
    "jsx": "react-jsx",
    "experimentalDecorators": true,

    // --- Libs ---
    "lib": [
      "es5", "dom",
      "es2015.promise", "es2015.collection",
      "es2015.iterable", "es2015.symbol.wellknown",
      "es2017", "es2020.bigint"
    ],

    // --- Path aliases (resolved against baseUrl: "packages") ---
    "paths": {
      "core/*": ["dev/core/dist/*"]
    }
  },
  "exclude": ["**/node_modules", "**/dist"]
}
```

**Conventions:**
- `target: "es2021"` avoids esnext class-field emit that breaks decorators.
- `module: "ES2020"` for tree-shaking by webpack.
- `baseUrl: "packages"` + `paths` let packages import each other's **compiled output**.
- Each package overrides `paths` during compilation to point at `src/*` instead.

### 3c. Per-package `tsconfig.build.json`

**Browser library package (typical):**

```jsonc
// packages/dev/<pkg>/tsconfig.build.json
{
  "extends": "../../../tsconfig.build.json",
  "compilerOptions": {
    "composite": true,          // required for project references
    "outDir": "./dist",
    "rootDir": "./src",
    "skipLibCheck": true
  },
  "include": ["./src/**/*.ts", "./src/**/*.tsx"],
  "references": [
    // List every internal package this one imports from:
    // { "path": "../core/tsconfig.build.json" },
    // { "path": "../geodesy/tsconfig.build.json" }
  ]
}
```

**Node.js server package (overrides module system):**

```jsonc
// packages/dev/tunnel/tsconfig.build.json
{
  "extends": "../../../tsconfig.build.json",
  "compilerOptions": {
    "composite": true,
    "outDir": "./dist",
    "rootDir": "./src",
    "skipLibCheck": true,
    "esModuleInterop": true,
    "lib": ["ES2020"],                    // no DOM
    "types": ["node"],                    // Node.js types
    "module": "NodeNext",                 // .js extensions required
    "moduleResolution": "NodeNext"
  },
  "include": ["./src/**/*.ts"]
}
```

---

## 4. Per-package `package.json` template

```jsonc
{
  "name": "@dev/<pkg>",
  "version": "0.1.0",
  "private": true,
  "main":    "dist/index",
  "module":  "dist/index",
  "esnext":  "dist/index",
  "types":   "dist/index",
  "files":   ["dist", "src"],
  "scripts": {
    "build":          "npm run clean && npm run compile",
    "clean":          "rimraf dist bundle && rimraf tsconfig.build.tsbuildinfo",
    "compile":        "npm run compile:source",
    "compile:source": "tsc -b tsconfig.build.json",
    "watch:source":   "tsc -b tsconfig.build.json -w",
    // Only for bundled packages:
    "bundle":         "webpack --mode production",
    "bundle:dev":     "webpack --mode development",
    "bundle:watch":   "webpack --mode development --watch"
  },
  "devDependencies": {
    // Only for bundled packages:
    "ts-loader":   "^9.5.0",
    "webpack":     "^5.98.0",
    "webpack-cli": "^5.1.0"
    // Engine SDKs as devDependencies (externalized at bundle time):
    // "@babylonjs/core": "^8.0.0",
    // "cesium": "^1.125.0"
  }
}
```

**Node.js server package** adds:
```jsonc
{
  "type": "module",
  "main": "dist/index.js",
  "types": "dist/index.d.ts",
  "scripts": {
    "start": "node dist/bin.js"
  },
  "dependencies": {
    "ws": "^8.18.0",
    "open": "^11.0.0"
  },
  "devDependencies": {
    "@types/node": "^20.0.0",
    "@types/ws": "^8.5.0"
  }
}
```

---

## 5. Webpack UMD bundles

### 5a. Which packages get bundled

| Package | Bundle? | Reason |
|---------|---------|--------|
| Core (interfaces) | Yes | Loaded by all adapters at runtime |
| Core (server) | Yes | Server runtime |
| Filters | Yes | Optional, loaded separately |
| Engine adapter | Yes | One per engine (Babylon, Cesium) |
| Geodesy / Behaviors | No | Compiled into adapter bundles |
| Tunnel (Node.js) | No | Server, not a browser bundle |

### 5b. `webpack.config.js` template

```js
const path = require("path");

module.exports = (env, argv) => {
    const isProd = argv.mode === "production";
    return {
        entry: "./src/index.ts",
        output: {
            filename:      "mcp-<pkg>.js",
            path:          path.resolve(__dirname, "bundle"),
            library:       "Mcp<Pkg>",           // UMD global name
            libraryTarget: "umd",
            globalObject:  "globalThis",          // browser + worker safe
        },
        target: "web",
        devtool: isProd ? "source-map" : "inline-source-map",
        resolve: {
            extensions: [".ts", ".tsx", ".js"],
        },
        module: {
            rules: [
                {
                    test: /\.tsx?$/,
                    loader: "ts-loader",
                    exclude: /node_modules/,
                    options: { transpileOnly: true },   // type-check via tsc -b
                },
            ],
        },
        externals: {
            // Map internal packages to their UMD global:
            // "@dev/core":    "McpServer",
            // "@dev/filters": "McpFilters",
            //
            // Map engine SDK to its global:
            // "@babylonjs/core": "BABYLON",
            // "cesium":          "Cesium",
        },
    };
};
```

### 5c. Externals strategy

| Import path | UMD global | Loaded from |
|-------------|-----------|-------------|
| `@dev/core` | `McpServer` | `mcp-server.js` (NOT mcp-core.js) |
| `@dev/filters` | `McpFilters` | `mcp-filters.js` |
| `@babylonjs/core` | `BABYLON` | Babylon.js engine script |
| `cesium` / `cesium/*` | `Cesium` | CesiumJS script |

**Rule:** Engine SDKs are always externalized. Internal packages that produce
their own UMD bundle are externalized. Packages without bundles (geodesy,
behaviors) are **compiled into** the adapter bundle.

### 5d. Multi-entry config (core package)

When a package needs two bundles (e.g. interfaces-only + full runtime):

```js
module.exports = (env, argv) => {
    const base = { /* shared config */ };
    return [
        { ...base, entry: "./src/interfaces/index.ts",
          output: { ...base.output, filename: "mcp-core.js",   library: "McpCore" }},
        { ...base, entry: "./src/index.ts",
          output: { ...base.output, filename: "mcp-server.js", library: "McpServer" }},
    ];
};
```

---

## 6. Bundle deployment

`scripts/deploy-bundles.mjs` copies all `*.js` and `*.js.map` files from
each package's `bundle/` directory into `packages/host/www/bundle/`.

```js
// Pseudocode
const sources = [
    "packages/dev/core/bundle",
    "packages/dev/filters/bundle",
    "packages/dev/babylon/bundle",
    "packages/dev/cesium/bundle",
];
const dest = "packages/host/www/bundle";

for (const src of sources) {
    if (!exists(src)) continue;
    for (const file of glob(src, "*.js", "*.js.map")) {
        copy(file, dest);
    }
}
```

---

## 7. ESLint

```jsonc
// .eslintrc.json
{
  "root": true,
  "parser": "@typescript-eslint/parser",
  "parserOptions": {
    "ecmaVersion": 2020,
    "sourceType": "module",
    "project": [
      "./packages/dev/core/tsconfig.build.json",
      "./packages/dev/filters/tsconfig.build.json",
      "./packages/dev/geodesy/tsconfig.build.json",
      "./packages/dev/behaviors/tsconfig.build.json",
      "./packages/dev/babylon/tsconfig.build.json",
      "./packages/dev/cesium/tsconfig.build.json",
      "./packages/dev/tunnel/tsconfig.build.json"
    ]
  },
  "plugins": ["@typescript-eslint", "prettier"],
  "extends": [
    "eslint:recommended",
    "plugin:@typescript-eslint/recommended",
    "prettier"                                   // must be last
  ],
  "rules": {
    "prettier/prettier":                          "error",
    "@typescript-eslint/no-explicit-any":          "warn",
    "@typescript-eslint/explicit-function-return-type": "off",
    "@typescript-eslint/explicit-module-boundary-types": "off",
    "@typescript-eslint/no-unused-vars":           ["error", { "argsIgnorePattern": "^_" }],
    "no-console":  "warn",
    "eqeqeq":     ["error", "always"],
    "no-var":      "error",
    "prefer-const": "error"
  },
  "ignorePatterns": ["dist/", "build/", "node_modules/", "*.js"]
}
```

---

## 8. Prettier

```json
{
  "printWidth": 180,
  "tabWidth": 4,
  "useTabs": false,
  "semi": true,
  "singleQuote": false,
  "jsxSingleQuote": false,
  "trailingComma": "es5",
  "bracketSpacing": true,
  "arrowParens": "always",
  "endOfLine": "auto"
}
```

---

## 9. Dependency graph & project references

```
                ┌─────────┐
                │  core   │  (no deps)
                └────┬────┘
                     │
        ┌────────────┼────────────┐
        │            │            │
   ┌────┴────┐  ┌────┴─────┐  ┌──┴──────┐
   │ geodesy │  │ filters  │  │  ...    │  (all leaf packages)
   │ (no dep)│  │ (no dep) │  └─────────┘
   └────┬────┘  └────┬─────┘
        │            │
   ┌────┴────────────┴────┐
   │      behaviors       │  refs: core, geodesy, filters
   └──────────┬───────────┘
              │
     ┌────────┴────────┐
     │                 │
┌────┴─────┐    ┌──────┴────┐
│ babylon  │    │  cesium   │  refs: core, filters, geodesy, behaviors
│ adapter  │    │  adapter  │
└──────────┘    └───────────┘
```

**Rules for adding a new package:**
1. Create `packages/dev/<name>/` with `package.json` + `tsconfig.build.json`.
2. Add its tsconfig to the root `tsconfig.json` references array.
3. Add its tsconfig to `.eslintrc.json` `parserOptions.project`.
4. If it needs a UMD bundle: add webpack config + add `--workspace` to root bundle scripts.
5. If it has a bundle: add its `bundle/` dir to `deploy-bundles.mjs` sources.
6. If another package depends on it: add a `references` entry in that package's tsconfig.

---

## 10. Build pipeline summary

```
npm run build:all:dev
  │
  ├─ 1. tsc -b                         # compile all packages via project refs
  │     outputs → packages/dev/*/dist/
  │
  ├─ 2. webpack (per bundled package)   # UMD bundles
  │     outputs → packages/dev/*/bundle/
  │
  └─ 3. deploy-bundles.mjs             # copy bundles to serving dir
        outputs → packages/host/www/bundle/
```

---

## 11. Checklist for scaffolding a new repo

- [ ] Create root `package.json` with workspaces, engines, and scripts
- [ ] Create root `tsconfig.build.json` with shared compiler options
- [ ] Create root `tsconfig.json` as solution file (empty `files`, only `references`)
- [ ] Create `.eslintrc.json` referencing all package tsconfigs
- [ ] Create `.prettierrc`
- [ ] Create `packages/dev/` directory structure
- [ ] For each package:
  - [ ] `package.json` (name, main, module, types, scripts)
  - [ ] `tsconfig.build.json` (extends root, composite, outDir, rootDir, references)
  - [ ] `src/index.ts` entry point
  - [ ] `webpack.config.js` if UMD bundle needed
- [ ] Create `scripts/deploy-bundles.mjs`
- [ ] Create `packages/host/www/` for dev harness
- [ ] Run `npm install` from root
- [ ] Verify `npm run build:all:dev` succeeds end-to-end
