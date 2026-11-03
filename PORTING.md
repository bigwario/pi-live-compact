# PORTING.md — 与 DSH 原版的逐项差异

原版：dsh-live-compact 1.0.1（MerkyorLynn，MIT）。本表只记「被迫不同」处；
没列的即与原版一致（阈值、卡片算法、安全门、文案结构）。

| # | 方面 | DSH 原版 | Pi 版 | 为什么 |
|---|---|---|---|---|
| 1 | 挂载点 | 继承宿主 `BasicCompactionEngine`，`agent/status idle` 后跑维护流程 | Pi 扩展 `turn_end` 边界，返回 `context_edit` 草案 | Pi 没有可替换的 compaction engine 类；turn_end 是官方可提议条目的边界（Phase 0 已实测形态成立） |
| 2 | 切的落地 | `session.append` compaction 三件套＋surface replace | span 首条 `context_edit` 替换为卡片、其余条目省略 | Pi 的投影机制原生支持按条目替换/省略，效果等价 |
| 3 | 原文保存 | 明文写 `~/.dsh/compaction-spine/shadow`，只增不删 | 不写 shadow；原文条目本就留在 Pi 会话文件里，卡片尾行改为引用条目 id 区间 | Pi 会话是 append-only，原文天然在档；再抄一份纯属重复（原版卡片里也声明路径不等于保全） |
| 4 | token 计量 | 宿主 tokenMeter 逐节点计量 | 总量用 `ctx.getContextUsage()`；逐条目用原版 thunder.js 的 estimateTokens 估算 | Pi 不给逐条目计量 API。估算误差只影响选段边界，不影响安全门（安全门按原文行判定） |
| 5 | 工具配对检查 | 宿主 `toolPairingBalancedBefore/After` | 按 toolCall id 自行判定（切后不得有调用的结果落在 span 外；span 首条不得是孤儿 toolResult） | Pi 无此宿主函数；判定语义按 Pi compaction 文档的切点规则重述 |
| 6 | 「已切」识别 | 事件文本含 MARK 或 source.kind 为 compact-checkpoint | 投影文本含 MARK（`Spine extract.`） | Pi 的 context_edit 替换内容就是卡片文本，标记天然可见；不依赖进程内状态（探针实测内存标记跨进程会失效） |
| 7 | 大压缩（雷霆） | 仍走原版引擎模型摘要，本包的 thunder 优化默认关 | 不接管；Pi 自带 compaction 原样工作 | 等价对应原版「默认仍走原版」；SPINE_THUNDER 的 send-less 优化未移植，属原版默认关闭的实验路径 |
| 8 | planMessages | 摘要路径用（短用户消息收集等） | 未移植 | 本地切路径原版只用 buildCard；planMessages 只服务于模型摘要路径，Pi 侧该路径归 Pi 自带 compaction |
| 9 | 日志 | 宿主 logger 打 `spine cut …ms` | `ctx.ui.notify` 同义文案 | Pi 扩展的可见输出通道不同；验收以会话内 context_edit 条目为准，不以日志为准 |
| 10 | 触发时机 | 一轮完整结束后（agent idle） | 每个 turn_end（一个 agent 回合可多轮） | Pi 无「idle 后维护」钩子；turn_end 更贴「边做边压」，且短尾规则保证刚说完的话留在尾巴里 |

已知未覆盖：DSH 原版的 `SPINE_SHADOW_DIR`、`DSH_HOME` 环境变量在 Pi 版无对应物（见 #3）。
