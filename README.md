# Live Compact for Pi（边做边压 · Pi 版）

[中文](./README.md) | [English](./README.en.md)

Live Compact 就是边做边压。活着的时候就压，不等窗口堆满。

这是 [dsh-live-compact](https://github.com/MerkyorLynn/dsh-live-compact)（MerkyorLynn，MIT）
到 Pi coding agent 的忠实移植：原理、阈值与卡片算法与原版 1.0.6 一致，
宿主机制差异逐项记在 [PORTING.md](./PORTING.md)。

Pi 自带 compaction 和 DSH 原版一样是「堆到阈值才调模型大压一次」。
这个扩展不等：上下文超过 **2 万 token**，就在每个 turn 结束时把**最新结束的一段**
在本地切掉——不调用模型、不新增工具、毫秒级。切点前面的原文不动，前缀缓存照旧命中；
被切段替换成一张抽取式卡片，且只有当卡片能证明「硬行一条没丢」时才下刀；
散文占比太高的段不切，留给 Pi 自带 compaction，原理同原版的 wait-80 路由。

1.0.6 的卡片语义（与上游同步）：

- **最近 3 个已结束的工具轮原样保留**（合计 32K token 预算内），切点必须在它们之前；
- 硬行只从非助手消息里认，保留行逐行标原角色；助手说过的完成声明不算硬行，
  工具证据只写「第几轮、哪条命令、退出状态、调用编号」；
- 短工具结果（≤12 行且 ≤512 字）整段留在卡上；失败的工具结果优先摘录，
  且只认结构信号（非 0 退出码、`isError`、`[stderr]` 等），不靠关键词猜；
- 每条被切的工具结果在卡上留指针：会话条目 id＋sha256＋字节数，需要原文再读。

与原版的一处天然改进：Pi 会话文件是 append-only，被切的原文条目仍在档里，
所以不需要原版那个只增不删的明文 shadow 目录——指针直接指向会话条目。

## 安装

需要 Pi `1.2.0`（扩展边界 API：`turn_end` 提议 `context_edit`）。

```sh
# 作为本地包目录启用（示例）
pi install /path/to/pi-live-compact
# 或单次试用
pi -e /path/to/pi-live-compact/extensions/live-compact.ts
```

装好后跑长任务，会话文件里出现 `context_edit` 条目、且条目内容以
`Spine extract.` 开头，就是切刀生效了。

## 参数

与原版同名同义：

| 环境变量 | 默认 | 作用 |
|---|---|---|
| `SPINE_MIN_TOKENS` | `20000` | 触发小切的上下文总量门槛 |
| `SPINE_KEEP_ROUNDS` | `3` | 切点之前原样保留的最近工具轮数 |
| `SPINE_KEEP_ROUND_TOKENS` | `32000` | 保留轮合计 token 预算 |

其余常量与原版写死一致：单刀 1K–32K token、保留预算 8000 字符、
尾巴保护 2200 token、48K 以下不急切、650K 以上不归小切管（见 PORTING.md #7）。

## 测试

```sh
npm test   # node --test，卡片构建器与选段逻辑共 17 个用例
```

## 许可与来源

MIT，见 [LICENSE](./LICENSE)。原作 © Merkyor，Pi 移植 © carrotciallo。
原理与测评背景见原版仓库与说明页：
https://github.com/MerkyorLynn/dsh-live-compact
