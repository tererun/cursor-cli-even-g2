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
import type { TermSession } from "./api";

const TEXT_ID = 1;
const LIST_ID = 2;

export class GlassesRenderer {
  private initialized = false;
  private operations: Promise<void> = Promise.resolve();

  constructor(private readonly bridge: EvenAppBridge) {}

  async initialize(): Promise<void> {
    if (this.initialized) return;
    const result = await this.bridge.createStartUpPageContainer(
      new CreateStartUpPageContainer({
        containerTotalNum: 1,
        textObject: [this.text("G2 Term\nBTキーボードを接続し\nスマホでbridgeを設定")],
      }),
    );
    if (result !== StartUpPageCreateResult.success) {
      throw new Error(`G2 startup page creation failed: ${result}`);
    }
    this.initialized = true;
  }

  async sessions(items: TermSession[]): Promise<void> {
    const names = items.length
      ? items.slice(0, 20).map((item) => item.title.slice(0, 64))
      : ["セッションなし"];
    await this.enqueue(async () => {
      const rebuilt = await this.bridge.rebuildPageContainer(
        new RebuildPageContainer({
          containerTotalNum: 2,
          textObject: [new TextContainerProperty({
            xPosition: 0,
            yPosition: 0,
            width: 576,
            height: 42,
            containerID: TEXT_ID,
            containerName: "header",
            content: "G2 Term sessions",
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
      if (!rebuilt) throw new Error("G2 session page rebuild failed");
    });
  }

  async terminal(content: string): Promise<void> {
    await this.enqueue(async () => {
      const rebuilt = await this.bridge.rebuildPageContainer(
        new RebuildPageContainer({
          containerTotalNum: 1,
          textObject: [this.text(content || " ")],
        }),
      );
      if (!rebuilt) throw new Error("G2 terminal page rebuild failed");
    });
  }

  async updateTerminal(content: string): Promise<void> {
    await this.enqueue(async () => {
      const updated = await this.bridge.textContainerUpgrade(new TextContainerUpgrade({
        containerID: TEXT_ID,
        containerName: "main",
        content: content || " ",
      }));
      if (!updated) throw new Error("G2 text update failed");
    });
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

  private enqueue(operation: () => Promise<void>): Promise<void> {
    const result = this.operations.then(operation);
    this.operations = result.catch(() => {});
    return result;
  }
}
