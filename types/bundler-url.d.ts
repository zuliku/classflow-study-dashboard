/** Vite/打包器资源导入声明（原 Next ?url 语义，桌面版同样适用） */
declare module "*.mjs?url" {
  const src: string;
  export default src;
}
