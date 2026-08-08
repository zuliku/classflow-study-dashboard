/** 应用版本唯一来源：next.config.mjs 从 package.json 注入（build-time） */
export const APP_VERSION: string = process.env.NEXT_PUBLIC_APP_VERSION ?? "dev";
