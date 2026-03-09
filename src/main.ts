import { mountApp } from "./ui/app.ts";

const container = document.querySelector<HTMLElement>("#app");

if (!container) {
  throw new Error("未找到应用挂载节点 #app");
}

mountApp(container);
