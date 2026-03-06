# Codex Longrun 无中断执行增强任务拆分

## Tag

`codex_longrun_uninterrupted_20260306`

## 任务 1：定义无中断执行契约

目标：

- 明确区分“普通聊天实现”和“runner 连续执行”
- 保持现有 runner-controlled 架构不变
- 明确用户说“开始实现”时的预期行为和边界

产出：

- 需求文档已落地
- AGENTS/Skill 文案和 CLI 输出使用统一术语：
  - longrun runner
  - auto-continue
  - active tag

## 任务 2：增加项目内稳定启动入口

目标：

- 初始化 Codex longrun 资产时，同时生成一个项目内启动入口
- 让 AGENTS/Skill 不再只是笼统提示“运行 task-master codex run”，而是指向一个明确、固定的项目内入口

建议实现：

- 生成项目内启动脚本或命令包装器
- 启动入口默认使用当前激活 tag
- 启动入口默认启用前台日志输出和自动连续执行

验收：

- `task-master codex init` 后可看到项目内启动入口文件
- AGENTS hook 引导 Codex 执行该入口，而不是自由发挥

## 任务 3：强化 AGENTS / Skill 的触发契约

目标：

- 强化“开始实现”触发时的行为约束
- 明确禁止 Codex 在聊天流中直接逐任务实现
- 进入 longrun 时必须先调用项目内启动入口

验收：

- AGENTS hook 和 skill addendum 同步更新
- 文案中明确：
  - 不要在普通聊天模式下直接实现任务
  - 用户说“开始实现”时必须进入 longrun runner

## 任务 4：增强前台执行可观察性

目标：

- longrun 一启动就让用户知道当前模式正确
- 在任务 1 开始前输出足够多的模式信息

建议输出：

- longrun 已启动
- 当前 tag
- executor
- model
- reasoning effort
- auto-continue 开启状态
- 终止条件

验收：

- 终端在开始阶段即可判断“当前确实进入了连续执行模式”

## 任务 5：补齐测试

目标：

- 为新入口、AGENTS 文案、CLI 启动输出增加回归测试
- 防止后续再退回“提示词存在但入口不稳定”的状态

测试范围：

- `codex init` 生成的资产和输出
- AGENTS hook 中的 longrun 触发契约
- `codex run` 的启动信息输出

## 任务 6：真实场景验证

目标：

- 使用一个临时本地项目进行端到端验证
- 至少验证 3 个可顺序执行任务

验收：

1. 拆分任务完成
2. 在 Codex 对话上下文中触发“开始实现”
3. 实际进入 longrun runner
4. 连续完成多个任务而不逐任务询问
5. 任务状态自动回写
6. 最终输出总结

## 实施顺序

建议顺序：

1. 任务 2：项目内稳定入口
2. 任务 3：强化 AGENTS / Skill 触发契约
3. 任务 4：增强前台可观察性
4. 任务 5：补测试
5. 任务 6：真实场景验证
