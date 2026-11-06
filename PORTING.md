# PORTING.md — 与 DSH 原版的逐项差异

原版：dsh-live-compact 1.0.9（MerkyorLynn，MIT）。本表只记「被迫不同」处；
没列的即与原版一致（阈值、卡片算法、安全门、保留轮规则、双模式选段、文案结构）。

| # | 方面 | DSH 原版 | Pi 版 | 为什么 |
|---|---|---|---|---|
| 1 | 挂载点 | 继承宿主 `BasicCompactionEngine`，`agent/status idle` 后跑维护流程 | Pi 扩展 `turn_end` 边界，返回 `context_edit` 草案 | Pi 没有可替换的 compaction engine 类；turn_end 是官方可提议条目的边界（Phase 0 已实测形态成立） |
| 2 | 切的落地 | `session.append` compaction 三件套＋surface replace | span 首条 `context_edit` 替换为卡片、其余条目省略 | Pi 的投影机制原生支持按条目替换/省略，效果等价 |
| 3 | 原文指针 | 1.0.7 起改走会话日志序号（`seq 调用 -> result 序号`），shadow 文件只作宿主侧备份 | 同序号制：序号＝条目在投影列表中的 0 起序号（system 为 0）；卡片不再带 sha256/字节数，也不再附整段条目区间行 | Pi 会话是 append-only，原文天然在档，`context_edit` 本身就记录了被替换的条目；序号即足够定位 |
| 4 | token 计量 | 宿主 tokenMeter 逐节点计量 | 总量用 `ctx.getContextUsage()`；逐条目用原版 thunder.js 的 estimateTokens 估算 | Pi 不给逐条目计量 API。估算误差只影响选段边界，不影响安全门（安全门按原文行判定） |
| 5 | 工具配对检查 | 宿主 `toolPairingBalancedBefore/After` | 按 toolCall id 自行判定（切后不得有调用的结果落在 span 外；span 首条不得是孤儿 toolResult） | Pi 无此宿主函数；判定语义按 Pi compaction 文档的切点规则重述 |
| 6 | 「已切」识别 | 事件文本含 MARK，或 source.kind 为 `spine-checkpoint`（1.0.8 新）/旧 `compact-checkpoint` | 投影文本含 MARK（`Spine extract.`） | Pi 的 context_edit 替换内容只有文本、没有 source kind；标记天然可见且不依赖进程内状态（探针实测内存标记跨进程会失效）。连带差异：Pi 自带 compaction 触发时仍可能把卡片当普通文本再摘要，原版用新 kind 正是为躲开这一点，Pi 侧拦不住，属已知差异 |
| 7 | 大压缩（雷霆） | 仍走原版引擎模型摘要，本包的 thunder 优化默认关 | 不接管；Pi 自带 compaction 原样工作 | 等价对应原版「默认仍走原版」；SPINE_THUNDER 的 send-less 优化未移植，属原版默认关闭的实验路径 |
| 8 | planMessages | 摘要路径用（短用户消息收集等） | 未移植 | 本地切路径原版只用 buildCard；planMessages 只服务于模型摘要路径，Pi 侧该路径归 Pi 自带 compaction |
| 9 | 日志 | 宿主 logger 打 `spine cut …ms` | `ctx.ui.notify` 打 `spine cut xN total=A -> B` | Pi 扩展的可见输出通道不同；验收以会话内 context_edit 条目为准，不以日志为准 |
| 10 | 触发时机 | 一轮完整结束后（agent idle） | 每个 turn_end（一个 agent 回合可多轮） | Pi 无「idle 后维护」钩子；turn_end 更贴「边做边压」，且短尾规则保证刚说完的话留在尾巴里 |
| 11 | 后台任务 | 读宿主任务登记事件（job/registered、job/settled），卡上记已结束与未结束的任务 | 只报「启动原文落在被切段内」的任务（结果文本含 started background job 字样），一律记为切时未结束 | Pi 会话条目里没有任务登记事件流，已结束状态无从得知，不装作知道 |
| 12 | 轮次编号 | 宿主事件自带 turn 号，证据行与读文件标签照抄 | 按用户消息计数：条目所在的用户轮次即其 turn | Pi 条目没有宿主 turn 号；计数口径确定且可复算 |
| 13 | 备份/shadow | shadow 目录存原文＋256MB 轮转＋`searchShadow` 检索 API＋累计统计（`dsh-live-compact stats`） | 轮转与统计不移植；取回这一半由 #19 的 sidecar 存档＋`spine_recall` 工具补齐 | Pi 原文在会话文件里（见 #3），不需要第二份全量副本；但模型够不着会话条目，检索/取回必须由扩展自己给（见 #19），统计则没有宿主落点 |
| 14 | 模式判定输入 | `resolveEngine` 读宿主的请求头/上下文/服务商列表三级取址；1.0.9 起地址解析补成完整来源链 `resolveProviderBaseURL`（请求头 > 已列服务商 > 配置层 > 配置文件文本 > DeepSeek 官方 > 内置目录，读不到按本地） | 读 `ctx.model.provider` 与 `ctx.model.baseUrl`，取不到地址时用 `ctx.modelRegistry` 的模型列表按服务商查 `baseUrl`，再不行走原版同款 deepseek 兜底地址 | 判定函数本身（env 覆盖、strata 名、本地地址段含 100.64/10）与原版逐行一致，只是地址来源换成 Pi 的模型对象；Pi 给的本就是当前配置生效中的地址，正合 1.0.9「当前配置优先」的次序，来源链其余层级在 Pi 无对应物 |
| 15 | drain 的趟数与状态 | finishTurn 内连量连切最多 8 趟，每趟对真实会话面重新计量；turnBase/maxTurnGrowth 存在引擎实例里 | 一次 turn_end 内对**模拟条目表**连算多刀（切一刀就在表里换成卡再选下一刀），全部草案一次返回；增量预测状态只存活于单个 Pi 进程 | Pi 的 turn_end 一次只能交一批草案、交完才生效，没有「切完再量」的宿主回路；`pi -p` 每次调用是新进程，预测状态跨调用清零——但 drain 的另一触发线（总量 ≥48K）不依赖它，照样生效。1.0.9 两点收紧已同步：drain 触发要求增量基线 >0（静态总量过线不算，只有 48K 紧急线例外）；选段内不再绕过保留轮——原版靠逐趟重新计量、重新保留，Pi 侧模拟多刀每刀重跑 selectNewestChunk 本就重算保留轮，等价 |
| 16 | 指针卡的头 | 指针卡正文无 MARK，靠 source kind `spine-checkpoint` 识别 | 指针卡首行加 `Spine extract.` | Pi 没有 source kind，卡片身份只能靠文本标记（见 #6），否则下一轮选段认不出它、会把指针卡再切一遍 |
| 17 | 指针刀的多调用守护 | 宿主 commitSelectedSpan 整段替换 | 若承载调用的那条 assistant 消息里还有别的调用、且其结果落在 span 之外，拒绝这一刀 | Pi 的 context_edit 是整条替换：把那条消息换成指针卡会让 span 外的结果变孤儿。原版 surface 语义没有这个坑，Pi 侧多加一道守护 |
| 18 | CHUNK_MIN/CHUNK_MAX | 写死常量（1000 / 32000） | 原为提前采纳上游 issue #15 的建议而加；上游 1.0.9 已正式采纳（index.js 实读 env、默认 1000 / RAIL_TOKENS、`SPINE_POINTER_TOKENS` 默认跟随 CHUNK_MAX），现与上游一致，仅钳制 MIN ≤ MAX 为 Pi 侧保留 | issue #11 实测慢增长会话（一轮一个小工具调用）会被写死的 1000 下限整段挡死；给 Pi 侧留一个可调口子，默认行为与原版一字不差 |
| 19 | 原文取回 | 宿主 shadow 目录＋`searchShadow` API，模型/宿主可按需捞回原文 | 注册 `spine_recall` 工具（参考 billion-context 的 `acp_retrieve` 模式）：切时把段内最大的 3 条工具原文存入会话同目录的 sidecar（`<会话文件>.spine.jsonl`），卡上追加「原文存档」行给出 ref（条目 id）；取回 ≤24000 字直返、更大的写成文件返回路径，会话续接时按 sidecar 重载 | 只留序号指针、模型又够不着会话条目时，被切内容对模型等于丢失：2026-11-05 冒烟实证 DS 在任务中途反复重读刚被切的源文件（读 4 文件的任务跑出 48 条编辑、同一文件读 ≥3 次）；补取回后同场景复跑：源文件只读 1 次、模型改走 spine_recall、两条埋点信息答全，续接新进程再问仍能按 ref 取回 |
| 20 | 云端选段收紧（1.0.9） | 普通云端轮次什么都不切（超大结果也不再单独指针化）；只有 drain 或总量 ≥48000 才选段，指针只在当前尾段内找、扩段不越卡片与最后一条 user；本地支的 oversized 预扫描删除 | 逐行同步，无 Pi 侧差异；Pi 的官方 compaction 摘要（role `compactionSummary`）与自家卡一并算 checkpoint（原版 isCheckpoint 同样含官方 kind） | 原版行为变更，照单全收；2026-11-06 冒烟验：cloud 普通轮（总量 28K）零切割、drain 场景切割与答全照常 |
| 21 | 卡片覆盖门（1.0.9） | buildCard 全面改走来源溯源：原文按来源编号，硬行只从用户来源与工具摘录统计（`hasProtectedToolFact` 认硬事实）认，保留行逐行核对来源 id（checkCoverage）；助手正文里的决策形行（kebab 编号/`方案 X`）若会丢失，整卡否决；整段原文仍在未切区逐字站立的来源不再重复要求 | 逐行同步；Pi 侧 spans 由 select.ts 构造、无宿主 raw 备份字段，`rawPaths` 恒空 | 原版行为变更，照单全收；单测钉了三条：助手决策行否决、整段在 live 中不重复要求、工具硬事实经 stats 入卡 |
| 22 | 官方压缩冷却（1.0.9 新增 cooldown.js） | 宿主官方压缩产出新卡（source.kind `compact-checkpoint`）后，spine 的下一次动作跳过一刀（按 seq 判、每张新卡只跳一次）；可选时间窗 `SPINE_COOLDOWN_MS` 默认 0＝关 | 同语义映射到 Pi：投影里 `sourceEntry.type === "compaction"` 的最新条目 id 作判据，状态存扩展实例内；时间窗 env 同名同义 | Pi 的官方摘要以 compaction 条目投影（role `compactionSummary`），无 source.kind 可读，条目 id 是等价的身份判据；处理器级单测验过「跳一刀、再切如常、新 compaction 再跳一次」 |

已知未覆盖：DSH 原版的 `SPINE_SHADOW_DIR`、`DSH_HOME` 环境变量在 Pi 版无对应物（见 #13）。
