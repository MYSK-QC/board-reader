# 开心消消乐棋盘读取插件

DSH 工具 `xxl_board` 通过已授权的 ADB 和 `su` 截取屏幕。每次调用都会核对格线；已验证的格距和相位可复用，核对失败时会重新搜索。开局动画结束后调用即可取得本关坐标，无需填写行列数。

```sh
npm ci
npm test
npm pack
```

## 接入 DSH

将打包生成的 tgz 安装到对应的 DSH profile，例如桌面版：

```sh
dsh plugin --profile desktop add "file:/path/to/dsh-plugin-xxl-board-0.6.0.tgz"
```

重启对应的 DSH 实例后，调用 `xxl_board`。每次开局或棋盘停止动画后，DSH 可以再次调用获取当前坐标。插件只截屏和读盘；后续怎么使用这些坐标由 DSH 决定。

## 返回值

保留 `ok`、`grid`、`legend`、`rows`、`cols`、`x`、`y`、`cellSize` 和 `captureMs`。新增按行排列的 `cells`，每条包含从 1 开始的 `row`、`col`、格心屏幕像素坐标 `x`、`y`、`code` 和 `status`。新增 `coordinateMap`，按列标注格心 X、按行标注格心 Y，并在交叉位置显示格子代码。逐格可附带 `typeId`、`label` 和 `color`，颜色无法确认时为 `null`。已知动物颜色由校准文件中的 `colors` 提供。DSH 可按 `cells[].movable` 筛选已识别的普通棋子，未知类型和障碍都返回 `false`。坐标对应 ADB 截图的像素尺寸。棋盘定位失败时返回 `{ ok: false, reason }`。

| 字符 | 含义 |
| --- | --- |
| `.` | 有格子，但当前没有棋子 |
| `~` | 与背景空洞参考图匹配 |
| `#`、`I`、`E`、`L`、`F`、`C`、`V`、`W` | 饼干盒、冰块、蛋形障碍、锁链、冰封大块、蓝色花形冰障、绿色花形冰障、紫色企鹅目标。大块元素按占用的每格输出 |
| `K`、`D` | 钥匙、叶纹水滴形元素，状态为 `special` |
| `?` | 未确认的格子，包括帧间变化、证据不足、新外观和看起来像普通棋子的未确认元素。临时类型保留在逐格 `typeId`，并标记为不可移动 |
| 大写字母 | 已校准类型 |

## 配置与校准

- 默认取两帧，间隔 `frameDelayMs: 75`；同一位置外观变化时输出 `?`。双帧用于验证稳定性；每帧都要通过同样的轮廓校验。棋盘安定后可传 `{ "quick": true }` 或配置 `frames: 1`，只取一帧并复用已存在的标签。遇到新关、动画或不确定格，请用默认双帧。默认 `mode: auto` 优先让手机端用 gzip 无损压缩原始像素后再通过 ADB 传输。设备不支持时自动回退到原始像素或 PNG。也可指定 `gzip`、`raw`、`pipe` 或 `pull`。如运行过 `node capture.cjs [serial]`，默认优先使用该设备实测最快的方式。返回的 `captureMs`、`recognitionMs`、`totalMs` 和 `reusedGeometry` 可用于测量耗时。
- 自定义 `calibration` 或环境变量 `XXL_CALIBRATION` 指向 version 1 JSON。保留 `screen` 和 `board` 作为屏幕基准、格距和格线相位提示。默认在屏高 22%–87% 搜索，可配置 `searchY`。建议从截图裁切完整单格，加入 `references`，例如 `{"file":"refs/hole.png","code":"~","label":"空洞"}`。背景或主题变化较大时可以为同一代码添加多张参考图。2×2 障碍使用整块裁图和 `"span": 2`，识别时核对四格和各自的位置。单格障碍可以单独添加参考图。为参考图设置 `"kind": "obstacle"` 或 `"kind": "special"`，可以标记类型，并将它排除出棋盘定位的动物锚点。可用 `maxDistanceByCode`、`minMarginByCode` 设置某个代码的阈值，也可以在单张参考图上用 `maxDistance` 收紧匹配。暂未弄清类别的外观可以用 `"kind": "uncertain"` 登记。动物与冰类候选还要独立比对亮度边缘的方向和位置，轮廓不够接近或两类难区分时输出 `?`。使用 `"shapeOnly": true` 添加单格的纯轮廓样本，不影响颜色匹配。`contourIceCodes` 指定参与冰类轮廓检查的代码。
- 默认样本目录为用户目录下的 `.xxl-board/samples`。可用 `learnedDir` 或 `XXL_LEARNED_DIR` 改路径，`learnedDir: false` 关闭写入。样本保存颜色和空间分布特征。临时类型会在主色明显时附颜色名称。DSH 网格统一用 `?` 显示这些临时类型，DSH 可用逐格 `typeId` 区分。独立调用 `readBoard` 时可传 `unknownAsQuestion: true` 获得同一显示规则。可修改 JSON 中的 `label`；要升级为正式动物或障碍类型，请将完整格子的 PNG 裁图加入校准文件。多种皮肤建议分开使用样本目录。进程异常退出遗留 `.write.lock` 时，确认没有进程写入后可删除该锁文件。

识别需要至少四个已校准的动物锚点，跨至少两行两列。行列范围来自能稳定识别出的格子边界。未校准的孔洞会保留为 `?`，完全缺乏可识别格子的外缘可能被裁掉。自动学习要求两帧稳定且有棋盘位置证据。未知外沿只有在同一行或列出现至少三个相似样本、并紧邻已识别动物时才会扩入；证据不足的格子保持不确定。临时标签描述外观，正式动物名需要经确认后加入校准。冰层与特殊障碍的判定依赖参考图。ADB 截图耗时随设备和连接变化。
