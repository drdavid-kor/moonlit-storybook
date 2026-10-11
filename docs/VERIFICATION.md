# Verification / 验证记录

Observed on the live prototype on 2026-10-11. These are prototype integration checks, not a child learning study.

以下为原型集成验证，不是儿童学习效果研究。

- A parent entered opportunity cost, cooperation and probability as three knowledge points. Saving began full-book preparation before any child chose a cover.
- Three books completed with six pages each. Their stored core concepts matched the parent inputs in order. The home shelf displayed their generated covers and actual titles together.
- Clicking a cover immediately opened Scene 1 with six page controls and no generation wait. Cloud job count did not increase.
- Refreshing during preparation resumed the same job. After a quota interruption, explicit continuation reused two completed books and prepared only the missing third; the old shelf stayed readable until the new group finished.
- Earlier continuation checks submitted a custom idea and rendered a new scene with the same hero and changed location/prop. The branch was saved locally.
- The public transcription API correctly transcribed a synthetic adult system-voice fixture. Physical microphone permissions, real children's speech and system narration playback were not verified.
- Desktop and 390×844 mobile viewport checks showed no horizontal overflow. Inputs, story cards and the parent dialog stayed inside the viewport. Viewport simulation is not a real-device performance test.
- Anonymous HTTPS access, protected session cookies, empty libraries for fresh visitors, rejection of known job IDs from a different visitor, private-path 404s, cross-origin rejection and invalid-input rejection were checked.
- JavaScript syntax and the Wrangler build dry run passed. No application errors appeared in the observed browser console.

画面为程序绘制的 SVG 模板，AI 输出正文与画面参数；这些检查不代表完成了逐幕 AI 插画、视频生成或教育效果验证。

Raw runtime records, provider receipts and browser session data remain local and are excluded from the public repository. The README preview is a curated screenshot of generated demo covers.

## Public repository checks / 公开仓库整理验证

- A clean copy of the tracked files passed `npm ci`, JavaScript syntax checks and the Wrangler dry run using only the example configuration.
- The bundled Python client and local server were checked without the installed credential helper or a real key: the UI loaded, the library was empty and generation returned configuration-required status. A mocked provider error verified that the portable client does not retry; no additional paid call was made for publication.
- Tracked files were checked against available credential values and common token/private-key signatures. Runtime records, private configuration, local paths, source maps and dependency/build directories were excluded.
