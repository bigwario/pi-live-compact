# Live Compact for Pi（边做边压 · Pi 版）

[中文](./README.md) | [English](./README.en.md)

Live Compact 就是边做边压。活着的时候就压，不等窗口堆满。

这是 [dsh-live-compact](https://github.com/MerkyorLynn/dsh-live-compact)（MerkyorLynn，MIT）
到 Pi coding agent 的忠实移植：原理、阈值与卡片算法与原版 1.0.8 一致，
宿主机制差异逐项记在 [PORTING.md](./PORTING.md)。

Pi 自带 compaction 和 DSH 原版一样是「堆到阈值才调模型大压一次」。
这个扩展不等：上下文超过 **2 万 token**，就在每个 turn 结束时把**最新结束的一段**
在本地切掉——不调用模型、不新增工具、毫秒级。切点前面的原文不动，前缀缓存照旧命中；
被切段替换成一张抽取式卡片，且只有当卡片能证明「硬行一条没丢」时才下刀；
散文占比太高的段不切，留给 Pi 自带 compaction，原理同原版的 wait-80 路由。

1.0.8 的语义（与上游同步）：

- **双模式**：端点按地址判定——`strata` 服务商、loopback、局域网与 Tailscale
  段地址算**本地模式**（照旧积极切，切点只落在最后一条用户消息之后）；
  其余算**云端模式**：总量在保留预算（32K）以下时普通段不切，只把超大工具结果
  指针化；总量加上预测的下一轮增量越过预算后进入 drain，逐个 turn 段往回切，
  把总量拉回预算以内。`SPINE_ENGINE=local|cloud` 可强制指定。
- **最近 3 个已结束的工具轮原样保留**（合计 32K token 预算内），非 drain 的
  切点必须在它们之前；
- 硬行只从非助手消息里认，保留行逐行标原角色；助手说过的完成声明不算硬行，
  工具证据只写「第几轮、哪条命令、退出状态、调用编号」；
- 短工具结果（≤12 行且 ≤512 字）整段留在卡上；失败的工具结果优先摘录，
  且只认结构信号（非 0 退出码、`isError`、`[stderr]` 等），不靠关键词猜；
- **超大工具结果**（单条超过 32K token，可调）不摘录原文，整轮换成一张
  指针卡：只留「第几个序号的调用 → 第几个序号的结果」；
- 每条被切的工具结果在卡上留**序号指针**（会话日志里的事件号，卡上明示
  「不是备份文件路径」）；被切段里较早的用户消息以 JSON 行原样留在卡上，
  要求和约束继续有效。

与原版的一处天然改进：Pi 会话文件是 append-only，被切的原文条目仍在档里，
所以不需要原版那个只增不删的明文 shadow 目录——序号指针直接指向会话条目。

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
| `SPINE_KEEP_ROUND_TOKENS` | `32000` | 保留轮合计 token 预算（也是云端模式的 drain 目标线） |
| `SPINE_ENGINE` | 按端点判定 | 强制模式：`local` 或 `cloud` |
| `SPINE_POINTER_TOKENS` | `32000` | 单条工具结果超过此值只留指针、不摘原文 |
| `SPINE_CHUNK_MIN` | `1000` | 一刀的最少收益（非用户 token） |
| `SPINE_CHUNK_MAX` | `32000` | 一刀最多切的 token 数 |

`SPINE_CHUNK_MIN` / `SPINE_CHUNK_MAX` 在原版里是写死常量；上游 issue #15
建议把它们做成环境变量（默认值不变），Pi 版提前采纳了这条建议
（见 PORTING.md #18）。

其余常量与原版写死一致：保留预算 8000 字符、尾巴保护 2200 token、
48K 以下不急切、650K 以上不归小切管（见 PORTING.md #7）。

## 测试

```sh
npm test   # node --test，卡片构建器、模式判定与选段逻辑共 33 个用例
```

## 许可与来源

MIT，见 [LICENSE](./LICENSE)。原作 © Merkyor，Pi 移植 © carrotciallo。
原理与测评背景见原版仓库与说明页：
https://github.com/MerkyorLynn/dsh-live-compact
