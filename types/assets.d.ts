/** Next.js 资源 URL 导入声明（pdf.worker.mjs?url 等） */
declare module "*.mjs?url" {
  const url: string;
  export default url;
}
