export const help = `bcr-work — BCR 仓库中的共享制作引擎

  --root DIR                       指定作品工作区；默认使用当前工作区或 Runner 配置

  init PROJECT [--title 标题] [--no-install]
                                    创建标准草稿工程并登记
  draft PROJECT [--force]           按内容更新草稿估算时序
  status [PROJECT]                  工程、缓存与交付状态
  doctor [PROJECT]                  工具、依赖、时间轴、私有素材检查
  env                              按 uv.lock 同步独立音频环境
  check PROJECT|all                 类型/内容回归与音频验收
  audio PROJECT [--check] [--force]  按依赖执行旁白→对齐→混音→验收
  build PROJECT [--target ID]       Rspack 打包（内容不变直接复用）
  preview PROJECT [--target ID] [--port N]
  capture PROJECT [--target ID] [--frame N] [--output PATH]
  render PROJECT [--target ID] [--from N --to N] [--cq N]
         [--output PATH] [--concurrency N]
         [--encoder libaom-av1 --cpu-reason 原因]
  release PROJECT --from-dir DIR [--legacy]
                                    完整复制、校验、原子切换 current
  releases PROJECT                 交付版本列表
  import-history                   登记迁移基线中的旧交付，不复制/转码
  gc [--budget-gib N] [--apply]     清理工具缓存；默认仅展示
  gc --legacy-scratch [--apply]     清理旧 Runner 已结束任务的 project/bundle
  gc --dedup-snapshots [--apply]    按 SHA256 整理不可变源码快照
  verify-history                   校验迁移前成片、封面和素材的 SHA256

默认成片：AV1 NVENC + AAC/48kHz。样片与全片、自动检查与人工验收分别记录。
默认产物：工程/.bcr/production/artifacts；交付：工作区/.releases/工程/current。
`;
