// Vite 资源导入（tsconfig types 为空，这里手动声明 ?url 尾缀）
declare module "*?url" {
  const url: string;
  export default url;
}
