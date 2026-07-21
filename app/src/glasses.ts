import {
  CreateStartUpPageContainer,
  ListContainerProperty,
  ListItemContainerProperty,
  RebuildPageContainer,
  StartUpPageCreateResult,
  TextContainerProperty,
  TextContainerUpgrade,
  type EvenAppBridge,
} from "@evenrealities/even_hub_sdk";
import type { Session } from "./api";

const TEXT_ID = 1;
const LIST_ID = 2;

export class GlassesRenderer {
  private initialized = false;

  constructor(private readonly bridge: EvenAppBridge) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const result = await this.bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 1,
        textObject: [this.text("Cursor G2\nスマホで接続設定してください")],
      }),
    );
    if (result !== StartUpPageCreateResult.success) {
      throw new Error(`G2 startup page creation failed: ${result}`);
    }
    this.initialized = true;
  }

  async sessions(items: Session[]): Promise<void> {
    const names = items.length
      ? items.slice(0, 20).map((item) => item.cwd.split("/").filter(Boolean).pop() || item.cwd)
      : ["セッションなし"];
    await this.bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 2,
        textObject: [new TextContainerProperty({
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 42,
          containerID: TEXT_ID,
          containerName: "header",
          content: "Cursor sessions",
          isEventCapture: 0,
        })],
        listObject: [new ListContainerProperty({
          xPosition: 0,
          yPosition: 45,
          width: 576,
          height: 243,
          containerID: LIST_ID,
          containerName: "sessions",
          isEventCapture: 1,
          itemContainer: new ListItemContainerProperty({
            itemCount: names.length,
            itemWidth: 552,
            isItemSelectBorderEn: 1,
            itemName: names,
          }),
        })],
      }),
    );
  }

  async chat(content: string, page: number, totalPages: number, state: string): Promise<void> {
    const body = `${state}  ${page + 1}/${Math.max(totalPages, 1)}\n${content || "タップして音声入力"}`;
    await this.bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 1,
        textObject: [this.text(body)],
      }),
    );
  }

  async updateChat(content: string, page: number, totalPages: number, state: string): Promise<void> {
    const body = `${state}  ${page + 1}/${Math.max(totalPages, 1)}\n${content || "タップして音声入力"}`;
    await this.bridge.textContainerUpgrade(new TextContainerUpgrade({
      containerID: TEXT_ID,
      containerName: "main",
      content: body,
    }));
  }

  async choices(title: string, choices: string[]): Promise<void> {
    await this.bridge.rebuildPageContainer(
      new RebuildPageContainer({
        containerTotalNum: 2,
        textObject: [new TextContainerProperty({
          xPosition: 0,
          yPosition: 0,
          width: 576,
          height: 72,
          containerID: TEXT_ID,
          containerName: "choice-title",
          content: title.slice(0, 120),
          isEventCapture: 0,
        })],
        listObject: [new ListContainerProperty({
          xPosition: 0,
          yPosition: 74,
          width: 576,
          height: 214,
          containerID: LIST_ID,
          containerName: "choices",
          isEventCapture: 1,
          itemContainer: new ListItemContainerProperty({
            itemCount: choices.length,
            itemWidth: 552,
            isItemSelectBorderEn: 1,
            itemName: choices.map((item) => item.slice(0, 80)),
          }),
        })],
      }),
    );
  }

  private text(content: string): TextContainerProperty {
    return new TextContainerProperty({
      xPosition: 0,
      yPosition: 0,
      width: 576,
      height: 288,
      containerID: TEXT_ID,
      containerName: "main",
      content,
      isEventCapture: 1,
    });
  }
}

export function paginate(text: string, size = 420): string[] {
  const normalized = text.replace(/\r/g, "").trim();
  if (!normalized) return [""];
  const pages: string[] = [];
  let rest = normalized;
  while (rest.length > size) {
    let cut = Math.max(rest.lastIndexOf("\n", size), rest.lastIndexOf(" ", size));
    if (cut < size * 0.6) cut = size;
    pages.push(rest.slice(0, cut).trim());
    rest = rest.slice(cut).trim();
  }
  pages.push(rest);
  return pages;
}
