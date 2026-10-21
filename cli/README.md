# mcsrc CLI

纯 Node.js 命令行入口，不启动浏览器。直接导入上游 `src/logic/` 和 worker，原有 `src/`、`java/` 不作修改。

## 环境与安装

- Node.js 22.12 或更高版本。
- 导出源码需要 JDK 25，与项目现有 Java 构建要求一致。`--list` 不需要 Java。
- 首次安装、查询版本和下载未缓存的文件需要联网。

在仓库根目录执行：

```sh
npm ci
npm ci --prefix cli
```

## 命令

联网列出全部版本 ID，每行一个，包含项目已有的实验版本：

```sh
node cli/mcsrc.mjs --list
```

指定客户端版本和输出目录：

```sh
node cli/mcsrc.mjs --client 1.14.4 --output ./minecraft-source
```

参数顺序不限；带空格的版本 ID 或路径需要加引号。`--list` 不能与 `--client`、`--output` 混用。查看帮助：

```sh
node cli/mcsrc.mjs --help
```

`--list` 沿用 launcher 的完整版本列表；导出沿用 mcsrc 原有的版本支持范围。列表中存在、但原有反编译流程不支持的版本会明确报错，不会自动改用另一套算法。

## 输出与缓存

```text
minecraft-source/
├── client.jar          原始客户端 JAR
├── .mcsrc-cache/       原流程使用的映射、重映射 JAR 等磁盘缓存
└── sources/
    ├── .mcsrc          此目录由 CLI 管理的标记
    └── com/…/*.java    按原 Java 包路径保存，也可能包含 net/ 等目录
```

客户端缓存按版本清单中的 SHA-1 校验。不匹配时重新下载，下载完成并通过校验后才替换 `client.jar`。没有 SHA-1 的客户端不跨进程复用原始 JAR 缓存。版本元数据仍然联网查询，缓存不等于离线模式。

导出全部顶层类，内部类由原反编译器合并到对应的 Java 源文件。Node 中每批处理 100 个顶层类，写盘后清空该批的内存结果；映射阶段使用一个 Node worker。不会同时保留全部源码和 token 结果，但单批内存开销仍取决于原反编译器及类的大小。

成功后，stdout 输出 `sources` 的绝对路径；进度和原模块日志写入 stderr。失败退出码为 1，下载缓存保留。再次运行会替换带 `.mcsrc` 标记的 `sources/`；不会覆盖已有的、非空且没有标记的同名目录。导出失败时保留上一次成功的源码。

## 与上游同步

| 功能 | 直接复用的实现 |
| --- | --- |
| 版本列表、版本清单 | `src/logic/MinecraftApi.ts` 的 `fetchLauncherVersions`、`fetchLauncherVersionManifest` |
| 下载、缓存调用、映射调度 | 同文件的 `minecraftJarPipeline` |
| 反编译选项 | `src/logic/Decompiler.ts` 的 `getDecompilerOptions` |
| 批量反编译、token、结果格式 | `src/workers/decompile/worker.ts` 的 `DecompileWorker` |
| 引擎及回退机制 | `src/logic/vineflower/` 的原始 WASM/JavaScript 实现 |
| 映射 | 原 `src/workers/remap/` worker 和 `java/` 源码 |

`cli/runtime.ts` 只适配原模块所需的平台 API：Node worker_threads、Comlink 官方 Node endpoint、内存 IndexedDB 和磁盘 CacheStorage。`cli/export.ts` 只调度原 worker、写出结果和发布源码目录，不重写反编译算法。

入口会重新打包 TypeScript，导出前通过项目现有 Gradle wrapper 更新 Java 产物。CLI 自己的产物均在 `cli/dist/`、`cli/java-build/`、`cli/.gradle/`；Gradle 的用户级依赖缓存使用其默认位置。无需复制或修改上游源码。

## 检查

在仓库根目录执行：

```sh
npm run --prefix cli check
npm test -- cli/cache.test.ts
```

使用下载的 Minecraft 文件及映射前，请确认遵守 Minecraft EULA 和文件附带的许可。
