# Vite 源码实现

## 架构原理

Vite 底层使用两个构建引擎，Esbuild 和 Rollup。

<img src="../images/design.png" style="zoom: 80%" />

### EsBuild

* 依赖预构建阶段，作为 bundler（打包工具） 使用

* 语法转译，将 Esbuild 作为 transformer 使用
  * TS 或者 JSX 文件转译，生产环境和开发环境都会执行
  * 替换原来的 Babel 和 TSC 功能
* 代码压缩，作为压缩工具使用
  * 在生产环境通过插件的形式融入到 Rollup 的打包流程
  * JS 和 CSS 代码压缩

Vite 利用 EsBuild 各个垂直方向的能力（Bundler、Transformer、Minifier），给 Vite 的高性能提供了有利的保证。

Vite 3.0 支持通过配置将 EsBuild 预构建同时用于开发环境和生产环境，默认不会开启，属于实验性质的特性。

### Rollup

* 生产环境下，Vite 利用 Rollup 打包，并基于 Rollup 本身的打包能力进行扩展和优化。
  * CSS 代码分割
    * 将异步模块 CSS 代码抽离成单独文件，提高线上产物的缓存复用率
  * 自动预加载
    * 为 入口 chunk 的依赖自动生成 `<link rel="modulepreload" >`，提前下载资源，优化页面性能
    * 关于 [modulepreload](https://developer.mozilla.org/en-US/docs/Web/HTML/Link_types/modulepreload)
  * 异步 chunk 加载优化
    * 自动预加载公共依赖，优化 Rollup 产物依赖加载方式
* 兼容插件机制
  * 无论是开发阶段还是生产环境，Vite 都根植于 Rollup 的插件机制和生态

在 Vite 中，无论是插件机制还是打包手段，都基于 Rollup 来实现，可以说 Vite 是对于 Rollup 的一种场景化的深度拓展。

## 插件流水线

在开发阶段 Vite 实现了一个按需加载的服务器，每一个文件都会经历一系列的编译流程，然后再将编译结果响应给浏览器。
在生产环境中，Vite 同样会执行一系列编译过程，将编译结果交给 Rollup 进行模块打包。

这一系列的编译过程指的就是 Vite 的插件工作流水线（Pipeline），插件功能是 Vite 构建的核心。

在生产环境中 Vite 直接调用 Rollup 进行打包，由 Rollup 调度各种插件。
在开发环境中，Vite 模拟了 Rollup 的插件机制，设计了一个 `PluginContainer` 对象来调度各个插件。

PluginContainer 的实现主要分为两部分：

* 实现 Rollup 插件钩子的调度
* 实现插件钩子内部的 Context 上下文对象

Vite 插件的具体执行顺序如下：

* 别名插件：`vite:pre-alias` 和 `@rollup/plugin-alias` ，用于路径别名替换。
* 用户自定义 pre 插件，即带有 `enforce: "pre"` 属性的自定义插件。
* vite 核心构建插件。
* 用户自定义普通插件，即不带有 `enforce` 属性的自定义插件。
* vite 生产环境插件和用户插件中带有 `enforce: "post"` 属性的插件。
* 开发阶段特有的插件，包括环境变量注入插件 `clientInjectionsPlugin` 和 import 语句分析及重写插件 `importAnalysisPlugin`。

Vite 内置的插件包括四大类：

* 别名插件
* 核心构建插件
* 生产环境特有插件
* 开发环境特有插件

关于更多插件流水线内容，可以查看 [这篇文章](https://www.yueluo.club/detail?articleId=62f370d9b6da2b3d4dc99b0a)。

## 源码实现

<img src="./images/vite_source.jpg" />

### 开发环境搭建

安装依赖

```bash
pnpm init -y
```

```bash
pnpm i cac chokidar connect debug es-module-lexer esbuild fs-extra magic-string picocolors resolve rollup sirv ws --save
```

```bash
pnpm i @types/connect @types/debug @types/fs-extra @types/resolve @types/ws tsup --save-dev
```

这里我们使用 [tsup](https://github.com/egoist/tsup) 进行项目的构建（Vite 本身使用 Rollup 进行打包）， tsup 能够实现库打包的功能，并且内置 esbuild 进行提速，性能上更加强悍。

配置 scripts 脚本

```json
// package.json

"scripts": {
  "start": "tsup --watch",
  "build": "tsup --minify"
}
```

新建 `tsconfig.json` 和 `tsup.config.ts` 配置文件

```json
// tsconfig.json

{
  "compilerOptions": {
    // 支持 commonjs 模块的 default import，如 import path from 'path'
    // 否则只能通过 import * as path from 'path' 进行导入
    "esModuleInterop": true,
    "target": "ES2020",
    "moduleResolution": "node",
    "module": "ES2020",
    "strict": true
  }
}
```

```json
// tsup.config.ts

import { defineConfig } from "tsup";

export default defineConfig({
  // 后续会增加 entry
  entry: {
    index: "src/node/cli.ts",
  },
  // 产物格式，包含 esm 和 cjs 格式
  format: ["esm", "cjs"],
  // 目标语法
  target: "es2020",
  // 生成 sourcemap
  sourcemap: true,
  // 没有拆包的需求，关闭拆包能力
  splitting: false,
})
```

新建 `src/node/cli.ts`文件，进行 cli 的初始化：

```typescript
// src/node/cli.ts

import cac from "cac"

const cli = cac()

// [] 中的内容为可选参数，也就是说仅输入 `vite` 命令下会执行下面的逻辑
cli
  .command("[root]", "Run the development server")
  .alias("serve")
  .alias("dev")
  .action(async () => {
    console.log('测试 cli~')
  })

cli.help()

cli.parse()
```

现在你可以执行  `pnpm start` 来编译这个 `custom-vite` 项目，tsup 会生成产物目录 `dist`，然后你可以新建 `bin/vite` 文件来引用产物:

```
#!/usr/bin/env node

require("../dist/index.js")
```

同时，你需要在 package.json 中注册 `vite`命令，配置如下:

```json
"bin": {
  "vite": "bin/vite"
}
```

现在，我们就可以在业务项目中使用 `vite` 这个命令了。这里有一个示例的 `playground` 项目，你可以拿来进行测试，[点击查看项目](https://github.com/yw0525/notes/tree/master/vite/vite_source/playground)。

playground 项目 package.json 如下：

```json
{
  "name": "playground",
  "private": true,
  "version": "0.0.0",
  "scripts": {
    "dev": "vite"
  },
  "dependencies": {
    "react": "17",
    "react-dom": "17"
  },
  "devDependencies": {
    "@types/react": "17",
    "@types/react-dom": "17",
    "@vitejs/plugin-react": "^1.3.0",
    "vite": "../custom-vite",
    "typescript": "^4.6.3"
  }
}
```

将 `playground` 项目放在 `vite` 同级目录中，然后执行 `pnpm i`，`vite ` 命令会自动安装到测试项目的 `node_modules/.bin`目录中。

<div><img src="./images/command.png" /></div>

接着我们在 `playground` 项目中执行 `pnpm dev` 命令(内部执行 `vite`)，可以看到如下的 log 信息:

```
测试 cli~
```

接着，我们把 `console.log` 语句换成服务启动的逻辑:

```diff
import cac from "cac"
+ import { startDevServer } from "./server"

const cli = cac()

cli
  .command("[root]", "Run the development server")
  .alias("serve")
  .alias("dev")
  .action(async () => {
-    console.log('测试 cli~')
+   await startDevServer()
  })

cli.help()

cli.parse()
```

接着新建 `src/node/server/index.ts`，内容如下:

```typescript
// connect 是一个具有中间件机制的轻量级 Node.js 框架。
// 既可以单独作为服务器，也可以接入到任何具有中间件机制的框架中，如 Koa、Express
import connect from "connect"
// picocolors 是一个用来在命令行显示不同颜色文本的工具
import { blue, green } from "picocolors"

export async function startDevServer() {
  const app = connect()
  const root = process.cwd()
  const startTime = Date.now()
  
  app.listen(3000, async () => {
    console.log(
      green("🚀 No-Bundle 服务已经成功启动!"),
      `耗时: ${Date.now() - startTime}ms`
    )
    console.log(`> 本地访问路径: ${blue("http://localhost:3000")}`)
  })
}
```

再次执行 `pnpm dev`，你可以发现终端出现如下的启动日志:

<div><img src="./images/server.png" /></div>

### 依赖预构建

现在我们来进入依赖预构建阶段的开发。

首先我们新建 `src/node/optimizer/index.ts` 来存放依赖预构建的逻辑:

```typescript
export async function optimize(root: string) {
  // 1. 确认入口
  // 2. 从入口处扫描依赖
  // 3. 预构建依赖  
}
```

然后在服务入口中引入预构建的逻辑:

```diff
import connect from "connect"
import { blue, green } from "picocolors"

+import { optimize } from '../optimizer'

export async function startDevServer() {
  const app = connect()
  const root = process.cwd()
  const startTime = Date.now()

  app.listen(3000, async () => {
+    await optimize(root)

    console.log(
      green("🚀 No-Bundle 服务已经成功启动!"),
      `耗时: ${Date.now() - startTime}ms`
    )
    console.log(`> 本地访问路径: ${blue("http://localhost:3000")}`)
  })
}
```

接着我们来开发依赖预构建的功能，从上面的代码注释你也可以看出，我们需要完成三部分的逻辑:

- 确定预构建入口
- 从入口开始扫描出用到的依赖
- 对依赖进行预构建

首先是确定入口，为了方便理解，我们直接约定入口为 src 目录下的 `main.tsx` 文件:

```typescript
import path from 'path'

export async function optimize(root: string) {
  // 1. 确认入口
  const entry = path.resolve(root, 'src/main.tsx')

  // 2. 从入口处扫描依赖
  // 3. 预构建依赖  
}
```

第二步是扫描依赖：

```typescript
import path from 'path'
import { build } from "esbuild";
import { green } from 'picocolors'
import { scanPlugin } from './scanPlugin'

export async function optimize(root: string) {
  // 1. 确认入口
  const entry = path.resolve(root, 'src/main.tsx')

  // 2. 从入口处扫描依赖
  const deps = new Set<string>()

  await build({
    entryPoints: [entry],
    bundle: true,
    write: false,
    plugins: [ scanPlugin(deps) ]
  })

  console.log(
    `${green("需要预构建的依赖")}:\n${[...deps]
    .map(green)
    .map((item) => `  ${item}`)
    .join("\n")}`
  )

  // 3. 预构建依赖  
}
```

依赖扫描需要我们借助 Esbuild 插件来完成，最后会记录到 deps 这个集合中。

接下来我们开发基于 Esbuild 的依赖扫描插件，你需要在 `optimzier` 目录中新建 `scanPlguin.ts` 文件，内容如下:

```typescript
import { Plugin } from "esbuild"
import { BARE_IMPORT_RE, EXTERNAL_TYPES } from "../constants"

export function scanPlugin(deps: Set<string>): Plugin {
  return {
    name: "esbuild:scan-deps",
    setup(build) {
      // 忽略的文件类型
      build.onResolve(
        { filter: new RegExp(`\\.(${EXTERNAL_TYPES.join("|")})$`) },
        (resolveInfo) => {
          return {
            path: resolveInfo.path,
            // 打上 external 标记
            external: true,
          }
        }
      )
      // 记录依赖
      build.onResolve(
        {
          filter: BARE_IMPORT_RE,
        },
        (resolveInfo) => {
          const { path: id } = resolveInfo
          // 推入 deps 集合中
          deps.add(id)
          return {
            path: id,
            external: true,
          }
        }
      )
    }
  }
}
```

文件中用到了一些常量，在 `src/node/constants.ts` 中定义，内容如下：

```typescript
export const EXTERNAL_TYPES = [
  "css",
  "less",
  "sass",
  "scss",
  "styl",
  "stylus",
  "pcss",
  "postcss",
  "vue",
  "svelte",
  "marko",
  "astro",
  "png",
  "jpe?g",
  "gif",
  "svg",
  "ico",
  "webp",
  "avif",
]

export const BARE_IMPORT_RE = /^[\w@][^:]/
```

插件的逻辑非常简单，即把一些无关的资源进行 external，不让 esbuild 处理，防止 Esbuild 报错，同时将 `bare import` 的路径视作第三方包，推入 deps 集合中。

现在，我们在 `playground` 项目根路径中执行 `pnpm dev`，可以发现依赖扫描已经成功执行:

当我们收集到所有的依赖信息之后，就可以对每个依赖进行打包，完成依赖预构建了：

<div><img src="./images/pre-bundle.png" /></div>

当我们收集到所有的依赖信息之后，就可以对每个依赖进行打包，完成依赖预构建了：

```typescript
// ...
import { preBundlePlugin } from "./preBundlePlugin";
import { PRE_BUNDLE_DIR } from "../constants";

export async function optimize(root: string) {
  // 1. 确认入口
  const entry = path.resolve(root, 'src/main.tsx')

  // 2. 从入口处扫描依赖
	// ...
  
  // 3. 预构建依赖
  await build({
    entryPoints: [...deps],
    write: true,
    bundle: true,
    format: 'esm',
    splitting: true,
   outdir: path.resolve(root, PRE_BUNDLE_DIR),
    plugins: [preBundlePlugin(deps)]
  })
}
```

在此，我们引入了一个新的常量 `PRE_BUNDLE_DIR`，定义如下:

```typescript
const path = require('path')

// ...

export const BARE_IMPORT_RE = /^[\w@][^:]/

// 预构建产物默认存放在 node_modules 中的 .vite 目录中
export const PRE_BUNDLE_DIR = path.join("node_modules", ".vite")
```

接着，我们继续开发预构建的 Esbuild 插件：

```typescript
// src/node/utils.ts

const path = require('path')
const os = require('os')

export function slash(p: string): string {
  return p.replace(/\\/g, '/')
}
export const isWindows = os.platform() === 'win32'

export function normalizePath(id: string): string {
  return path.posix.normalize(isWindows ? slash(id) : id)
}
```

```typescript
// src/node/optimizer/preBundlePlugin.ts

import { Loader, Plugin } from "esbuild"
import { BARE_IMPORT_RE } from "../constants"

// 用来分析 es 模块 import/export 语句的库
import { init, parse } from "es-module-lexer"
import path from "path"
// 一个实现了 node 路径解析算法的库
import resolve from "resolve"
// 一个更加好用的文件操作库
import fs from "fs-extra"
// 用来开发打印 debug 日志的库
import createDebug from "debug"

import{ normalizePath } from '../utils'

const debug = createDebug("dev")

export function preBundlePlugin(deps: Set<string>): Plugin {
  return {
    name: "esbuild:pre-bundle",
    setup(build) {
      build.onResolve(
        {
          filter: BARE_IMPORT_RE,
        },
        (resolveInfo) => {
          const { path: id, importer } = resolveInfo
          const isEntry = !importer

          // 命中需要预编译的依赖
          if (deps.has(id)) {
            // 若为入口，则标记 dep 的 
            
            return isEntry
              ? {
                  path: id,
                  namespace: "dep",
                }
              : {
                  // 因为走到 onResolve 了，所以这里的 path 就是绝对路径了
                  path: resolve.sync(id, { basedir: process.cwd() }),
                }
          }
        }
      )

      // 拿到标记后的依赖，构造代理模块，交给 esbuild 打包
      build.onLoad(
        {
          filter: /.*/,
          namespace: "dep",
        },
        async (loadInfo) => {
          await init
          
          const id = loadInfo.path
          const root = process.cwd()

          const entryPath = resolve.sync(id, { basedir: root })

          const code = await fs.readFile(entryPath, "utf-8")
          const [imports, exports] = await parse(code)

          let relativePath = normalizePath(path.relative(root, entryPath))
          if (
            !relativePath.startsWith('./') &&
            !relativePath.startsWith('../') &&
            relativePath !== '.'
          ) {
            relativePath = `./${relativePath}`
          }

          let proxyModule = []

          // cjs
          if (!imports.length && !exports.length) {
            // 构造代理模块
            const res = require(entryPath)
            const specifiers = Object.keys(res)
            proxyModule.push(
              `export { ${specifiers.join(",")} } from "${relativePath}"`,
              `export default require("${relativePath}")`
            )
          } else {
            // esm 格式比较好处理，export * 或者 export default 即可
            if (exports.includes("default")) {
              proxyModule.push(`import d from "${relativePath}"export default d`)
            }
            proxyModule.push(`export * from "${relativePath}"`)
          }
          debug("代理模块内容: %o", proxyModule.join("\n"))
          const loader = path.extname(entryPath).slice(1)

          return {
            loader: loader as Loader,
            contents: proxyModule.join("\n"),
            resolveDir: root,
          }
        }
      )
    }
  }
}
```

对于 CommonJS 格式的依赖，单纯用 `export default require('入口路径')` 是有局限性的，比如对于 React 而言，用这样的方式生成的产物最后只有 default 导出:

```typescript
// esbuild 的打包产物
// ...
export default react_default
```

那么用户在使用这个依赖的时候，必须这么使用：

```typescript
// ✅ 正确
import React from 'react'

const { useState } = React

// ❌ 报错
import { useState } from 'react'
```

那为什么上述会报错的语法在 Vite 是可以正常使用的呢？原因是 Vite 在做 import 语句分析的时候，自动将你的代码进行改写了：

```typescript
// 原来的写法
import { useState } from 'react'

// Vite 的 importAnalysis 插件转换后的写法类似下面这样
import react_default from '/node_modules/.vite/react.js'

const { useState } = react_default
```

那么，还有没有别的方案来解决这个问题？其实，上述的插件代码中已经用另一个方案解决了这个问题，我们不妨把目光集中在下面这段代码中：

```typescript
if (!imports.length && !exports.length) {
  // 构造代理模块
  // 通过 require 拿到模块的导出对象
  const res = require(entryPath)
  // 用 Object.keys 拿到所有的具名导出
  const specifiers = Object.keys(res)
  // 构造 export 语句交给 Esbuild 打包
  proxyModule.push(
    `export { ${specifiers.join(",")} } from "${entryPath}"`,
    `export default require("${entryPath}")`
  )
}
```

如此一来，Esbuild 预构建的产物中便会包含 CommonJS 模块中所有的导出信息：

```typescript
// 预构建产物导出代码
export {
  react_default as default,
  useState,
  useEffect,
  // 省略其它导出
}
```

接下来让我们来测试一下预构建整体的功能。在 `playground` 项目中执行 `pnpm dev`，接着去项目的 `node_modules` 目录中，可以发现`.vite` 目录下新增的`react`、`react-dom`的预构建产物:

<div><img src="./images/bundle01.png" /></div>

### 插件机制开发

