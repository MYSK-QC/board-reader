# 开心消消乐棋盘读取插件

DSH 工具 `xxl_board` 通过已授权的 ADB 和 `su` 截取屏幕。每次调用都会重新定位格线。开局动画结束后调用即可取得本关坐标，无需填写行列数。

```sh
npm ci
npm test
npm pack
```

## 接入 DSH

将打包生成的 tgz 安装到对应的 DSH profile，例如桌面版：

```sh
dsh plugin --profile desktop add "file:/path/to/dsh-plugin-xxl-board-0.4.0.tgz"
```

重启对应的 DSH 实例后，调用 `xxl_board`。每次开局或棋盘停止动画后，DSH 可以再次调用获取当前坐标。插件只截屏和读盘；后续怎么使用这些坐标由 DSH 决定。

## 返回值

保留 `ok`、`grid`、`legend`、`rows`、`cols`、`x`、`y`、`cellSize` 和 `captureMs`。新增按行排列的 `cells`，每条包含从 1 开始的 `row`、`col`、格心屏幕像素坐标 `x`、`y`、`code` 和 `status`。新增 `coordinateMap`，按列标注格心 X、按行标注格心 Y，并在交叉位置显示格子代码。逐格可附带 `typeId`、`label` 和 `color`，颜色无法确认时为 `null`。已知动物颜色由校准文件中的 `colors` 提供。坐标对应 ADB 截图的像素尺寸。棋盘定位失败时返回 `{ ok: false, reason }`。

| 字符 | 含义 |
| --- | --- |
| `.` | 有格子，但当前没有棋子 |
| `~` | 与背景空洞参考图匹配 |
| `#`、`I`、`E`、`L`、`F` | 饼干盒、冰块、蛋形障碍、锁链、冰封大块。大块元素按占用的每格输出 |
| `K`、`D` | 钥匙、叶纹水滴形元素，状态为 `special` |
| `?` | 帧间有变化、分类太接近，或证据不足 |
| `!` | 未建档的未知外观，或单字符用尽后的已建档外观。用 `cells[].status` 和 `typeId` 区分 |
| `a–z`、`0–9` | 已记录的临时视觉类型 |
| 大写字母 | 已校准类型 |

## 配置与校准

- 默认取两帧，间隔 `frameDelayMs: 75`；同一位置外观变化时输出 `?`。设置 `frames: 1` 可降低延迟，此时不学习新类型。已有 ADB 参数 `adb`、`serial`、`mode` 仍可用。用 `node capture.cjs [serial]` 比较设备上的 pipe 和 pull。
- 自定义 `calibration` 或环境变量 `XXL_CALIBRATION` 指向 version 1 JSON。保留 `screen` 和 `board` 作为屏幕基准、格距和格线相位提示。默认在屏高 22%–87% 搜索，可配置 `searchY`。建议从截图裁切完整单格，加入 `references`，例如 `{"file":"refs/hole.png","code":"~","label":"空洞"}`。背景或主题变化较大时可以为同一代码添加多张参考图。2×2 障碍使用整块裁图和 `"span": 2`，识别时核对四格和各自的位置。单格障碍可以单独添加参考图。为参考图设置 `"kind": "obstacle"` 或 `"kind": "special"`，可以标记类型，并将它排除出棋盘定位的动物锚点。可用 `maxDistanceByCode`、`minMarginByCode` 设置某个代码的阈值，也可以在单张参考图上用 `maxDistance` 收紧匹配。
- 默认样本目录为用户目录下的 `.xxl-board/samples`。可用 `learnedDir` 或 `XXL_LEARNED_DIR` 改路径，`learnedDir: false` 关闭写入。样本保存颜色和空间分布特征。临时类型会在主色明显时附颜色名称。前 36 种保留单字符，之后仍能继续建档，DSH 可用逐格 `typeId` 区分。可修改 JSON 中的 `label`；要升级为正式动物或障碍类型，请将完整格子的 PNG 裁图加入校准文件。多种皮肤建议分开使用样本目录。进程异常退出遗留 `.write.lock` 时，确认没有进程写入后可删除该锁文件。

识别需要至少四个已校准的动物锚点，跨至少两行两列。行列范围来自能稳定识别出的格子边界。未校准的孔洞会保留为 `?`，完全缺乏可识别格子的外缘可能被裁掉。自动学习要求两帧稳定且有棋盘位置证据。未知外沿只有在同一行或列出现至少三个相似样本、并紧邻已识别动物时才会扩入；证据不足的格子保持不确定。临时标签描述外观，正式动物名需要经确认后加入校准。冰层与特殊障碍的判定依赖参考图。ADB 截图耗时随设备和连接变化。
