/**
 * 二进制对象的存储抽象（架构文档 §4/§8：huge 数据走 OPFS，按窗口流动）。
 *
 * 实现方必须支持流式与区间读写，调用方禁止把大文件整段装载进内存。
 */
export interface BinaryStore {
  /** 整体写入小对象（配置、元数据、一次性结果）。 */
  put(path: string, data: Uint8Array): Promise<void>;

  /** 整体读取小对象；不存在时返回 undefined。 */
  get(path: string): Promise<Uint8Array | undefined>;

  /** 流式写入大对象。 */
  putStream(path: string, stream: ReadableStream<Uint8Array>): Promise<void>;

  /** 流式读取大对象；不存在时返回 undefined。 */
  getStream(path: string): Promise<ReadableStream<Uint8Array> | undefined>;

  /** 按窗口读取 [offset, offset + length)。越界部分按实际可用长度返回。 */
  readRange(path: string, offset: number, length: number): Promise<Uint8Array>;

  delete(path: string): Promise<void>;

  has(path: string): Promise<boolean>;

  /** 按路径前缀列举（前缀按路径段语义，如 "artifacts/"）。 */
  list(prefix?: string): Promise<string[]>;

  /** 对象字节长度；不存在时返回 undefined。 */
  size(path: string): Promise<number | undefined>;

  /**
   * 文件句柄快照 Blob（不整段进内存）——大文件交给 BlobSource / 视频播放用。
   * 可选：实现方不支持时调用方回退 get()。
   */
  getBlob?(path: string): Promise<Blob | undefined>;
}
